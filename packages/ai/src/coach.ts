import { allowedNumbers, type AiContext } from "./context";
import type { ChatTurn, LLMClient } from "./llm";
import { SYSTEM_PROMPT, PROMPT_VERSION, dataBlock } from "./prompts";
import { parseCoachReply, type CoachReply } from "./schema";
import { SAFETY_REPLIES, postCheck, preCheck, type SafetyCategory } from "./safety";

export type ReplySource = "ai" | "rules" | "safety";
export interface CoachResult {
  reply: CoachReply;
  /** 'ai' = validated model output; 'rules' = deterministic fallback; 'safety' = fixed vetted reply (model not called). */
  source: ReplySource;
  /** Present when source is 'rules' because the model failed or was rejected. */
  fallbackReason?: "ai_not_configured" | "ai_unavailable" | "invalid_output" | "failed_validation" | "quota_exceeded";
  safetyCategory?: SafetyCategory;
  promptVersion: string;
  /** The engine's score — always authoritative. */
  score: number | null;
  rejected?: string[];
}

const STATUS = (s: string): CoachReply["status"] => (s === "on_track" || s === "slightly_off" || s === "off_track" ? s : "unknown");

/** Deterministic answer from the engines' own output. Used whenever the model is absent, fails or is rejected. */
export function rulesReply(ctx: AiContext): CoachReply {
  const a = ctx.suggested_actions;
  const lead = a[0];
  const foods = lead?.foods.length ? ` Options: ${lead.foods.slice(0, 2).join("; ")}.` : "";
  return {
    status: STATUS(ctx.score.status),
    summary: `${ctx.score.explanation}${ctx.data_gaps.length ? ` Missing data: ${ctx.data_gaps.join(", ")}.` : ""}`.trim(),
    priority: lead?.title ?? "Log today's data to get personalised guidance",
    recommendations: a.slice(0, 3).map((x, i) => (i === 0 ? `${x.detail}${foods}` : x.detail)).map((s) => s.slice(0, 300)),
    confidence: 1, safety_flag: false,
  };
}

export interface CoachParams {
  llm: LLMClient | null;
  context: AiContext;
  history: ChatTurn[];
  message: string;
  signal?: AbortSignal;
}

/**
 * pre-safety → model → parse/validate (one repair retry) → post-safety/grounding → result.
 * Never throws for model problems; the user always gets an answer built from their real data.
 */
export async function runCoach(p: CoachParams): Promise<CoachResult> {
  const base = { promptVersion: PROMPT_VERSION, score: p.context.score.value };
  const cat = preCheck(p.message);
  if (cat) return { ...base, reply: SAFETY_REPLIES[cat], source: "safety", safetyCategory: cat };

  const fallback = (reason: NonNullable<CoachResult["fallbackReason"]>, rejected?: string[]): CoachResult =>
    ({ ...base, reply: rulesReply(p.context), source: "rules", fallbackReason: reason, rejected });
  if (!p.llm) return fallback("ai_not_configured");

  const allowed = allowedNumbers(p.context);
  const turns: ChatTurn[] = [...p.history.slice(-6), { role: "user", content: `${dataBlock(p.context)}\n\nUSER QUESTION:\n${p.message}` }];
  let lastErrors: string[] = [];
  let lastText = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      const msgs = attempt === 0 ? turns : [...turns, { role: "assistant" as const, content: lastText.slice(0, 2000) || "(no output)" }, { role: "user" as const, content: `Your reply was rejected: ${lastErrors.join("; ")}. Reply again with ONE valid JSON object, using only numbers from DATA.` }];
      text = await p.llm.complete({ system: SYSTEM_PROMPT, messages: msgs }, p.signal);
    } catch { return fallback("ai_unavailable"); }
    lastText = text;
    const parsed = parseCoachReply(text);
    if (!parsed.ok) { lastErrors = [parsed.error]; continue; }
    const check = postCheck(parsed.value, allowed, p.message);
    if (!check.ok) { lastErrors = check.reasons; continue; }
    return { ...base, reply: parsed.value, source: "ai" };
  }
  return fallback(lastErrors.some((e) => /^(banned|ungrounded|unsafe)/.test(e)) ? "failed_validation" : "invalid_output", lastErrors);
}
