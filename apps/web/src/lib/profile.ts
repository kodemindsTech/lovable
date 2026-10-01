import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export interface ProfileRow { name: string | null; onboarding_completed: boolean; diet: string | null; training_days_per_week: number | null }
export interface TargetsRow {
  calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number; steps: number;
}

export function useProfile() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [targets, setTargets] = useState<TargetsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    const [p, t] = await Promise.all([
      supabase.from("profiles").select("name,onboarding_completed,diet,training_days_per_week").eq("user_id", session.user.id).maybeSingle(),
      supabase.from("nutrition_targets").select("*").eq("user_id", session.user.id).maybeSingle(),
    ]);
    if (p.error || t.error) setError((p.error ?? t.error)!.message);
    setProfile(p.data as ProfileRow | null);
    setTargets(t.data as TargetsRow | null);
    setLoading(false);
  }, [session]);

  useEffect(() => { void load(); }, [load]);
  return { profile, targets, loading, error, reload: load };
}
