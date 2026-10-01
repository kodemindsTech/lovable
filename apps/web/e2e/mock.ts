import type { Page, Route } from "@playwright/test";

/** In-browser fake of Supabase REST + the coach API, so UI flows run without any backend. */
export interface MockOpts {
  signedIn?: boolean; onboarded?: boolean; role?: string | null; plan?: "free" | "pro";
  failFirst?: string[];            // URL fragments that return 500 on first call (to test retry)
  coachReply?: object | { status: number; body: object };
}
export interface Call { method: string; url: string; body: unknown }

const day = (n = 0) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const FOOD = { id: "f1", name: "Roti (chapati)", serving_size: 1, serving_unit: "piece", serving_grams: 40, calories: 120, protein_g: 3.6, carbs_g: 22, fat_g: 2.5, fibre_g: 3, verification_status: "ai_estimated", aliases: [] };
const PRO = ["ai_coach", "weekly_reports", "daily_fitness_score", "workout_progression"];

export async function mockBackend(page: Page, o: MockOpts = {}) {
  const calls: Call[] = []; const failed = new Set<string>();
  const signedIn = o.signedIn ?? true, plan = o.plan ?? "pro";
  if (signedIn)
    await page.addInitScript(() => localStorage.setItem("sb-localhost-auth-token", JSON.stringify({
      access_token: "a.b.c", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "00000000-0000-0000-0000-000000000001", email: "t@example.com", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" } })));

  await page.route("http://localhost:54321/**", async (r: Route) => {
    const req = r.request(), u = req.url();
    const j = (x: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(x) });
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: H });
    let body: unknown = null; try { body = req.postDataJSON(); } catch { /* none */ }
    calls.push({ method: req.method(), url: u, body });
    for (const f of o.failFirst ?? []) if (u.includes(f) && !failed.has(f)) { failed.add(f); return j({ message: "boom" }, 500); }
    if (u.includes("/profiles")) return j({ name: "Asha", onboarding_completed: o.onboarded ?? true, diet: "eggetarian", training_days_per_week: 3 });
    if (u.includes("rpc/complete_onboarding") || u.includes("rpc/delete_my_account")) return j(null);
    if (u.includes("/nutrition_targets")) return j({ calories: 2100, protein_g: 150, carbs_g: 220, fat_g: 60, fibre_g: 30, steps: 9000, tdee: 2500 });
    if (u.includes("my_admin_role")) return j(o.role ?? null);
    if (u.includes("current_entitlements")) return j({ plan, features: plan === "pro" ? PRO : [], subscription: null, trial_eligible: true });
    if (u.includes("has_ai_consent")) return j(true);
    if (u.includes("my_flags")) return j({ ai_coach: true, announcements: true });
    if (u.includes("search_foods")) return j([FOOD]);
    if (u.includes("rpc/log_food")) return j({});
    if (u.includes("day_totals")) return j([{ calories: 1760, protein_g: 137, carbs_g: 180, fat_g: 55, fibre_g: 25, water_ml: 250 }]);
    if (u.includes("/food_logs")) return j([{ id: "l1", name: "Roti (chapati)", quantity: 2, serving_label: "1 piece", calories: 240, protein_g: 7.2, carbs_g: 44, fat_g: 5, fibre_g: 6, source_status: "ai_estimated", meal_logs: { local_date: day(), meal_type: "breakfast" } }]);
    if (u.includes("/foods")) return j([{ ...FOOD, food_categories: { name: "Breads" } }]);
    if (u.includes("/goals")) return j({ goal: "lose_fat", start_weight_kg: "82", target_weight_kg: "75" });
    if (u.includes("/weight_logs")) return j([28, 14, 0].map((n, i) => ({ local_date: day(n), weight_kg: String(82 - i) })));
    if (u.includes("/activities")) return j(u.includes("type=eq.steps") ? { steps: 11420 } : [{ id: "a1", local_date: day(), type: "steps", steps: 11420, distance_km: null, duration_min: null, active_kcal: null, source: "manual" }]);
    if (u.includes("/workout_sessions")) return j(u.includes("id=eq.") ? { id: "s1", local_date: day(), workout_name: "Push", duration_min: null, notes: null, completed: false, started_at: "" } : [{ id: "s1", local_date: day(), workout_name: "Push", duration_min: 45, notes: null, completed: true, started_at: "" }]);
    if (u.includes("/session_exercises")) return j([]);
    if (u.includes("/workout_sets")) return j([]);
    if (u.includes("/workout_templates")) return j([]);
    if (u.includes("/plan_prices")) return j([{ plan_id: "pro", interval: "month", currency: "INR", amount_minor: 29900 }]);
    if (u.includes("/plan_features")) return j(PRO.map((k) => ({ plan_id: "pro", feature_key: k })));
    if (u.includes("/plans")) return j([{ id: "free", name: "Free", sort: 0 }, { id: "pro", name: "Pro", sort: 1 }]);
    if (u.includes("/weekly_reports")) return j(null);
    if (u.includes("/notifications")) return j([{ id: "n1", title: "Welcome", body: "Thanks for trying the beta." }]);
    if (u.includes("admin_metrics")) return j({ total_users: 5, dau: 1, wau: 2, mau: 3, retention: {}, paying_users: 0 });
    if (u.includes("admin_ai_stats")) return j({ by_source: {}, safety_flagged: 0, conversations: 0, requests_by_kind: {} });
    if (u.includes("track_event")) return j(null);
    return j([]);
  });

  await page.route("http://localhost:8787/**", async (r: Route) => {
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: H });
    calls.push({ method: "POST", url: r.request().url(), body: r.request().postDataJSON() });
    const c = o.coachReply as { status?: number; body?: object } | undefined;
    if (c && "status" in c && c.status) return r.fulfill({ status: c.status, contentType: "application/json", headers: H, body: JSON.stringify(c.body) });
    return r.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify({
      conversation_id: "c1", source: "ai", fallback_reason: null, score: 86, saved: true, disclaimer: "x",
      reply: (o.coachReply as object) ?? { status: "on_track", summary: "You need about 13 g more protein.", priority: "Protein", recommendations: ["Add yogurt"], confidence: 0.9, safety_flag: false } }) });
  });
  return { calls };
}
