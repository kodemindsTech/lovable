import { supabase } from "./supabase";

export interface PlanView {
  id: "free" | "pro" | "pro_plus"; name: string;
  prices: { interval: "month" | "year"; currency: string; amountMinor: number }[];
  features: string[];
}
export const FEATURE_LABELS: Record<string, string> = {
  ai_coach: "AI Coach", ai_food_recognition: "AI food recognition", voice_logging: "Voice logging", daily_fitness_score: "Daily Fitness Score",
  weekly_reports: "Weekly reports & AI summaries", advanced_analytics: "Advanced analytics", workout_progression: "Workout progression suggestions",
  advanced_ai_coaching: "Advanced AI coaching", ai_meal_planning: "AI meal planning", running_analysis: "Running analysis",
  advanced_progress: "Advanced progress analysis", advanced_recommendations: "Advanced recommendations",
};
/** Features that are live in the app today; the rest are listed as "coming soon" so we don't oversell. */
export const BUILT_FEATURES = new Set(["ai_coach", "daily_fitness_score", "weekly_reports", "workout_progression"]);

/** Reads plans, prices and features from the database — nothing is hard-coded. */
export async function loadPlans(): Promise<PlanView[]> {
  const [p, pr, f] = await Promise.all([
    supabase.from("plans").select("id,name,sort").order("sort"),
    supabase.from("plan_prices").select("plan_id,interval,currency,amount_minor").order("amount_minor"),
    supabase.from("plan_features").select("plan_id,feature_key"),
  ]);
  const err = p.error ?? pr.error ?? f.error; if (err) throw new Error(err.message);
  return (p.data ?? []).map((x: { id: PlanView["id"]; name: string }) => ({
    id: x.id, name: x.name,
    prices: (pr.data ?? []).filter((r: { plan_id: string }) => r.plan_id === x.id).map((r: { interval: "month" | "year"; currency: string; amount_minor: number }) => ({ interval: r.interval, currency: r.currency, amountMinor: Number(r.amount_minor) })),
    features: (f.data ?? []).filter((r: { plan_id: string }) => r.plan_id === x.id).map((r: { feature_key: string }) => r.feature_key),
  }));
}
