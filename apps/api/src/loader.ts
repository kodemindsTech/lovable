import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextInput, WeekSummary } from "@fitness-os/ai";
import { parseWeights, weightStats, type Diet, type FoodCandidate, type Goal } from "@fitness-os/core";

const must = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
const num = (v: unknown) => Number(v ?? 0);
export const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export interface WeekRows {
  food: { local_date: string; calories: number; protein_g: number; fibre_g: number }[];
  steps: number[];
  workouts: number;
  runKm: number;
}
/** Averages are over days that actually have data — missing days are never treated as zero. */
export function summariseWeek(r: WeekRows): WeekSummary {
  const byDay = new Map<string, { c: number; p: number; f: number }>();
  for (const x of r.food) {
    const d = byDay.get(x.local_date) ?? { c: 0, p: 0, f: 0 };
    d.c += x.calories; d.p += x.protein_g; d.f += x.fibre_g; byDay.set(x.local_date, d);
  }
  const days = [...byDay.values()];
  return {
    days_with_food_logs: days.length,
    avg_calories: avg(days.map((d) => d.c)), avg_protein_g: avg(days.map((d) => d.p)), avg_fibre_g: avg(days.map((d) => d.f)),
    avg_steps: avg(r.steps), workouts: r.workouts, run_km: Math.round(r.runKm * 10) / 10,
  };
}

/** Reads the caller's own data through their RLS-scoped client (no service role). */
export async function loadContextInput(c: SupabaseClient, today: string, hour: number): Promise<ContextInput> {
  const from7 = shift(today, -6);
  const [targets, profile, goal, totals, mealCount, acts7, sess7, weights, settings, foods, food7] = await Promise.all([
    c.from("nutrition_targets").select("*").maybeSingle(),
    c.from("profiles").select("diet,training_days_per_week").maybeSingle(),
    c.from("goals").select("goal,target_weight_kg").eq("active", true).maybeSingle(),
    c.rpc("day_totals", { p_date: today }),
    c.from("food_logs").select("id, meal_logs!inner(local_date)", { count: "exact", head: true }).eq("meal_logs.local_date", today),
    c.from("activities").select("type,steps,distance_km,duration_min,local_date").gte("local_date", from7).lte("local_date", today),
    c.from("workout_sessions").select("id").eq("completed", true).gte("local_date", from7).lte("local_date", today),
    c.from("weight_logs").select("local_date,weight_kg").gte("local_date", shift(today, -30)).lte("local_date", today).order("local_date"),
    c.from("app_settings").select("value").eq("key", "score_weights").maybeSingle(),
    c.from("foods").select("id,name,serving_size,serving_unit,calories,protein_g,fibre_g,verification_status,food_categories(name)").is("owner_id", null),
    c.from("food_logs").select("calories,protein_g,fibre_g, meal_logs!inner(local_date)").gte("meal_logs.local_date", from7).lte("meal_logs.local_date", today),
  ]);
  const t = must(targets) as Record<string, unknown> | null;
  if (!t) throw new Error("onboarding incomplete");
  const tot = ((must(totals) as Record<string, unknown>[] | null) ?? [])[0] ?? {};
  const acts = (must(acts7) ?? []) as { type: string; steps: number | null; distance_km: unknown; duration_min: unknown; local_date: string }[];
  const todayActs = acts.filter((a) => a.local_date === today);
  const stepsRow = todayActs.find((a) => a.type === "steps");
  const others = todayActs.filter((a) => a.type !== "steps" && a.duration_min != null);
  const pts = (must(weights) ?? []).map((w: { local_date: string; weight_kg: unknown }) => ({ date: w.local_date, kg: num(w.weight_kg) }));
  const g = must(goal) as { goal: Goal; target_weight_kg: unknown } | null;
  const p = must(profile) as { diet: Diet | null; training_days_per_week: number | null } | null;
  const ws = weightStats(pts, { asOf: today, targetKg: g?.target_weight_kg == null ? null : num(g.target_weight_kg) });
  const workouts7 = (must(sess7) ?? []).length;

  const candidates: FoodCandidate[] = (must(foods) ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string, name: r.name as string, category: (r.food_categories as { name: string } | null)?.name ?? null,
    servingLabel: `${r.serving_size} ${r.serving_unit}`, calories: num(r.calories), proteinG: num(r.protein_g), fibreG: num(r.fibre_g),
    status: r.verification_status as FoodCandidate["status"],
  }));
  const week = summariseWeek({
    food: (must(food7) ?? []).map((r: Record<string, unknown>) => ({
      local_date: (r.meal_logs as { local_date: string }).local_date, calories: num(r.calories), protein_g: num(r.protein_g), fibre_g: num(r.fibre_g) })),
    steps: acts.filter((a) => a.type === "steps").map((a) => num(a.steps)),
    workouts: workouts7,
    runKm: acts.filter((a) => a.type === "run").reduce((s, a) => s + num(a.distance_km), 0),
  });
  const mealsLogged = mealCount.count ?? 0;

  return {
    date: today, hour, waterMl: num(tot.water_ml), currentWeightKg: ws.current, avg7WeightKg: ws.avg7, targetWeightKg: ws.target,
    week, diet: p?.diet ?? null, foods: candidates,
    weights: parseWeights((must(settings) as { value: unknown } | null)?.value),
    day: {
      goal: g?.goal ?? "maintain",
      targets: { calories: num(t.calories), proteinG: num(t.protein_g), carbsG: num(t.carbs_g), fatG: num(t.fat_g), fibreG: num(t.fibre_g), steps: num(t.steps) },
      totals: { calories: num(tot.calories), proteinG: num(tot.protein_g), carbsG: num(tot.carbs_g), fatG: num(tot.fat_g), fibreG: num(tot.fibre_g) },
      mealsLogged, stepsToday: stepsRow ? num(stepsRow.steps) : null,
      activeMinutes: others.length ? others.reduce((s, a) => s + num(a.duration_min), 0) : null,
      workoutsLast7: workouts7, trainingDays: p?.training_days_per_week ?? 0,
      weightTrendKgPerWeek: ws.trendKgPerWeek, hour, dayComplete: hour >= 22,
    },
  };
}
