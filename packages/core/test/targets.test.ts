import { describe, expect, it } from "vitest";
import { calcBmr, calcTargets } from "../src";

const base = {
  sex: "male" as const, age: 30, heightCm: 175, weightKg: 81,
  goal: "lose_fat" as const, activityLevel: "moderate" as const,
};

describe("targets", () => {
  it("BMR matches Mifflin-St Jeor", () => {
    expect(calcBmr(base)).toBe(10 * 81 + 6.25 * 175 - 150 + 5);
  });
  it("applies deficit and protein by goal", () => {
    const t = calcTargets(base);
    expect(t.calories).toBeLessThan(t.tdee);
    expect(t.proteinG).toBe(162);
    expect(t.fibreG).toBeGreaterThanOrEqual(25);
    expect(t.formulaVersion).toBeTruthy();
  });
  it("macros roughly sum to calories", () => {
    const t = calcTargets(base);
    const kcal = t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9;
    expect(Math.abs(kcal - t.calories)).toBeLessThan(15);
  });
  it("enforces calorie floor with a warning", () => {
    const t = calcTargets({ ...base, sex: "female", age: 60, heightCm: 150, weightKg: 45, activityLevel: "sedentary" });
    expect(t.calories).toBeGreaterThanOrEqual(1200);
    expect(t.warnings.length).toBeGreaterThan(0);
  });
  it("surplus for muscle gain", () => {
    expect(calcTargets({ ...base, goal: "build_muscle" }).dailyBalanceKcal).toBeGreaterThan(0);
  });
  it("rejects invalid input", () => {
    expect(() => calcTargets({ ...base, age: 15 })).toThrow();
  });
});
