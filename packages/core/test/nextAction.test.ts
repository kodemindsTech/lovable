import { describe, expect, it } from "vitest";
import { isDietCompatible, nextActions, suggestFoods, type FoodCandidate, type NextActionInput } from "../src";

const food = (name: string, category: string, calories: number, proteinG: number, fibreG = 0): FoodCandidate =>
  ({ id: name, name, category, servingLabel: "1 serving", calories, proteinG, fibreG, status: "ai_estimated" });
const FOODS = [
  food("Greek yogurt", "Dairy & Eggs", 90, 15), food("Boiled egg", "Dairy & Eggs", 78, 6.3), food("Egg white", "Dairy & Eggs", 17, 3.6),
  food("Chicken breast (cooked)", "Meat & Fish", 165, 31), food("Paneer", "Dairy & Eggs", 265, 18), food("Tofu", "Dairy & Eggs", 76, 8),
  food("Moong dal (cooked)", "Dal & Legumes", 130, 9, 4), food("Sprouted moong", "Dal & Legumes", 100, 7, 4), food("Roasted chana", "Snacks", 110, 6, 5),
];
const base: NextActionInput = {
  goal: "lose_fat", targets: { calories: 2100, proteinG: 150, carbsG: 220, fatG: 60, fibreG: 30, steps: 9000 },
  totals: { calories: 1760, proteinG: 137, carbsG: 180, fatG: 55, fibreG: 25 }, mealsLogged: 4,
  stepsToday: 11420, activeMinutes: 35, workoutsLast7: 3, trainingDays: 3, weightTrendKgPerWeek: -0.4,
  hour: 19, dayComplete: false, diet: "non_vegetarian", foods: FOODS,
};

const ON_TRACK = { totals: { calories: 2050, proteinG: 150, carbsG: 210, fatG: 58, fibreG: 31 }, hour: 20 };

describe("nextActions — PRD example", () => {
  const a = nextActions(base);
  it("prioritises protein with the real gap and says activity is done", () => {
    expect(a[0]!.id).toBe("protein");
    expect(a[0]!.title).toMatch(/13 g/);
    expect(a.length).toBeLessThanOrEqual(3);
  });
  it("suggests real catalog foods that fit the calories and don't wildly overshoot", () => {
    const s = a[0]!.suggestions; expect(s.length).toBeGreaterThan(0);
    for (const x of s) { expect(FOODS.some((f) => f.id === x.foodId)).toBe(true); expect(x.calories).toBeLessThanOrEqual(340); expect(x.proteinG).toBeLessThanOrEqual(13 * 1.35 + 0.1); }
  });
  it("does not nag about activity when the step target is met", () => {
    expect(a.some((x) => x.id === "walk" || x.id === "add_activity")).toBe(false);
  });
});

describe("nextActions — other situations", () => {
  it("nothing logged → ask to log, never invent advice", () => {
    const a = nextActions({ ...base, mealsLogged: 0, totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 }, hour: 9 });
    expect(a[0]!.id).toBe("log_meal");
    expect(a.some((x) => x.id === "protein")).toBe(false);
  });
  it("no activity data → asks to add it rather than assuming zero", () => {
    const a = nextActions({ ...base, ...ON_TRACK, stepsToday: null, activeMinutes: null });
    expect(a.some((x) => x.id === "add_activity")).toBe(true);
  });
  it("over calories never recommends skipping meals or compensating with exercise", () => {
    const a = nextActions({ ...base, totals: { ...base.totals, calories: 2600 } });
    const over = a.find((x) => x.id === "calories_over")!;
    expect(over).toBeDefined();
    expect(over.detail).toMatch(/no need to skip meals/i);
    expect(JSON.stringify(a)).not.toMatch(/burn off|skip dinner|fast/i);
  });
  it("very low intake in the evening raises a safety nudge (no diagnosis)", () => {
    const a = nextActions({ ...base, hour: 21, totals: { calories: 700, proteinG: 40, carbsG: 60, fatG: 20, fibreG: 8 } });
    const s = a.find((x) => x.id === "under_eating");
    expect(s).toBeDefined(); expect(s!.detail).toMatch(/doctor or registered dietitian/);
    expect(s!.detail).not.toMatch(/disorder|diagnos/i);
  });
  it("behind on steps mid-day gives a concrete walking target", () => {
    const a = nextActions({ ...base, stepsToday: 2000, activeMinutes: null, hour: 17 });
    const w = a.find((x) => x.id === "walk")!; expect(w.title).toMatch(/7,000/);
  });
  it("overtraining suggests rest", () => {
    expect(nextActions({ ...base, ...ON_TRACK, workoutsLast7: 6 }).some((x) => x.id === "rest")).toBe(true);
  });
  it("everything on track yields a positive 'on track' action", () => {
    const a = nextActions({ ...base, totals: { calories: 2050, proteinG: 150, carbsG: 210, fatG: 58, fibreG: 31 }, hour: 20 });
    expect(a[0]!.id).toBe("on_track");
  });
  it("is deterministic and capped at 3", () => {
    expect(nextActions(base)).toEqual(nextActions(base));
    expect(nextActions({ ...base, stepsToday: null, activeMinutes: null, workoutsLast7: 0, totals: { ...base.totals, proteinG: 50, fibreG: 5 } }).length).toBeLessThanOrEqual(3);
  });
  it("no suggestions when no calories remain", () => {
    const a = nextActions({ ...base, totals: { ...base.totals, calories: 2100 } });
    expect(a.find((x) => x.id === "protein")?.suggestions ?? []).toEqual([]);
  });
});

describe("diet filtering & suggestions", () => {
  it("respects diets", () => {
    const chicken = FOODS[3]!, egg = FOODS[1]!, paneer = FOODS[4]!, tofu = FOODS[5]!, dal = FOODS[6]!;
    expect(isDietCompatible("vegetarian", chicken)).toBe(false);
    expect(isDietCompatible("vegetarian", egg)).toBe(false);
    expect(isDietCompatible("eggetarian", egg)).toBe(true);
    expect(isDietCompatible("eggetarian", chicken)).toBe(false);
    expect(isDietCompatible("vegan", paneer)).toBe(false);
    expect(isDietCompatible("vegan", tofu)).toBe(true);
    expect(isDietCompatible("vegan", dal)).toBe(true);
    expect(isDietCompatible("non_vegetarian", chicken)).toBe(true);
    expect(isDietCompatible(null, chicken)).toBe(true);
  });
  it("vegetarian users are never offered meat or eggs", () => {
    const a = nextActions({ ...base, diet: "vegetarian" });
    for (const s of a.flatMap((x) => x.suggestions)) expect(/chicken|egg/i.test(s.name)).toBe(false);
  });
  it("suggestFoods respects calorie cap and nutrient need", () => {
    const s = suggestFoods(FOODS, { nutrient: "proteinG", amount: 13, maxKcal: 100 });
    for (const x of s) expect(x.calories).toBeLessThanOrEqual(100);
    expect(suggestFoods(FOODS, { nutrient: "proteinG", amount: 13, maxKcal: 5 })).toEqual([]);
  });
});
