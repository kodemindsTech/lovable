import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { buildContext, preCheck, runCoach, type CoachResult } from "@fitness-os/ai";
import type { Deps } from "./deps";

const Body = z.object({
  message: z.string().trim().min(1).max(1000),
  conversation_id: z.string().uuid().optional(),
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  local_hour: z.number().min(0).max(24),
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

      // Only spend quota when the model will actually be called.
      const needsModel = deps.llm !== null && preCheck(message) === null;
      const quota = needsModel ? await scope.consumeQuota() : "ok";

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

  return app;
}
