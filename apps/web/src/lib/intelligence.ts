import { useEffect, useState } from "react";
import {
  nextActions, parseWeights, scoreDay, weightStats,
  type DailyScore, type Diet, type FoodCandidate, type Goal, type Macros, type NextAction,
} from "@fitness-os/core";
import { supabase } from "./supabase";
import { addDays, localDate } from "./date";
import type { ProfileRow, TargetsRow } from "./profile";
import type { DayTotals } from "./nutrition";

export interface Intelligence { score: DailyScore; actions: NextAction[] }

const must = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };

async function loadFoodCandidates(): Promise<FoodCandidate[]> {
  const rows = must(await supabase.from("foods").select("id,name,serving_size,serving_unit,calories,protein_g,fibre_g,verification_status,food_categories(name)").is("owner_id", null)) ?? [];
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string, name: r.name as string,
    category: (r.food_categories as { name: string } | null)?.name ?? null,
    servingLabel: `${r.serving_size} ${r.serving_unit}`,
    calories: Number(r.calories), proteinG: Number(r.protein_g), fibreG: Number(r.fibre_g),
    status: r.verification_status as FoodCandidate["status"],
  }));
}

/** Gathers today's real data, then runs the deterministic score + next-action engines. */
export async function loadIntelligence(p: { profile: ProfileRow; targets: TargetsRow; totals: DayTotals; mealsLogged: number; userId: string }): Promise<Intelligence> {
  const today = localDate(), now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const [acts, sessions, weights, goal, settings, foods] = await Promise.all([
    supabase.from("activities").select("type,steps,duration_min").eq("local_date", today),
    supabase.from("workout_sessions").select("id").eq("completed", true).gte("local_date", addDays(today, -6)),
    supabase.from("weight_logs").select("local_date,weight_kg").gte("local_date", addDays(today, -30)).order("local_date"),
    supabase.from("goals").select("goal,start_weight_kg,target_weight_kg").eq("active", true).maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "score_weights").maybeSingle(),
    loadFoodCandidates(),
  ]);
  const a = must(acts) ?? [];
  const stepsRow = a.find((r: { type: string }) => r.type === "steps") as { steps: number } | undefined;
  const others = a.filter((r: { type: string; duration_min: unknown }) => r.type !== "steps" && r.duration_min != null);
  const g = must(goal) as { goal: Goal; start_weight_kg: unknown; target_weight_kg: unknown } | null;
  const ws = weightStats(
    (must(weights) ?? []).map((r: { local_date: string; weight_kg: unknown }) => ({ date: r.local_date, kg: Number(r.weight_kg) })),
    { asOf: today });
  const totals: Macros = { calories: p.totals.calories, proteinG: p.totals.protein_g, carbsG: p.totals.carbs_g, fatG: p.totals.fat_g, fibreG: p.totals.fibre_g };
  const input = {
    goal: g?.goal ?? "maintain",
    targets: { calories: p.targets.calories, proteinG: p.targets.protein_g, carbsG: p.targets.carbs_g, fatG: p.targets.fat_g, fibreG: p.targets.fibre_g, steps: p.targets.steps },
    totals, mealsLogged: p.mealsLogged,
    stepsToday: stepsRow ? stepsRow.steps : null,
    activeMinutes: others.length ? others.reduce((s: number, r: { duration_min: unknown }) => s + Number(r.duration_min), 0) : null,
    workoutsLast7: (must(sessions) ?? []).length,
    trainingDays: p.profile.training_days_per_week ?? 0,
    weightTrendKgPerWeek: ws.trendKgPerWeek,
    hour, dayComplete: hour >= 22,
  };
  const weightsCfg = parseWeights((must(settings) as { value: unknown } | null)?.value);
  const score = scoreDay(input, weightsCfg);
  const actions = nextActions({ ...input, diet: (p.profile.diet as Diet | null) ?? null, foods });

  // Derived cache of the day's score for history/reports; failure must never affect the UI.
  void supabase.from("daily_scores").upsert({
    user_id: p.userId, local_date: today, score: score.score, status: score.status,
    explanation: score.explanation, components: score.components, formula_version: score.version, computed_at: new Date().toISOString(),
  }).then(() => undefined, () => undefined);
  return { score, actions };
}

export function useIntelligence(args: { profile: ProfileRow | null; targets: TargetsRow | null; totals: DayTotals | null; mealsLogged: number; userId?: string; ready: boolean }) {
  const [data, setData] = useState<Intelligence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const { profile, targets, totals, mealsLogged, userId, ready } = args;
  useEffect(() => {
    if (!ready || !profile || !targets || !totals || !userId) return;
    let live = true;
    setLoading(true); setError(null);
    loadIntelligence({ profile, targets, totals, mealsLogged, userId })
      .then((d) => live && setData(d)).catch((e: Error) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [ready, profile, targets, totals, mealsLogged, userId, tick]);
  return { data, error, loading, retry: () => setTick((t) => t + 1) };
}
