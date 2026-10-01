import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, makeDb, newUser, onboardingPayload } from "./harness";

let db: PGlite; let a: string; let b: string; let foodId: string;
const today = "2026-01-15";

beforeAll(async () => {
  db = await makeDb();
  a = await newUser(db, "a@x.com"); b = await newUser(db, "b@x.com");
  foodId = (await db.query<{ id: string }>("select id from foods where name = 'Roti (chapati)'")).rows[0]!.id;
  await as(db, a, async () => {
    await db.query("select complete_onboarding($1::jsonb)", [JSON.stringify(onboardingPayload)]);
    await db.query("select log_food($1, $2, 'lunch', 2)", [foodId, today]);
    await db.query("insert into water_logs(user_id, local_date, ml) values ($1, $2, 500)", [a, today]);
    await db.query("insert into foods(owner_id,name,serving_size,serving_unit,calories,protein_g,carbs_g,fat_g,fibre_g,source,verification_status) values ($1,'Aunty ladoo',1,'piece',200,3,30,8,1,'user','user_entered')", [a]);
  });
});

const userTables = ["profiles","goals","nutrition_targets","target_history","consents","meal_logs","food_logs","water_logs"];

describe("RLS isolation", () => {
  for (const t of userTables)
    it(`user B cannot read user A's ${t}`, async () => {
      const q = `select count(*)::int c from ${t} where user_id = '${a}'`;
      const mine = await as(db, a, () => db.query(q));
      expect((mine.rows[0] as { c: number }).c).toBeGreaterThan(0);
      const theirs = await as(db, b, () => db.query(q));
      expect((theirs.rows[0] as { c: number }).c).toBe(0);
    });

  it("anon sees nothing", async () => {
    for (const t of userTables) {
      const r = await as(db, null, () => db.query(`select count(*)::int c from ${t}`).catch(() => ({ rows: [{ c: 0 }] })));
      expect((r.rows[0] as { c: number }).c).toBe(0);
    }
  });

  it("B cannot update or delete A's rows", async () => {
    await as(db, b, async () => {
      await db.query("update profiles set name = 'hacked' where user_id = $1", [a]);
      await db.query("delete from food_logs where user_id = $1", [a]);
      await db.query("delete from water_logs where user_id = $1", [a]);
    });
    const p = await as(db, a, () => db.query("select name from profiles where user_id = $1", [a]));
    expect((p.rows[0] as { name: string }).name).toBe("Asha");
    const n = await as(db, a, () => db.query("select count(*)::int c from food_logs"));
    expect((n.rows[0] as { c: number }).c).toBe(1);
  });

  it("B cannot insert rows for A", async () => {
    await expect(as(db, b, () => db.query("insert into water_logs(user_id, local_date, ml) values ($1,$2,100)", [a, today]))).rejects.toThrow();
    await expect(as(db, b, () => db.query("insert into goals(user_id, goal, start_weight_kg) values ($1,'maintain',70)", [a]))).rejects.toThrow();
  });

  it("B cannot log into A's meal", async () => {
    const m = (await db.query<{ id: string }>("select id from meal_logs limit 1")).rows[0]!.id;
    await expect(as(db, b, () => db.query(
      "insert into food_logs(user_id,meal_log_id,name,quantity,serving_label,calories,protein_g,carbs_g,fat_g,fibre_g,source_status) values ($1,$2,'x',1,'1',1,1,1,1,1,'user_entered')", [b, m]))).rejects.toThrow();
  });

  it("user-created foods are private and always user_entered", async () => {
    const own = await as(db, a, () => db.query("select count(*)::int c from foods where name = 'Aunty ladoo'"));
    expect((own.rows[0] as { c: number }).c).toBe(1);
    const other = await as(db, b, () => db.query("select count(*)::int c from foods where name = 'Aunty ladoo'"));
    expect((other.rows[0] as { c: number }).c).toBe(0);
    await expect(as(db, b, () => db.query("insert into foods(owner_id,name,serving_size,serving_unit,calories,protein_g,carbs_g,fat_g,fibre_g,source,verification_status) values ($1,'Fake',1,'g',1,1,1,1,1,'x','verified')", [b]))).rejects.toThrow();
  });

  it("users cannot modify the shared catalog", async () => {
    await as(db, a, () => db.query("update foods set calories = 0 where owner_id is null"));
    const r = await db.query("select count(*)::int c from foods where owner_id is null and calories = 0");
    expect((r.rows[0] as { c: number }).c).toBe(0);
  });

  it("non-admins cannot read admin tables or write settings", async () => {
    await db.query("insert into app_settings values ('k','1')");
    await expect(as(db, a, () => db.query("insert into app_settings values ('x','1')"))).rejects.toThrow();
    const r = await as(db, a, () => db.query("select count(*)::int c from audit_logs"));
    expect((r.rows[0] as { c: number }).c).toBe(0);
  });
});
