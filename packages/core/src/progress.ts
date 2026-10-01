/** Dates are ISO "YYYY-MM-DD" calendar days. Only real measurements are used; nothing is interpolated. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const shiftDate = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---------- weight ----------
export interface WeightPoint { date: string; kg: number }

export interface WeightStats {
  current: number | null;
  start: number | null;
  target: number | null;
  /** current − start (negative = lost). */
  change: number | null;
  /** Mean of actual entries in the 7 days up to `asOf`; null if none. */
  avg7: number | null;
  /** Least-squares slope in kg/week over the last 30 days; null unless ≥3 entries spanning ≥7 days. */
  trendKgPerWeek: number | null;
  remainingToTarget: number | null;
}

export function weightStats(points: WeightPoint[], opts: { asOf: string; startKg?: number | null; targetKg?: number | null }): WeightStats {
  const pts = [...points].filter((p) => p.date <= opts.asOf).sort((a, b) => a.date.localeCompare(b.date));
  const latest = pts.at(-1) ?? null;
  const start = opts.startKg ?? pts[0]?.kg ?? null;
  const w7 = pts.filter((p) => daysBetween(p.date, opts.asOf) < 7);
  const w30 = pts.filter((p) => daysBetween(p.date, opts.asOf) < 30);

  let trend: number | null = null;
  if (w30.length >= 3 && daysBetween(w30[0]!.date, w30.at(-1)!.date) >= 7) {
    const xs = w30.map((p) => daysBetween(w30[0]!.date, p.date));
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = w30.reduce((s, p) => s + p.kg, 0) / w30.length;
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const sxy = xs.reduce((s, x, i) => s + (x - mx) * (w30[i]!.kg - my), 0);
    trend = sxx === 0 ? null : (sxy / sxx) * 7;
  }
  const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
  const current = latest?.kg ?? null;
  return {
    current, start: start ?? null, target: opts.targetKg ?? null,
    change: current !== null && start != null ? r1(current - start) : null,
    avg7: w7.length ? r1(w7.reduce((s, p) => s + p.kg, 0) / w7.length) : null,
    trendKgPerWeek: trend === null ? null : Math.round(trend * 100) / 100,
    remainingToTarget: current !== null && opts.targetKg != null ? r1(current - opts.targetKg) : null,
  };
}

// ---------- running ----------
export interface Run { date: string; distanceKm: number; durationMin: number }

/** Minutes per km, or null when distance/duration are not positive. */
export const paceMinPerKm = (distanceKm: number, durationMin: number): number | null =>
  distanceKm > 0 && durationMin > 0 ? durationMin / distanceKm : null;

export function formatPace(minPerKm: number | null): string {
  if (minPerKm === null) return "–";
  let m = Math.floor(minPerKm), s = Math.round((minPerKm - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export interface RunStats {
  runs: number;
  totalKm: number;
  avgPaceMinPerKm: number | null;   // total time / total distance
  weekKm: number;                   // 7 days up to asOf
  monthKm: number;                  // 30 days up to asOf
  runsPerWeek: number | null;       // over the last 28 days
  longestKm: number | null;
  /** Best average pace among runs of at least `minKmForPace` km. */
  bestPaceMinPerKm: number | null;
}

export function runStats(runs: Run[], asOf: string, minKmForPace = 1): RunStats {
  const valid = runs.filter((r) => r.date <= asOf && r.distanceKm > 0 && r.durationMin > 0);
  const within = (n: number) => valid.filter((r) => daysBetween(r.date, asOf) < n);
  const sum = (rs: Run[]) => rs.reduce((s, r) => s + r.distanceKm, 0);
  const r1 = (x: number) => Math.round(x * 100) / 100;
  const km = sum(valid), mins = valid.reduce((s, r) => s + r.durationMin, 0);
  const paced = valid.filter((r) => r.distanceKm >= minKmForPace).map((r) => r.durationMin / r.distanceKm);
  return {
    runs: valid.length, totalKm: r1(km),
    avgPaceMinPerKm: km > 0 ? mins / km : null,
    weekKm: r1(sum(within(7))), monthKm: r1(sum(within(30))),
    runsPerWeek: valid.length ? Math.round((within(28).length / 4) * 10) / 10 : null,
    longestKm: valid.length ? Math.max(...valid.map((r) => r.distanceKm)) : null,
    bestPaceMinPerKm: paced.length ? Math.min(...paced) : null,
  };
}
