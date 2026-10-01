/**
 * Subscription lifecycle — a pure state machine. The payment provider is the source of truth for
 * money; this module turns normalised provider events into subscription state and decides access.
 * Card data is never handled here or anywhere in the app.
 *
 * Keep `effectivePlan` in sync with the SQL function `effective_plan()` (migration 0009);
 * both are covered by the same scenario table in their tests.
 */
export type PlanId = "free" | "pro" | "pro_plus";
export type Interval = "month" | "year";
export type SubStatus = "trialing" | "active" | "past_due" | "canceled" | "expired";

export interface SubscriptionState {
  planId: Exclude<PlanId, "free">;
  interval: Interval;
  status: SubStatus;
  currentPeriodEnd: string | null;   // ISO timestamp
  trialEnd: string | null;
  /** Cancelled but paid access continues until currentPeriodEnd. */
  cancelAtPeriodEnd: boolean;
  /** Set on payment failure: access continues until then. */
  graceUntil: string | null;
  /** Downgrade scheduled for the next renewal. */
  pendingPlanId: Exclude<PlanId, "free"> | null;
  pendingInterval: Interval | null;
  lastEventAt: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
}

export type BillingEvent =
  | { type: "subscription_started"; at: string; planId: Exclude<PlanId, "free">; interval: Interval; periodEnd: string; trialEnd?: string | null; providerCustomerId?: string; providerSubscriptionId?: string }
  | { type: "payment_succeeded"; at: string; periodEnd: string }
  | { type: "payment_failed"; at: string }
  | { type: "cancel_requested"; at: string; atPeriodEnd: boolean }
  | { type: "cancel_undone"; at: string }
  | { type: "subscription_expired"; at: string }
  | { type: "plan_changed"; at: string; planId: Exclude<PlanId, "free">; interval: Interval; immediate: boolean };

export interface BillingConfig {
  /** Days of continued access after a failed payment. */
  graceDays: number;
  /** Hours of slack after currentPeriodEnd before access lapses (covers webhook delay). */
  periodSkewHours: number;
}
export const DEFAULT_BILLING: BillingConfig = { graceDays: 7, periodSkewHours: 12 };

const RANK: Record<PlanId, number> = { free: 0, pro: 1, pro_plus: 2 };
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();
const addHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

export function initialState(e: Extract<BillingEvent, { type: "subscription_started" }>): SubscriptionState {
  const trialing = !!e.trialEnd && Date.parse(e.trialEnd) > Date.parse(e.at);
  return {
    planId: e.planId, interval: e.interval, status: trialing ? "trialing" : "active", currentPeriodEnd: e.periodEnd,
    trialEnd: e.trialEnd ?? null, cancelAtPeriodEnd: false, graceUntil: null, pendingPlanId: null, pendingInterval: null,
    lastEventAt: e.at, providerCustomerId: e.providerCustomerId ?? null, providerSubscriptionId: e.providerSubscriptionId ?? null,
  };
}

/** Returns the new state. Stale (out-of-order) events and impossible transitions return the state unchanged. */
export function applyEvent(state: SubscriptionState | null, e: BillingEvent, cfg: BillingConfig = DEFAULT_BILLING): SubscriptionState | null {
  if (e.type === "subscription_started") {
    // A new started event never overwrites a newer state.
    return state && state.lastEventAt && state.lastEventAt > e.at ? state : initialState(e);
  }
  if (!state) return null;
  if (state.lastEventAt && e.at < state.lastEventAt) return state;
  const s: SubscriptionState = { ...state, lastEventAt: e.at };

  switch (e.type) {
    case "payment_succeeded": {
      s.status = "active"; s.graceUntil = null; s.currentPeriodEnd = e.periodEnd; s.trialEnd = state.trialEnd;
      if (s.pendingPlanId) { s.planId = s.pendingPlanId; s.interval = s.pendingInterval ?? s.interval; s.pendingPlanId = null; s.pendingInterval = null; }
      return s;
    }
    case "payment_failed": {
      if (state.status === "canceled" || state.status === "expired") return state;
      s.status = "past_due"; s.graceUntil = state.graceUntil ?? addDays(e.at, cfg.graceDays);
      return s;
    }
    case "cancel_requested": {
      if (state.status === "expired" || state.status === "canceled") return state;
      if (e.atPeriodEnd) { s.cancelAtPeriodEnd = true; return s; }
      s.status = "canceled"; s.cancelAtPeriodEnd = false; s.graceUntil = null; return s;
    }
    case "cancel_undone": {
      if (state.status === "canceled" || state.status === "expired") return state;
      s.cancelAtPeriodEnd = false; return s;
    }
    case "subscription_expired": { s.status = "expired"; s.graceUntil = null; return s; }
    case "plan_changed": {
      if (state.status === "canceled" || state.status === "expired") return state;
      const up = RANK[e.planId] > RANK[state.planId] || (e.planId === state.planId && e.interval === "year" && state.interval === "month");
      if (e.immediate || up) { s.planId = e.planId; s.interval = e.interval; s.pendingPlanId = null; s.pendingInterval = null; }
      else { s.pendingPlanId = e.planId; s.pendingInterval = e.interval; }
      return s;
    }
  }
}

/** The plan whose features the user may use right now. */
export function effectivePlan(state: SubscriptionState | null, now: string, cfg: BillingConfig = DEFAULT_BILLING): PlanId {
  if (!state) return "free";
  const t = Date.parse(now);
  switch (state.status) {
    case "trialing": return state.trialEnd && t < Date.parse(state.trialEnd) ? state.planId : "free";
    case "active": return state.currentPeriodEnd && t < Date.parse(addHours(state.currentPeriodEnd, cfg.periodSkewHours)) ? state.planId : "free";
    case "past_due": return state.graceUntil && t < Date.parse(state.graceUntil) ? state.planId : "free";
    default: return "free";
  }
}

export type SubscriptionView =
  | { kind: "free" }
  | { kind: "trial"; plan: PlanId; endsAt: string }
  | { kind: "active"; plan: PlanId; renewsAt: string }
  | { kind: "cancelling"; plan: PlanId; endsAt: string }
  | { kind: "payment_failed"; plan: PlanId; graceUntil: string }
  | { kind: "ended" };

/** What to show the user about their subscription. */
export function describeSubscription(state: SubscriptionState | null, now: string, cfg: BillingConfig = DEFAULT_BILLING): SubscriptionView {
  if (!state) return { kind: "free" };
  const plan = effectivePlan(state, now, cfg);
  if (plan === "free") return { kind: "ended" };
  if (state.status === "past_due") return { kind: "payment_failed", plan, graceUntil: state.graceUntil! };
  if (state.status === "trialing") return { kind: "trial", plan, endsAt: state.trialEnd! };
  if (state.cancelAtPeriodEnd) return { kind: "cancelling", plan, endsAt: state.currentPeriodEnd! };
  return { kind: "active", plan, renewsAt: state.currentPeriodEnd! };
}

/** First-time subscribers only, and only if a trial is configured. */
export const trialEligible = (hadTrialBefore: boolean, trialDays: number): boolean => !hadTrialBefore && trialDays > 0;

// ---------- features ----------
export const FEATURES = [
  "ai_coach", "ai_food_recognition", "voice_logging", "daily_fitness_score", "weekly_reports", "advanced_analytics", "workout_progression",
  "advanced_ai_coaching", "ai_meal_planning", "running_analysis", "advanced_progress", "advanced_recommendations",
] as const;
export type FeatureKey = (typeof FEATURES)[number];
export const hasFeature = (features: readonly string[] | undefined, f: FeatureKey): boolean => !!features?.includes(f);

/** Formats a minor-unit amount (e.g. paise) for display. */
export function formatMoney(amountMinor: number, currency: string, locale = "en-IN"): string {
  const major = amountMinor / 100;
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Number.isInteger(major) ? 0 : 2 }).format(major);
}
