import { beforeEach, describe, expect, it } from "vitest";
import type { ChatTurn, CoachResult, ContextInput, LLMClient } from "@fitness-os/ai";
import { buildApp, makeLimiter } from "../src/app";
import type { Deps, UserScope } from "../src/deps";
import { summariseWeek } from "../src/loader";
import { input } from "./fixtures";
import { buildReport, shiftDate, type DaySummary } from "@fitness-os/core";

const goodReply = JSON.stringify({ status: "on_track", summary: "You need about 13 g more protein.", priority: "Protein", recommendations: ["Add yogurt"], confidence: 0.8, safety_flag: false });

interface State { entitled: boolean; plan: string; sub: { planId: string; interval: string; status: string; providerSubscriptionId: string | null } | null; prices: Set<string>; trialOk: boolean; reportSaves: unknown[]; reportFails: boolean; consent: boolean; quota: "ok" | "quota_exceeded"; saved: { msg: string; r: CoachResult }[]; quotaCalls: number; conv: boolean; saveFails: boolean; loadFails: boolean }
const dayS = (date: string, o: Partial<DaySummary> = {}): DaySummary => ({ date, mealsLogged: 3, calories: 2000, proteinG: 100, fibreG: 28, steps: 9500, workouts: 0, runKm: 0, weightKg: null, ...o });
const sampleReport = buildReport(Array.from({ length: 14 }, (_, i) => dayS(shiftDate("2026-01-05", i), i < 7 ? { proteinG: 120 } : {})),
  { start: "2026-01-12", end: "2026-01-18", targets: input.day.targets, goal: "lose_fat", tdee: 2500, trainingDays: 3 }, { start: "2026-01-05", end: "2026-01-11" });
let st: State;
const scope = (): UserScope => ({
  userId: "u1",
  hasConsent: async () => st.consent,
  hasFeature: async () => st.entitled,
  getPrice: async (plan, interval) => (st.prices.has(`${plan}:${interval}`) ? { amountMinor: 29900, currency: "INR", providerPriceId: null } : null),
  getSubscription: async () => st.sub,
  currentPlan: async () => st.plan,
  trialEligible: async () => st.trialOk,
  email: () => "u@example.com",
  consumeQuota: async () => { st.quotaCalls++; return st.quota; },
  loadReport: async () => { if (st.reportFails) throw new Error("boom with user data"); return sampleReport; },
  saveNarrative: async (_w, _r, res) => { st.reportSaves.push(res); },
  loadContextInput: async () => { if (st.loadFails) throw new Error("db down with user data"); return input; },
  openConversation: async (id) => (id && !st.conv ? null : { id: id ?? "11111111-1111-1111-1111-111111111111", history: [] as ChatTurn[] }),
  saveTurn: async (_c, msg, r) => { if (st.saveFails) throw new Error("x"); st.saved.push({ msg, r }); },
});
const mk = (llm: LLMClient | null, o: { limit?: number } = {}) => {
  const deps: Deps = { authenticate: async (t) => (t === "good" ? scope() : null), llm };
  return buildApp(deps, { rateLimitPerMin: o.limit ?? 100 });
};
const llmOk: LLMClient = { complete: async () => goodReply };
const post = (app: ReturnType<typeof mk>, body: object = {}, token: string | null = "good") =>
  app.inject({ method: "POST", url: "/v1/coach/messages", headers: token ? { authorization: `Bearer ${token}` } : {}, payload: { message: "What should I eat tonight?", local_date: "2026-01-15", local_hour: 19, ...body } });

beforeEach(() => { st = { entitled: true, plan: "free", sub: null, prices: new Set(["pro:month", "pro:year", "pro_plus:month"]), trialOk: true, reportSaves: [], reportFails: false, consent: true, quota: "ok", saved: [], quotaCalls: 0, conv: true, saveFails: false, loadFails: false }; });

describe("POST /v1/coach/messages", () => {
  it("returns an AI reply, persists both turns, and attaches the engine score + disclaimer", async () => {
    const r = await post(mk(llmOk)); const b = r.json();
    expect(r.statusCode).toBe(200); expect(b.source).toBe("ai"); expect(b.reply.priority).toBe("Protein");
    expect(typeof b.score).toBe("number"); expect(b.disclaimer).toMatch(/not medical advice/i); expect(b.saved).toBe(true);
    expect(st.saved).toHaveLength(1); expect(st.quotaCalls).toBe(1);
  });
  it("requires a valid token", async () => {
    expect((await post(mk(llmOk), {}, null)).statusCode).toBe(401);
    expect((await post(mk(llmOk), {}, "bad")).statusCode).toBe(401);
  });
  it("validates input", async () => {
    for (const bad of [{ message: "" }, { message: "x".repeat(1001) }, { local_date: "15/01/2026" }, { local_hour: 30 }, { conversation_id: "nope" }])
      expect((await post(mk(llmOk), bad)).statusCode, JSON.stringify(bad).slice(0, 30)).toBe(400);
  });
  it("blocks use without AI consent and never calls the model or spends quota", async () => {
    st.consent = false; let called = 0;
    const r = await post(mk({ complete: async () => { called++; return goodReply; } }));
    expect(r.statusCode).toBe(403); expect(r.json().code).toBe("consent_required"); expect(called).toBe(0); expect(st.quotaCalls).toBe(0);
  });
  it("serves a labelled rules answer when no LLM is configured (no quota spent)", async () => {
    const b = (await post(mk(null))).json();
    expect(b.source).toBe("rules"); expect(b.fallback_reason).toBe("ai_not_configured"); expect(st.quotaCalls).toBe(0);
  });
  it("serves a rules answer when quota is exhausted", async () => {
    st.quota = "quota_exceeded"; let called = 0;
    const b = (await post(mk({ complete: async () => { called++; return goodReply; } }))).json();
    expect(b.source).toBe("rules"); expect(b.fallback_reason).toBe("quota_exceeded"); expect(called).toBe(0);
  });
  it("high-risk messages get the vetted reply, no model call, no quota", async () => {
    let called = 0;
    const b = (await post(mk({ complete: async () => { called++; return goodReply; } }), { message: "I want to lose 20 kg in 2 weeks" })).json();
    expect(b.source).toBe("safety"); expect(b.reply.safety_flag).toBe(true); expect(called).toBe(0); expect(st.quotaCalls).toBe(0);
  });
  it("model failure degrades to rules and still answers", async () => {
    const b = (await post(mk({ complete: async () => { throw new Error("down"); } }))).json();
    expect(b.source).toBe("rules"); expect(b.fallback_reason).toBe("ai_unavailable");
  });
  it("a failed save does not lose the answer", async () => {
    st.saveFails = true; const r = await post(mk(llmOk));
    expect(r.statusCode).toBe(200); expect(r.json().saved).toBe(false); expect(r.json().reply.priority).toBe("Protein");
  });
  it("unknown conversation → 404", async () => {
    st.conv = false; expect((await post(mk(llmOk), { conversation_id: "22222222-2222-2222-2222-222222222222" })).statusCode).toBe(404);
  });
  it("internal errors return a safe message without leaking details", async () => {
    st.loadFails = true; const r = await post(mk(llmOk));
    expect(r.statusCode).toBe(500); expect(r.body).not.toMatch(/db down|user data/); expect(r.json().message).toMatch(/data is saved/i);
  });
  it("rate limits per user", async () => {
    const app = mk(llmOk, { limit: 2 });
    expect((await post(app)).statusCode).toBe(200); expect((await post(app)).statusCode).toBe(200);
    const r = await post(app); expect(r.statusCode).toBe(429); expect(r.json().retryable).toBe(true);
  });
  it("healthz reports whether AI is configured", async () => {
    expect((await mk(null).inject({ url: "/healthz" })).json()).toEqual({ ok: true, ai: false });
    expect((await mk(llmOk).inject({ url: "/healthz" })).json()).toEqual({ ok: true, ai: true });
  });
});

describe("helpers", () => {
  it("limiter window slides", () => {
    let t = 0; const allow = makeLimiter(1, 1000, () => t);
    expect(allow("a")).toBe(true); expect(allow("a")).toBe(false); t = 1001; expect(allow("a")).toBe(true); expect(allow("b")).toBe(true);
  });
  it("week summary averages only days with data", () => {
    const s = summariseWeek({ food: [
      { local_date: "d1", calories: 1000, protein_g: 50, fibre_g: 5 }, { local_date: "d1", calories: 1000, protein_g: 50, fibre_g: 5 },
      { local_date: "d2", calories: 1800, protein_g: 100, fibre_g: 20 }], steps: [8000, 10000], workouts: 2, runKm: 5.25 });
    expect(s).toMatchObject({ days_with_food_logs: 2, avg_calories: 1900, avg_protein_g: 100, avg_steps: 9000, workouts: 2, run_km: 5.3 });
    expect(summariseWeek({ food: [], steps: [], workouts: 0, runKm: 0 })).toMatchObject({ days_with_food_logs: 0, avg_calories: null, avg_steps: null });
  });
});

const narrativeOk = JSON.stringify({ summary: "You logged food on 7 of 7 days and averaged 2,000 kcal.", improved: [], declined: [], priority: sampleReport.priority.text, next_week_focus: [sampleReport.nextFocus[0]!] });
const postReport = (app: ReturnType<typeof mk>, body: object = {}, token: string | null = "good") =>
  app.inject({ method: "POST", url: "/v1/reports/narrative", headers: token ? { authorization: `Bearer ${token}` } : {}, payload: { kind: "week", start: "2026-01-12", local_date: "2026-01-15", ...body } });

describe("POST /v1/reports/narrative", () => {
  it("returns a validated AI narrative, saves it for weeks, spends report quota", async () => {
    const r = await postReport(mk({ complete: async () => narrativeOk })); const b = r.json();
    expect(r.statusCode).toBe(200); expect(b.source).toBe("ai"); expect(b.narrative.summary).toMatch(/7 of 7/); expect(b.saved).toBe(true);
    expect(st.reportSaves).toHaveLength(1); expect(st.quotaCalls).toBe(1);
  });
  it("monthly narratives are not stored in weekly_reports", async () => {
    const r = await postReport(mk({ complete: async () => narrativeOk }), { kind: "month", start: "2026-01-01" });
    expect(r.statusCode).toBe(200); expect(st.reportSaves).toHaveLength(0);
  });
  it("auth, validation (period alignment), consent", async () => {
    expect((await postReport(mk(llmOk), {}, null)).statusCode).toBe(401);
    expect((await postReport(mk(llmOk), { start: "2026-01-13" })).statusCode).toBe(400);
    expect((await postReport(mk(llmOk), { kind: "year" })).statusCode).toBe(400);
    st.consent = false; const r = await postReport(mk(llmOk)); expect(r.statusCode).toBe(403); expect(st.quotaCalls).toBe(0);
  });
  it("falls back to a rules narrative when unconfigured, over quota, or the model lies", async () => {
    expect((await postReport(mk(null))).json()).toMatchObject({ source: "rules", fallback_reason: "ai_not_configured" });
    st.quota = "quota_exceeded"; expect((await postReport(mk(llmOk))).json()).toMatchObject({ source: "rules", fallback_reason: "quota_exceeded" });
    st.quota = "ok"; const lie = JSON.stringify({ summary: "You averaged 9,999 kcal.", improved: [], declined: [], priority: "x", next_week_focus: [] });
    expect((await postReport(mk({ complete: async () => lie }))).json()).toMatchObject({ source: "rules", fallback_reason: "failed_validation" });
  });
  it("errors don't leak details", async () => {
    st.reportFails = true; const r = await postReport(mk(llmOk));
    expect(r.statusCode).toBe(500); expect(r.body).not.toMatch(/boom|user data/);
  });
});
