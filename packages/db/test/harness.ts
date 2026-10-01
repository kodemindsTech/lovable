import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal stand-in for Supabase's auth schema + roles. */
const AUTH_STUB = `
create role authenticated nologin; create role anon nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`;

export async function makeDb() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB);
  for (const f of readdirSync(join(root, "migrations")).sort())
    await db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  await db.exec(readFileSync(join(root, "seed", "foods.sql"), "utf8"));
  await db.exec(`
    grant usage on schema public to authenticated, anon;
    grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
    revoke execute on function delete_my_account() from anon;`);
  return db;
}

export async function newUser(db: PGlite, email: string): Promise<string> {
  const r = await db.query<{ id: string }>("insert into auth.users(email) values ($1) returning id", [email]);
  return r.rows[0]!.id;
}

/** Run fn as an authenticated user (RLS enforced), or anon when uid is null. */
export async function as<T>(db: PGlite, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  try { return await fn(); }
  finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}

export const onboardingPayload = {
  name: "Asha", age: 30, sex: "female", height_cm: 165, weight_kg: 70, target_weight_kg: 65,
  goal: "lose_fat", activity_level: "moderate", diet: "vegetarian", training_days: 3,
  targets: { calories: 1700, protein_g: 140, carbs_g: 170, fat_g: 47, fibre_g: 25, steps: 9000, formula_version: "1.0.0" },
  inputs: { age: 30 },
};
