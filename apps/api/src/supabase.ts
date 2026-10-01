import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CoachResult, NarrativeResult } from "@fitness-os/ai";
import type { Report } from "@fitness-os/core";
import { computeReport } from "@fitness-os/data";
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
      async consumeQuota(kind) {
        const { error: e } = await c.rpc("ai_consume", { p_kind: kind });
        if (!e) return "ok";
        if (/quota_exceeded/.test(e.message)) return "quota_exceeded";
        throw new Error(e.message);
      },
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
