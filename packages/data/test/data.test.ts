import { describe, expect, it } from "vitest";
import { assembleDays, eachDate, isAlignedStart } from "../src";

describe("assembleDays", () => {
  const days = assembleDays("2026-01-05", "2026-01-08", {
    food: [{ local_date: "2026-01-05", calories: "500", protein_g: "30", fibre_g: "5" }, { local_date: "2026-01-05", calories: 300, protein_g: 20, fibre_g: 2 }, { local_date: "2026-02-01", calories: 999, protein_g: 9, fibre_g: 9 }],
    activities: [{ local_date: "2026-01-06", type: "steps", steps: 8000, distance_km: null }, { local_date: "2026-01-06", type: "run", steps: null, distance_km: "5.2" }, { local_date: "2026-01-06", type: "walk", steps: null, distance_km: "2" }],
    sessions: [{ local_date: "2026-01-07" }], weights: [{ local_date: "2026-01-08", weight_kg: "81.4" }],
  });
  it("has an entry for every date, empty days included (not zero-filled data)", () => {
    expect(days.map((d) => d.date)).toEqual(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]);
    expect(days[2]).toMatchObject({ mealsLogged: 0, steps: null, weightKg: null });
  });
  it("sums food, keeps steps null when absent, only counts runs as run km, ignores out-of-range rows", () => {
    expect(days[0]).toMatchObject({ mealsLogged: 2, calories: 800, proteinG: 50, fibreG: 7 });
    expect(days[1]).toMatchObject({ steps: 8000, runKm: 5.2 });
    expect(days[2]!.workouts).toBe(1); expect(days[3]!.weightKg).toBe(81.4);
  });
  it("eachDate is inclusive", () => expect(eachDate("2026-01-30", "2026-02-02")).toHaveLength(4));
});

describe("isAlignedStart", () => {
  it("weeks start on Monday, months on the 1st", () => {
    expect(isAlignedStart("week", "2026-01-12")).toBe(true); expect(isAlignedStart("week", "2026-01-13")).toBe(false);
    expect(isAlignedStart("month", "2026-02-01")).toBe(true); expect(isAlignedStart("month", "2026-02-02")).toBe(false);
    expect(isAlignedStart("week", "garbage")).toBe(false);
  });
});
