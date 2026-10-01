import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { hasFeature, type FeatureKey } from "@fitness-os/core";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export interface SubscriptionInfo {
  plan_id: "pro" | "pro_plus"; interval: "month" | "year"; status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  current_period_end: string | null; trial_end: string | null; cancel_at_period_end: boolean; grace_until: string | null; pending_plan_id: string | null;
}
export interface Entitlements { plan: "free" | "pro" | "pro_plus"; features: string[]; subscription: SubscriptionInfo | null; trial_eligible: boolean }

interface Ctx { ent: Entitlements | null; loading: boolean; error: string | null; reload: () => Promise<void>; has: (f: FeatureKey) => boolean }
const C = createContext<Ctx>({ ent: null, loading: true, error: null, reload: async () => undefined, has: () => false });
export const useEntitlements = () => useContext(C);

/** Server-computed entitlements (RPC). On failure features stay empty (fail closed) and the error is surfaced. */
export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    const { data, error: e } = await supabase.rpc("current_entitlements");
    if (e) setError(e.message); else setEnt(data as Entitlements);
    setLoading(false);
  }, [session]);
  useEffect(() => { void reload(); }, [reload]);
  return <C.Provider value={{ ent, loading, error, reload, has: (f) => hasFeature(ent?.features, f) }}>{children}</C.Provider>;
}
