import {
  nextActions, scoreDay, DEFAULT_WEIGHTS, type DayInput, type FoodCandidate, type Diet, type ScoreWeights, type Goal,
} from "@fitness-os/core";

/** Compact, PII-free snapshot sent to the model (PRD §23). No name, email, ids or raw history. */
export interface WeekSummary {
  days_with_food_logs: number;
  avg_calories: number | null; avg_protein_g: number | null; avg_fibre_g: number | null;
  avg_steps: number | null; workouts: number; run_km: number;
}
export interface ContextInput {
  date: string;
  hour: number;
  day: DayInput;
  waterMl: number;
  currentWeightKg: number | null;
  avg7WeightKg: number | null;
  targetWeightKg: number | null;
  week: WeekSummary | null;
  diet: Diet | null;
  foods: FoodCandidate[];
  weights?: ScoreWeights;
}

export interface AiContext {
  date: string;
  local_time: string;
  day_in_progress: boolean;
  goal: Goal;
  weight: { current_kg: number | null; avg_7day_kg: number | null; target_kg: number | null; trend_kg_per_week: number | null };
  targets: { calories: number; protein_g: number; fibre_g: number; steps: number };
  today: {
    calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number; water_ml: number;
    meals_logged: number; steps: number | null; active_minutes: number | null;
    workouts_last_7_days: number; planned_workouts_per_week: number;
  };
  remaining: { calories: number; protein_g: number; fibre_g: number; steps: number | null };
  score: { value: number | null; status: string; explanation: string };
  suggested_actions: { title: string; detail: string; foods: string[] }[];
  week: WeekSummary | null;
  data_gaps: string[];
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

export function buildContext(i: ContextInput): AiContext {
  const d = i.day, t = d.targets;
  const score = scoreDay(d, i.weights ?? DEFAULT_WEIGHTS);
  const actions = nextActions({ ...d, diet: i.diet, foods: i.foods });
  const gaps: string[] = [];
  if (d.mealsLogged === 0) gaps.push("no meals logged today");
  if (d.stepsToday === null) gaps.push("no steps entered today");
  if (i.currentWeightKg === null) gaps.push("no weight logged");
  if (d.weightTrendKgPerWeek === null) gaps.push("not enough weigh-ins for a weight trend");
  if (!i.week || i.week.days_with_food_logs < 3) gaps.push("fewer than 3 days of food logs this week");
  return {
    date: i.date, local_time: hhmm(i.hour), day_in_progress: !d.dayComplete, goal: d.goal,
    weight: { current_kg: i.currentWeightKg, avg_7day_kg: i.avg7WeightKg, target_kg: i.targetWeightKg, trend_kg_per_week: d.weightTrendKgPerWeek },
    targets: { calories: t.calories, protein_g: t.proteinG, fibre_g: t.fibreG, steps: t.steps },
    today: {
      calories: r0(d.totals.calories), protein_g: r0(d.totals.proteinG), carbs_g: r0(d.totals.carbsG), fat_g: r0(d.totals.fatG),
      fibre_g: r0(d.totals.fibreG), water_ml: i.waterMl, meals_logged: d.mealsLogged, steps: d.stepsToday, active_minutes: d.activeMinutes,
      workouts_last_7_days: d.workoutsLast7, planned_workouts_per_week: d.trainingDays,
    },
    remaining: {
      calories: r0(t.calories - d.totals.calories), protein_g: r0(Math.max(0, t.proteinG - d.totals.proteinG)),
      fibre_g: r0(Math.max(0, t.fibreG - d.totals.fibreG)), steps: d.stepsToday === null ? null : Math.max(0, t.steps - d.stepsToday),
    },
    score: { value: score.score, status: score.status, explanation: score.explanation },
    suggested_actions: actions.map((a) => ({
      title: a.title, detail: a.detail,
      foods: a.suggestions.map((s) => `${s.servings} × ${s.servingLabel} ${s.name} (${s.calories} kcal, ${r1(s.proteinG)} g protein)`),
    })),
    week: i.week,
    data_gaps: gaps,
  };
}

/** Every number present in the context — the set the model may cite. */
export function allowedNumbers(ctx: AiContext, extraText = ""): number[] {
  const nums = (JSON.stringify(ctx) + " " + extraText).match(/-?\d+(?:\.\d+)?/g) ?? [];
  return nums.map(Number);
}
