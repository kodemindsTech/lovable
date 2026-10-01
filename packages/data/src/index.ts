import type { SupabaseClient } from "@supabase/supabase-js";
import { buildReport, monthRange, previousRange, shiftDate, weekRange, type DaySummary, type Goal, type Report, type ReportTargets } from "@fitness-os/core";

/**
 * Shared data gathering for reports. Works with any RLS-scoped Supabase client
 * (browser session or the API acting as the user), so it never needs a service key.
 */
const PAGE = 1000;
const num = (v: unknown) => Number(v ?? 0);

async function fetchAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = shiftDate(d, 1)) out.push(d);
  return out;
}

export interface RawRows {
  food: { local_date: string; calories: unknown; protein_g: unknown; fibre_g: unknown }[];
  activities: { local_date: string; type: string; steps: number | null; distance_km: unknown }[];
  sessions: { local_date: string }[];
  weights: { local_date: string; weight_kg: unknown }[];
}

/** Pure assembly of per-day summaries — one entry for EVERY date in range, empty days included. */
export function assembleDays(start: string, end: string, r: RawRows): DaySummary[] {
  const map = new Map<string, DaySummary>(eachDate(start, end).map((d) => [d, {
    date: d, mealsLogged: 0, calories: 0, proteinG: 0, fibreG: 0, steps: null, workouts: 0, runKm: 0, weightKg: null }]));
  for (const f of r.food) { const d = map.get(f.local_date); if (d) { d.mealsLogged++; d.calories += num(f.calories); d.proteinG += num(f.protein_g); d.fibreG += num(f.fibre_g); } }
  for (const a of r.activities) {
    const d = map.get(a.local_date); if (!d) continue;
    if (a.type === "steps" && a.steps !== null) d.steps = (d.steps ?? 0) + a.steps;
    if (a.type === "run") d.runKm += num(a.distance_km);
  }
  for (const s of r.sessions) { const d = map.get(s.local_date); if (d) d.workouts++; }
  for (const w of r.weights) { const d = map.get(w.local_date); if (d) d.weightKg = num(w.weight_kg); }
  return [...map.values()];
}

export async function loadPeriodDays(c: SupabaseClient, start: string, end: string): Promise<DaySummary[]> {
  const [food, activities, sessions, weights] = await Promise.all([
    fetchAll((a, b) => c.from("food_logs").select("calories,protein_g,fibre_g, meal_logs!inner(local_date)").gte("meal_logs.local_date", start).lte("meal_logs.local_date", end).order("logged_at").range(a, b)
      .then((r) => ({ data: (r.data as unknown as { calories: unknown; protein_g: unknown; fibre_g: unknown; meal_logs: { local_date: string } }[] | null)?.map((x) => ({ ...x, local_date: x.meal_logs.local_date })) ?? null, error: r.error }))),
    fetchAll((a, b) => c.from("activities").select("local_date,type,steps,distance_km").gte("local_date", start).lte("local_date", end).order("logged_at").range(a, b).then((r) => ({ data: r.data as RawRows["activities"] | null, error: r.error }))),
    fetchAll((a, b) => c.from("workout_sessions").select("local_date").eq("completed", true).gte("local_date", start).lte("local_date", end).order("started_at").range(a, b).then((r) => ({ data: r.data as RawRows["sessions"] | null, error: r.error }))),
    fetchAll((a, b) => c.from("weight_logs").select("local_date,weight_kg").gte("local_date", start).lte("local_date", end).order("local_date").range(a, b).then((r) => ({ data: r.data as RawRows["weights"] | null, error: r.error }))),
  ]);
  return assembleDays(start, end, { food, activities, sessions, weights });
}

export interface ReportContext { targets: ReportTargets; goal: Goal; tdee: number | null; trainingDays: number }
export async function loadReportContext(c: SupabaseClient): Promise<ReportContext> {
  const [t, p, g] = await Promise.all([
    c.from("nutrition_targets").select("*").maybeSingle(),
    c.from("profiles").select("training_days_per_week").maybeSingle(),
    c.from("goals").select("goal").eq("active", true).maybeSingle(),
  ]);
  if (t.error) throw new Error(t.error.message);
  if (!t.data) throw new Error("onboarding incomplete");
  const r = t.data as Record<string, unknown>;
  return {
    targets: { calories: num(r.calories), proteinG: num(r.protein_g), carbsG: num(r.carbs_g), fatG: num(r.fat_g), fibreG: num(r.fibre_g), steps: num(r.steps) },
    goal: ((g.data as { goal: Goal } | null)?.goal) ?? "maintain",
    tdee: r.tdee == null ? null : num(r.tdee),
    trainingDays: (p.data as { training_days_per_week: number | null } | null)?.training_days_per_week ?? 0,
  };
}

export type ReportKind = "week" | "month";
/** True when `start` is the first day of a Monday-based week / calendar month. */
export const isAlignedStart = (kind: ReportKind, start: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(start) && (kind === "week" ? weekRange(start).start === start : monthRange(start).start === start);

/** Builds the deterministic report for one week/month plus its previous period, from the caller's own data. */
export async function computeReport(c: SupabaseClient, p: { kind: ReportKind; start: string; today: string }): Promise<Report> {
  if (!isAlignedStart(p.kind, p.start)) throw new Error("start must be the first day of the period");
  const cur = p.kind === "week" ? weekRange(p.start) : monthRange(p.start);
  const prev = previousRange(p.kind, p.start);
  const [ctx, days] = await Promise.all([loadReportContext(c), loadPeriodDays(c, prev.start, cur.end)]);
  return buildReport(days, { ...cur, asOf: p.today, targets: ctx.targets, goal: ctx.goal, tdee: ctx.tdee, trainingDays: ctx.trainingDays }, prev);
}
