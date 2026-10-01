/**
 * Strength progression — deterministic double-progression rules. AI never picks weights.
 *
 *  1. No history           → no suggestion (we never invent a starting weight).
 *  2. Every working set at the top weight reached repMax → add ONE increment, reps reset to repMin.
 *  3. The last two sessions at the same weight both had a set below repMin → deload 10% (rounded to the increment).
 *  4. Otherwise            → keep the weight, aim for +1 rep on the weakest set (capped at repMax).
 * Never more than one increment per session. Weights are rounded to 0.5 kg.
 */
export interface SetRecord { weightKg: number | null; reps: number | null }
/** Sessions newest first. */
export type SessionSets = SetRecord[];

export type Equipment = "Barbell" | "Dumbbell" | "Machine" | "Cable" | "Kettlebell" | "Bodyweight" | string;
export const INCREMENT_KG: Record<string, number> = { Barbell: 2.5, Machine: 2.5, Cable: 2.5, Dumbbell: 2, Kettlebell: 2 };
export const incrementFor = (equipment: Equipment): number => INCREMENT_KG[equipment] ?? 1;

export interface Suggestion {
  kind: "no_history" | "increase_weight" | "add_reps" | "hold" | "deload";
  weightKg: number | null;
  targetReps: number | null;
  reason: string;
}
export interface ProgressionOptions { repMin?: number; repMax?: number; equipment?: Equipment }

const round = (x: number) => Math.round(x * 2) / 2;

/** Epley estimated 1RM — an estimate; displayed as such. */
export function estimate1RM(weightKg: number, reps: number): number {
  return reps <= 1 ? weightKg : weightKg * (1 + reps / 30);
}

interface Working { weight: number | null; reps: number[] }
function working(sets: SessionSets): Working | null {
  const valid = sets.filter((s) => s.reps && s.reps > 0);
  if (!valid.length) return null;
  const weights = valid.map((s) => s.weightKg ?? 0);
  const top = Math.max(...weights);
  return { weight: top > 0 ? top : null, reps: valid.filter((s) => (s.weightKg ?? 0) === top).map((s) => s.reps!) };
}

export function suggestNext(history: SessionSets[], opts: ProgressionOptions = {}): Suggestion {
  const repMin = opts.repMin ?? 8, repMax = opts.repMax ?? 12;
  if (repMin < 1 || repMax < repMin) throw new RangeError("invalid rep range");
  const inc = incrementFor(opts.equipment ?? "");
  const last = history.map(working).find((w): w is Working => w !== null);
  if (!last) return { kind: "no_history", weightKg: null, targetReps: null, reason: "Log this exercise once to get a suggestion." };

  const minReps = Math.min(...last.reps);
  const bodyweight = last.weight === null;

  if (minReps >= repMax) {
    return bodyweight
      ? { kind: "add_reps", weightKg: null, targetReps: minReps + 1, reason: `You hit ${repMax}+ reps on every set — aim for ${minReps + 1}.` }
      : { kind: "increase_weight", weightKg: round(last.weight! + inc), targetReps: repMin,
          reason: `You reached ${repMax} reps on every set at ${last.weight} kg. Add ${inc} kg and aim for ${repMin} reps.` };
  }

  if (!bodyweight) {
    const prev = history.map(working).filter((w): w is Working => w !== null)[1];
    if (prev && prev.weight === last.weight && minReps < repMin && Math.min(...prev.reps) < repMin) {
      const lighter = Math.max(0, round(Math.round((last.weight! * 0.9) / inc) * inc));
      return { kind: "deload", weightKg: lighter, targetReps: repMax, reason: `Fell short of ${repMin} reps twice at ${last.weight} kg. Drop to ${lighter} kg and rebuild.` };
    }
  }

  const target = Math.min(repMax, Math.max(minReps, repMin - 1) + 1);
  return {
    kind: target > minReps ? "add_reps" : "hold", weightKg: last.weight, targetReps: target,
    reason: `Stay at ${last.weight ?? "bodyweight"}${last.weight ? " kg" : ""} and aim for ${target} reps on every set.`,
  };
}

export interface PersonalBests { heaviestKg: number | null; best1RMKg: number | null; mostReps: number | null }
export function personalBests(history: SessionSets[]): PersonalBests {
  let heaviest: number | null = null, best: number | null = null, most: number | null = null;
  for (const s of history.flat()) {
    if (!s.reps) continue;
    most = Math.max(most ?? 0, s.reps);
    if (s.weightKg && s.weightKg > 0) {
      heaviest = Math.max(heaviest ?? 0, s.weightKg);
      best = Math.max(best ?? 0, estimate1RM(s.weightKg, s.reps));
    }
  }
  return { heaviestKg: heaviest, best1RMKg: best === null ? null : Math.round(best * 10) / 10, mostReps: most };
}
