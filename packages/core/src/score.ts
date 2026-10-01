import type { Goal } from "./types";
import type { Macros } from "./nutrition";

/**
 * Daily Fitness Score — an internal 0–100 ADHERENCE score. It is not a health or medical score.
 * Fully deterministic; the AI layer may only phrase the explanation, never change the number.
 *
 * Each component is 0..1. Components without real data are EXCLUDED (never counted as zero or
 * invented) and weights are renormalised over the rest. No food logged → no score.
 * While the day is in progress, "on pace" is judged against the share of the day elapsed,
 * so a 10 am score isn't punished for lunch not having happened yet.
 */
export const SCORE_VERSION = "1.0.0";

export interface ScoreWeights { calories: number; protein: number; fibre: number; activity: number; workout: number; goal: number }
export const DEFAULT_WEIGHTS: ScoreWeights = { calories: 30, protein: 25, fibre: 10, activity: 15, workout: 15, goal: 5 };

/** Accepts a JSON value from app_settings; falls back to defaults on anything invalid. */
export function parseWeights(v: unknown): ScoreWeights {
  if (!v || typeof v !== "object") return DEFAULT_WEIGHTS;
  const o = v as Record<string, unknown>;
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(out) as (keyof ScoreWeights)[]) {
    const x = o[k];
    if (x === undefined) continue;
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return DEFAULT_WEIGHTS;
    out[k] = x;
  }
  return Object.values(out).some((w) => w > 0) ? out : DEFAULT_WEIGHTS;
}

export interface DayTargets { calories: number; proteinG: number; carbsG: number; fatG: number; fibreG: number; steps: number }

export interface DayInput {
  goal: Goal;
  targets: DayTargets;
  totals: Macros;
  mealsLogged: number;
  stepsToday: number | null;          // null = not entered (≠ 0)
  activeMinutes: number | null;       // non-step activity logged today; null = none logged
  workoutsLast7: number;              // completed sessions in the 7 days up to and including today
  trainingDays: number;               // user's planned sessions per week (0 = unspecified)
  weightTrendKgPerWeek: number | null;
  /** Local hour as a decimal (e.g. 14.5). */
  hour: number;
  /** True for past days (or after ~22:00): judge against the full day. */
  dayComplete: boolean;
}

export type ComponentKey = keyof ScoreWeights;
export interface ScoreComponent { key: ComponentKey; label: string; value: number | null; weight: number; note: string }
export type ScoreStatus = "on_track" | "slightly_off" | "off_track" | "no_data";
export interface DailyScore {
  score: number | null; status: ScoreStatus; inProgress: boolean;
  components: ScoreComponent[]; excluded: string[]; explanation: string; version: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const dayFraction = (hour: number, complete: boolean): number => (complete ? 1 : Math.max(0.1, Math.min(1, (hour - 6) / 16)));
/** 1 inside tolerance, falling linearly to 0 at `zero`. */
const fall = (dev: number, tol: number, zero: number) => (dev <= tol ? 1 : clamp01(1 - (dev - tol) / (zero - tol)));
const g = (n: number) => `${Math.round(n)} g`;

const SURPLUS: Goal[] = ["build_muscle", "gain_weight"];
const LOSS: Goal[] = ["lose_weight", "lose_fat"];

function calorieValue(i: DayInput): { v: number; note: string } {
  const t = i.targets.calories, d = (i.totals.calories - t) / t, surplus = SURPLUS.includes(i.goal), loss = LOSS.includes(i.goal);
  const over = fall(Math.max(0, d), surplus ? 0.15 : loss ? 0.05 : 0.1, surplus ? 0.4 : loss ? 0.3 : 0.35);
  const under = i.dayComplete ? fall(Math.max(0, -d), surplus ? 0.05 : loss ? 0.1 : 0.1, surplus ? 0.3 : loss ? 0.5 : 0.35) : 1;
  const v = Math.min(over, under);
  const diff = Math.round(Math.abs(i.totals.calories - t));
  const note = d > 0 && over < 1 ? `Calories are ${diff} kcal over target`
    : d < 0 && under < 1 ? `Calories are ${diff} kcal under target` : "Calories are within range";
  return { v, note };
}

function paceValue(current: number, target: number, frac: number, name: string, unit: string, partial: boolean) {
  const expected = target * frac;
  const v = clamp01(current / expected);
  const gap = Math.max(0, partial ? expected - current : target - current);
  const note = v >= 0.95 ? `${name} on track` : `${name} is ${unit === "g" ? g(gap) : `${Math.round(gap).toLocaleString()} ${unit}`} ${partial ? "behind pace" : "below target"}`;
  return { v, note };
}

export function scoreDay(i: DayInput, weights: ScoreWeights = DEFAULT_WEIGHTS): DailyScore {
  const frac = dayFraction(i.hour, i.dayComplete);
  const partial = !i.dayComplete && frac < 1;
  const base = { components: [] as ScoreComponent[], excluded: [] as string[], version: SCORE_VERSION, inProgress: partial };
  if (i.mealsLogged === 0)
    return { ...base, score: null, status: "no_data", explanation: "No meals logged yet, so there's nothing to score. Log a meal to see today's score." };

  const comps: ScoreComponent[] = [];
  const add = (key: ComponentKey, label: string, value: number | null, note: string) => comps.push({ key, label, value, weight: weights[key], note });

  const c = calorieValue(i); add("calories", "Calories", c.v, c.note);
  const p = paceValue(i.totals.proteinG, i.targets.proteinG, frac, "Protein", "g", partial); add("protein", "Protein", p.v, p.note);
  const f = paceValue(i.totals.fibreG, i.targets.fibreG, frac, "Fibre", "g", partial); add("fibre", "Fibre", f.v, f.note);

  let act: number | null = null, actNote = "No activity logged";
  if (i.stepsToday !== null) { const s = paceValue(i.stepsToday, i.targets.steps, frac, "Steps", "steps", partial); act = s.v; actNote = s.note; }
  if (i.activeMinutes !== null) {
    const m = clamp01(i.activeMinutes / 30);
    if (act === null || m > act) { act = m; actNote = m >= 0.95 ? "Activity on track" : `Activity is ${Math.round(30 - i.activeMinutes)} min short of 30`; }
  }
  add("activity", "Activity", act, actNote);

  const wk = i.trainingDays > 0 ? clamp01(i.workoutsLast7 / i.trainingDays) : i.workoutsLast7 > 0 ? 1 : null;
  add("workout", "Workouts", wk, wk === null ? "No workout plan or sessions" : wk >= 1 ? "Weekly workouts on track" : `${i.workoutsLast7} of ${i.trainingDays} planned workouts this week`);

  const tr = i.weightTrendKgPerWeek;
  let gv: number | null = null, gn = "Not enough weigh-ins for a trend";
  if (tr !== null) {
    const dir = LOSS.includes(i.goal) ? -tr : SURPLUS.includes(i.goal) ? tr : -Math.abs(tr) + 0.25;
    gv = clamp01(0.5 + dir / 0.5);
    gn = gv >= 0.75 ? "Weight trend matches your goal" : gv >= 0.4 ? "Weight trend is roughly flat for your goal" : "Weight trend is moving away from your goal";
  }
  add("goal", "Goal", gv, gn);

  const used = comps.filter((x) => x.value !== null && x.weight > 0);
  const total = used.reduce((s, x) => s + x.weight, 0);
  const excluded = comps.filter((x) => x.value === null).map((x) => `${x.label} (${x.note.toLowerCase()})`);
  if (total === 0) return { ...base, components: comps, excluded, score: null, status: "no_data", explanation: "Not enough data to score yet." };

  const score = Math.round((used.reduce((s, x) => s + x.weight * x.value!, 0) / total) * 100);
  const status: ScoreStatus = score >= 80 ? "on_track" : score >= 60 ? "slightly_off" : "off_track";
  const off = used.filter((x) => x.value! < 0.85).sort((a, b) => (1 - b.value!) * b.weight - (1 - a.value!) * a.weight);
  const ok = used.filter((x) => x.value! >= 0.85).map((x) => x.label.toLowerCase());
  const parts: string[] = [];
  if (ok.length) parts.push(`${cap(joinList(ok))} ${ok.length > 1 ? "are" : "is"} on track.`);
  for (const x of off.slice(0, 2)) parts.push(`${x.note}.`);
  if (partial) parts.push("The day isn't over, so this compares you with where you'd expect to be by now.");
  if (excluded.length) parts.push(`Not counted: ${excluded.map((e) => e.split(" (")[0]!.toLowerCase()).join(", ")} (no data).`);
  return { ...base, components: comps, excluded, score, status, explanation: parts.join(" ") };
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const joinList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
