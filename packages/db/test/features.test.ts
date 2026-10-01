import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, makeDb, newUser, onboardingPayload } from "./harness";

let db: PGlite; let a: string; let foodId: string;
const d = "2026-01-15";
const id = async (name: string) => (await db.query<{ id: string }>("select id from foods where name = $1", [name])).rows[0]!.id;

beforeAll(async () => {
  db = await makeDb(); a = await newUser(db, "a@x.com");
  foodId = await id("Roti (chapati)");
});

describe("onboarding", () => {
  it("is atomic and writes everything", async () => {
    await as(db, a, () => db.query("select complete_onboarding($1::jsonb)", [JSON.stringify(onboardingPayload)]));
    for (const [t, n] of [["goals", 1], ["nutrition_targets", 1], ["target_history", 1], ["consents", 1]] as const) {
      const r = await db.query(`select count(*)::int c from ${t}`);
      expect((r.rows[0] as { c: number }).c).toBe(n);
    }
    const p = await db.query("select onboarding_completed ok from profiles where user_id = $1", [a]);
    expect((p.rows[0] as { ok: boolean }).ok).toBe(true);
  });
  it("rolls back fully on failure and rejects under-18", async () => {
    const u = await newUser(db, "c@x.com");
    await expect(as(db, u, () => db.query("select complete_onboarding($1::jsonb)", [JSON.stringify({ ...onboardingPayload, age: 17 })]))).rejects.toThrow(/18/);
    await expect(as(db, u, () => db.query("select complete_onboarding($1::jsonb)", [JSON.stringify({ ...onboardingPayload, goal: "bogus" })]))).rejects.toThrow();
    const r = await db.query("select count(*)::int c from consents where user_id = $1", [u]);
    expect((r.rows[0] as { c: number }).c).toBe(0);
  });
  it("requires authentication", async () => {
    await expect(as(db, null, () => db.query("select complete_onboarding($1::jsonb)", [JSON.stringify(onboardingPayload)]))).rejects.toThrow();
  });
});

describe("food logging", () => {
  it("computes the snapshot server-side and totals correctly", async () => {
    await as(db, a, async () => {
      await db.query("select log_food($1,$2,'breakfast',2)", [foodId, d]);               // 2 rotis
      await db.query("select log_food($1,$2,'lunch',1.5)", [await id("Chicken breast (cooked)"), d]); // 150 g
      await db.query("insert into water_logs(user_id,local_date,ml) values ($1,$2,250)", [a, d]);
    });
    const t = (await as(db, a, () => db.query("select * from day_totals($1)", [d]))).rows[0] as Record<string, string>;
    expect(Number(t.calories)).toBeCloseTo(120 * 2 + 165 * 1.5);
    expect(Number(t.protein_g)).toBeCloseTo(3.6 * 2 + 31 * 1.5);
    expect(Number(t.fibre_g)).toBeCloseTo(6);
    expect(Number(t.water_ml)).toBe(250);
  });
  it("totals are empty for a day with no logs", async () => {
    const t = (await as(db, a, () => db.query("select * from day_totals('2026-02-01')"))).rows[0] as Record<string, string>;
    expect(Number(t.calories)).toBe(0);
  });
  it("edit rescales; delete removes", async () => {
    const row = (await as(db, a, () => db.query<{ id: string }>("select id from food_logs where name like 'Roti%'"))).rows[0]!;
    await as(db, a, () => db.query("select update_food_log_quantity($1, 3)", [row.id]));
    let t = (await as(db, a, () => db.query("select * from day_totals($1)", [d]))).rows[0] as Record<string, string>;
    expect(Number(t.calories)).toBeCloseTo(120 * 3 + 165 * 1.5);
    await as(db, a, () => db.query("delete from food_logs where id = $1", [row.id]));
    t = (await as(db, a, () => db.query("select * from day_totals($1)", [d]))).rows[0] as Record<string, string>;
    expect(Number(t.calories)).toBeCloseTo(165 * 1.5);
  });
  it("snapshot is unaffected by later catalog edits", async () => {
    await db.query("update foods set calories = 999 where name = 'Chicken breast (cooked)'");
    const t = (await as(db, a, () => db.query("select * from day_totals($1)", [d]))).rows[0] as Record<string, string>;
    expect(Number(t.calories)).toBeCloseTo(165 * 1.5);
  });
  it("rejects invalid quantities", async () => {
    await expect(as(db, a, () => db.query("select log_food($1,$2,'dinner',0)", [foodId, d]))).rejects.toThrow();
    await expect(as(db, a, () => db.query("select log_food($1,$2,'dinner',-1)", [foodId, d]))).rejects.toThrow();
  });
});

describe("search", () => {
  const s = async (q: string) => (await as(db, a, () => db.query<{ name: string }>("select name from search_foods($1, 5)", [q]))).rows.map((r) => r.name);
  it("finds by name prefix, alias and typo", async () => {
    expect((await s("roti"))[0]).toBe("Roti (chapati)");
    expect(await s("phulka")).toContain("Roti (chapati)");
    expect(await s("biryaani")).toEqual(expect.arrayContaining([expect.stringContaining("biryani")]));
  });
  it("returns nothing for blank input", async () => expect(await s("  ")).toEqual([]));
  it("seed is labelled as estimates, never verified", async () => {
    const r = await db.query("select distinct verification_status s from foods where owner_id is null");
    expect(r.rows).toEqual([{ s: "ai_estimated" }]);
  });
});

describe("account deletion", () => {
  it("removes all of the user's data and none of others'", async () => {
    const other = await newUser(db, "o@x.com");
    await as(db, other, () => db.query("insert into water_logs(user_id,local_date,ml) values ($1,$2,100)", [other, d]));
    await as(db, a, () => db.query("select delete_my_account()"));
    for (const t of ["profiles","goals","nutrition_targets","target_history","consents","meal_logs","food_logs","water_logs"]) {
      const r = await db.query(`select count(*)::int c from ${t} where user_id = $1`, [a]);
      expect((r.rows[0] as { c: number }).c, t).toBe(0);
    }
    expect((await db.query("select count(*)::int c from water_logs where user_id = $1", [other])).rows[0]).toEqual({ c: 1 });
    expect((await db.query("select count(*)::int c from audit_logs where action='account_deleted'")).rows[0]).toEqual({ c: 1 });
  });
  it("anon cannot call it", async () => {
    await expect(as(db, null, () => db.query("select delete_my_account()"))).rejects.toThrow();
  });
});
