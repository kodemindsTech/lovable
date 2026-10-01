import type { Goal } from "./types";
import { scoreDay } from "./score";
import { daysBetween, shiftDate } from "./progress";

/**
 * Period reports and "What changed?" — pure, deterministic. Only real logged data is used:
 * averages are over days that HAVE data (a missing day is never treated as zero), and every
 * comparison needs data on both sides.
 */
export interface DaySummary {
  date: string;
  mealsLogged: number;
  /** Sums for the day; only meaningful when mealsLogged > 0. */
  calories: number; proteinG: number; fibreG: number;
  steps: number | null;
  workouts: number;
  runKm: number;
  weightKg: number | null;
}
export interface ReportTargets { calories: number; proteinG: number; carbsG: number; fatG: number; fibreG: number; steps: number }
export interface ReportConfig {
  start: string; end: string;
  /** Last day to count (e.g. today for an in-progress period). Defaults to `end`. */
  asOf?: string;
  targets: ReportTargets; goal: Goal;
  tdee?: number | null;
  trainingDays?: number;
}

export interface PeriodStats {
  start: string; end: string; asOf: string; inProgress: boolean;
  days: number; daysLogged: number;
  avgCalories: number | null; avgProteinG: number | null; avgFibreG: number | null;
  avgSteps: number | null; stepDays: number;
  workouts: number; runKm: number;
  avgWeightKg: number | null; weightChangeKg: number | null; weighIns: number;
  /** ESTIMATE: average logged calories − TDEE (negative = deficit). Needs ≥3 logged days and a TDEE. */
  estimatedBalanceKcal: number | null;
  adherentDays: number; adherencePct: number | null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r0 = (n: number | null) => (n === null ? null : Math.round(n));
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

export function summarisePeriod(all: DaySummary[], c: ReportConfig): PeriodStats {
  const asOf = c.asOf && c.asOf < c.end ? c.asOf : c.end;
  const days = all.filter((d) => d.date >= c.start && d.date <= asOf);
  const logged = days.filter((d) => d.mealsLogged > 0);
  const steps = days.filter((d) => d.steps !== null).map((d) => d.steps!);
  const weights = days.filter((d) => d.weightKg !== null).sort((a, b) => a.date.localeCompare(b.date));
  const avgCal = avg(logged.map((d) => d.calories));

  // A logged day is "adherent" when calories are within the goal's band and protein ≥ 90% of target.
  const adherent = logged.filter((d) => {
    const s = scoreDay({
      goal: c.goal, targets: c.targets, totals: { calories: d.calories, proteinG: d.proteinG, carbsG: 0, fatG: 0, fibreG: d.fibreG },
      mealsLogged: d.mealsLogged, stepsToday: null, activeMinutes: null, workoutsLast7: 0, trainingDays: 0,
      weightTrendKgPerWeek: null, hour: 23, dayComplete: true,
    });
    const cal = s.components.find((x) => x.key === "calories")!.value!;
    return cal >= 0.8 && d.proteinG >= c.targets.proteinG * 0.9;
  }).length;

  return {
    start: c.start, end: c.end, asOf, inProgress: asOf < c.end,
    days: daysBetween(c.start, asOf) + 1, daysLogged: logged.length,
    avgCalories: r0(avgCal), avgProteinG: r0(avg(logged.map((d) => d.proteinG))), avgFibreG: r0(avg(logged.map((d) => d.fibreG))),
    avgSteps: r0(avg(steps)), stepDays: steps.length,
    workouts: days.reduce((s, d) => s + d.workouts, 0), runKm: Math.round(days.reduce((s, d) => s + d.runKm, 0) * 10) / 10,
    avgWeightKg: r1(avg(weights.map((d) => d.weightKg!))),
    weightChangeKg: weights.length >= 2 ? r1(weights.at(-1)!.weightKg! - weights[0]!.weightKg!) : null,
    weighIns: weights.length,
    estimatedBalanceKcal: c.tdee && avgCal !== null && logged.length >= 3 ? Math.round(avgCal - c.tdee) : null,
    adherentDays: adherent, adherencePct: logged.length ? Math.round((adherent / logged.length) * 100) : null,
  };
}

// ---------------- What changed? ----------------
export type MetricKey = "calories" | "protein" | "fibre" | "steps" | "workouts" | "runKm" | "weight" | "adherence";
export interface Change {
  key: MetricKey; label: string; from: number; to: number; delta: number; pct: number | null;
  direction: "up" | "down"; sentiment: "better" | "worse" | "neutral"; text: string;
}

interface MetricDef {
  key: MetricKey; label: string; unit: string;
  get: (s: PeriodStats) => number | null;
  minPct?: number; minAbs?: number;
  /** +1 higher is better, -1 lower is better, 0 neutral, or goal-based. */
  better: (g: Goal) => 1 | -1 | 0;
  phrase: (d: number, from: number, to: number, pct: number | null) => string;
}
const fmt = (n: number) => Math.abs(Math.round(n)).toLocaleString("en-US");
const LOSS: Goal[] = ["lose_weight", "lose_fat"], GAIN: Goal[] = ["build_muscle", "gain_weight"];
const verb = (d: number) => (d > 0 ? "increased" : "decreased");

const METRICS: MetricDef[] = [
  { key: "protein", label: "Protein", unit: "g/day", get: (s) => s.avgProteinG, minPct: 10, better: () => 1,
    phrase: (d, f, t, p) => `Average protein ${verb(d)} ${Math.abs(Math.round(p ?? 0))}% (${f} → ${t} g/day).` },
  { key: "fibre", label: "Fibre", unit: "g/day", get: (s) => s.avgFibreG, minPct: 10, better: () => 1,
    phrase: (d, f, t, p) => `Average fibre ${verb(d)} ${Math.abs(Math.round(p ?? 0))}% (${f} → ${t} g/day).` },
  { key: "calories", label: "Calories", unit: "kcal/day", get: (s) => s.avgCalories, minPct: 8, better: () => 0,
    phrase: (d, f, t) => `Average calories ${verb(d)} by ${fmt(d)} kcal/day (${f.toLocaleString("en-US")} → ${t.toLocaleString("en-US")}).` },
  { key: "steps", label: "Steps", unit: "steps/day", get: (s) => s.avgSteps, minAbs: 1000, better: () => 1,
    phrase: (d) => `Average steps ${verb(d)} ${fmt(d)}/day.` },
  { key: "workouts", label: "Workouts", unit: "sessions", get: (s) => s.workouts, minAbs: 1, better: () => 1,
    phrase: (d, f, t) => `Workouts ${verb(d)} from ${f} to ${t}.` },
  { key: "runKm", label: "Running", unit: "km", get: (s) => s.runKm, minAbs: 1, better: () => 1,
    phrase: (d, f, t) => `Running distance ${verb(d)} from ${f} to ${t} km.` },
  { key: "weight", label: "Weight", unit: "kg", get: (s) => s.avgWeightKg, minAbs: 0.3,
    better: (g) => (LOSS.includes(g) ? -1 : GAIN.includes(g) ? 1 : 0),
    phrase: (d, f, t) => `Average weight ${verb(d)} ${Math.abs(Math.round(d * 10) / 10)} kg (${f} → ${t} kg).` },
  { key: "adherence", label: "Plan adherence", unit: "%", get: (s) => s.adherencePct, minAbs: 10, better: () => 1,
    phrase: (d, f, t) => `Days on plan ${verb(d)} from ${f}% to ${t}%.` },
];

/** Meaningful changes between two periods, biggest first. Needs real data in both periods. */
export function compareMeaningful(prev: PeriodStats, cur: PeriodStats, goal: Goal, opts: { minDays?: number } = {}): Change[] {
  const minDays = opts.minDays ?? 1;
  const out: (Change & { weight: number })[] = [];
  for (const m of METRICS) {
    const needsFoodDays = ["protein", "fibre", "calories", "adherence"].includes(m.key);
    if (needsFoodDays && (prev.daysLogged < minDays || cur.daysLogged < minDays)) continue;
    if (m.key === "steps" && (prev.stepDays < minDays || cur.stepDays < minDays)) continue;
    if (m.key === "weight" && (prev.weighIns < 1 || cur.weighIns < 1)) continue;
    const a = m.get(prev), b = m.get(cur);
    if (a === null || b === null) continue;
    const delta = Math.round((b - a) * 10) / 10, pct = a !== 0 ? (delta / a) * 100 : null;
    const big = (m.minPct !== undefined && pct !== null && Math.abs(pct) >= m.minPct) || (m.minAbs !== undefined && Math.abs(delta) >= m.minAbs);
    if (!big) continue;
    const dir = m.better(goal);
    out.push({
      key: m.key, label: m.label, from: a, to: b, delta, pct: pct === null ? null : Math.round(pct * 10) / 10,
      direction: delta > 0 ? "up" : "down", sentiment: dir === 0 ? "neutral" : delta * dir > 0 ? "better" : "worse",
      text: m.phrase(delta, a, b, pct), weight: m.minPct ? Math.abs(pct ?? 0) / m.minPct : Math.abs(delta) / (m.minAbs ?? 1),
    });
  }
  return out.sort((x, y) => y.weight - x.weight).map(({ weight: _w, ...c }) => c);
}

/** Day vs day (e.g. yesterday vs today so far). Nutrition only; today is partial so wording says so. */
export function compareDays(yesterday: DaySummary | undefined, today: DaySummary | undefined, todayInProgress: boolean): string[] {
  if (!yesterday || !today || yesterday.mealsLogged === 0 || today.mealsLogged === 0) return [];
  const out: string[] = [];
  const suffix = todayInProgress ? " so far today" : "";
  for (const [label, a, b, unit, pctMin] of [
    ["Protein", yesterday.proteinG, today.proteinG, "g", 10], ["Fibre", yesterday.fibreG, today.fibreG, "g", 10], ["Calories", yesterday.calories, today.calories, "kcal", 10],
  ] as const) {
    if (a <= 0) continue;
    const pct = ((b - a) / a) * 100;
    if (Math.abs(pct) >= pctMin) out.push(`${label}${suffix} is ${Math.abs(Math.round(pct))}% ${pct > 0 ? "higher" : "lower"} than yesterday (${Math.round(a)} → ${Math.round(b)} ${unit}).`);
  }
  if (yesterday.steps !== null && today.steps !== null && Math.abs(today.steps - yesterday.steps) >= 1000)
    out.push(`Steps${suffix} are ${fmt(today.steps - yesterday.steps)} ${today.steps > yesterday.steps ? "higher" : "lower"} than yesterday.`);
  return out;
}

// ---------------- Report ----------------
export interface Report {
  stats: PeriodStats; previous: PeriodStats; targets: ReportTargets;
  changes: Change[]; improved: Change[]; declined: Change[];
  priority: { key: string; text: string };
  nextFocus: string[];
  notes: string[];
  estimates: string[];
}

interface Gap { key: string; shortfall: number; text: string; focus: string }

export function buildReport(all: DaySummary[], c: ReportConfig, prevCfg: Pick<ReportConfig, "start" | "end">): Report {
  const stats = summarisePeriod(all, c);
  const previous = summarisePeriod(all, { ...c, ...prevCfg, asOf: prevCfg.end });
  const changes = compareMeaningful(previous, stats, c.goal);
  const t = c.targets;
  const notes: string[] = [];
  if (stats.inProgress) notes.push("This period isn't finished yet; figures cover the days so far.");
  if (stats.daysLogged < Math.min(stats.days, 4)) notes.push(`Only ${stats.daysLogged} of ${stats.days} days have food logged, so averages may not reflect a typical day.`);
  if (stats.stepDays === 0) notes.push("No steps were recorded in this period.");

  const gaps: Gap[] = [];
  const enough = stats.daysLogged >= 3;
  if (enough && stats.avgProteinG !== null && stats.avgProteinG < t.proteinG * 0.9)
    gaps.push({ key: "protein", shortfall: 1 - stats.avgProteinG / t.proteinG,
      text: `Protein averaged ${stats.avgProteinG} g/day against a ${t.proteinG} g target.`, focus: `Add about ${t.proteinG - stats.avgProteinG} g of protein per day to reach your target.` });
  if (enough && stats.avgFibreG !== null && stats.avgFibreG < t.fibreG * 0.8)
    gaps.push({ key: "fibre", shortfall: (1 - stats.avgFibreG / t.fibreG) * 0.7,
      text: `Fibre averaged ${stats.avgFibreG} g/day against a ${t.fibreG} g target.`, focus: `Aim for about ${t.fibreG - stats.avgFibreG} g more fibre per day (vegetables, dal, fruit, whole grains).` });
  if (enough && stats.avgCalories !== null && LOSS.includes(c.goal) && stats.avgCalories > t.calories * 1.08)
    gaps.push({ key: "calories", shortfall: stats.avgCalories / t.calories - 1,
      text: `Calories averaged ${stats.avgCalories.toLocaleString("en-US")} kcal/day, above your ${t.calories.toLocaleString("en-US")} kcal target.`, focus: `Bring daily calories back toward ${t.calories.toLocaleString("en-US")} kcal.` });
  if (enough && stats.avgCalories !== null && GAIN.includes(c.goal) && stats.avgCalories < t.calories * 0.92)
    gaps.push({ key: "calories", shortfall: 1 - stats.avgCalories / t.calories,
      text: `Calories averaged ${stats.avgCalories.toLocaleString("en-US")} kcal/day, below your ${t.calories.toLocaleString("en-US")} kcal target.`, focus: `Eat closer to ${t.calories.toLocaleString("en-US")} kcal per day.` });
  if (stats.stepDays >= 3 && stats.avgSteps !== null && stats.avgSteps < t.steps * 0.8)
    gaps.push({ key: "steps", shortfall: (1 - stats.avgSteps / t.steps) * 0.6,
      text: `Steps averaged ${stats.avgSteps.toLocaleString("en-US")}/day against a ${t.steps.toLocaleString("en-US")} target.`, focus: `Add about ${(Math.round((t.steps - stats.avgSteps) / 500) * 500).toLocaleString("en-US")} steps per day.` });
  const planned = c.trainingDays ?? 0;
  const weeks = Math.max(stats.days / 7, 1);
  if (planned > 0 && !stats.inProgress && stats.workouts < Math.floor(planned * weeks) * 0.75)
    gaps.push({ key: "workouts", shortfall: 1 - stats.workouts / (planned * weeks),
      text: `${stats.workouts} workouts logged against about ${Math.round(planned * weeks)} planned.`, focus: `Schedule ${planned} sessions next week and log them.` });

  gaps.sort((a, b) => b.shortfall - a.shortfall);
  const priority = gaps[0]
    ? { key: gaps[0].key, text: gaps[0].text }
    : stats.daysLogged < 3
      ? { key: "log_more", text: "Log food on more days so the report can show a reliable picture." }
      : { key: "maintain", text: "You're close to your targets — keep the routine going." };
  const nextFocus = gaps.length ? gaps.slice(0, 3).map((g) => g.focus) : stats.daysLogged < 3 ? ["Log your meals on at least 5 days next week."] : ["Keep following your current plan."];

  return {
    stats, previous, targets: c.targets, changes,
    improved: changes.filter((x) => x.sentiment === "better"), declined: changes.filter((x) => x.sentiment === "worse"),
    priority, nextFocus, notes,
    estimates: stats.estimatedBalanceKcal === null ? [] : [
      `Estimated energy balance: about ${Math.abs(stats.estimatedBalanceKcal).toLocaleString("en-US")} kcal/day ${stats.estimatedBalanceKcal < 0 ? "deficit" : "surplus"} (average logged intake − estimated daily burn; an estimate).`],
  };
}

// ---------------- Period helpers ----------------
/** Monday-based calendar week containing `date`. */
export function weekRange(date: string): { start: string; end: string } {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
  const start = shiftDate(date, -dow);
  return { start, end: shiftDate(start, 6) };
}
export function monthRange(date: string): { start: string; end: string } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}
export function previousRange(kind: "week" | "month", start: string): { start: string; end: string } {
  return kind === "week" ? { start: shiftDate(start, -7), end: shiftDate(start, -1) } : monthRange(shiftDate(start, -1));
}
/** Rolling window of `n` days ending at `end` (inclusive). */
export const rollingRange = (end: string, n: number) => ({ start: shiftDate(end, -(n - 1)), end });
