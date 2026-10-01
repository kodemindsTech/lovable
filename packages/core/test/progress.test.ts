import { describe, expect, it } from "vitest";
import { daysBetween, formatPace, paceMinPerKm, runStats, shiftDate, weightStats } from "../src";

const wp = (date: string, kg: number) => ({ date, kg });

describe("weightStats", () => {
  it("returns nulls with no data — nothing invented", () => {
    expect(weightStats([], { asOf: "2026-01-30" })).toEqual({
      current: null, start: null, target: null, change: null, avg7: null, trendKgPerWeek: null, remainingToTarget: null });
  });
  it("uses actual entries only for the 7-day average", () => {
    const s = weightStats([wp("2026-01-20", 82), wp("2026-01-28", 81), wp("2026-01-30", 80)], { asOf: "2026-01-30" });
    expect(s.avg7).toBe(80.5);                       // the 20th is outside the window
    expect(s.current).toBe(80);
  });
  it("computes change from the provided start weight and distance to target", () => {
    const s = weightStats([wp("2026-01-30", 80)], { asOf: "2026-01-30", startKg: 85, targetKg: 75 });
    expect(s.change).toBe(-5); expect(s.remainingToTarget).toBe(5);
  });
  it("trend needs ≥3 points spanning ≥7 days", () => {
    expect(weightStats([wp("2026-01-29", 80), wp("2026-01-30", 79.9)], { asOf: "2026-01-30" }).trendKgPerWeek).toBeNull();
    expect(weightStats([wp("2026-01-28", 80), wp("2026-01-29", 80), wp("2026-01-30", 80)], { asOf: "2026-01-30" }).trendKgPerWeek).toBeNull();
  });
  it("trend is the regression slope per week", () => {
    const pts = [0, 7, 14, 21].map((d, i) => wp(shiftDate("2026-01-09", d), 82 - i * 0.5));
    expect(weightStats(pts, { asOf: "2026-01-30" }).trendKgPerWeek).toBe(-0.5);
  });
  it("ignores future entries", () => {
    expect(weightStats([wp("2026-02-05", 70)], { asOf: "2026-01-30" }).current).toBeNull();
  });
});

describe("running", () => {
  it("pace and formatting", () => {
    expect(paceMinPerKm(5, 30)).toBe(6);
    expect(formatPace(5.5)).toBe("5:30 /km");
    expect(formatPace(5.999)).toBe("6:00 /km");
    expect(paceMinPerKm(0, 30)).toBeNull(); expect(formatPace(null)).toBe("–");
  });
  const runs = [
    { date: "2026-01-30", distanceKm: 5, durationMin: 30 },
    { date: "2026-01-25", distanceKm: 10, durationMin: 65 },
    { date: "2026-01-05", distanceKm: 3, durationMin: 18 },
  ];
  it("aggregates weekly/monthly distance, frequency and bests", () => {
    const s = runStats(runs, "2026-01-30");
    expect(s.totalKm).toBe(18); expect(s.weekKm).toBe(15); expect(s.monthKm).toBe(18);
    expect(s.runsPerWeek).toBe(0.8);
    expect(s.longestKm).toBe(10);
    expect(s.bestPaceMinPerKm).toBe(6);
    expect(s.avgPaceMinPerKm).toBeCloseTo(113 / 18);
  });
  it("empty and invalid runs", () => {
    expect(runStats([], "2026-01-30")).toMatchObject({ runs: 0, avgPaceMinPerKm: null, longestKm: null, runsPerWeek: null });
    expect(runStats([{ date: "2026-01-30", distanceKm: 0, durationMin: 10 }], "2026-01-30").runs).toBe(0);
  });
  it("date helpers", () => { expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30); expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28"); });
});
