import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, parseWeights, scoreDay, type DayInput } from "../src";

const base: DayInput = {
  goal: "lose_fat",
  targets: { calories: 2100, proteinG: 150, carbsG: 220, fatG: 60, fibreG: 30, steps: 9000 },
  totals: { calories: 1760, proteinG: 137, carbsG: 180, fatG: 55, fibreG: 25 },
  mealsLogged: 4, stepsToday: 11420, activeMinutes: 35, workoutsLast7: 3, trainingDays: 3,
  weightTrendKgPerWeek: -0.4, hour: 20, dayComplete: true,
};

describe("scoreDay", () => {
  it("PRD example day is on track with an explanation", () => {
    const s = scoreDay(base);
    expect(s.status).toBe("on_track");
    expect(s.score).toBeGreaterThanOrEqual(80);
    expect(s.explanation.length).toBeGreaterThan(10);
    expect(s.components.every((c) => c.note.length > 0)).toBe(true);
  });
  it("no meals → no score (never fabricated)", () => {
    const s = scoreDay({ ...base, mealsLogged: 0 });
    expect(s.score).toBeNull(); expect(s.status).toBe("no_data"); expect(s.explanation).toMatch(/log a meal/i);
  });
  it("missing steps are excluded, not counted as zero", () => {
    const s = scoreDay({ ...base, stepsToday: null, activeMinutes: null });
    expect(s.excluded.join()).toMatch(/Activity/);
    expect(s.score).toBeGreaterThanOrEqual(80);
    expect(s.explanation).toMatch(/Not counted: activity/i);
  });
  it("overeating on a loss goal lowers the score and says so", () => {
    const s = scoreDay({ ...base, totals: { ...base.totals, calories: 2900 } });
    expect(s.score!).toBeLessThan(scoreDay(base).score!);
    expect(s.explanation).toMatch(/800 kcal over/);
  });
  it("very low protein at day end is flagged", () => {
    const s = scoreDay({ ...base, totals: { ...base.totals, proteinG: 40 } });
    expect(s.explanation).toMatch(/Protein is 110 g below target/);
  });
  it("in-progress day is judged on pace: light breakfast at 9am is fine", () => {
    const morning = scoreDay({ ...base, hour: 9, dayComplete: false, mealsLogged: 1,
      totals: { calories: 400, proteinG: 30, carbsG: 40, fatG: 10, fibreG: 5 }, stepsToday: null, activeMinutes: null });
    expect(morning.inProgress).toBe(true);
    expect(morning.score!).toBeGreaterThanOrEqual(70);
    expect(morning.explanation).toMatch(/isn't over/);
  });
  it("same breakfast judged at day end scores lower", () => {
    const t = { calories: 400, proteinG: 30, carbsG: 40, fatG: 10, fibreG: 5 };
    const a = scoreDay({ ...base, hour: 9, dayComplete: false, totals: t });
    const b = scoreDay({ ...base, hour: 23, dayComplete: true, totals: t });
    expect(b.score!).toBeLessThan(a.score!);
  });
  it("muscle gain penalises under-eating that loss goals tolerate", () => {
    const t = { ...base.totals, calories: 1700 };
    const loss = scoreDay({ ...base, totals: t }).components.find((c) => c.key === "calories")!.value!;
    const gain = scoreDay({ ...base, goal: "build_muscle", totals: t }).components.find((c) => c.key === "calories")!.value!;
    expect(gain).toBeLessThan(loss);
  });
  it("score stays within 0–100 for extreme inputs", () => {
    const s = scoreDay({ ...base, totals: { calories: 99999, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 }, stepsToday: 0, workoutsLast7: 0 });
    expect(s.score!).toBeGreaterThanOrEqual(0); expect(s.score!).toBeLessThanOrEqual(100);
  });
  it("custom weights change the result; invalid weights fall back", () => {
    expect(parseWeights({ calories: -1 })).toEqual(DEFAULT_WEIGHTS);
    expect(parseWeights("x")).toEqual(DEFAULT_WEIGHTS);
    expect(parseWeights({ calories: 0, protein: 0, fibre: 0, activity: 0, workout: 0, goal: 0 })).toEqual(DEFAULT_WEIGHTS);
    const w = parseWeights({ calories: 100, protein: 0 });
    expect(w.calories).toBe(100); expect(w.fibre).toBe(10);
  });
  it("is deterministic", () => expect(scoreDay(base)).toEqual(scoreDay(base)));
});
