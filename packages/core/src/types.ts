export type Sex = "male" | "female";
export type Goal =
  | "lose_weight" | "lose_fat" | "maintain" | "build_muscle"
  | "gain_weight" | "improve_fitness" | "improve_running";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very_active" | "extremely_active";

export interface TargetInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg?: number;
  goal: Goal;
  activityLevel: ActivityLevel;
}

export interface Targets {
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fibreG: number;
  steps: number;
  /** Daily energy balance vs TDEE (negative = deficit). */
  dailyBalanceKcal: number;
  /** Human-readable notes, e.g. when a safety floor was applied. */
  warnings: string[];
  formulaVersion: string;
}
