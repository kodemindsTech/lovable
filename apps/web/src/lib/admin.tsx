import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type AdminRole = "support" | "content" | "finance" | "super";
/** UI convenience only — the database enforces every one of these (RLS + role checks in functions). */
export const TABS: { path: string; label: string; roles: AdminRole[] }[] = [
  { path: "overview", label: "Overview", roles: ["support", "finance", "content"] },
  { path: "users", label: "Users", roles: ["support", "finance"] },
  { path: "foods", label: "Foods", roles: ["content"] },
  { path: "exercises", label: "Exercises", roles: ["content"] },
  { path: "pricing", label: "Plans & pricing", roles: ["finance"] },
  { path: "ai", label: "AI monitoring", roles: ["support"] },
  { path: "feedback", label: "Feedback", roles: ["support", "content"] },
  { path: "announcements", label: "Announcements", roles: ["content"] },
  { path: "flags", label: "Feature flags", roles: [] },
  { path: "settings", label: "System settings", roles: [] },
  { path: "admins", label: "Admins", roles: [] },
  { path: "audit", label: "Audit log", roles: [] },
];
export const canSee = (role: AdminRole | null, roles: AdminRole[]) => !!role && (role === "super" || roles.includes(role));

interface Ctx { role: AdminRole | null; loading: boolean }
const C = createContext<Ctx>({ role: null, loading: true });
export const useAdminRole = () => useContext(C);

export function AdminRoleProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [state, setState] = useState<Ctx>({ role: null, loading: true });
  useEffect(() => {
    if (!session) return;
    supabase.rpc("my_admin_role").then(({ data }) => setState({ role: (data as AdminRole | null) ?? null, loading: false }), () => setState({ role: null, loading: false }));
  }, [session]);
  return <C.Provider value={state}>{children}</C.Provider>;
}

/** Tiny loader hook for admin screens. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => { setLoading(true); setError(null); try { setData(await fn()); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
export const must = <T,>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
