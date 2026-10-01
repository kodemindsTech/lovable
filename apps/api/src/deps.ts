import type { ChatTurn, CoachResult, ContextInput, LLMClient, NarrativeResult } from "@fitness-os/ai";
import type { Report } from "@fitness-os/core";

/** Everything the route needs from the outside world, so it can be tested without Supabase or an LLM. */
export interface UserScope {
  userId: string;
  hasConsent(): Promise<boolean>;
  consumeQuota(kind: "coach" | "report"): Promise<"ok" | "quota_exceeded">;
  loadContextInput(localDate: string, localHour: number): Promise<ContextInput>;
  openConversation(id: string | undefined): Promise<{ id: string; history: ChatTurn[] } | null>;
  loadReport(kind: "week" | "month", start: string, today: string): Promise<Report>;
  saveNarrative(weekStart: string, report: Report, result: NarrativeResult): Promise<void>;
  saveTurn(conversationId: string, userMessage: string, result: CoachResult): Promise<void>;
}
export interface Deps {
  /** Verifies the bearer token; returns a scope that acts AS the user (RLS enforced), or null. */
  authenticate(token: string): Promise<UserScope | null>;
  llm: LLMClient | null;
  /** Log sink; receives metadata only — never message content or health data. */
  log?: (event: string, meta: Record<string, string | number | boolean | undefined>) => void;
}
