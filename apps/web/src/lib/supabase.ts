import { createClient } from "@supabase/supabase-js";
import { demoFetch } from "../demo/backend";

const DEMO = import.meta.env.VITE_DEMO === "1";
const url = DEMO ? "http://demo.local" : (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key = DEMO ? "demo-anon-key-000000000000" : (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export const isConfigured = Boolean(url && key);

// Demo build: in-memory session + in-browser fake backend (never used in the normal build).
const mem: Record<string, string> = DEMO ? { "demo-session": JSON.stringify({ access_token: "demo.token.x", refresh_token: "demo", token_type: "bearer", expires_in: 3e8, expires_at: Math.floor(Date.now() / 1000) + 3e8,
  user: { id: "demo-user", email: "demo@example.com", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" } }) } : {};
const demoOpts = DEMO ? { auth: { storage: { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; }, removeItem: (k: string) => { delete mem[k]; } }, storageKey: "demo-session", autoRefreshToken: false }, global: { fetch: demoFetch } } : {};
export const supabase = createClient(url ?? "http://localhost:54321", key ?? "missing", demoOpts);
