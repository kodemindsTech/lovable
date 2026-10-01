import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, givePlan, makeAdmin, makeDb, newUser, onboardingPayload } from "./harness";

let db: PGlite;
let sup: string, con: string, fin: string, boss: string, u1: string, u2: string, supp2: string;
const count = async (who: string | null, q: string) => ((await as(db, who, () => db.query(q))).rows[0] as { c: number }).c;
const audit = async (like: string) => ((await db.query("select count(*)::int c from audit_logs where target like $1 or action like $1", [like])).rows[0] as { c: number }).c;

beforeAll(async () => {
  db = await makeDb();
  [sup, con, fin, boss, u1, u2, supp2] = await Promise.all(["sup", "con", "fin", "boss", "u1", "u2", "supp2"].map((n) => newUser(db, `${n}@x.com`)));
  await makeAdmin(db, sup!, "support"); await makeAdmin(db, con!, "content"); await makeAdmin(db, fin!, "finance"); await makeAdmin(db, boss!, "super"); await makeAdmin(db, supp2!, "support");
  await as(db, u1!, async () => {
    await db.query("select complete_onboarding($1::jsonb)", [JSON.stringify(onboardingPayload)]);
    const f = (await db.query<{ id: string }>("select id from foods limit 1")).rows[0]!.id;
    await db.query("select log_food($1,'2026-01-15','lunch',1)", [f]);
    await db.query("insert into foods(owner_id,name,serving_size,serving_unit,calories,protein_g,carbs_g,fat_g,fibre_g,source,verification_status) values ($1,'Secret family dish',1,'g',1,1,1,1,1,'u','user_entered')", [u1]);
    await db.query("insert into weight_logs(user_id, local_date, weight_kg) values ($1,'2026-01-15',80)", [u1]);
  });
});

describe("role-based permissions", () => {
  it("regular users have no admin powers and can't self-promote", async () => {
    expect(await count(u1!, "select count(*)::int c from admin_users")).toBe(0);
    await expect(as(db, u1!, () => db.query("insert into admin_users(user_id, role) values ($1,'super')", [u1]))).rejects.toThrow();
    await expect(as(db, u1!, () => db.query("select admin_metrics()"))).rejects.toThrow(/forbidden/);
    await expect(as(db, u1!, () => db.query("select * from admin_list_users()"))).rejects.toThrow(/forbidden/);
    await expect(as(db, u1!, () => db.query("select admin_add_admin('u1@x.com','super')"))).rejects.toThrow(/forbidden/);
    expect(((await as(db, u1!, () => db.query("select my_admin_role() r"))).rows[0] as { r: string | null }).r).toBeNull();
  });
  it("only super manages admins; others can read only their own row", async () => {
    await expect(as(db, con!, () => db.query("insert into admin_users(user_id, role) values ($1,'support')", [u2]))).rejects.toThrow();
    await expect(as(db, con!, () => db.query("select admin_add_admin('u2@x.com','support')"))).rejects.toThrow(/forbidden/);
    expect(await count(con!, "select count(*)::int c from admin_users")).toBe(1);
    await as(db, boss!, () => db.query("select admin_add_admin('u2@x.com','content')"));
    expect(await count(boss!, "select count(*)::int c from admin_users")).toBeGreaterThan(4);
    await as(db, boss!, () => db.query("delete from admin_users where user_id = $1", [u2]));
  });
  it("content admins manage the shared catalog; others cannot", async () => {
    await as(db, con!, () => db.query("update foods set verification_status = 'admin_reviewed' where name = 'Paneer'"));
    expect(await count(con!, "select count(*)::int c from foods where name='Paneer' and verification_status='admin_reviewed'")).toBe(1);
    await as(db, fin!, () => db.query("update foods set verification_status = 'verified' where name = 'Poha'"));
    await as(db, sup!, () => db.query("delete from exercises where name = 'Plank'"));
    expect(await count(boss!, "select count(*)::int c from foods where name='Poha' and verification_status='verified'")).toBe(0);
    expect(await count(boss!, "select count(*)::int c from exercises where name='Plank'")).toBe(1);
    await as(db, con!, () => db.query("insert into exercises(owner_id,name,muscle_group,equipment) values (null,'Cable Woodchop','Core','Cable')"));
    expect(await count(boss!, "select count(*)::int c from exercises where name='Cable Woodchop'")).toBe(1);
  });
  it("finance edits pricing; content cannot", async () => {
    await as(db, fin!, () => db.query("update plan_prices set amount_minor = 31900 where plan_id='pro' and interval='month'"));
    await as(db, con!, () => db.query("update plan_prices set amount_minor = 1 where plan_id='pro' and interval='year'"));
    const r = await db.query<{ i: string; a: number }>("select interval i, amount_minor a from plan_prices where plan_id='pro' order by interval");
    expect(r.rows).toEqual([{ i: "month", a: 31900 }, { i: "year", a: 199900 }]);
    await db.query("update plan_prices set amount_minor = 29900 where plan_id='pro' and interval='month'");
  });
  it("system settings and flags: super only", async () => {
    await expect(as(db, fin!, () => db.query("insert into app_settings values ('x','1')"))).rejects.toThrow();
    await as(db, boss!, () => db.query("update feature_flags set enabled = false where key = 'announcements'"));
    await as(db, con!, () => db.query("update feature_flags set enabled = true where key = 'announcements'"));
    expect(await count(boss!, "select count(*)::int c from feature_flags where key='announcements' and enabled")).toBe(0);
    await as(db, boss!, () => db.query("update feature_flags set enabled = true where key = 'announcements'"));
  });
  it("the last super admin cannot be removed or demoted", async () => {
    await expect(as(db, boss!, () => db.query("delete from admin_users where user_id = $1", [boss]))).rejects.toThrow(/last super/);
    await expect(as(db, boss!, () => db.query("update admin_users set role='support' where user_id = $1", [boss]))).rejects.toThrow(/last super/);
  });
});

describe("admins do NOT get users' private data", () => {
  it("cannot read health logs, private foods, conversations, consents or profiles of users", async () => {
    for (const t of ["food_logs", "meal_logs", "weight_logs", "workout_sessions", "profiles", "consents", "nutrition_targets", "goals", "ai_messages", "activities"])
      for (const who of [sup!, boss!, fin!, con!]) expect(await count(who, `select count(*)::int c from ${t} where user_id = '${u1}'`), `${t} as admin`).toBe(0);
    expect(await count(boss!, "select count(*)::int c from foods where name = 'Secret family dish'")).toBe(0);
  });
  it("user directory exposes only account basics and is audited", async () => {
    const before = await audit("view_users");
    const rows = (await as(db, sup!, () => db.query<Record<string, unknown>>("select * from admin_list_users('u1')"))).rows;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["created_at", "email", "onboarding_completed", "plan", "sub_status", "user_id"]);
    expect(rows[0]).toMatchObject({ email: "u1@x.com", plan: "free", onboarding_completed: true });
    expect(await audit("view_users")).toBe(before + 1);
    await expect(as(db, con!, () => db.query("select * from admin_list_users()"))).rejects.toThrow(/forbidden/);
  });
  it("metrics are aggregates only", async () => {
    const m = (await as(db, fin!, () => db.query<{ m: Record<string, unknown> }>("select admin_metrics() m"))).rows[0]!.m;
    expect(m.total_users).toBeGreaterThan(5); expect(m.food_logs_30d).toBeDefined(); expect(m.ltv_minor).toBeNull();
    expect(JSON.stringify(m)).not.toMatch(/@|u1/);
  });
});

describe("audit logging", () => {
  it("records admin edits of shared data with old/new, but not users' own edits", async () => {
    const before = await audit("foods:%");
    await as(db, con!, () => db.query("update foods set calories = calories + 1 where name = 'Idli'"));
    expect(await audit("foods:%")).toBe(before + 1);
    const meta = (await db.query<{ meta: { old: { calories: string }; new: { calories: string } } }>("select meta from audit_logs where target like 'foods:%' order by id desc limit 1")).rows[0]!.meta;
    expect(Number(meta.new.calories)).toBe(Number(meta.old.calories) + 1);
    const actor = (await db.query<{ actor_id: string }>("select actor_id from audit_logs order by id desc limit 1")).rows[0]!.actor_id;
    expect(actor).toBe(con);
    await as(db, u1!, () => db.query("update foods set calories = 5 where name = 'Secret family dish'"));
    expect(await audit("foods:%")).toBe(before + 1);
  });
  it("audits pricing, settings, admin changes; only super can read the log", async () => {
    await as(db, fin!, () => db.query("update plan_prices set amount_minor = amount_minor where plan_id='pro_plus'"));
    await as(db, boss!, () => db.query("update app_settings set value = value where key='billing'"));
    expect(await audit("plan_prices:%")).toBeGreaterThan(0); expect(await audit("app_settings:%")).toBeGreaterThan(0); expect(await audit("admin_users:%")).toBeGreaterThan(0);
    expect(await count(boss!, "select count(*)::int c from audit_logs")).toBeGreaterThan(3);
    for (const who of [sup!, con!, fin!, u1!]) expect(await count(who, "select count(*)::int c from audit_logs")).toBe(0);
  });
  it("audit entries cannot be altered by admins", async () => {
    await as(db, boss!, () => db.query("delete from audit_logs"));
    await as(db, boss!, () => db.query("update audit_logs set action = 'x'"));
    expect(await audit("x")).toBe(0); expect(await audit("%")).toBeGreaterThan(3);
  });
});

describe("feedback", () => {
  it("users submit and see only their own; support/content triage; users can't self-triage", async () => {
    await as(db, u1!, () => db.query("insert into feedback(user_id, category, message, page) values ($1,'bug','Steps look wrong','/activity')", [u1]));
    await expect(as(db, u1!, () => db.query("insert into feedback(user_id, category, message, status) values ($1,'bug','x','closed')", [u1]))).rejects.toThrow();
    await expect(as(db, u2!, () => db.query("insert into feedback(user_id, category, message) values ($1,'bug','x')", [u1]))).rejects.toThrow();
    await expect(as(db, u1!, () => db.query("insert into feedback(user_id, category, message) values ($1,'bug','')", [u1]))).rejects.toThrow();
    expect(await count(u2!, "select count(*)::int c from feedback")).toBe(0);
    expect(await count(sup!, "select count(*)::int c from feedback")).toBe(1);
    expect(await count(fin!, "select count(*)::int c from feedback")).toBe(0);
    await as(db, sup!, () => db.query("update feedback set status = 'reviewed', admin_note = 'looking' "));
    await as(db, u1!, () => db.query("update feedback set status = 'closed'"));
    expect(await count(boss!, "select count(*)::int c from feedback where status = 'reviewed'")).toBe(1);
    expect(await audit("feedback:%")).toBe(1);
  });
});

describe("announcements", () => {
  it("content admins publish; audience, window and active flag respected; dismiss is per user", async () => {
    await as(db, con!, async () => {
      await db.query("insert into notifications(title, body, audience, created_by) values ('Hello all','body','all',$1)", [con]);
      await db.query("insert into notifications(title, body, audience) values ('Paid only','body','paid')");
      await db.query("insert into notifications(title, body, audience) values ('Free only','body','free')");
      await db.query("insert into notifications(title, body, starts_at) values ('Future','body', now() + interval '1 day')");
      await db.query("insert into notifications(title, body, ends_at) values ('Expired','body', now() - interval '1 day')");
      await db.query("insert into notifications(title, body, active) values ('Off','body', false)");
    });
    const titles = async (who: string) => (await as(db, who, () => db.query<{ title: string }>("select title from notifications order by title"))).rows.map((r) => r.title);
    expect(await titles(u2!)).toEqual(["Free only", "Hello all"]);
    const paid = await newUser(db, "paid@x.com"); await givePlan(db, paid, "pro");
    expect(await titles(paid)).toEqual(["Hello all", "Paid only"]);
    await expect(as(db, u2!, () => db.query("insert into notifications(title, body) values ('x','y')"))).rejects.toThrow();
    const id = (await db.query<{ id: string }>("select id from notifications where title='Hello all'")).rows[0]!.id;
    await as(db, u2!, () => db.query("insert into notification_dismissals values ($1,$2)", [u2, id]));
    expect(await count(u1!, "select count(*)::int c from notification_dismissals")).toBe(0);
  });
});

describe("feature flags", () => {
  it("rollout is deterministic per user and respects enabled/percent", async () => {
    const flags = async (who: string) => (await as(db, who, () => db.query<{ f: Record<string, boolean> }>("select my_flags() f"))).rows[0]!.f;
    expect((await flags(u1!)).ai_coach).toBe(true);
    await as(db, boss!, () => db.query("update feature_flags set rollout_percent = 0 where key='ai_coach'"));
    expect((await flags(u1!)).ai_coach).toBe(false);
    await as(db, boss!, () => db.query("update feature_flags set rollout_percent = 50 where key='ai_coach'"));
    const users = await Promise.all(Array.from({ length: 40 }, (_, i) => newUser(db, `r${i}@x.com`)));
    const a: boolean[] = [], b: boolean[] = [];
    for (const x of users) a.push((await flags(x)).ai_coach);   // sequential: the test DB is a single connection
    for (const x of users) b.push((await flags(x)).ai_coach);
    expect(a).toEqual(b); expect(a.filter(Boolean).length).toBeGreaterThan(5); expect(a.filter(Boolean).length).toBeLessThan(35);
    await as(db, boss!, () => db.query("update feature_flags set rollout_percent = 100, enabled = false where key='ai_coach'"));
    expect((await flags(u1!)).ai_coach).toBe(false);
    await as(db, boss!, () => db.query("update feature_flags set enabled = true where key='ai_coach'"));
  });
});

describe("analytics & metrics", () => {
  it("track_event records allowed events only, respects withdrawal of consent", async () => {
    await as(db, u2!, async () => { await db.query("select track_event('food_logged')"); await db.query("select track_event('app_opened')"); });
    expect(await count(u2!, "select count(*)::int c from events")).toBe(3); // incl. signup
    await expect(as(db, u2!, () => db.query("select track_event('credit_card_number')"))).rejects.toThrow();
    await expect(as(db, u2!, () => db.query("insert into events(user_id, name) values ($1,'food_logged')", [u1]))).rejects.toThrow();
    await as(db, u2!, () => db.query("insert into consents(user_id,purpose,granted,policy_version) values ($1,'analytics',false,'v1')", [u2]));
    await as(db, u2!, () => db.query("select track_event('food_logged')"));
    expect(await count(u2!, "select count(*)::int c from events")).toBe(3);
    expect(await count(u1!, "select count(*)::int c from events where user_id = '" + u2 + "'")).toBe(0);
  });
  it("sign-ups are recorded as events automatically", async () => {
    expect(((await db.query("select count(*)::int c from events where name = 'signup' and user_id = $1", [u1])).rows[0] as { c: number }).c).toBe(1);
  });
  it("DAU/WAU/MAU, retention, conversion, churn, MRR are computed from real rows", async () => {
    const d = await newUser(db, "m1@x.com"), e = await newUser(db, "m2@x.com"), pay = await newUser(db, "pay@x.com");
    await db.query("update profiles set created_at = now() - interval '10 days' where user_id in ($1,$2)", [d, e]);
    await db.query("insert into events(user_id, name, created_at) values ($1,'app_opened', now() - interval '9 days'), ($1,'app_opened', now() - interval '3 days'), ($2,'app_opened', now() - interval '40 days')", [d, e]);
    await db.query("insert into events(user_id, name) values ($1,'app_opened')", [d]);
    await givePlan(db, pay, "pro", { status: "active" });
    await db.query("insert into subscriptions(user_id, plan_id, interval, status, last_event_at) select id,'pro','month','expired', now() - interval '5 days' from auth.users where email='r0@x.com'");
    const m = (await as(db, boss!, () => db.query<{ m: Record<string, number | null | Record<string, number | null>> }>("select admin_metrics() m"))).rows[0]!.m;
    expect(m.dau as number).toBeGreaterThanOrEqual(1); expect(m.wau as number).toBeGreaterThanOrEqual(m.dau as number); expect(m.mau as number).toBeGreaterThanOrEqual(m.wau as number);
    const ret = m.retention as Record<string, number | null>;
    expect(ret.d1).toBe(50); // of the two 10-day-old users, only one had an event the day after signup
    // paying: `pay` + the Pro user from the announcements test; churned: the expired subscription
    expect(m.paying_users).toBe(2); expect(m.churned_30d).toBe(1); expect(m.monthly_churn_pct).toBe(33.3);
    expect(m.mrr_minor).toBe(59800); expect(m.arppu_minor).toBe(29900); expect(m.ever_paid_users).toBe(3);
  });
});

describe("AI monitoring", () => {
  it("flagged exchanges are pseudonymised, role-gated and audited; stats are aggregate", async () => {
    await as(db, u1!, async () => {
      const c = (await db.query<{ id: string }>("insert into ai_conversations(user_id) values ($1) returning id", [u1])).rows[0]!.id;
      await db.query("insert into ai_messages(conversation_id,user_id,role,content) values ($1,$2,'user','I keep making myself vomit')", [c, u1]);
      await db.query("insert into ai_messages(conversation_id,user_id,role,content,source,safety_flag) values ($1,$2,'assistant','Please talk to a professional','safety',true)", [c, u1]);
      await db.query("insert into ai_messages(conversation_id,user_id,role,content) values ($1,$2,'user','What should I eat?')", [c, u1]);
      await db.query("insert into ai_messages(conversation_id,user_id,role,content,source) values ($1,$2,'assistant','Eat protein','ai')", [c, u1]);
    });
    const before = await audit("view_flagged%");
    const rows = (await as(db, sup!, () => db.query<Record<string, unknown>>("select * from admin_flagged_messages()"))).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "safety", user_message: "I keep making myself vomit", reply: "Please talk to a professional" });
    expect(Object.keys(rows[0]!).sort()).toEqual(["created_at", "message_id", "reply", "source", "user_message"]);
    expect(await audit("view_flagged%")).toBe(before + 1);
    await expect(as(db, fin!, () => db.query("select * from admin_flagged_messages()"))).rejects.toThrow(/forbidden/);
    const st = (await as(db, sup!, () => db.query<{ s: { by_source: Record<string, number>; safety_flagged: number } }>("select admin_ai_stats(30) s"))).rows[0]!.s;
    expect(st.by_source).toEqual({ safety: 1, ai: 1 }); expect(st.safety_flagged).toBe(1);
  });
});

describe("privacy lifecycle", () => {
  it("deleting a user removes their feedback, events and dismissals", async () => {
    await as(db, u1!, () => db.query("select delete_my_account()"));
    for (const t of ["feedback", "events", "notification_dismissals"]) expect(((await db.query(`select count(*)::int c from ${t} where user_id = $1`, [u1])).rows[0] as { c: number }).c, t).toBe(0);
  });
});
