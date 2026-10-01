import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { buildContext, preCheck, runCoach, runNarrative, type CoachResult } from "@fitness-os/ai";
import { isAlignedStart } from "@fitness-os/data";
import { applyEvent, type BillingEvent } from "@fitness-os/core";
import { InvalidSignature } from "./billing";
import type { Deps, UserScope } from "./deps";

const Body = z.object({
  message: z.string().trim().min(1).max(1000),
  conversation_id: z.string().uuid().optional(),
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  local_hour: z.number().min(0).max(24),
});

const ReportBody = z.object({
  kind: z.enum(["week", "month"]),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const DISCLAIMER = "AI-generated from your logged data. Not medical advice.";

/** Tiny in-memory sliding-window limiter. Per instance only; use a shared store when scaling out. */
export function makeLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now(), recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(t); hits.set(key, recent);
    return true;
  };
}

export function buildApp(deps: Deps, opts: { corsOrigins?: string[]; rateLimitPerMin?: number } = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 });
  const allow = makeLimiter(opts.rateLimitPerMin ?? 10, 60_000);
  const log = deps.log ?? (() => undefined);
  void app.register(cors, { origin: opts.corsOrigins?.length ? opts.corsOrigins : false });

  app.get("/healthz", async () => ({ ok: true, ai: deps.llm !== null }));

  app.post("/v1/coach/messages", async (req, reply) => {
    const started = Date.now();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!token) return reply.code(401).send({ code: "unauthorized", message: "Sign in to use the coach.", retryable: false });
    const scope = await deps.authenticate(token).catch(() => null);
    if (!scope) return reply.code(401).send({ code: "unauthorized", message: "Your session has expired. Please sign in again.", retryable: false });
    if (!allow(scope.userId)) return reply.code(429).send({ code: "rate_limited", message: "Too many messages. Please wait a minute.", retryable: true });

    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ code: "bad_request", message: "Invalid request.", retryable: false });
    const { message, conversation_id, local_date, local_hour } = body.data;

    try {
      if (!(await scope.hasConsent()))
        return reply.code(403).send({ code: "consent_required", message: "Please agree to AI processing of your fitness data before using the coach.", retryable: false });

      // Safety replies are never gated: anyone typing a crisis message gets the vetted response.
      const safety = preCheck(message) !== null;
      if (!safety && !(await scope.hasFeature("ai_coach")))
        return reply.code(402).send({ code: "upgrade_required", feature: "ai_coach", message: "The AI coach is part of Pro. Upgrade to use it.", retryable: false });
      // Only spend quota when the model will actually be called.
      const needsModel = deps.llm !== null && !safety;
      const quota = needsModel ? await scope.consumeQuota("coach") : "ok";
      if (quota === "not_in_plan") return reply.code(402).send({ code: "upgrade_required", feature: "ai_coach", message: "The AI coach is part of Pro. Upgrade to use it.", retryable: false });

      const [input, conv] = await Promise.all([scope.loadContextInput(local_date, local_hour), scope.openConversation(conversation_id)]);
      if (!conv) return reply.code(404).send({ code: "not_found", message: "Conversation not found.", retryable: false });
      const context = buildContext(input);

      let result: CoachResult = await runCoach({ llm: quota === "ok" ? deps.llm : null, context, history: conv.history, message });
      if (quota === "quota_exceeded") result = { ...result, fallbackReason: "quota_exceeded" };

      let saved = true;
      await scope.saveTurn(conv.id, message, result).catch(() => { saved = false; }); // never lose the answer over a save failure
      log("coach_reply", { source: result.source, fallback: result.fallbackReason, safety: result.safetyCategory, ms: Date.now() - started, saved });
      return reply.send({
        conversation_id: conv.id, reply: result.reply, source: result.source, fallback_reason: result.fallbackReason ?? null,
        score: result.score, saved, disclaimer: DISCLAIMER,
      });
    } catch (e) {
      log("coach_error", { ms: Date.now() - started });
      void e; // details intentionally not returned or logged: may contain user data
      return reply.code(500).send({ code: "internal", message: "Your data is saved. AI insights are temporarily unavailable.", retryable: true });
    }
  });

  app.post("/v1/reports/narrative", async (req, reply) => {
    const started = Date.now();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!token) return reply.code(401).send({ code: "unauthorized", message: "Sign in to continue.", retryable: false });
    const scope = await deps.authenticate(token).catch(() => null);
    if (!scope) return reply.code(401).send({ code: "unauthorized", message: "Your session has expired. Please sign in again.", retryable: false });
    if (!allow(scope.userId)) return reply.code(429).send({ code: "rate_limited", message: "Too many requests. Please wait a minute.", retryable: true });
    const body = ReportBody.safeParse(req.body);
    if (!body.success || !isAlignedStart(body.data.kind, body.data.start))
      return reply.code(400).send({ code: "bad_request", message: "Invalid request.", retryable: false });
    const { kind, start, local_date } = body.data;
    try {
      if (!(await scope.hasConsent()))
        return reply.code(403).send({ code: "consent_required", message: "Please agree to AI processing of your fitness data first.", retryable: false });
      if (!(await scope.hasFeature("weekly_reports")))
        return reply.code(402).send({ code: "upgrade_required", feature: "weekly_reports", message: "Report summaries are part of Pro. Upgrade to use them.", retryable: false });
      const quota = deps.llm !== null ? await scope.consumeQuota("report") : "ok";
      if (quota === "not_in_plan") return reply.code(402).send({ code: "upgrade_required", feature: "weekly_reports", message: "Report summaries are part of Pro. Upgrade to use them.", retryable: false });
      const report = await scope.loadReport(kind, start, local_date);
      let result = await runNarrative({ llm: quota === "ok" ? deps.llm : null, report, kind });
      if (quota === "quota_exceeded") result = { ...result, fallbackReason: "quota_exceeded" };
      let saved = true;
      if (kind === "week") await scope.saveNarrative(start, report, result).catch(() => { saved = false; });
      log("report_narrative", { kind, source: result.source, fallback: result.fallbackReason, ms: Date.now() - started, saved });
      return reply.send({ narrative: result.narrative, source: result.source, fallback_reason: result.fallbackReason ?? null, saved, disclaimer: DISCLAIMER });
    } catch (e) {
      void e;
      log("report_error", { kind, ms: Date.now() - started });
      return reply.code(500).send({ code: "internal", message: "Your data is saved. AI insights are temporarily unavailable.", retryable: true });
    }
  });

  registerBilling(app, deps, allow, log);
  return app;
}

type Allow = (key: string) => boolean;
const PLAN = z.enum(["pro", "pro_plus"]);
const INTERVAL = z.enum(["month", "year"]);
const RANK = { pro: 1, pro_plus: 2 } as const;

type Auth = { ok: true; scope: UserScope } | { ok: false; code: 401 | 429; body: object };
async function authed(deps: Deps, req: { headers: { authorization?: string } }, allow: Allow): Promise<Auth> {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (!token) return { ok: false, code: 401, body: { code: "unauthorized", message: "Sign in to continue.", retryable: false } };
  const scope = await deps.authenticate(token).catch(() => null);
  if (!scope) return { ok: false, code: 401, body: { code: "unauthorized", message: "Your session has expired. Please sign in again.", retryable: false } };
  if (!allow(scope.userId)) return { ok: false, code: 429, body: { code: "rate_limited", message: "Too many requests. Please wait a minute.", retryable: true } };
  return { ok: true, scope };
}
const notConfigured = { code: "billing_not_configured", message: "Payments aren't available yet.", retryable: false };

function registerBilling(app: FastifyInstance, deps: Deps, allow: Allow, log: NonNullable<Deps["log"]>) {
  const internal = { code: "internal", message: "Something went wrong. Please try again.", retryable: true };

  app.post("/v1/billing/checkout", async (req, reply) => {
    if (!deps.billing) return reply.code(503).send(notConfigured);
    const a = await authed(deps, req, allow); if (!a.ok) return reply.code(a.code).send(a.body);
    const body = z.object({ plan: PLAN, interval: INTERVAL }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ code: "bad_request", message: "Invalid request.", retryable: false });
    try {
      const { scope } = a, { plan, interval } = body.data;
      if ((await scope.currentPlan()) !== "free")
        return reply.code(409).send({ code: "already_subscribed", message: "You already have an active plan. Use change plan instead.", retryable: false });
      const price = await scope.getPrice(plan, interval);
      if (!price) return reply.code(404).send({ code: "price_not_found", message: "That plan isn't available.", retryable: false });
      const cfg = await deps.billing.store.config();
      const trialDays = (await scope.trialEligible()) && plan === "pro" ? cfg.trialDays : 0;
      // Redirect targets are fixed server-side (no open redirect).
      const base = deps.billing.appUrl.replace(/\/$/, "");
      const out = await deps.billing.provider.createCheckout({
        userId: scope.userId, email: scope.email(), planId: plan, interval, ...price, trialDays,
        successUrl: `${base}/subscription?checkout=success`, cancelUrl: `${base}/subscription?checkout=cancelled`,
      });
      log("checkout_created", { plan, interval, trial: trialDays > 0 });
      return reply.send({ checkout_url: out.url, trial_days: trialDays });
    } catch { log("billing_error", { op: "checkout" }); return reply.code(500).send(internal); }
  });

  app.post("/v1/billing/cancel", async (req, reply) => {
    if (!deps.billing) return reply.code(503).send(notConfigured);
    const a = await authed(deps, req, allow); if (!a.ok) return reply.code(a.code).send(a.body);
    const body = z.object({ at_period_end: z.boolean().default(true) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ code: "bad_request", message: "Invalid request.", retryable: false });
    try {
      const sub = await a.scope.getSubscription();
      if (!sub?.providerSubscriptionId || !["active", "trialing", "past_due"].includes(sub.status))
        return reply.code(404).send({ code: "no_subscription", message: "You don't have an active subscription.", retryable: false });
      await deps.billing.provider.cancelSubscription({ providerSubscriptionId: sub.providerSubscriptionId, atPeriodEnd: body.data.at_period_end });
      log("cancel_requested", { atPeriodEnd: body.data.at_period_end });
      return reply.send({ ok: true, pending_confirmation: true });
    } catch { log("billing_error", { op: "cancel" }); return reply.code(500).send(internal); }
  });

  app.post("/v1/billing/change", async (req, reply) => {
    if (!deps.billing) return reply.code(503).send(notConfigured);
    const a = await authed(deps, req, allow); if (!a.ok) return reply.code(a.code).send(a.body);
    const body = z.object({ plan: PLAN, interval: INTERVAL }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ code: "bad_request", message: "Invalid request.", retryable: false });
    try {
      const sub = await a.scope.getSubscription();
      if (!sub?.providerSubscriptionId || !["active", "trialing"].includes(sub.status))
        return reply.code(404).send({ code: "no_subscription", message: "You don't have an active subscription to change.", retryable: false });
      const { plan, interval } = body.data;
      if (sub.planId === plan && sub.interval === interval) return reply.code(409).send({ code: "no_change", message: "You're already on that plan.", retryable: false });
      const price = await a.scope.getPrice(plan, interval);
      if (!price) return reply.code(404).send({ code: "price_not_found", message: "That plan isn't available.", retryable: false });
      const up = RANK[plan] > RANK[sub.planId as "pro" | "pro_plus"] || (plan === sub.planId && interval === "year");
      await deps.billing.provider.changePlan({ providerSubscriptionId: sub.providerSubscriptionId, planId: plan, interval, providerPriceId: price.providerPriceId, immediate: up });
      log("plan_change_requested", { plan, interval, upgrade: up });
      return reply.send({ ok: true, takes_effect: up ? "now" : "next_renewal", pending_confirmation: true });
    } catch { log("billing_error", { op: "change" }); return reply.code(500).send(internal); }
  });

  // Webhooks: raw body needed for signature verification, so this lives in its own encapsulated scope.
  void app.register(async (hook) => {
    hook.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body));
    hook.post("/webhooks/billing", async (req, reply) => {
      if (!deps.billing) return reply.code(503).send(notConfigured);
      const raw = typeof req.body === "string" ? req.body : "";
      let parsed;
      try { parsed = deps.billing.provider.parseWebhook(raw, req.headers["x-billing-signature"] as string | undefined); }
      catch (e) {
        if (e instanceof InvalidSignature) { log("webhook_rejected", { reason: "bad_signature" }); return reply.code(400).send({ code: "bad_signature" }); }
        return reply.code(400).send({ code: "bad_payload" });
      }
      if (!parsed) return reply.send({ ok: true, outcome: "ignored_event" });
      try {
        const { store, provider } = deps.billing;
        const cfg = await store.config();
        const current = await store.getState(parsed.userId);
        const next = applyEvent(current, parsed.event as BillingEvent, cfg);
        const outcome = await store.apply({ provider: provider.name, providerEventId: parsed.providerEventId, type: parsed.event.type, userId: parsed.userId, occurredAt: parsed.event.at, payload: parsed.event, state: next });
        log("webhook_applied", { type: parsed.event.type, outcome });
        return reply.send({ ok: true, outcome });
      } catch { log("billing_error", { op: "webhook" }); return reply.code(500).send({ code: "internal" }); } // provider will retry
    });
  });
}
