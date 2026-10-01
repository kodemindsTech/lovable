import { supabase } from "./supabase";
import { localDate } from "./date";

export interface CoachReply { status: string; summary: string; priority: string; recommendations: string[]; confidence: number; safety_flag: boolean }
export interface CoachResponse {
  conversation_id: string; reply: CoachReply; source: "ai" | "rules" | "safety";
  fallback_reason: "ai_not_configured" | "ai_unavailable" | "invalid_output" | "failed_validation" | "quota_exceeded" | null;
  score: number | null; saved: boolean; disclaimer: string;
}
export class CoachError extends Error {
  constructor(public code: string, message: string, public retryable: boolean) { super(message); }
}
export const SUGGESTED = ["What should I eat tonight?", "Should I train today?", "How did I do this week?", "How much protein do I need?", "What should I change tomorrow?", "Why did my weight change?"];

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export async function hasAiConsent(): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_ai_consent");
  if (error) throw new Error(error.message);
  return data === true;
}
export async function setAiConsent(granted: boolean): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("consents").insert({ user_id: u.user!.id, purpose: "ai_processing", granted, policy_version: "draft-1" });
  if (error) throw new Error(error.message);
}

/** POSTs to the AI backend with the user's session token. Throws CoachError with user-safe messages. */
export async function callApi<T>(path: string, payload: object): Promise<T> {
  if (!API) throw new CoachError("not_configured", "The AI backend isn't configured (VITE_API_URL).", false);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CoachError("unauthorized", "Please sign in again.", false);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  } catch { throw new CoachError("network", "Your data is saved. AI insights are temporarily unavailable.", true); }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new CoachError(body?.code ?? "error", body?.message ?? "Something went wrong.", body?.retryable ?? res.status >= 500);
  return body as T;
}

export function sendMessage(message: string, conversationId?: string): Promise<CoachResponse> {
  const now = new Date();
  return callApi<CoachResponse>("/v1/coach/messages", { message, conversation_id: conversationId, local_date: localDate(now), local_hour: now.getHours() + now.getMinutes() / 60 });
}

export interface StoredMessage { id: string; role: "user" | "assistant"; content: string; structured: CoachReply | null; source: CoachResponse["source"] | null }
export async function latestConversation(): Promise<{ id: string; messages: StoredMessage[] } | null> {
  const { data: c, error } = await supabase.from("ai_conversations").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) return null;
  const { data: m, error: e2 } = await supabase.from("ai_messages").select("id,role,content,structured,source").eq("conversation_id", c.id).order("created_at");
  if (e2) throw new Error(e2.message);
  return { id: c.id as string, messages: (m ?? []) as StoredMessage[] };
}
