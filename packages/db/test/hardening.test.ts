import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, asService, givePlan, makeAdmin, makeDb, newUser } from "./harness";

let db: PGlite;
beforeAll(async () => { db = await makeDb(); });

describe("schema invariants (run against the real migrations)", () => {
  it("every public table has row-level security enabled", async () => {
    const r = await db.query<{ relname: string }>("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });
  it("every user-owned table has an owner policy (no table is RLS-enabled with zero policies unless intentionally server-only)", async () => {
    const r = await db.query<{ relname: string }>(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`);
    expect(r.rows.map((x) => x.relname).sort()).toEqual([]);
  });
  it("no policy is unconditionally true for writes", async () => {
    const r = await db.query<{ tablename: string; policyname: string }>("select tablename, policyname from pg_policies where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL') and (qual = 'true' or with_check = 'true')");
    expect(r.rows).toEqual([]);
  });
  it("every SECURITY DEFINER function pins search_path", async () => {
    const r = await db.query<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(r.rows.map((x) => x.proname)).toEqual([]);
  });
  it("anonymous callers can execute only an explicit allowlist of functions", async () => {
    const r = await db.query<{ proname: string }>(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    expect(r.rows.map((x) => x.proname)).toEqual(["has_admin_role"]);
  });
  it("signed-in users cannot execute server-only functions", async () => {
    for (const sig of ["apply_subscription_event(jsonb)"]) {
      const r = await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', '${sig}', 'execute') ok`);
      expect(r.rows[0]!.ok, sig).toBe(false);
    }
    expect(((await db.query<{ ok: boolean }>("select has_function_privilege('service_role', 'apply_subscription_event(jsonb)', 'execute') ok")).rows[0]!).ok).toBe(true);
  });
  it("future functions are private by default", async () => {
    await db.exec("create function public.zz_probe() returns int language sql as $$ select 1 $$");
    expect(((await db.query<{ ok: boolean }>("select has_function_privilege('anon', 'public.zz_probe()', 'execute') ok")).rows[0]!).ok).toBe(false);
    await db.exec("drop function public.zz_probe()");
  });
  it("user-owned tables all cascade on account deletion (every table referencing auth.users)", async () => {
    const r = await db.query<{ conrelid: string; confdeltype: string }>(`select conrelid::regclass::text as conrelid, confdeltype from pg_constraint
      where contype = 'f' and confrelid = 'auth.users'::regclass and connamespace = 'public'::regnamespace order by 1`);
    const notCascade = r.rows.filter((x) => x.confdeltype !== "c").map((x) => x.conrelid);
    // created_by on notifications is intentionally SET NULL (keep announcements when an admin account is deleted)
    expect(notCascade).toEqual(["notifications"]);
  });
});

describe("effective_plan lookups", () => {
  it("a user cannot probe another user's plan; admins and the server can", async () => {
    const a = await newUser(db, "a@x.com"), b = await newUser(db, "b@x.com"), s = await newUser(db, "s@x.com");
    await givePlan(db, b, "pro"); await makeAdmin(db, s, "support");
    await expect(as(db, a, () => db.query("select effective_plan($1)", [b]))).rejects.toThrow(/forbidden/);
    expect(((await as(db, a, () => db.query<{ p: string }>("select effective_plan($1) p", [a]))).rows[0]!).p).toBe("free");
    expect(((await as(db, s, () => db.query<{ p: string }>("select effective_plan($1) p", [b]))).rows[0]!).p).toBe("pro");
    expect(((await asService(db, () => db.query<{ p: string }>("select effective_plan($1) p", [b]))).rows[0]!).p).toBe("pro");
    await expect(as(db, null, () => db.query("select effective_plan($1)", [b]))).rejects.toThrow();
  });
});
