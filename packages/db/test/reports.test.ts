import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, givePlan, makeDb, newUser, onboardingPayload } from "./harness";

let db: PGlite; let a: string; let b: string;
const count = async (who: string, q: string) => ((await as(db, who, () => db.query(q))).rows[0] as { c: number }).c;
beforeAll(async () => { db = await makeDb(); a = await newUser(db, "a@x.com"); b = await newUser(db, "b@x.com"); });

describe("reports schema", () => {
  it("onboarding stores TDEE", async () => {
    await as(db, a, () => db.query("select complete_onboarding($1::jsonb)", [JSON.stringify(onboardingPayload)]));
    expect(await count(a, "select tdee::int c from nutrition_targets")).toBe(2100);
  });
  it("onboarding still works without TDEE (older clients)", async () => {
    const p = { ...onboardingPayload, targets: { ...onboardingPayload.targets, tdee: undefined } };
    await as(db, b, () => db.query("select complete_onboarding($1::jsonb)", [JSON.stringify(p)]));
    expect(await count(b, "select count(*)::int c from nutrition_targets where tdee is null")).toBe(1);
  });
  it("weekly_reports are private per user", async () => {
    await as(db, a, () => db.query("insert into weekly_reports(user_id, week_start, report) values ($1,'2026-01-12','{}')", [a]));
    expect(await count(b, "select count(*)::int c from weekly_reports")).toBe(0);
    await expect(as(db, b, () => db.query("insert into weekly_reports(user_id, week_start, report) values ($1,'2026-01-19','{}')", [a]))).rejects.toThrow();
  });
  it("report quota comes from the plan", async () => {
    await givePlan(db, a, "pro");
    const left = await as(db, a, () => db.query("select ai_consume('report') r"));
    expect((left.rows[0] as { r: number }).r).toBe(9);
  });
  it("deletion cascades reports", async () => {
    await as(db, a, () => db.query("select delete_my_account()"));
    expect(((await db.query("select count(*)::int c from weekly_reports where user_id = $1", [a])).rows[0] as { c: number }).c).toBe(0);
  });
});
