import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal stand-in for Supabase's auth schema + roles. */
const AUTH_STUB = `
create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon, service_role;
`;

export async function makeDb() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB);
  for (const f of readdirSync(join(root, "migrations")).sort())
    await db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  for (const f of ["foods.sql", "exercises.sql"]) await db.exec(readFileSync(join(root, "seed", f), "utf8"));
  await db.exec(`
    grant usage on schema public to authenticated, anon, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    grant select on plans, plan_prices, plan_features to anon;
    grant all on all sequences in schema public to authenticated;
    `);   // function privileges come from the migrations themselves (0011), not from this harness
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
  targets: { calories: 1700, protein_g: 140, carbs_g: 170, fat_g: 47, fibre_g: 25, steps: 9000, tdee: 2100, formula_version: "1.0.0" },
  inputs: { age: 30 },
};

/** Run as the server (service_role bypasses RLS). */
export async function asService<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

/** Gives a user an active subscription directly (bypassing the server path) for tests. */
export async function givePlan(db: PGlite, uid: string, plan: "pro" | "pro_plus", opts: { status?: string; periodEnd?: string; graceUntil?: string | null; trialEnd?: string | null } = {}) {
  await db.query(
    `insert into subscriptions(user_id, plan_id, interval, status, current_period_end, grace_until, trial_end, last_event_at)
     values ($1,$2,'month',$3,$4,$5,$6, now()) on conflict (user_id) do update set plan_id=excluded.plan_id, status=excluded.status,
       current_period_end=excluded.current_period_end, grace_until=excluded.grace_until, trial_end=excluded.trial_end`,
    [uid, plan, opts.status ?? "active", opts.periodEnd ?? new Date(Date.now() + 20 * 864e5).toISOString(), opts.graceUntil ?? null, opts.trialEnd ?? null]);
}

export async function makeAdmin(db: PGlite, uid: string, role: "support" | "content" | "finance" | "super") {
  await db.query("insert into admin_users(user_id, role) values ($1,$2) on conflict (user_id) do update set role = excluded.role", [uid, role]);
}
