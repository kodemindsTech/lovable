import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CoachResult, NarrativeResult } from "@fitness-os/ai";
import type { Report } from "@fitness-os/core";
import { computeReport } from "@fitness-os/data";
import { DEFAULT_BILLING, type SubscriptionState } from "@fitness-os/core";
import type { BillingStore } from "./billing";
import type { UserScope } from "./deps";
import { loadContextInput } from "./loader";

/** Builds a client that acts as the user: every query is subject to their RLS policies. */
export const userClient = (url: string, anonKey: string, token: string): SupabaseClient =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });

export function makeAuthenticator(url: string, anonKey: string) {
  return async (token: string): Promise<UserScope | null> => {
    const c = userClient(url, anonKey, token);
    const { data, error } = await c.auth.getUser(token);
    if (error || !data.user) return null;
    const userId = data.user.id;
    return {
      userId,
      async hasConsent() {
        const { data: v, error: e } = await c.rpc("has_ai_consent");
        if (e) throw new Error(e.message);
        return v === true;
      },
      async flagEnabled(key) {
        const { data: v, error: e } = await c.rpc("my_flags");
        if (e) throw new Error(e.message);
        return (v as Record<string, boolean> | null)?.[key] !== false;   // unknown flag = on; only an explicit off disables
      },
      async hasFeature(feature) {
        const { data: v, error: e } = await c.rpc("current_entitlements");
        if (e) throw new Error(e.message);
        return ((v as { features?: string[] } | null)?.features ?? []).includes(feature);
      },
      async consumeQuota(kind) {
        const { error: e } = await c.rpc("ai_consume", { p_kind: kind });
        if (!e) return "ok";
        if (/quota_exceeded/.test(e.message)) return "quota_exceeded";
        if (/feature_not_in_plan/.test(e.message)) return "not_in_plan";
        throw new Error(e.message);
      },
      async getPrice(planId, interval) {
        const { data: r, error: e } = await c.from("plan_prices").select("amount_minor,currency,provider_price_id").eq("plan_id", planId).eq("interval", interval).eq("currency", "INR").maybeSingle();
        if (e) throw new Error(e.message);
        return r ? { amountMinor: Number(r.amount_minor), currency: r.currency as string, providerPriceId: (r.provider_price_id as string | null) ?? null } : null;
      },
      async getSubscription() {
        const { data: r, error: e } = await c.from("subscriptions").select("plan_id,interval,status,provider_subscription_id").maybeSingle();
        if (e) throw new Error(e.message);
        return r ? { planId: r.plan_id as string, interval: r.interval as string, status: r.status as string, providerSubscriptionId: (r.provider_subscription_id as string | null) ?? null } : null;
      },
      async currentPlan() {
        const { data: v, error: e } = await c.rpc("current_entitlements");
        if (e) throw new Error(e.message);
        return (v as { plan?: string } | null)?.plan ?? "free";
      },
      async trialEligible() {
        const { data: v, error: e } = await c.rpc("current_entitlements");
        if (e) throw new Error(e.message);
        return (v as { trial_eligible?: boolean } | null)?.trial_eligible === true;
      },
      email: () => data.user.email ?? undefined,
      loadContextInput: (d, h) => loadContextInput(c, d, h),
      loadReport: (kind, start, today) => computeReport(c, { kind, start, today }),
      async saveNarrative(weekStart: string, report: Report, r: NarrativeResult) {
        const { error: e } = await c.from("weekly_reports").upsert({
          user_id: userId, week_start: weekStart, report,
          narrative: { ...r.narrative, source: r.source, fallback_reason: r.fallbackReason ?? null, version: r.version, generated_at: new Date().toISOString() },
          generated_at: new Date().toISOString(),
        }, { onConflict: "user_id,week_start" });
        if (e) throw new Error(e.message);
      },
      async openConversation(id) {
        if (!id) {
          const { data: r, error: e } = await c.from("ai_conversations").insert({ user_id: userId }).select("id").single();
          if (e) throw new Error(e.message);
          return { id: r.id as string, history: [] };
        }
        const { data: conv } = await c.from("ai_conversations").select("id").eq("id", id).maybeSingle();
        if (!conv) return null;
        const { data: msgs, error: e } = await c.from("ai_messages").select("role,content").eq("conversation_id", id).order("created_at", { ascending: false }).limit(6);
        if (e) throw new Error(e.message);
        return { id, history: (msgs ?? []).reverse().map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content })) };
      },
      async saveTurn(conversationId: string, userMessage: string, r: CoachResult) {
        const { error: e } = await c.from("ai_messages").insert([
          { conversation_id: conversationId, user_id: userId, role: "user", content: userMessage },
          { conversation_id: conversationId, user_id: userId, role: "assistant", content: r.reply.summary, structured: r.reply, source: r.source, prompt_version: r.promptVersion, safety_flag: r.reply.safety_flag },
        ]);
        if (e) throw new Error(e.message);
      },
    };
  };
}

const rowToState = (r: Record<string, unknown>): SubscriptionState => ({
  planId: r.plan_id as SubscriptionState["planId"], interval: r.interval as SubscriptionState["interval"], status: r.status as SubscriptionState["status"],
  currentPeriodEnd: (r.current_period_end as string | null) ?? null, trialEnd: (r.trial_end as string | null) ?? null,
  cancelAtPeriodEnd: r.cancel_at_period_end === true, graceUntil: (r.grace_until as string | null) ?? null,
  pendingPlanId: (r.pending_plan_id as SubscriptionState["pendingPlanId"]) ?? null, pendingInterval: (r.pending_interval as SubscriptionState["pendingInterval"]) ?? null,
  lastEventAt: (r.last_event_at as string | null) ?? null, providerCustomerId: (r.provider_customer_id as string | null) ?? null,
  providerSubscriptionId: (r.provider_subscription_id as string | null) ?? null,
});

/** Server-only store for webhook processing. Uses the service-role key, which must never leave the API process. */
export function makeBillingStore(url: string, serviceKey: string): BillingStore {
  const c = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async getState(userId) {
      const { data: r, error } = await c.from("subscriptions").select("*").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      return r ? rowToState(r) : null;
    },
    async apply(a) {
      const st = a.state;
      const { data: out, error } = await c.rpc("apply_subscription_event", { p: {
        provider: a.provider, provider_event_id: a.providerEventId, type: a.type, user_id: a.userId, occurred_at: a.occurredAt, payload: a.payload,
        state: st && { plan_id: st.planId, interval: st.interval, status: st.status, current_period_end: st.currentPeriodEnd, trial_end: st.trialEnd,
          cancel_at_period_end: st.cancelAtPeriodEnd, grace_until: st.graceUntil, pending_plan_id: st.pendingPlanId, pending_interval: st.pendingInterval,
          last_event_at: st.lastEventAt, provider_customer_id: st.providerCustomerId, provider_subscription_id: st.providerSubscriptionId } } });
      if (error) throw new Error(error.message);
      return out as "applied" | "duplicate" | "ignored" | "no_state";
    },
    async config() {
      const { data: r } = await c.from("app_settings").select("value").eq("key", "billing").maybeSingle();
      const v = (r?.value ?? {}) as { grace_days?: number; trial_days?: number; period_skew_hours?: number };
      return { graceDays: v.grace_days ?? DEFAULT_BILLING.graceDays, periodSkewHours: v.period_skew_hours ?? DEFAULT_BILLING.periodSkewHours, trialDays: v.trial_days ?? 0 };
    },
  };
}
