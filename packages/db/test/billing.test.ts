import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyEvent, effectivePlan, type BillingEvent, type SubscriptionState } from "../../core/src";
import { as, asService, givePlan, makeDb, newUser } from "./harness";

let db: PGlite; let u: string; let v: string;
const count = async (who: string, q: string) => ((await as(db, who, () => db.query(q))).rows[0] as { c: number }).c;
const plan = async (who: string, now?: string) => ((await db.query<{ p: string }>("select effective_plan($1, coalesce($2::timestamptz, now())) p", [who, now ?? null])).rows[0]!.p);
const day = (n: number, from = "2026-01-01T00:00:00.000Z") => new Date(Date.parse(from) + n * 864e5).toISOString();
const toSql = (s: SubscriptionState) => ({ plan_id: s.planId, interval: s.interval, status: s.status, current_period_end: s.currentPeriodEnd, trial_end: s.trialEnd,
  cancel_at_period_end: s.cancelAtPeriodEnd, grace_until: s.graceUntil, pending_plan_id: s.pendingPlanId, pending_interval: s.pendingInterval, last_event_at: s.lastEventAt,
  provider_customer_id: s.providerCustomerId, provider_subscription_id: s.providerSubscriptionId });
const apply = (uid: string, id: string, ev: BillingEvent, st: SubscriptionState | null) =>
  asService(db, async () => (await db.query<{ r: string }>("select apply_subscription_event($1::jsonb) r", [JSON.stringify({ provider: "fake", provider_event_id: id, type: ev.type, user_id: uid, occurred_at: ev.at, payload: {}, state: st ? toSql(st) : null })])).rows[0]!.r);

beforeAll(async () => { db = await makeDb(); u = await newUser(db, "u@x.com"); v = await newUser(db, "v@x.com"); });

describe("entitlements", () => {
  it("defaults to free with no features", async () => {
    const e = (await as(db, u, () => db.query<{ e: { plan: string; features: string[]; trial_eligible: boolean; subscription: unknown } }>("select current_entitlements() e"))).rows[0]!.e;
    expect(e.plan).toBe("free"); expect(e.features).toEqual([]); expect(e.subscription).toBeNull(); expect(e.trial_eligible).toBe(true);
  });
  it("pro and pro_plus get their configured features", async () => {
    await givePlan(db, u, "pro");
    let e = (await as(db, u, () => db.query<{ e: { plan: string; features: string[] } }>("select current_entitlements() e"))).rows[0]!.e;
    expect(e.plan).toBe("pro"); expect(e.features).toEqual(expect.arrayContaining(["ai_coach", "weekly_reports", "daily_fitness_score", "workout_progression"])); expect(e.features).not.toContain("ai_meal_planning");
    await givePlan(db, u, "pro_plus");
    e = (await as(db, u, () => db.query<{ e: { plan: string; features: string[] } }>("select current_entitlements() e"))).rows[0]!.e;
    expect(e.features).toContain("ai_meal_planning");
  });
});

describe("SQL effective_plan matches the TypeScript state machine", () => {
  const T0 = "2026-01-01T00:00:00.000Z";
  const started: BillingEvent = { type: "subscription_started", at: T0, planId: "pro", interval: "month", periodEnd: day(30) };
  const scenarios: [string, BillingEvent[], number[]][] = [
    ["active", [started], [5, 30.2, 31]],
    ["trial", [{ ...started, trialEnd: day(7), periodEnd: day(7) } as BillingEvent], [3, 8]],
    ["past_due grace", [started, { type: "payment_failed", at: day(30) }], [31, 36, 38]],
    ["cancel at period end", [started, { type: "cancel_requested", at: day(5), atPeriodEnd: true }], [20, 31]],
    ["immediate cancel", [started, { type: "cancel_requested", at: day(5), atPeriodEnd: false }], [6]],
    ["expired", [started, { type: "subscription_expired", at: day(31) }], [31]],
  ];
  for (const [name, evs, probes] of scenarios)
    it(name, async () => {
      const who = await newUser(db, `${name.replace(/\W/g, "")}@x.com`);
      let st: SubscriptionState | null = null; let i = 0;
      for (const e of evs) { st = applyEvent(st, e); await apply(who, `${name}-${i++}`, e, st); }
      for (const d of probes) { const at = day(d); expect(await plan(who, at), `${name} @ day ${d}`).toBe(effectivePlan(st, at)); }
    });
});

describe("server-only writes & idempotency", () => {
  const ev: BillingEvent = { type: "subscription_started", at: day(0), planId: "pro", interval: "month", periodEnd: day(30), trialEnd: day(7) };
  it("users cannot create or edit subscriptions or call the apply function", async () => {
    await expect(as(db, v, () => db.query("insert into subscriptions(user_id,plan_id,interval,status,current_period_end) values ($1,'pro','month','active', now() + interval '1 year')", [v]))).rejects.toThrow();
    await expect(as(db, v, () => db.query("select apply_subscription_event('{}'::jsonb)"))).rejects.toThrow();
    await as(db, u, () => db.query("update subscriptions set plan_id = 'pro_plus', status = 'active'"));
    expect(await plan(v)).toBe("free");
  });
  it("applies once; duplicate provider events are ignored", async () => {
    const st = applyEvent(null, ev)!;
    expect(await apply(v, "evt-1", ev, st)).toBe("applied");
    expect(await apply(v, "evt-1", ev, st)).toBe("duplicate");
    expect(await count(v, "select count(*)::int c from subscriptions")).toBe(1);
    expect(await plan(v, day(2))).toBe("pro");
  });
  it("trial use is remembered (no second trial)", async () => {
    const e = (await as(db, v, () => db.query<{ e: { trial_eligible: boolean } }>("select current_entitlements() e"))).rows[0]!.e;
    expect(e.trial_eligible).toBe(false);
  });
  it("stale events are recorded but not applied", async () => {
    const st = applyEvent(null, ev)!; const newer = applyEvent(st, { type: "payment_succeeded", at: day(7), periodEnd: day(37) })!;
    expect(await apply(v, "evt-2", { type: "payment_succeeded", at: day(7), periodEnd: day(37) }, newer)).toBe("applied");
    const stale: BillingEvent = { type: "payment_failed", at: day(3) };
    expect(await apply(v, "evt-3", stale, applyEvent(st, stale))).toBe("ignored");
    expect(await plan(v, day(20))).toBe("pro");
  });
  it("users cannot read other users' subscriptions or any events", async () => {
    expect(await count(u, `select count(*)::int c from subscriptions where user_id = '${v}'`)).toBe(0);
    expect(await count(v, "select count(*)::int c from subscription_events")).toBe(0);
  });
});

describe("AI gating by plan", () => {
  it("free users cannot use AI features; paid users can", async () => {
    const f = await newUser(db, "free@x.com");
    await expect(as(db, f, () => db.query("select ai_consume('coach')"))).rejects.toThrow(/feature_not_in_plan/);
    await expect(as(db, f, () => db.query("select ai_consume('report')"))).rejects.toThrow(/feature_not_in_plan/);
    const paid = await newUser(db, "paid@x.com"); await givePlan(db, paid, "pro");
    expect(((await as(db, paid, () => db.query("select ai_consume('coach') r"))).rows[0] as { r: number }).r).toBe(19);
  });
  it("lapsed or past-grace users lose access immediately", async () => {
    const g = await newUser(db, "lapsed@x.com");
    await givePlan(db, g, "pro", { periodEnd: new Date(Date.now() - 3 * 864e5).toISOString() });
    await expect(as(db, g, () => db.query("select ai_consume('coach')"))).rejects.toThrow(/feature_not_in_plan/);
    await givePlan(db, g, "pro", { status: "past_due", graceUntil: new Date(Date.now() + 864e5).toISOString() });
    await expect(as(db, g, () => db.query("select ai_consume('coach')"))).resolves.toBeDefined();
    await givePlan(db, g, "pro", { status: "past_due", graceUntil: new Date(Date.now() - 864e5).toISOString() });
    await expect(as(db, g, () => db.query("select ai_consume('coach')"))).rejects.toThrow(/feature_not_in_plan/);
  });
});

describe("pricing is data", () => {
  it("is publicly readable, configurable, and not writable by users", async () => {
    const anon = await as(db, null, () => db.query<{ plan_id: string; amount_minor: number }>("select plan_id, interval, amount_minor from plan_prices order by plan_id, interval"));
    expect(anon.rows.map((r) => `${r.plan_id}:${r.amount_minor}`)).toEqual(["pro:29900", "pro:199900", "pro_plus:49900"]);
    await as(db, u, () => db.query("update plan_prices set amount_minor = 1"));
    expect(((await db.query("select min(amount_minor)::int m from plan_prices")).rows[0] as { m: number }).m).toBe(29900);
    await expect(as(db, u, () => db.query("insert into plan_prices(plan_id,interval,amount_minor) values ('pro','month',1) on conflict do nothing returning 1"))).rejects.toThrow();
  });
  it("account deletion removes subscription data", async () => {
    await as(db, v, () => db.query("select delete_my_account()"));
    for (const t of ["subscriptions", "subscription_events"]) expect(((await db.query(`select count(*)::int c from ${t} where user_id = $1`, [v])).rows[0] as { c: number }).c, t).toBe(0);
  });
});
