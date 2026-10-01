import type { ActivityLevel, Goal, TargetInput, Targets } from "./types";

/**
 * Target engine — deterministic, no AI. Bump FORMULA_VERSION on any change
 * so stored target_history rows stay interpretable.
 *
 * BMR:   Mifflin-St Jeor  10*kg + 6.25*cm - 5*age + (male ? 5 : -161)
 * TDEE:  BMR * activity multiplier
 * kcal:  TDEE + goal adjustment, clamped to a safety floor
 * Protein: g/kg bodyweight by goal.  Fat: 25% kcal, min 0.6 g/kg.
 * Carbs: remaining kcal.  Fibre: 14 g per 1000 kcal, min 25 g.
 */
export const FORMULA_VERSION = "1.0.0";

export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very_active: 1.725,
  extremely_active: 1.9,
};

export const STEP_TARGET: Record<ActivityLevel, number> = {
  sedentary: 6000,
  light: 7500,
  moderate: 9000,
  very_active: 10000,
  extremely_active: 11000,
};

/** Daily kcal adjustment relative to TDEE, as a fraction of TDEE. */
const GOAL_ADJUSTMENT: Record<Goal, number> = {
  lose_weight: -0.2,
  lose_fat: -0.2,
  maintain: 0,
  build_muscle: 0.1,
  gain_weight: 0.15,
  improve_fitness: 0,
  improve_running: 0,
};

const PROTEIN_G_PER_KG: Record<Goal, number> = {
  lose_weight: 1.8,
  lose_fat: 2.0,
  maintain: 1.4,
  build_muscle: 2.0,
  gain_weight: 1.6,
  improve_fitness: 1.5,
  improve_running: 1.5,
};

export const CALORIE_FLOOR = { male: 1500, female: 1200 } as const;
/** Max planned weight loss: 1% of bodyweight per week (~7700 kcal/kg). */
export const MAX_LOSS_FRACTION_PER_WEEK = 0.01;
const KCAL_PER_KG = 7700;

export function calcBmr(i: Pick<TargetInput, "sex" | "age" | "heightCm" | "weightKg">): number {
  return 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + (i.sex === "male" ? 5 : -161);
}

export function validateInput(i: TargetInput): void {
  if (!(i.age >= 18 && i.age <= 100)) throw new RangeError("age must be 18–100");
  if (!(i.heightCm >= 120 && i.heightCm <= 230)) throw new RangeError("heightCm must be 120–230");
  if (!(i.weightKg >= 30 && i.weightKg <= 300)) throw new RangeError("weightKg must be 30–300");
}

export function calcTargets(i: TargetInput): Targets {
  validateInput(i);
  const warnings: string[] = [];
  const bmr = calcBmr(i);
  const tdee = bmr * ACTIVITY_MULTIPLIER[i.activityLevel];

  let balance = tdee * GOAL_ADJUSTMENT[i.goal];
  const maxDeficit = (i.weightKg * MAX_LOSS_FRACTION_PER_WEEK * KCAL_PER_KG) / 7;
  if (balance < -maxDeficit) {
    balance = -maxDeficit;
    warnings.push("Deficit limited to a safe rate of weight loss.");
  }

  let calories = tdee + balance;
  const floor = CALORIE_FLOOR[i.sex];
  if (calories < floor) {
    calories = floor;
    balance = floor - tdee;
    warnings.push(`Calories raised to the minimum recommended level (${floor} kcal).`);
  }

  const proteinG = i.weightKg * PROTEIN_G_PER_KG[i.goal];
  const fatG = Math.max((calories * 0.25) / 9, i.weightKg * 0.6);
  const carbsG = Math.max(0, (calories - proteinG * 4 - fatG * 9) / 4);
  const fibreG = Math.max(25, (calories / 1000) * 14);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories: Math.round(calories),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
    fibreG: Math.round(fibreG),
    steps: STEP_TARGET[i.activityLevel],
    dailyBalanceKcal: Math.round(balance),
    warnings,
    formulaVersion: FORMULA_VERSION,
  };
}
