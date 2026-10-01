import { supabase } from "./supabase";
import type { Run, WeightPoint } from "@fitness-os/core";
import { track } from "./analytics";

export interface ActivityRow {
  id: string; local_date: string; type: "steps" | "run" | "walk" | "cycle" | "other";
  steps: number | null; distance_km: number | null; duration_min: number | null; active_kcal: number | null; source: string;
}
export interface Measurement {
  id: string; local_date: string; waist_cm: number | null; chest_cm: number | null; arms_cm: number | null;
  hips_cm: number | null; thighs_cm: number | null; body_fat_pct: number | null;
}
const must = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
const n = (v: unknown) => (v == null ? null : Number(v));
const uid = async () => (await supabase.auth.getUser()).data.user!.id;

export const setSteps = async (date: string, steps: number) => { must(await supabase.rpc("set_steps", { p_date: date, p_steps: steps })); track("activity_logged"); };
export const logRun = async (date: string, km: number, min: number, kcal: number | null, hr: number | null) => {
  must(await supabase.rpc("log_run", { p_date: date, p_distance_km: km, p_duration_min: min, p_active_kcal: kcal, p_avg_hr: hr }));
  track("activity_logged");
};
export async function logOther(date: string, type: "walk" | "cycle" | "other", km: number | null, min: number | null, kcal: number | null) {
  must(await supabase.from("activities").insert({ user_id: await uid(), local_date: date, type, distance_km: km, duration_min: min, active_kcal: kcal }));
  track("activity_logged");
}
export const deleteActivity = async (id: string) => { must(await supabase.from("activities").delete().eq("id", id)); };

export async function listActivities(sinceDate: string): Promise<ActivityRow[]> {
  const rows = must(await supabase.from("activities").select("*").gte("local_date", sinceDate).order("local_date", { ascending: false }).order("logged_at", { ascending: false })) ?? [];
  return rows.map((r: ActivityRow) => ({ ...r, distance_km: n(r.distance_km), duration_min: n(r.duration_min) }));
}
export const toRuns = (rows: ActivityRow[]): Run[] =>
  rows.filter((r) => r.type === "run" && r.distance_km && r.duration_min).map((r) => ({ date: r.local_date, distanceKm: r.distance_km!, durationMin: r.duration_min! }));

export const setWeight = async (date: string, kg: number) => { must(await supabase.rpc("set_weight", { p_date: date, p_kg: kg })); track("weight_logged"); };
export async function listWeights(sinceDate: string): Promise<WeightPoint[]> {
  const rows = must(await supabase.from("weight_logs").select("local_date, weight_kg").gte("local_date", sinceDate).order("local_date")) ?? [];
  return rows.map((r: { local_date: string; weight_kg: unknown }) => ({ date: r.local_date, kg: Number(r.weight_kg) }));
}
export async function activeGoal() {
  const g = must(await supabase.from("goals").select("start_weight_kg, target_weight_kg").eq("active", true).maybeSingle());
  return g ? { startKg: Number(g.start_weight_kg), targetKg: n(g.target_weight_kg) } : null;
}
export async function saveMeasurement(date: string, m: Partial<Omit<Measurement, "id" | "local_date">>) {
  must(await supabase.from("body_measurements").upsert({ user_id: await uid(), local_date: date, ...m }, { onConflict: "user_id,local_date" }));
}
export async function latestMeasurements(): Promise<Measurement[]> {
  const rows = must(await supabase.from("body_measurements").select("*").order("local_date", { ascending: false }).limit(5)) ?? [];
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string, local_date: r.local_date as string, waist_cm: n(r.waist_cm), chest_cm: n(r.chest_cm), arms_cm: n(r.arms_cm),
    hips_cm: n(r.hips_cm), thighs_cm: n(r.thighs_cm), body_fat_pct: n(r.body_fat_pct),
  }));
}
export async function todaySteps(date: string): Promise<number | null> {
  const r = must(await supabase.from("activities").select("steps").eq("type", "steps").eq("local_date", date).maybeSingle());
  return r ? r.steps : null;
}
