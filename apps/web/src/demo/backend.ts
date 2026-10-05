/**
 * In-browser fake backend for DEMO mode only (VITE_DEMO=1 build). It answers the same Supabase REST/RPC
 * and coach-API requests the app makes, from sample data held in memory. Nothing here is real user data,
 * nothing is persisted, and the AI replies are simulated. It never ships in the normal build.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface DemoFlags { plan: "free" | "pro"; admin: boolean }
export const flags: DemoFlags = { plan: "pro", admin: false };

const iso = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const today = () => iso(new Date());
const dayAgo = (n: number) => iso(new Date(Date.now() - n * 864e5));
let seq = 1; const id = (p: string) => `${p}${seq++}`;

const FOODS: Row[] = [
  ["Roti (chapati)", "Breads", 1, "piece", 40, 120, 3.6, 22, 2.5, 3, ["chapati", "phulka"]], ["Cooked white rice", "Rice & Grains", 1, "katori", 150, 195, 4, 42, 0.4, 0.5, ["rice"]],
  ["Toor dal (cooked)", "Dal & Legumes", 1, "katori", 150, 140, 8, 20, 3, 4, ["dal"]], ["Moong dal (cooked)", "Dal & Legumes", 1, "katori", 150, 130, 9, 20, 1.5, 4, []],
  ["Rajma curry", "Dal & Legumes", 1, "katori", 150, 190, 9, 26, 5, 7, ["rajma"]], ["Paneer", "Dairy & Eggs", 100, "g", 100, 265, 18, 1.2, 20, 0, []],
  ["Paneer bhurji", "Curries", 1, "katori", 150, 300, 17, 6, 23, 1.5, []], ["Chicken curry", "Curries", 1, "katori", 150, 240, 20, 6, 15, 1.5, []],
  ["Chicken breast (cooked)", "Meat & Fish", 100, "g", 100, 165, 31, 0, 3.6, 0, ["chicken"]], ["Boiled egg", "Dairy & Eggs", 1, "piece", 50, 78, 6.3, 0.6, 5.3, 0, ["egg"]],
  ["Egg white", "Dairy & Eggs", 1, "piece", 33, 17, 3.6, 0.2, 0.1, 0, []], ["Greek yogurt", "Dairy & Eggs", 150, "g", 150, 90, 15, 5.5, 0.7, 0, []],
  ["Curd (dahi)", "Dairy & Eggs", 1, "katori", 100, 60, 3.5, 4.5, 3.3, 0, ["dahi", "curd"]], ["Idli", "Breakfast", 1, "piece", 40, 58, 2, 12, 0.3, 0.7, []],
  ["Plain dosa", "Breakfast", 1, "piece", 100, 168, 3.9, 29, 3.7, 1, ["dosa"]], ["Poha", "Breakfast", 1, "katori", 150, 220, 4, 38, 6, 2.5, []],
  ["Oats (dry)", "Rice & Grains", 40, "g", 40, 150, 5, 27, 2.5, 4, ["oats"]], ["Banana", "Fruit", 1, "piece", 120, 105, 1.3, 27, 0.4, 3.1, []],
  ["Chicken biryani", "Rice & Grains", 1, "plate", 300, 490, 24, 58, 17, 2.5, ["biryani"]], ["Sprouted moong", "Dal & Legumes", 100, "g", 100, 100, 7, 17, 0.6, 4, ["sprouts"]],
  ["Whey protein", "Supplements", 1, "scoop", 30, 120, 24, 3, 1.5, 0, []], ["Roasted chana", "Snacks", 30, "g", 30, 110, 6, 18, 2, 5, []],
].map(([name, cat, ss, su, sg, kc, p, c, f, fi, al], i) => ({
  id: `food${i + 1}`, name, aliases: al, serving_size: ss, serving_unit: su, serving_grams: sg, calories: kc, protein_g: p, carbs_g: c, fat_g: f, fibre_g: fi,
  verification_status: "ai_estimated", owner_id: null, source: "seed-draft-v1", food_categories: { name: cat },
}));
const EXERCISES: Row[] = [
  ["Barbell Bench Press", "Chest", "Barbell", "intermediate", "weight_reps"], ["Back Squat", "Legs", "Barbell", "intermediate", "weight_reps"], ["Lat Pulldown", "Back", "Machine", "beginner", "weight_reps"],
  ["Dumbbell Shoulder Press", "Shoulders", "Dumbbell", "beginner", "weight_reps"], ["Push-up", "Chest", "Bodyweight", "beginner", "reps"], ["Plank", "Core", "Bodyweight", "beginner", "duration"],
  ["Romanian Deadlift", "Legs", "Barbell", "intermediate", "weight_reps"], ["Biceps Curl", "Arms", "Dumbbell", "beginner", "weight_reps"],
].map(([name, mg, eq, d, t], i) => ({ id: `ex${i + 1}`, name, muscle_group: mg, equipment: eq, difficulty: d, tracks: t, instructions: "General technique cue (demo).", owner_id: null }));

const TARGETS = { calories: 2100, protein_g: 150, carbs_g: 220, fat_g: 60, fibre_g: 30, steps: 9000, tdee: 2600 };
const PRO = ["ai_coach", "weekly_reports", "daily_fitness_score", "workout_progression", "voice_logging"];

interface State { foodLogs: Row[]; water: Row[]; activities: Row[]; weights: Row[]; sessions: Row[]; sessionEx: Row[]; sets: Row[]; messages: Row[]; conv: string | null; dismissed: Set<string> }
let S: State;

export function resetDemo() {
  seq = 1;
  const meal = (date: string, type: string, food: Row | undefined, q: number): Row => ({
    id: id("fl"), name: food!.name, quantity: q, serving_label: `${food!.serving_size} ${food!.serving_unit}`, calories: food!.calories * q, protein_g: food!.protein_g * q,
    carbs_g: food!.carbs_g * q, fat_g: food!.fat_g * q, fibre_g: food!.fibre_g * q, source_status: food!.verification_status, food_id: food!.id, logged_at: `${date}T08:00:00Z`,
    meal_logs: { local_date: date, meal_type: type } });
  const f = (n: string) => FOODS.find((x) => x.name === n);
  const foodLogs = [
    meal(today(), "breakfast", f("Oats (dry)"), 1), meal(today(), "breakfast", f("Boiled egg"), 2), meal(today(), "breakfast", f("Banana"), 1),
    meal(today(), "lunch", f("Roti (chapati)"), 3), meal(today(), "lunch", f("Toor dal (cooked)"), 1.5), meal(today(), "lunch", f("Paneer bhurji"), 1), meal(today(), "lunch", f("Curd (dahi)"), 1),
  ];
  // 40 days of plausible history (one aggregate row per day; protein improves over the last week)
  for (let n = 1; n <= 40; n++) {
    if (n % 9 === 5) continue; // a few unlogged days: gaps stay gaps
    const recent = n <= 7;
    foodLogs.push({ id: id("fl"), name: "Meals (day total)", quantity: 1, serving_label: "day", calories: 1950 + ((n * 37) % 260), protein_g: recent ? 132 + (n % 4) * 4 : 104 + (n % 5) * 5, carbs_g: 210, fat_g: 58,
      fibre_g: 22 + (n % 6), source_status: "ai_estimated", food_id: null, logged_at: `${dayAgo(n)}T12:00:00Z`, meal_logs: { local_date: dayAgo(n), meal_type: "lunch" } });
  }
  const activities: Row[] = [{ id: id("ac"), local_date: today(), type: "steps", steps: 7480, distance_km: null, duration_min: null, active_kcal: null, source: "manual", logged_at: new Date().toISOString() }];
  for (let n = 1; n <= 40; n++) {
    if (n % 6 !== 4) activities.push({ id: id("ac"), local_date: dayAgo(n), type: "steps", steps: n <= 7 ? 9000 + (n % 3) * 600 : 6800 + (n % 4) * 500, distance_km: null, duration_min: null, active_kcal: null, source: "manual", logged_at: `${dayAgo(n)}T20:00:00Z` });
    if (n % 5 === 2) activities.push({ id: id("ac"), local_date: dayAgo(n), type: "run", steps: null, distance_km: 4 + (n % 3), duration_min: 26 + (n % 4) * 3, active_kcal: 320, source: "manual", logged_at: `${dayAgo(n)}T07:00:00Z` });
  }
  const weights = [0, 3, 6, 9, 13, 17, 21, 26, 31, 36].map((n, i) => ({ id: id("w"), local_date: dayAgo(n), weight_kg: String((81.4 + i * 0.25).toFixed(1)), logged_at: "" }));
  const sessions: Row[] = [{ id: "s-open", local_date: today(), workout_name: "Push day", duration_min: null, notes: null, completed: false, started_at: new Date().toISOString() }];
  const sets: Row[] = []; const sessionEx: Row[] = [{ id: id("se"), session_id: "s-open", exercise_id: "ex1", position: 0, exercises: EXERCISES[0] }];
  for (let k = 0; k < 6; k++) {
    const d = dayAgo(2 + k * 3), sid = `s-${k}`;
    sessions.push({ id: sid, local_date: d, workout_name: k % 2 ? "Legs" : "Push day", duration_min: 45 + k * 3, notes: null, completed: true, started_at: `${d}T07:00:00Z` });
    for (let s = 1; s <= 3; s++) sets.push({ id: id("st"), session_id: sid, exercise_id: "ex1", set_number: s, weight_kg: String(55 + Math.floor((5 - k) / 2) * 2.5), reps: k === 0 ? 12 : 10 + (s % 2), duration_s: null });
  }
  S = { foodLogs, water: [{ id: id("wt"), local_date: today(), ml: 750 }], activities, weights, sessions, sessionEx, sets, messages: [], conv: null, dismissed: new Set() };
}
resetDemo();

// ---------- tiny PostgREST emulation ----------
const get = (row: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), row);
function applyFilters(rows: Row[], q: URLSearchParams): Row[] {
  let out = rows;
  q.forEach((v, k) => {
    if (["select", "order", "limit", "offset", "on_conflict", "columns", "user_id"].includes(k)) return;   // single-user demo: user_id filters are no-ops
    const m = /^(eq|gte|lte|is|ilike|neq)\.(.*)$/.exec(v); if (!m) return;
    const [, op, val] = m as unknown as [string, string, string];
    out = out.filter((r) => {
      const x = get(r, k);
      if (op === "eq") return String(x) === val; if (op === "neq") return String(x) !== val;
      if (op === "gte") return String(x) >= val; if (op === "lte") return String(x) <= val;
      if (op === "is") return val === "null" ? x == null : x != null;
      if (op === "ilike") return String(x ?? "").toLowerCase().includes(val.replace(/\*/g, "").replace(/%/g, "").toLowerCase());
      return true;
    });
  });
  const order = q.get("order");
  if (order) for (const part of order.split(",").reverse()) {
    const [col, dir] = part.split("."); const sign = dir === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => { const x = String(get(a, col!) ?? ""), y = String(get(b, col!) ?? ""); return x < y ? -sign : x > y ? sign : 0; });
  }
  const lim = Number(q.get("limit")); if (lim > 0) out = out.slice(0, lim);
  return out;
}

const sum = (rows: Row[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
const todayLogs = () => S.foodLogs.filter((l) => l.meal_logs.local_date === today());
function totals(date: string) {
  const l = S.foodLogs.filter((x) => x.meal_logs.local_date === date);
  return [{ calories: sum(l, "calories"), protein_g: sum(l, "protein_g"), carbs_g: sum(l, "carbs_g"), fat_g: sum(l, "fat_g"), fibre_g: sum(l, "fibre_g"), water_ml: sum(S.water.filter((w) => w.local_date === date), "ml") }];
}
const entitlements = () => ({ plan: flags.plan, features: flags.plan === "pro" ? PRO : [], subscription: flags.plan === "pro" ? { plan_id: "pro", interval: "month", status: "trialing", current_period_end: null, trial_end: new Date(Date.now() + 5 * 864e5).toISOString(), cancel_at_period_end: false, grace_until: null, pending_plan_id: null } : null, trial_eligible: flags.plan === "free" });

function rpc(fn: string, a: Row): unknown {
  switch (fn) {
    case "day_totals": return totals(a.p_date);
    case "search_foods": { const q = String(a.q ?? "").toLowerCase().trim(); return q ? FOODS.filter((f) => f.name.toLowerCase().includes(q) || f.aliases.some((x: string) => x.includes(q))).slice(0, a.lim ?? 10) : []; }
    case "log_food": {
      const f = FOODS.find((x) => x.id === a.p_food_id)!, q = Number(a.p_quantity);
      S.foodLogs.push({ id: id("fl"), name: f.name, quantity: q, serving_label: `${f.serving_size} ${f.serving_unit}`, calories: f.calories * q, protein_g: f.protein_g * q, carbs_g: f.carbs_g * q, fat_g: f.fat_g * q,
        fibre_g: f.fibre_g * q, source_status: f.verification_status, food_id: f.id, logged_at: new Date().toISOString(), meal_logs: { local_date: a.p_date, meal_type: a.p_meal } });
      return {};
    }
    case "update_food_log_quantity": { const l = S.foodLogs.find((x) => x.id === a.p_id); if (l) { const r = Number(a.p_quantity) / l.quantity; for (const k of ["calories", "protein_g", "carbs_g", "fat_g", "fibre_g"]) l[k] *= r; l.quantity = Number(a.p_quantity); } return {}; }
    case "set_steps": { const r = S.activities.find((x) => x.type === "steps" && x.local_date === a.p_date); if (r) r.steps = a.p_steps; else S.activities.push({ id: id("ac"), local_date: a.p_date, type: "steps", steps: a.p_steps, source: "manual", logged_at: new Date().toISOString() }); return {}; }
    case "log_run": S.activities.push({ id: id("ac"), local_date: a.p_date, type: "run", distance_km: a.p_distance_km, duration_min: a.p_duration_min, active_kcal: a.p_active_kcal, source: "manual", logged_at: new Date().toISOString() }); return {};
    case "set_weight": { const r = S.weights.find((x) => x.local_date === a.p_date); if (r) r.weight_kg = String(a.p_kg); else S.weights.push({ id: id("w"), local_date: a.p_date, weight_kg: String(a.p_kg), logged_at: "" }); return {}; }
    case "search_exercises": { const q = String(a.q ?? "").toLowerCase().trim(); return q ? EXERCISES.filter((e) => e.name.toLowerCase().includes(q) || e.muscle_group.toLowerCase().startsWith(q)) : []; }
    case "start_session": { const s = { id: id("s"), local_date: a.p_date, workout_name: a.p_name || "Workout", duration_min: null, notes: null, completed: false, started_at: new Date().toISOString() }; S.sessions.unshift(s); return s; }
    case "exercise_history": {
      const bySession = new Map<string, Row[]>();
      for (const s of S.sets.filter((x) => x.exercise_id === a.p_exercise && x.session_id !== a.p_exclude_session)) bySession.set(s.session_id, [...(bySession.get(s.session_id) ?? []), s]);
      return [...bySession].map(([sid, sets]) => ({ session_id: sid, local_date: S.sessions.find((x) => x.id === sid)?.local_date ?? today(), sets: sets.sort((x, y) => x.set_number - y.set_number).map((s) => ({ set: s.set_number, weight_kg: s.weight_kg, reps: s.reps, duration_s: s.duration_s })) }))
        .sort((x, y) => (x.local_date < y.local_date ? 1 : -1)).slice(0, a.p_limit ?? 5);
    }
    case "save_template_from_session": return {};
    case "current_entitlements": return entitlements();
    case "has_ai_consent": return true;
    case "my_flags": return { ai_coach: true, announcements: true };
    case "my_admin_role": return flags.admin ? "super" : null;
    case "track_event": return null;
    case "admin_metrics": return { total_users: 482, dau: 61, wau: 174, mau: 301, retention: { d1: 41.2, d7: 22.5, d30: 11.8 }, food_logs_30d: 18240, users_logging_food_30d: 268, workouts_completed_30d: 2310, users_logging_workouts_30d: 142, ai_requests_30d: 3120, paying_users: 27, ever_paid_users: 41, conversion_pct: 8.5, churned_30d: 3, monthly_churn_pct: 10, mrr_minor: 817300, arpu_minor: 1695, arppu_minor: 30270, ltv_minor: null, cac_minor: null };
    case "admin_ai_stats": return { by_source: { ai: 2710, rules: 340, safety: 12 }, safety_flagged: 12, conversations: 640, requests_by_kind: { coach: 2950, report: 170 } };
    case "admin_list_users": return [{ user_id: "u1", email: "asha@example.com", created_at: `${dayAgo(30)}T00:00:00Z`, onboarding_completed: true, plan: "pro", sub_status: "active" }, { user_id: "u2", email: "ravi@example.com", created_at: `${dayAgo(4)}T00:00:00Z`, onboarding_completed: false, plan: "free", sub_status: null }];
    case "admin_flagged_messages": return [{ message_id: "m1", created_at: `${dayAgo(1)}T10:00:00Z`, source: "safety", user_message: "(sample) I want to lose 20 kg in 2 weeks", reply: "Very fast weight loss can be unsafe, so I won't build a plan around it…" }];
    default: return null;
  }
}

function coachReply(message: string) {
  const t = totals(today())[0]!, remP = Math.max(0, Math.round(TARGETS.protein_g - t.protein_g)), remK = Math.round(TARGETS.calories - t.calories), remF = Math.max(0, Math.round(TARGETS.fibre_g - t.fibre_g));
  const q = message.toLowerCase();
  const head = /train|run|workout/.test(q) ? "Based on your week, a short session is fine, but recovery matters too." : /week/.test(q) ? "Your last 7 days look steady: protein improved compared with the week before." : /weight/.test(q) ? "Your logged weight is trending slowly down — that's consistent with your goal." : `You've logged ${Math.round(t.calories)} of ${TARGETS.calories} kcal so far today.`;
  return { status: "on_track", priority: remP > 5 ? `Protein is your next priority — about ${remP} g to go` : "You're close to your targets", summary: `${head} (Simulated demo answer built from the sample data on screen.)`,
    recommendations: [remP > 5 ? `Add a protein source: for example 150 g Greek yogurt (90 kcal, 15 g protein).` : "Keep your remaining meals balanced.", remK > 150 ? `You have about ${remK} kcal left today.` : "You're near your calorie target.", ...(remF >= 5 ? [`Aim for about ${remF} g more fibre (dal, vegetables, fruit).`] : [])].slice(0, 3), confidence: 1, safety_flag: false };
}

// ---------- request router ----------
const json = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : null;
  const url = new URL(req?.url ?? String(input), "http://demo.local");
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const rawBody = init?.body ?? (req ? await req.clone().text() : undefined);
  let body: Row = {}; try { body = rawBody ? JSON.parse(String(rawBody)) : {}; } catch { /* none */ }
  const accept = new Headers(init?.headers ?? req?.headers).get("accept") ?? "";
  const single = accept.includes("pgrst.object");
  const wrap = (rows: Row[]) => json(single ? (rows[0] ?? null) : rows);
  const p = url.pathname, q = url.searchParams;

  if (p.startsWith("/auth/v1/user")) return json({ id: "demo-user", email: "demo@example.com", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" });
  if (p.startsWith("/auth/v1/")) return json({});

  if (p.endsWith("/v1/coach/messages")) {
    if (flags.plan !== "pro") return json({ code: "upgrade_required", feature: "ai_coach", message: "The AI coach is part of Pro. Upgrade to use it.", retryable: false }, 402);
    const reply = coachReply(String(body.message ?? "")); S.conv ??= "conv1";
    return json({ conversation_id: S.conv, reply, source: "rules", fallback_reason: "ai_not_configured", score: 90, saved: true, disclaimer: "Demo: simulated answer. Not medical advice." });
  }
  if (p.endsWith("/v1/reports/narrative")) return json({ narrative: { summary: "Demo summary: you logged food on most days and protein improved compared with the previous period.", improved: [], declined: [], priority: "Protein", next_week_focus: [] }, source: "rules", fallback_reason: "ai_not_configured", saved: true, disclaimer: "Demo" });
  if (p.includes("/v1/billing/")) return json({ code: "billing_not_configured", message: "Payments aren't available in the demo.", retryable: false }, 503);

  const rpcM = /\/rest\/v1\/rpc\/(\w+)/.exec(p);
  if (rpcM) return json(rpc(rpcM[1]!, body));

  const t = /\/rest\/v1\/(\w+)/.exec(p)?.[1]; if (!t) return json([], 404);
  const table: Record<string, Row[] | undefined> = {
    food_logs: S.foodLogs, foods: FOODS, activities: S.activities, weight_logs: S.weights, workout_sessions: S.sessions, session_exercises: S.sessionEx, workout_sets: S.sets, water_logs: S.water,
    exercises: EXERCISES,
    profiles: [{ name: "Asha", onboarding_completed: true, diet: "eggetarian", training_days_per_week: 3 }], nutrition_targets: [TARGETS], goals: [{ goal: "lose_fat", start_weight_kg: "82", target_weight_kg: "75", active: true }],
    app_settings: [{ key: "score_weights", value: { calories: 30, protein: 25, fibre: 10, activity: 15, workout: 15, goal: 5 } }, { key: "billing", value: { grace_days: 7, trial_days: 7, period_skew_hours: 12 } }],
    plans: [{ id: "free", name: "Free", sort: 0 }, { id: "pro", name: "Pro", sort: 1 }, { id: "pro_plus", name: "Pro+", sort: 2 }],
    plan_prices: [{ id: "p1", plan_id: "pro", interval: "month", currency: "INR", amount_minor: 29900, active: true }, { id: "p2", plan_id: "pro", interval: "year", currency: "INR", amount_minor: 199900, active: true }, { id: "p3", plan_id: "pro_plus", interval: "month", currency: "INR", amount_minor: 49900, active: true }],
    plan_features: [...PRO.map((k) => ({ plan_id: "pro", feature_key: k, daily_limit: k === "ai_coach" ? 20 : null })), ...PRO.concat(["ai_meal_planning"]).map((k) => ({ plan_id: "pro_plus", feature_key: k, daily_limit: null }))],
    notifications: S.dismissed.has("n1") ? [] : [{ id: "n1", title: "Welcome to the demo", body: "This is sample data in your browser. Use the bar at the top to switch between Free, Pro and Admin views.", created_at: new Date().toISOString() }],
    notification_dismissals: [...S.dismissed].map((n) => ({ notification_id: n })),
    workout_templates: [], weekly_reports: [], daily_scores: [], body_measurements: [], ai_conversations: S.conv ? [{ id: S.conv }] : [], ai_messages: S.messages,
    feedback: [{ id: "f1", category: "idea", message: "(sample) Please add more South Indian dishes.", page: "/nutrition", status: "new", admin_note: null, created_at: `${dayAgo(1)}T09:00:00Z` }],
    feature_flags: [{ key: "ai_coach", description: "AI kill switch", enabled: true, rollout_percent: 100 }, { key: "announcements", description: "Show in-app announcements", enabled: true, rollout_percent: 100 }],
    audit_logs: [{ id: 1, actor_id: "11111111", action: "UPDATE", target: "foods:food1", created_at: `${dayAgo(1)}T10:00:00Z`, meta: {} }], admin_users: [{ user_id: "11111111-aaaa", role: "super", created_at: "" }],
    consents: [], events: [],
  };

  if (method === "GET" || method === "HEAD") {
    const rows = table[t]; if (!rows) return json(single ? null : []);
    let out = applyFilters(rows, q);
    if (t === "foods" && q.get("owner_id") !== "is.null") out = out.filter((f) => f.owner_id === null);
    if (t === "food_logs" || t === "workout_sets" || t === "session_exercises") return wrap(out);
    return wrap(out);
  }
  if (method === "DELETE") {
    const arr = table[t]; if (arr && ["food_logs", "workout_sets", "session_exercises", "workout_sessions", "activities"].includes(t)) {
      const del = new Set(applyFilters(arr, q)); for (let i = arr.length - 1; i >= 0; i--) if (del.has(arr[i]!)) arr.splice(i, 1);
    }
    return json(null, 204);
  }
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    const rowsIn: Row[] = Array.isArray(body) ? body : [body];
    if (t === "water_logs") S.water.push({ id: id("wt"), local_date: rowsIn[0]!.local_date, ml: rowsIn[0]!.ml });
    else if (t === "workout_sets") S.sets.push({ id: id("st"), ...rowsIn[0]! });
    else if (t === "session_exercises") S.sessionEx.push({ id: id("se"), ...rowsIn[0]!, exercises: EXERCISES.find((e) => e.id === rowsIn[0]!.exercise_id) });
    else if (t === "activities") S.activities.push({ id: id("ac"), source: "manual", logged_at: new Date().toISOString(), ...rowsIn[0]! });
    else if (t === "workout_sessions" && method === "PATCH") for (const s of applyFilters(S.sessions, q)) Object.assign(s, body);
    else if (t === "notification_dismissals") S.dismissed.add(rowsIn[0]!.notification_id);
    else if (t === "ai_messages") S.messages.push(...rowsIn);
    // Everything else (feedback, admin edits, consents, caches…) is accepted but not persisted in the demo.
    return json(null, 201);
  }
  return json(null, 204);
}
