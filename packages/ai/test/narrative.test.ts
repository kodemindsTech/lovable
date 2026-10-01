import { describe, expect, it } from "vitest";
import { buildReport, shiftDate, type DaySummary } from "@fitness-os/core";
import { reportForModel, rulesNarrative, runNarrative, type LLMClient } from "../src";

const targets = { calories: 2100, proteinG: 150, carbsG: 220, fatG: 60, fibreG: 30, steps: 9000 };
const day = (date: string, o: Partial<DaySummary> = {}): DaySummary => ({ date, mealsLogged: 3, calories: 2000, proteinG: 100, fibreG: 28, steps: 9500, workouts: 0, runKm: 0, weightKg: null, ...o });
const all = Array.from({ length: 14 }, (_, i) => day(shiftDate("2026-01-05", i), i < 7 ? { proteinG: 120 } : { proteinG: 100, workouts: i === 8 ? 1 : 0 }));
const report = buildReport(all, { start: "2026-01-12", end: "2026-01-18", targets, goal: "lose_fat", tdee: 2500, trainingDays: 3 }, { start: "2026-01-05", end: "2026-01-11" });
const good = { summary: "You logged food on 7 of 7 days and averaged 2,000 kcal and 100 g of protein.", improved: [], declined: ["Average protein decreased 17% (120 → 100 g/day)."], priority: report.priority.text, next_week_focus: ["Add about 50 g of protein per day to reach your target."] };
const llm = (...o: (string | Error)[]): LLMClient & { n: number } => { let i = 0; const c = { n: 0, async complete() { c.n++; const x = o[Math.min(i++, o.length - 1)]!; if (x instanceof Error) throw x; return x; } }; return c; };

describe("report narrative", () => {
  it("model view has numbers but no PII fields", () => { const s = JSON.stringify(reportForModel(report, "week")); expect(s).toContain("protein_g"); expect(s).not.toMatch(/email|user/); });
  it("rules narrative is built from real report fields", () => {
    const n = rulesNarrative(report); expect(n.summary).toMatch(/7 of 7 days/); expect(n.priority).toBe(report.priority.text);
  });
  it("accepts a grounded AI narrative", async () => { const r = await runNarrative({ llm: llm(JSON.stringify(good)), report, kind: "week" }); expect(r.source).toBe("ai"); });
  it("rejects invented numbers and falls back to rules", async () => {
    const bad = JSON.stringify({ ...good, summary: "You averaged 3,400 kcal and lost 5 kg." });
    const l = llm(bad); const r = await runNarrative({ llm: l, report, kind: "week" });
    expect(r.source).toBe("rules"); expect(r.fallbackReason).toBe("failed_validation"); expect(l.n).toBe(2);
  });
  it("rejects unsafe advice", async () => {
    const r = await runNarrative({ llm: llm(JSON.stringify({ ...good, next_week_focus: ["Skip dinner twice a week."] })), report, kind: "week" });
    expect(r.source).toBe("rules");
  });
  it("falls back on garbage, errors and missing model — never throws", async () => {
    expect((await runNarrative({ llm: llm("nope"), report, kind: "week" })).fallbackReason).toBe("invalid_output");
    expect((await runNarrative({ llm: llm(new Error("x")), report, kind: "week" })).fallbackReason).toBe("ai_unavailable");
    expect((await runNarrative({ llm: null, report, kind: "week" })).fallbackReason).toBe("ai_not_configured");
  });
});
