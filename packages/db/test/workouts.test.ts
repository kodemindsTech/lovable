import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, makeDb, newUser } from "./harness";

let db: PGlite; let a: string; let b: string; let bench: string; let squat: string; let s1: string;
const ex = async (n: string) => (await db.query<{ id: string }>("select id from exercises where name = $1", [n])).rows[0]!.id;
const count = async (who: string, q: string) => ((await as(db, who, () => db.query(q))).rows[0] as { c: number }).c;

beforeAll(async () => {
  db = await makeDb(); a = await newUser(db, "a@x.com"); b = await newUser(db, "b@x.com");
  bench = await ex("Barbell Bench Press"); squat = await ex("Back Squat");
  s1 = await as(db, a, async () => {
    const s = (await db.query<{ id: string }>("select (start_session('2026-01-10','Push')).id id")).rows[0]!.id;
    await db.query("insert into session_exercises(user_id,session_id,exercise_id) values ($1,$2,$3)", [a, s, bench]);
    for (const [n, w, r] of [[1, 60, 10], [2, 60, 10], [3, 60, 9]])
      await db.query("insert into workout_sets(user_id,session_id,exercise_id,set_number,weight_kg,reps) values ($1,$2,$3,$4,$5,$6)", [a, s, bench, n, w, r]);
    return s;
  });
});

describe("workouts", () => {
  it("catalog is seeded and searchable", async () => {
    const r = await as(db, a, () => db.query<{ name: string }>("select name from search_exercises('bench', 3)"));
    expect(r.rows[0]!.name).toBe("Barbell Bench Press");
  });
  it("history returns sets per session, newest first, honouring exclusion", async () => {
    await as(db, a, async () => {
      const s = (await db.query<{ id: string }>("select (start_session('2026-01-12','Push')).id id")).rows[0]!.id;
      await db.query("insert into workout_sets(user_id,session_id,exercise_id,set_number,weight_kg,reps) values ($1,$2,$3,1,60,11)", [a, s, bench]);
    });
    const h = await as(db, a, () => db.query<{ local_date: string; sets: { reps: number }[] }>("select * from exercise_history($1, 5)", [bench]));
    expect(h.rows).toHaveLength(2);
    expect(h.rows[0]!.sets[0]!.reps).toBe(11);
    const ex1 = await as(db, a, () => db.query("select * from exercise_history($1, 5, $2)", [bench, s1]));
    expect(ex1.rows).toHaveLength(1);
  });
  it("templates copy exercises both ways", async () => {
    const tpl = await as(db, a, async () => (await db.query<{ id: string }>("select (save_template_from_session($1,'Push A')).id id", [s1])).rows[0]!.id);
    expect(await count(a, "select count(*)::int c from template_exercises")).toBe(1);
    const s = await as(db, a, async () => (await db.query<{ id: string }>("select (start_session('2026-01-14','Push A',$1)).id id", [tpl])).rows[0]!.id);
    expect(await count(a, `select count(*)::int c from session_exercises where session_id = '${s}'`)).toBe(1);
  });
  it("rejects sets with neither reps nor duration, and negative weights", async () => {
    await expect(as(db, a, () => db.query("insert into workout_sets(user_id,session_id,exercise_id,set_number,weight_kg) values ($1,$2,$3,9,50)", [a, s1, bench]))).rejects.toThrow();
    await expect(as(db, a, () => db.query("insert into workout_sets(user_id,session_id,exercise_id,set_number,weight_kg,reps) values ($1,$2,$3,9,-5,5)", [a, s1, bench]))).rejects.toThrow();
  });
  it("deleting a session removes its sets", async () => {
    const s = await as(db, a, async () => {
      const id = (await db.query<{ id: string }>("select (start_session('2026-01-20','Legs')).id id")).rows[0]!.id;
      await db.query("insert into workout_sets(user_id,session_id,exercise_id,set_number,reps) values ($1,$2,$3,1,10)", [a, id, squat]);
      return id;
    });
    await as(db, a, () => db.query("delete from workout_sessions where id = $1", [s]));
    expect(await count(a, `select count(*)::int c from workout_sets where session_id = '${s}'`)).toBe(0);
  });
});

describe("workout RLS", () => {
  for (const t of ["workout_sessions", "session_exercises", "workout_sets", "workout_templates", "template_exercises"])
    it(`B cannot see A's ${t}`, async () => {
      expect(await count(a, `select count(*)::int c from ${t}`)).toBeGreaterThan(0);
      expect(await count(b, `select count(*)::int c from ${t}`)).toBe(0);
    });
  it("B cannot add sets or exercises to A's session, or read A's history", async () => {
    await expect(as(db, b, () => db.query("insert into workout_sets(user_id,session_id,exercise_id,set_number,reps) values ($1,$2,$3,1,5)", [b, s1, bench]))).rejects.toThrow();
    await expect(as(db, b, () => db.query("insert into session_exercises(user_id,session_id,exercise_id) values ($1,$2,$3)", [b, s1, squat]))).rejects.toThrow();
    expect(await count(b, `select count(*)::int c from exercise_history('${bench}', 10)`)).toBe(0);
    await expect(as(db, b, () => db.query("select save_template_from_session($1,'steal')", [s1]))).rejects.toThrow();
  });
  it("B cannot edit or delete A's data", async () => {
    await as(db, b, async () => {
      await db.query("update workout_sets set reps = 1 where session_id = $1", [s1]);
      await db.query("delete from workout_sessions where id = $1", [s1]);
    });
    expect(await count(a, `select count(*)::int c from workout_sets where session_id = '${s1}' and reps = 1`)).toBe(0);
    expect(await count(a, `select count(*)::int c from workout_sessions where id = '${s1}'`)).toBe(1);
  });
  it("custom exercises are private; shared catalog is immutable to users", async () => {
    await as(db, a, () => db.query("insert into exercises(owner_id,name,muscle_group,equipment) values ($1,'My move','Core','None')", [a]));
    expect(await count(b, "select count(*)::int c from exercises where name = 'My move'")).toBe(0);
    await expect(as(db, b, () => db.query("insert into exercises(owner_id,name,muscle_group,equipment) values (null,'Global','x','y')"))).rejects.toThrow();
    await as(db, a, () => db.query("update exercises set name = 'hacked' where owner_id is null"));
    expect(await count(a, "select count(*)::int c from exercises where name = 'hacked'")).toBe(0);
  });
  it("account deletion cascades workout data", async () => {
    await as(db, a, () => db.query("select delete_my_account()"));
    for (const t of ["workout_sessions", "workout_sets", "session_exercises", "workout_templates", "template_exercises"])
      expect(((await db.query(`select count(*)::int c from ${t} where user_id = $1`, [a])).rows[0] as { c: number }).c, t).toBe(0);
  });
});
