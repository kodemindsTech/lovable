import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, givePlan, makeDb, newUser } from "./harness";

let db: PGlite; let a: string; let b: string;
const count = async (who: string, q: string) => ((await as(db, who, () => db.query(q))).rows[0] as { c: number }).c;

beforeAll(async () => {
  db = await makeDb(); a = await newUser(db, "a@x.com"); b = await newUser(db, "b@x.com");
  await givePlan(db, a, "pro"); await givePlan(db, b, "pro");
});

describe("AI consent", () => {
  it("defaults to false; latest decision wins", async () => {
    const has = async () => ((await as(db, a, () => db.query("select has_ai_consent() v"))).rows[0] as { v: boolean }).v;
    expect(await has()).toBe(false);
    await as(db, a, () => db.query("insert into consents(user_id,purpose,granted,policy_version) values ($1,'ai_processing',true,'v1')", [a]));
    expect(await has()).toBe(true);
    await as(db, a, () => db.query("insert into consents(user_id,purpose,granted,policy_version) values ($1,'ai_processing',false,'v1')", [a]));
    expect(await has()).toBe(false);
  });
});

describe("AI quota", () => {
  it("allows up to the limit, then refuses", async () => {
    await db.query("update plan_features set daily_limit = 2 where plan_id = 'pro' and feature_key = 'ai_coach'");
    const r1 = await as(db, a, () => db.query("select ai_consume('coach') r"));
    expect((r1.rows[0] as { r: number }).r).toBe(1);
    await as(db, a, () => db.query("select ai_consume('coach')"));
    await expect(as(db, a, () => db.query("select ai_consume('coach')"))).rejects.toThrow(/quota_exceeded/);
  });
  it("is per user", async () => { await as(db, b, () => db.query("select ai_consume('coach')")); });
  it("users cannot reset it by deleting or inserting usage rows", async () => {
    await as(db, a, async () => { await db.query("delete from ai_usage"); });
    expect(await count(a, "select count(*)::int c from ai_usage")).toBe(2);
    await expect(as(db, a, () => db.query("insert into ai_usage(user_id, kind) values ($1,'coach')", [a]))).rejects.toThrow();
    await expect(as(db, a, () => db.query("update ai_usage set created_at = now() - interval '2 days'"))).resolves.toBeDefined();
    await expect(as(db, a, () => db.query("select ai_consume('coach')"))).rejects.toThrow(/quota_exceeded/);
  });
  it("fails closed when unconfigured or unauthenticated", async () => {
    await expect(as(db, b, () => db.query("select ai_consume('unknown_kind')"))).rejects.toThrow(/not_configured/);
    await db.query("update plan_features set daily_limit = null where plan_id='pro' and feature_key='weekly_reports'");
    await expect(as(db, b, () => db.query("select ai_consume('report')"))).rejects.toThrow(/not_configured/);
    await db.query("update plan_features set daily_limit = 10 where plan_id='pro' and feature_key='weekly_reports'");
    await expect(as(db, null, () => db.query("select ai_consume('coach')"))).rejects.toThrow();
  });
});

describe("AI conversations RLS", () => {
  it("are private; users cannot post into others' conversations", async () => {
    const conv = await as(db, a, async () => (await db.query<{ id: string }>("insert into ai_conversations(user_id) values ($1) returning id", [a])).rows[0]!.id);
    await as(db, a, () => db.query("insert into ai_messages(conversation_id,user_id,role,content,source) values ($1,$2,'user','hi',null)", [conv, a]));
    expect(await count(a, "select count(*)::int c from ai_messages")).toBe(1);
    expect(await count(b, "select count(*)::int c from ai_messages")).toBe(0);
    expect(await count(b, "select count(*)::int c from ai_conversations")).toBe(0);
    await expect(as(db, b, () => db.query("insert into ai_messages(conversation_id,user_id,role,content) values ($1,$2,'user','x')", [conv, b]))).rejects.toThrow();
  });
  it("account deletion removes conversations, messages and usage", async () => {
    await as(db, a, () => db.query("select delete_my_account()"));
    for (const t of ["ai_conversations", "ai_messages", "ai_usage"])
      expect(((await db.query(`select count(*)::int c from ${t} where user_id = $1`, [a])).rows[0] as { c: number }).c, t).toBe(0);
  });
});
