import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export const MEALS: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfast" }, { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" }, { key: "snack", label: "Snacks" },
];

export interface Food {
  id: string; name: string; serving_size: number; serving_unit: string; serving_grams: number | null;
  calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number;
  verification_status: "verified" | "user_entered" | "ai_estimated" | "admin_reviewed";
}
export interface FoodLog {
  id: string; name: string; quantity: number; serving_label: string; calories: number;
  protein_g: number; carbs_g: number; fat_g: number; fibre_g: number;
  source_status: Food["verification_status"]; meal_type: MealType;
}
export interface DayTotals { calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number; water_ml: number }

const num = (v: unknown) => Number(v ?? 0);

export async function searchFoods(q: string, lim = 10): Promise<Food[]> {
  const { data, error } = await supabase.rpc("search_foods", { q, lim });
  if (error) throw error;
  return (data ?? []).map(normaliseFood);
}
const normaliseFood = (f: Food): Food => ({
  ...f, serving_size: num(f.serving_size), serving_grams: f.serving_grams == null ? null : num(f.serving_grams),
  calories: num(f.calories), protein_g: num(f.protein_g), carbs_g: num(f.carbs_g), fat_g: num(f.fat_g), fibre_g: num(f.fibre_g),
});

export async function logFood(foodId: string, date: string, meal: MealType, quantity: number) {
  const { error } = await supabase.rpc("log_food", { p_food_id: foodId, p_date: date, p_meal: meal, p_quantity: quantity });
  if (error) throw error;
}
export async function updateQuantity(id: string, quantity: number) {
  const { error } = await supabase.rpc("update_food_log_quantity", { p_id: id, p_quantity: quantity });
  if (error) throw error;
}
export async function deleteLog(id: string) {
  const { error } = await supabase.from("food_logs").delete().eq("id", id);
  if (error) throw error;
}
export async function addWater(date: string, ml: number) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("water_logs").insert({ user_id: u.user!.id, local_date: date, ml });
  if (error) throw error;
}

/** Loads the day's food logs and totals. Bump `reload` after any write. */
export function useDay(date: string) {
  const { session } = useAuth();
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [totals, setTotals] = useState<DayTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    const [l, t] = await Promise.all([
      supabase.from("food_logs").select("*, meal_logs!inner(local_date, meal_type)")
        .eq("meal_logs.local_date", date).order("logged_at"),
      supabase.rpc("day_totals", { p_date: date }),
    ]);
    const err = l.error ?? t.error;
    if (err) setError(err.message);
    else {
      setLogs((l.data ?? []).map((r: Record<string, unknown> & { meal_logs: { meal_type: MealType } }) => ({
        ...(r as unknown as FoodLog), meal_type: r.meal_logs.meal_type,
        quantity: num(r.quantity), calories: num(r.calories), protein_g: num(r.protein_g),
        carbs_g: num(r.carbs_g), fat_g: num(r.fat_g), fibre_g: num(r.fibre_g),
      })));
      const row = (t.data as DayTotals[] | null)?.[0];
      setTotals(row ? {
        calories: num(row.calories), protein_g: num(row.protein_g), carbs_g: num(row.carbs_g),
        fat_g: num(row.fat_g), fibre_g: num(row.fibre_g), water_ml: num(row.water_ml),
      } : null);
    }
    setLoading(false);
  }, [session, date]);

  useEffect(() => { void reload(); }, [reload]);
  return { logs, totals, loading, error, reload };
}
