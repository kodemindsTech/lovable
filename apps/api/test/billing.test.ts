import { beforeEach, describe, expect, it } from "vitest";
import { applyEvent, type BillingEvent, type SubscriptionState } from "@fitness-os/core";
import { buildApp } from "../src/app";
import { FakeBillingProvider, type BillingStore } from "../src/billing";
import type { Deps, UserScope } from "../src/deps";
import { input } from "./fixtures";

const SECRET = "test-secret";
const T0 = "2026-01-01T00:00:00.000Z";
const day = (n: number) => new Date(Date.parse(T0) + n * 864e5).toISOString();

interface S { plan: string; sub: { planId: string; interval: string; status: string; providerSubscriptionId: string | null } | null; trialOk: boolean; priceMissing: boolean; storeFails: boolean;
  states: Map<string, SubscriptionState>; seen: Set<string>; applied: string[]; feature: boolean; consume: "ok" | "not_in_plan" | "quota_exceeded" }
let s: S; let provider: FakeBillingProvider;

const scope = (): UserScope => ({
  userId: "u1", hasConsent: async () => true, flagEnabled: async () => true, hasFeature: async () => s.feature,
  consumeQuota: async () => s.consume, getPrice: async (p, i) => (s.priceMissing ? null : { amountMinor: p === "pro" ? 29900 : 49900, currency: "INR", providerPriceId: `price_${p}_${i}` }),
  getSubscription: async () => s.sub, currentPlan: async () => s.plan, trialEligible: async () => s.trialOk, email: () => "u@example.com",
  loadContextInput: async () => input, loadReport: async () => { throw new Error("not used"); }, saveNarrative: async () => undefined,
  openConversation: async () => ({ id: "11111111-1111-1111-1111-111111111111", history: [] }), saveTurn: async () => undefined,
});
const store = (): BillingStore => ({
  getState: async (u) => s.states.get(u) ?? null,
  config: async () => ({ graceDays: 7, periodSkewHours: 12, trialDays: 7 }),
  apply: async (a) => {
    if (s.storeFails) throw new Error("db down");
    if (s.seen.has(a.providerEventId)) return "duplicate";
    s.seen.add(a.providerEventId); s.applied.push(a.type);
    if (!a.state) return "no_state"; s.states.set(a.userId, a.state); return "applied";
  },
});
const app = () => {
  const deps: Deps = { authenticate: async (t) => (t === "good" ? scope() : null), llm: null, billing: { provider, store: store(), appUrl: "https://app.example.com/" } };
  return buildApp(deps, { rateLimitPerMin: 100 });
};
const auth = { authorization: "Bearer good" };
const hook = (a: ReturnType<typeof app>, id: string, event: BillingEvent, o: { sig?: string; user?: string } = {}) => {
  const raw = JSON.stringify({ id, user_id: o.user ?? "u1", event });
  return a.inject({ method: "POST", url: "/webhooks/billing", headers: { "content-type": "application/json", "x-billing-signature": o.sig ?? provider.sign(raw) }, payload: raw });
};
const started: BillingEvent = { type: "subscription_started", at: T0, planId: "pro", interval: "month", periodEnd: day(30), providerSubscriptionId: "sub_1" };

beforeEach(() => {
  provider = new FakeBillingProvider(SECRET);
  s = { plan: "free", sub: null, trialOk: true, priceMissing: false, storeFails: false, states: new Map(), seen: new Set(), applied: [], feature: true, consume: "ok" };
});

describe("checkout", () => {
  it("creates a checkout with server-fixed redirects, DB price, and a trial for first-time Pro", async () => {
    const r = await app().inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: { plan: "pro", interval: "month" } });
    expect(r.statusCode).toBe(200); expect(r.json().trial_days).toBe(7);
    const call = provider.calls[0]!.args as Record<string, unknown>;
    expect(call).toMatchObject({ planId: "pro", amountMinor: 29900, currency: "INR", providerPriceId: "price_pro_month", trialDays: 7, successUrl: "https://app.example.com/subscription?checkout=success" });
  });
  it("no trial when already used, or for Pro+", async () => {
    s.trialOk = false; expect((await app().inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: { plan: "pro", interval: "month" } })).json().trial_days).toBe(0);
    s.trialOk = true; expect((await app().inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: { plan: "pro_plus", interval: "month" } })).json().trial_days).toBe(0);
  });
  it("ignores client-supplied redirect urls and prices", async () => {
    await app().inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: { plan: "pro", interval: "month", success_url: "https://evil.example", amount: 1 } });
    expect(JSON.stringify(provider.calls[0]!.args)).not.toMatch(/evil|"amountMinor":1[,}]/);
  });
  it("auth, validation, unknown price, already subscribed, and not-configured", async () => {
    const a = app();
    expect((await a.inject({ method: "POST", url: "/v1/billing/checkout", payload: { plan: "pro", interval: "month" } })).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: { plan: "free", interval: "month" } })).statusCode).toBe(400);
    s.priceMissing = true; expect((await a.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: { plan: "pro", interval: "month" } })).statusCode).toBe(404);
    s.priceMissing = false; s.plan = "pro"; expect((await a.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: { plan: "pro_plus", interval: "month" } })).statusCode).toBe(409);
    const none = buildApp({ authenticate: async () => scope(), llm: null }); expect((await none.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload: { plan: "pro", interval: "month" } })).statusCode).toBe(503);
  });
});

describe("cancel & change", () => {
  beforeEach(() => { s.sub = { planId: "pro", interval: "month", status: "active", providerSubscriptionId: "sub_1" }; });
  it("cancel defaults to end of period and defers to the provider", async () => {
    const r = await app().inject({ method: "POST", url: "/v1/billing/cancel", headers: auth, payload: {} });
    expect(r.statusCode).toBe(200); expect(provider.calls[0]).toMatchObject({ method: "cancel", args: { providerSubscriptionId: "sub_1", atPeriodEnd: true } });
    expect(r.json().pending_confirmation).toBe(true);
  });
  it("cancel without a subscription → 404", async () => { s.sub = null; expect((await app().inject({ method: "POST", url: "/v1/billing/cancel", headers: auth, payload: {} })).statusCode).toBe(404); });
  it("upgrade is immediate, downgrade is at renewal, same plan is rejected", async () => {
    const up = (await app().inject({ method: "POST", url: "/v1/billing/change", headers: auth, payload: { plan: "pro_plus", interval: "month" } })).json();
    expect(up.takes_effect).toBe("now");
    s.sub = { planId: "pro_plus", interval: "month", status: "active", providerSubscriptionId: "sub_1" };
    const down = (await app().inject({ method: "POST", url: "/v1/billing/change", headers: auth, payload: { plan: "pro", interval: "month" } })).json();
    expect(down.takes_effect).toBe("next_renewal");
    expect((await app().inject({ method: "POST", url: "/v1/billing/change", headers: auth, payload: { plan: "pro_plus", interval: "month" } })).statusCode).toBe(409);
  });
});

describe("webhooks", () => {
  it("rejects bad or missing signatures without touching the store", async () => {
    const a = app();
    expect((await hook(a, "e1", started, { sig: "00".repeat(32) })).statusCode).toBe(400);
    expect((await hook(a, "e1", started, { sig: "" })).statusCode).toBe(400);
    expect((await hook(a, "e1", started, { sig: "zz" })).statusCode).toBe(400);
    expect(s.applied).toEqual([]);
  });
  it("applies the full lifecycle through the state machine", async () => {
    const a = app();
    expect((await hook(a, "e1", started)).json().outcome).toBe("applied");
    expect(s.states.get("u1")!.status).toBe("active");
    await hook(a, "e2", { type: "payment_failed", at: day(30) });
    expect(s.states.get("u1")!).toMatchObject({ status: "past_due", graceUntil: day(37) });
    await hook(a, "e3", { type: "payment_succeeded", at: day(32), periodEnd: day(60) });
    expect(s.states.get("u1")).toMatchObject({ status: "active", graceUntil: null });
    await hook(a, "e4", { type: "cancel_requested", at: day(40), atPeriodEnd: true });
    expect(s.states.get("u1")!.cancelAtPeriodEnd).toBe(true);
    await hook(a, "e5", { type: "subscription_expired", at: day(61) });
    expect(s.states.get("u1")!.status).toBe("expired");
  });
  it("is idempotent: redelivered events are acknowledged but not re-applied", async () => {
    const a = app(); await hook(a, "e1", started);
    const again = await hook(a, "e1", started); expect(again.statusCode).toBe(200); expect(again.json().outcome).toBe("duplicate"); expect(s.applied).toHaveLength(1);
  });
  it("events for unknown subscriptions are recorded with no state; stale ones keep the newer state", async () => {
    const a = app();
    expect((await hook(a, "e0", { type: "payment_failed", at: day(1) })).json().outcome).toBe("no_state");
    await hook(a, "e1", started); await hook(a, "e2", { type: "payment_succeeded", at: day(30), periodEnd: day(60) });
    await hook(a, "e3", { type: "payment_failed", at: day(10) });
    expect(s.states.get("u1")!.status).toBe("active");
  });
  it("returns 500 (so the provider retries) when storage fails, without leaking details", async () => {
    s.storeFails = true; const r = await hook(app(), "e1", started); expect(r.statusCode).toBe(500); expect(r.body).not.toMatch(/db down/);
  });
  it("ignores well-signed payloads that aren't events we use", async () => {
    const raw = JSON.stringify({ hello: "world" });
    const r = await app().inject({ method: "POST", url: "/webhooks/billing", headers: { "content-type": "application/json", "x-billing-signature": provider.sign(raw) }, payload: raw });
    expect(r.statusCode).toBe(200); expect(r.json().outcome).toBe("ignored_event");
  });
});

describe("feature gating on AI endpoints", () => {
  const coach = (message = "What should I eat tonight?") => app().inject({ method: "POST", url: "/v1/coach/messages", headers: auth, payload: { message, local_date: "2026-01-15", local_hour: 12 } });
  it("free users get 402 upgrade_required for the coach and report summaries", async () => {
    s.feature = false;
    const r = await coach(); expect(r.statusCode).toBe(402); expect(r.json()).toMatchObject({ code: "upgrade_required", feature: "ai_coach" });
    const rep = await app().inject({ method: "POST", url: "/v1/reports/narrative", headers: auth, payload: { kind: "week", start: "2026-01-12", local_date: "2026-01-15" } });
    expect(rep.statusCode).toBe(402); expect(rep.json().feature).toBe("weekly_reports");
  });
  it("safety replies are never gated", async () => {
    s.feature = false;
    const r = await coach("I want to kill myself"); expect(r.statusCode).toBe(200); expect(r.json().source).toBe("safety");
  });
});

it("state machine used by the webhook matches core (sanity)", () => {
  expect(applyEvent(null, started)!.status).toBe("active");
});
