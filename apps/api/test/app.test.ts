import { beforeEach, describe, expect, it } from "vitest";
import type { ChatTurn, CoachResult, ContextInput, LLMClient } from "@fitness-os/ai";
import { buildApp, makeLimiter } from "../src/app";
import type { Deps, UserScope } from "../src/deps";
import { summariseWeek } from "../src/loader";

const input: ContextInput = {
  date: "2026-01-15", hour: 19, waterMl: 500, currentWeightKg: 81, avg7WeightKg: 81.2, targetWeightKg: 75, week: null, diet: "non_vegetarian", foods: [],
  day: { goal: "lose_fat", targets: { calories: 2100, proteinG: 150, carbsG: 220, fatG: 60, fibreG: 30, steps: 9000 },
    totals: { calories: 1760, proteinG: 137, carbsG: 180, fatG: 55, fibreG: 25 }, mealsLogged: 4, stepsToday: 11420, activeMinutes: null,
    workoutsLast7: 3, trainingDays: 3, weightTrendKgPerWeek: null, hour: 19, dayComplete: false },
};
const goodReply = JSON.stringify({ status: "on_track", summary: "You need about 13 g more protein.", priority: "Protein", recommendations: ["Add yogurt"], confidence: 0.8, safety_flag: false });

interface State { consent: boolean; quota: "ok" | "quota_exceeded"; saved: { msg: string; r: CoachResult }[]; quotaCalls: number; conv: boolean; saveFails: boolean; loadFails: boolean }
let st: State;
const scope = (): UserScope => ({
  userId: "u1",
  hasConsent: async () => st.consent,
  consumeQuota: async () => { st.quotaCalls++; return st.quota; },
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

beforeEach(() => { st = { consent: true, quota: "ok", saved: [], quotaCalls: 0, conv: true, saveFails: false, loadFails: false }; });

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
