import { supabase } from "./supabase";

export type EventName =
  | "app_opened" | "onboarding_started" | "onboarding_completed" | "food_logged" | "workout_started" | "workout_completed"
  | "weight_logged" | "activity_logged" | "ai_opened" | "ai_recommendation_viewed" | "weekly_report_viewed" | "subscription_started" | "subscription_cancelled";

/** Fire-and-forget product event. Name only — no health values, ever. Failures never affect the UI. */
export function track(name: EventName): void {
  void supabase.rpc("track_event", { p_name: name }).then(() => undefined, () => undefined);
}
/** Track at most once per browser session. */
export function trackOnce(name: EventName): void {
  try { const k = `ev:${name}`; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch { /* storage unavailable: just track */ }
  track(name);
}
