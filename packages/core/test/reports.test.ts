import { describe, expect, it } from "vitest";
import { buildReport, compareDays, compareMeaningful, monthRange, previousRange, rollingRange, summarisePeriod, weekRange, shiftDate, type DaySummary, type ReportConfig } from "../src";

const targets = { calories: 2100, proteinG: 150, carbsG: 220, fatG: 60, fibreG: 30, steps: 9000 };
const day = (date: string, o: Partial<DaySummary> = {}): DaySummary => ({ date, mealsLogged: 3, calories: 2000, proteinG: 140, fibreG: 28, steps: 9500, workouts: 0, runKm: 0, weightKg: null, ...o });
const range = (start: string, n: number, f: (i: number, d: string) => Partial<DaySummary>) =>
  Array.from({ length: n }, (_, i) => day(shiftDate(start, i), f(i, shiftDate(start, i))));
const cfg = (start: string, end: string, extra: Partial<ReportConfig> = {}): ReportConfig => ({ start, end, targets, goal: "lose_fat", tdee: 2500, trainingDays: 3, ...extra });

describe("summarisePeriod", () => {
  it("averages only over days with data — gaps are not zeros", () => {
    const days = [day("2026-01-05", { calories: 2000, proteinG: 100 }), day("2026-01-06", { mealsLogged: 0, calories: 0, proteinG: 0 }), day("2026-01-07", { calories: 1800, proteinG: 140 })];
    const s = summarisePeriod(days, cfg("2026-01-05", "2026-01-07"));
    expect(s.daysLogged).toBe(2); expect(s.avgCalories).toBe(1900); expect(s.avgProteinG).toBe(120); expect(s.days).toBe(3);
  });
  it("returns nulls with no data", () => {
    const s = summarisePeriod([day("2026-01-05", { mealsLogged: 0, steps: null })], cfg("2026-01-05", "2026-01-11"));
    expect(s).toMatchObject({ daysLogged: 0, avgCalories: null, avgProteinG: null, avgSteps: null, adherencePct: null, estimatedBalanceKcal: null, weightChangeKg: null });
  });
  it("estimated balance needs ≥3 logged days and a TDEE", () => {
    const d3 = range("2026-01-05", 3, () => ({ calories: 2000 }));
    expect(summarisePeriod(d3, cfg("2026-01-05", "2026-01-11")).estimatedBalanceKcal).toBe(-500);
    expect(summarisePeriod(d3.slice(0, 2), cfg("2026-01-05", "2026-01-11")).estimatedBalanceKcal).toBeNull();
    expect(summarisePeriod(d3, cfg("2026-01-05", "2026-01-11", { tdee: null })).estimatedBalanceKcal).toBeNull();
  });
  it("weight change needs two entries; adherence counts calorie band + protein", () => {
    const d = [day("2026-01-05", { weightKg: 82 }), day("2026-01-06", { weightKg: null }), day("2026-01-07", { weightKg: 81.4, calories: 3200 })];
    const s = summarisePeriod(d, cfg("2026-01-05", "2026-01-07"));
    expect(s.weightChangeKg).toBe(-0.6); expect(s.avgWeightKg).toBe(81.7);
    expect(s.adherentDays).toBe(2); expect(s.adherencePct).toBe(67);          // the 3200 kcal day is off-plan
  });
  it("in-progress periods only count days up to asOf", () => {
    const d = range("2026-01-05", 7, () => ({}));
    const s = summarisePeriod(d, cfg("2026-01-05", "2026-01-11", { asOf: "2026-01-07" }));
    expect(s.inProgress).toBe(true); expect(s.days).toBe(3); expect(s.daysLogged).toBe(3);
  });
});

describe("compareMeaningful (What changed?)", () => {
  const prev = summarisePeriod(range("2026-01-05", 7, () => ({ proteinG: 110, steps: 7000, weightKg: 82 })), cfg("2026-01-05", "2026-01-11"));
  const cur = summarisePeriod(range("2026-01-12", 7, () => ({ proteinG: 130, steps: 9100, weightKg: 81.6 })), cfg("2026-01-12", "2026-01-18"));
  it("reports protein +18%, steps +2,100/day and weight down — the PRD examples", () => {
    const c = compareMeaningful(prev, cur, "lose_fat"); const text = c.map((x) => x.text).join(" | ");
    expect(text).toMatch(/protein increased 18%/i); expect(text).toMatch(/steps increased 2,100\/day/i); expect(text).toMatch(/weight decreased 0\.4 kg/i);
    expect(c.find((x) => x.key === "weight")!.sentiment).toBe("better");
    expect(c.find((x) => x.key === "protein")!.sentiment).toBe("better");
  });
  it("weight sentiment depends on the goal", () => {
    expect(compareMeaningful(prev, cur, "build_muscle").find((x) => x.key === "weight")!.sentiment).toBe("worse");
    expect(compareMeaningful(prev, cur, "maintain").find((x) => x.key === "weight")!.sentiment).toBe("neutral");
  });
  it("ignores small changes and missing data", () => {
    const same = summarisePeriod(range("2026-01-12", 7, () => ({ proteinG: 112, steps: 7200, weightKg: 82.1 })), cfg("2026-01-12", "2026-01-18"));
    expect(compareMeaningful(prev, same, "lose_fat")).toEqual([]);
    const empty = summarisePeriod([], cfg("2026-01-12", "2026-01-18"));
    expect(compareMeaningful(prev, empty, "lose_fat").filter((x) => x.key !== "workouts" && x.key !== "runKm")).toEqual([]);
  });
});

describe("compareDays", () => {
  it("compares yesterday with today so far, and says it is partial", () => {
    const r = compareDays(day("a", { proteinG: 100 }), day("b", { proteinG: 130 }), true);
    expect(r[0]).toMatch(/Protein so far today is 30% higher than yesterday \(100 → 130 g\)/);
  });
  it("returns nothing without both days' data", () => {
    expect(compareDays(undefined, day("b"), true)).toEqual([]);
    expect(compareDays(day("a", { mealsLogged: 0 }), day("b"), false)).toEqual([]);
  });
});

describe("buildReport", () => {
  const all = [
    ...range("2026-01-05", 7, () => ({ proteinG: 120, calories: 2000, workouts: 0, weightKg: 82 })),
    ...range("2026-01-12", 7, (i) => ({ proteinG: 100, calories: 2000, steps: 9200, workouts: i % 3 === 0 ? 1 : 0, runKm: i === 2 ? 5 : 0, weightKg: 81.5 })),
  ];
  const r = buildReport(all, cfg("2026-01-12", "2026-01-18"), { start: "2026-01-05", end: "2026-01-11" });
  it("picks the biggest real gap as the priority, with the real numbers", () => {
    expect(r.priority.key).toBe("protein"); expect(r.priority.text).toMatch(/averaged 100 g\/day against a 150 g target/);
    expect(r.nextFocus[0]).toMatch(/about 50 g of protein/);
  });
  it("separates improved and declined and labels estimates", () => {
    expect(r.declined.some((x) => x.key === "protein")).toBe(true);
    expect(r.improved.some((x) => x.key === "steps" || x.key === "workouts" || x.key === "weight")).toBe(true);
    expect(r.estimates[0]).toMatch(/estimate/i); expect(r.estimates[0]).toMatch(/500 kcal\/day deficit/);
  });
  it("is honest about thin data", () => {
    const thin = buildReport([day("2026-01-12"), day("2026-01-13")], cfg("2026-01-12", "2026-01-18", { asOf: "2026-01-13" }), { start: "2026-01-05", end: "2026-01-11" });
    expect(thin.priority.key).toBe("log_more"); expect(thin.notes.join(" ")).toMatch(/isn't finished|Only 2 of 2/); expect(thin.estimates).toEqual([]);
  });
  it("never recommends eating below target for a loss goal", () => {
    const lowEat = buildReport(range("2026-01-12", 7, () => ({ calories: 1200, proteinG: 150 })), cfg("2026-01-12", "2026-01-18"), { start: "2026-01-05", end: "2026-01-11" });
    expect(JSON.stringify(lowEat.nextFocus)).not.toMatch(/less|cut|reduce/i);
  });
});

describe("period helpers", () => {
  it("week is Monday–Sunday", () => { expect(weekRange("2026-01-15")).toEqual({ start: "2026-01-12", end: "2026-01-18" }); expect(weekRange("2026-01-18").start).toBe("2026-01-12"); expect(weekRange("2026-01-12").start).toBe("2026-01-12"); });
  it("month ranges incl. leap February", () => { expect(monthRange("2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" }); expect(monthRange("2028-02-10").end).toBe("2028-02-29"); });
  it("previous ranges", () => {
    expect(previousRange("week", "2026-01-12")).toEqual({ start: "2026-01-05", end: "2026-01-11" });
    expect(previousRange("month", "2026-03-01")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(rollingRange("2026-01-15", 7)).toEqual({ start: "2026-01-09", end: "2026-01-15" });
  });
});
