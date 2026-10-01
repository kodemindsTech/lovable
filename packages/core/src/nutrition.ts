export interface Macros { calories: number; proteinG: number; carbsG: number; fatG: number; fibreG: number }

export interface FoodServing {
  servingSize: number;
  servingUnit: string;
  servingGrams?: number | null;
}

const COUNT_UNITS = new Set(["", "serving", "servings", "piece", "pieces", "pc", "pcs", "nos"]);
const UNIT_ALIASES: Record<string, string> = {
  grams: "g", gram: "g", gm: "g", gms: "g", g: "g", kg: "kg",
  millilitre: "ml", milliliter: "ml", ml: "ml", l: "l", litre: "l", liter: "l",
  katori: "katori", katoris: "katori", bowl: "bowl", bowls: "bowl", cup: "cup", cups: "cup",
  plate: "plate", plates: "plate", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", glass: "glass", glasses: "glass",
  scoop: "scoop", scoops: "scoop", slice: "slice", slices: "slice",
  roti: "piece", rotis: "piece", piece: "piece", pieces: "piece", pc: "piece", pcs: "piece",
  serving: "serving", servings: "serving",
};
export const normaliseUnit = (u: string): string => UNIT_ALIASES[u.toLowerCase()] ?? u.toLowerCase();

/**
 * How many servings of `food` is `qty` of `unit`? Returns null when the unit
 * can't be converted without guessing — callers must then ask the user.
 */
export function toServings(food: FoodServing, qty: number, unit: string): number | null {
  if (!(qty > 0)) return null;
  const u = normaliseUnit(unit);
  const fu = normaliseUnit(food.servingUnit);
  if (u === "kg") return toServings(food, qty * 1000, "g");
  if (u === "l") return toServings(food, qty * 1000, "ml");
  if (u === fu) return qty / food.servingSize;
  if (COUNT_UNITS.has(u)) {
    // bare counts only make sense for count-like serving units ("2 eggs", "1 serving")
    return COUNT_UNITS.has(fu) || fu === "piece" ? qty / food.servingSize : u === "serving" || u === "servings" ? qty : null;
  }
  if (u === "g" && food.servingGrams) return qty / food.servingGrams;
  return null;
}

export function scale(m: Macros, servings: number): Macros {
  return {
    calories: m.calories * servings, proteinG: m.proteinG * servings, carbsG: m.carbsG * servings,
    fatG: m.fatG * servings, fibreG: m.fibreG * servings,
  };
}

export const ZERO: Macros = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 };
export const sumMacros = (xs: Macros[]): Macros =>
  xs.reduce((a, b) => ({
    calories: a.calories + b.calories, proteinG: a.proteinG + b.proteinG, carbsG: a.carbsG + b.carbsG,
    fatG: a.fatG + b.fatG, fibreG: a.fibreG + b.fibreG,
  }), ZERO);

export interface Progress { current: number; target: number; remaining: number; pct: number }
export function progress(current: number, target: number): Progress {
  const pct = target > 0 ? Math.round((current / target) * 100) : 0;
  return { current, target, remaining: Math.max(0, target - current), pct };
}
