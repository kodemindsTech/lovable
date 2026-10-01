import { describe, expect, it } from "vitest";
import { estimate1RM, incrementFor, personalBests, suggestNext } from "../src";

const sess = (w: number | null, ...reps: number[]) => reps.map((r) => ({ weightKg: w, reps: r }));

describe("suggestNext", () => {
  it("does not invent a weight without history", () => {
    const s = suggestNext([]);
    expect(s).toMatchObject({ kind: "no_history", weightKg: null, targetReps: null });
    expect(suggestNext([[{ weightKg: 50, reps: null }]]).kind).toBe("no_history");
  });
  it("PRD example: 60kg x 11 → aim for 12 at the same weight", () => {
    expect(suggestNext([sess(60, 11)], { equipment: "Barbell" })).toMatchObject({ kind: "add_reps", weightKg: 60, targetReps: 12 });
  });
  it("adds exactly one increment when every set hits the top of the range", () => {
    expect(suggestNext([sess(60, 12, 12, 12)], { equipment: "Barbell" })).toMatchObject({ kind: "increase_weight", weightKg: 62.5, targetReps: 8 });
    expect(suggestNext([sess(20, 12, 13)], { equipment: "Dumbbell" }).weightKg).toBe(22);
    expect(suggestNext([sess(20, 12, 12)], { equipment: "Machine" }).weightKg).toBe(22.5);
  });
  it("one weak set blocks a weight increase", () => {
    expect(suggestNext([sess(60, 12, 12, 9)]).kind).toBe("add_reps");
  });
  it("ignores lighter warm-up sets", () => {
    const h = [[...sess(40, 12), ...sess(60, 10, 10)]];
    expect(suggestNext(h)).toMatchObject({ weightKg: 60, targetReps: 11 });
  });
  it("deloads 10% after two failed sessions at the same weight", () => {
    const s = suggestNext([sess(100, 6, 6), sess(100, 7, 6)], { equipment: "Barbell" });
    expect(s).toMatchObject({ kind: "deload", weightKg: 90 });
  });
  it("a single bad session is not a deload", () => {
    expect(suggestNext([sess(100, 6, 6), sess(100, 10, 10)]).kind).not.toBe("deload");
  });
  it("bodyweight exercises progress by reps only", () => {
    const s = suggestNext([sess(null, 12, 12)]);
    expect(s).toMatchObject({ kind: "add_reps", weightKg: null, targetReps: 13 });
  });
  it("never suggests more than one increment above the last weight", () => {
    for (const w of [5, 20, 60, 140]) {
      const s = suggestNext([sess(w, 12, 12)], { equipment: "Barbell" });
      expect(s.weightKg! - w).toBeLessThanOrEqual(incrementFor("Barbell"));
    }
  });
  it("rejects an invalid rep range", () => expect(() => suggestNext([], { repMin: 10, repMax: 5 })).toThrow());
});

describe("personal bests", () => {
  it("computes heaviest, estimated 1RM and most reps", () => {
    const pb = personalBests([sess(60, 10), sess(70, 5)]);
    expect(pb.heaviestKg).toBe(70);
    expect(pb.best1RMKg).toBe(Math.round(Math.max(estimate1RM(60, 10), estimate1RM(70, 5)) * 10) / 10);
    expect(pb.mostReps).toBe(10);
  });
  it("is null with no data", () => expect(personalBests([])).toEqual({ heaviestKg: null, best1RMKg: null, mostReps: null }));
});
