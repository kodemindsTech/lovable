import {
  compareDays, compareMeaningful, rollingRange, summarisePeriod, type Change, type Report,
} from "@fitness-os/core";
import { computeReport, loadPeriodDays, loadReportContext, type ReportKind } from "@fitness-os/data";
import { supabase } from "./supabase";
import { addDays, localDate } from "./date";
import { callApi } from "./coach";

export type { ReportKind };

export interface Narrative {
  summary: string; improved: string[]; declined: string[]; priority: string; next_week_focus: string[];
  source?: "ai" | "rules"; fallback_reason?: string | null; generated_at?: string;
}

export const getReport = (kind: ReportKind, start: string): Promise<Report> => computeReport(supabase, { kind, start, today: localDate() });

/** Best-effort cache of the deterministic weekly report; never blocks or fails the UI. */
export async function cacheWeeklyReport(start: string, report: Report): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("weekly_reports").upsert({ user_id: u.user.id, week_start: start, report }, { onConflict: "user_id,week_start" }).then(() => undefined, () => undefined);
}
export async function storedNarrative(weekStart: string): Promise<Narrative | null> {
  const { data } = await supabase.from("weekly_reports").select("narrative").eq("week_start", weekStart).maybeSingle();
  return (data?.narrative as Narrative | null) ?? null;
}
export async function requestNarrative(kind: ReportKind, start: string): Promise<Narrative> {
  const r = await callApi<{ narrative: Narrative; source: "ai" | "rules"; fallback_reason: string | null }>("/v1/reports/narrative", { kind, start, local_date: localDate() });
  return { ...r.narrative, source: r.source, fallback_reason: r.fallback_reason };
}

export interface WhatChanged { daily: string[]; week: Change[]; month: Change[]; weekLabel: string; monthLabel: string; todayInProgress: boolean }

/** Yesterday vs today, last 7 vs previous 7 days, last 30 vs previous 30 days. */
export async function loadWhatChanged(): Promise<WhatChanged> {
  const today = localDate(), now = new Date();
  const [ctx, days] = await Promise.all([loadReportContext(supabase), loadPeriodDays(supabase, addDays(today, -59), today)]);
  const base = { targets: ctx.targets, goal: ctx.goal, tdee: ctx.tdee, trainingDays: ctx.trainingDays };
  const win = (end: string, n: number) => { const r = rollingRange(end, n); return summarisePeriod(days, { ...base, ...r }); };
  const w1 = win(today, 7), w0 = win(addDays(today, -7), 7), m1 = win(today, 30), m0 = win(addDays(today, -30), 30);
  return {
    daily: compareDays(days.find((d) => d.date === addDays(today, -1)), days.find((d) => d.date === today), now.getHours() < 22),
    week: compareMeaningful(w0, w1, ctx.goal, { minDays: 2 }),
    month: compareMeaningful(m0, m1, ctx.goal, { minDays: 4 }),
    weekLabel: "Last 7 days vs the 7 before", monthLabel: "Last 30 days vs the 30 before", todayInProgress: now.getHours() < 22,
  };
}
