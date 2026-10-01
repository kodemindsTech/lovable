import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, makeDb, newUser } from "./harness";

let db: PGlite; let a: string; let b: string;
const count = async (who: string, q: string) => ((await as(db, who, () => db.query(q))).rows[0] as { c: number }).c;
const d = "2026-01-15";

beforeAll(async () => {
  db = await makeDb(); a = await newUser(db, "a@x.com"); b = await newUser(db, "b@x.com");
  await as(db, a, async () => {
    await db.query("select set_steps($1, 8000)", [d]);
    await db.query("select log_run($1, 5.2, 31.5, 320, null)", [d]);
    await db.query("select set_weight($1, 81.2)", [d]);
    await db.query("insert into body_measurements(user_id, local_date, waist_cm) values ($1,$2,86)", [a, d]);
    await db.query("insert into user_integrations(user_id, provider, status) values ($1,'strava','disconnected')", [a]).catch(() => {});
  });
});

describe("activity & weight", () => {
  it("steps: one entry per day, re-entry replaces", async () => {
    await as(db, a, () => db.query("select set_steps($1, 11420)", [d]));
    expect(await count(a, `select count(*)::int c from activities where type='steps' and local_date='${d}'`)).toBe(1);
    expect(await count(a, "select steps::int c from activities where type='steps'")).toBe(11420);
  });
  it("runs store no heart rate unless provided, and are manual-sourced", async () => {
    const r = (await as(db, a, () => db.query("select a.source, r.avg_heart_rate from activities a join running_sessions r on r.activity_id = a.id"))).rows[0];
    expect(r).toEqual({ source: "manual", avg_heart_rate: null });
  });
  it("weight: one per day, upsert", async () => {
    await as(db, a, () => db.query("select set_weight($1, 80.8)", [d]));
    expect(await count(a, "select count(*)::int c from weight_logs")).toBe(1);
    expect(await count(a, "select weight_kg::float c from weight_logs")).toBeCloseTo(80.8);
  });
  it("validates inputs", async () => {
    await expect(as(db, a, () => db.query("select set_weight($1, 5)", [d]))).rejects.toThrow();
    await expect(as(db, a, () => db.query("select log_run($1, 0, 30)", [d]))).rejects.toThrow();
    await expect(as(db, a, () => db.query("select log_run($1, 5, 0)", [d]))).rejects.toThrow();
    await expect(as(db, a, () => db.query("select set_steps($1, -1)", [d]))).rejects.toThrow();
    await expect(as(db, a, () => db.query("insert into body_measurements(user_id, local_date) values ($1,'2026-01-16')", [a]))).rejects.toThrow();
    await expect(as(db, a, () => db.query("insert into body_measurements(user_id, local_date, body_fat_pct, body_fat_source) values ($1,'2026-01-16',20,'ai_estimate')", [a]))).rejects.toThrow();
  });
  it("users cannot self-assert a connected integration", async () => {
    await expect(as(db, a, () => db.query("insert into user_integrations(user_id, provider, status, connected_at) values ($1,'fitbit','connected',now())", [a]))).rejects.toThrow();
  });
});

describe("activity RLS", () => {
  for (const t of ["activities", "running_sessions", "weight_logs", "body_measurements"])
    it(`B cannot see A's ${t}`, async () => {
      expect(await count(a, `select count(*)::int c from ${t}`)).toBeGreaterThan(0);
      expect(await count(b, `select count(*)::int c from ${t}`)).toBe(0);
    });
  it("B cannot modify A's data or attach a run to A's activity", async () => {
    const act = (await db.query<{ id: string }>("select id from activities where type='run'")).rows[0]!.id;
    await as(db, b, async () => {
      await db.query("update weight_logs set weight_kg = 40", []);
      await db.query("delete from activities", []);
    });
    expect(await count(a, "select count(*)::int c from activities")).toBe(2);
    expect(await count(a, "select count(*)::int c from weight_logs where weight_kg = 40")).toBe(0);
    await expect(as(db, b, () => db.query("insert into running_sessions(activity_id, user_id) values ($1,$2)", [act, b]))).rejects.toThrow();
  });
  it("account deletion cascades", async () => {
    await as(db, a, () => db.query("select delete_my_account()"));
    for (const t of ["activities", "running_sessions", "weight_logs", "body_measurements", "user_integrations"])
      expect(((await db.query(`select count(*)::int c from ${t} where user_id = $1`, [a])).rows[0] as { c: number }).c, t).toBe(0);
  });
});
