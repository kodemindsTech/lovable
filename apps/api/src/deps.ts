import type { ChatTurn, CoachResult, ContextInput, LLMClient, NarrativeResult } from "@fitness-os/ai";
import type { Report } from "@fitness-os/core";
import type { BillingDeps } from "./billing";

/** Everything the route needs from the outside world, so it can be tested without Supabase or an LLM. */
export interface UserScope {
  userId: string;
  hasConsent(): Promise<boolean>;
  /** Is the feature part of the caller's current plan? (Server-side entitlement check.) */
  hasFeature(feature: string): Promise<boolean>;
  consumeQuota(kind: "coach" | "report"): Promise<"ok" | "quota_exceeded" | "not_in_plan">;
  getPrice(planId: string, interval: string): Promise<{ amountMinor: number; currency: string; providerPriceId: string | null } | null>;
  getSubscription(): Promise<{ planId: string; interval: string; status: string; providerSubscriptionId: string | null } | null>;
  /** Plan the caller currently has access to ("free" if none). */
  currentPlan(): Promise<string>;
  trialEligible(): Promise<boolean>;
  email(): string | undefined;
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
  /** Absent → billing endpoints answer 503 billing_not_configured. */
  billing?: BillingDeps;
  /** Log sink; receives metadata only — never message content or health data. */
  log?: (event: string, meta: Record<string, string | number | boolean | undefined>) => void;
}
