import { useCallback, useEffect, useState } from "react";
import { monthRange, previousRange, weekRange, type Change, type Report } from "@fitness-os/core";
import { addDays, localDate } from "../lib/date";
import { cacheWeeklyReport, getReport, loadWhatChanged, requestNarrative, storedNarrative, type Narrative, type ReportKind, type WhatChanged } from "../lib/reports";
import { CoachError } from "../lib/coach";
import { ScreenState } from "../components/ScreenState";
import { FeatureGate } from "../components/FeatureGate";
import { track } from "../lib/analytics";

type Tab = "week" | "month" | "changed";

export default function Reports() {
  const [tab, setTab] = useState<Tab>("week");
  return (
    <>
      <h1>Reports</h1>
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {([["week", "Weekly"], ["month", "Monthly"], ["changed", "What changed?"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "" : "ghost"} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "changed" ? <Changed /> : <FeatureGate feature="weekly_reports"><PeriodReport key={tab} kind={tab} /></FeatureGate>}
    </>
  );
}

const sentimentClass = (c: Change) => (c.sentiment === "better" ? "good" : c.sentiment === "worse" ? "bad" : "");

export function ChangeList({ items, empty }: { items: Change[]; empty: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return <ul className="list">{items.map((c) => <li key={c.key} className={`change ${sentimentClass(c)}`}>{c.direction === "up" ? "▲" : "▼"} {c.text}</li>)}</ul>;
}

function Changed() {
  const [d, setD] = useState<WhatChanged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setError(null); try { setD(await loadWhatChanged()); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <ScreenState loading={!d && !error} error={error} onRetry={load}>
      {d && (
        <>
          <section className="card"><h2>Yesterday vs today</h2>
            {d.daily.length ? <ul className="list">{d.daily.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="muted">Not enough logged food on both days to compare.</p>}</section>
          <section className="card"><h2>{d.weekLabel}</h2><ChangeList items={d.week} empty="No meaningful changes yet — or not enough logged days in both periods." /></section>
          <section className="card"><h2>{d.monthLabel}</h2><ChangeList items={d.month} empty="No meaningful changes yet — or not enough logged days in both periods." /></section>
        </>
      )}
    </ScreenState>
  );
}

function PeriodReport({ kind }: { kind: ReportKind }) {
  const today = localDate();
  const current = (kind === "week" ? weekRange(today) : monthRange(today)).start;
  const [start, setStart] = useState(current);
  const [report, setReport] = useState<Report | null>(null);
  const [narr, setNarr] = useState<Narrative | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nBusy, setNBusy] = useState(false);
  const [nErr, setNErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null); setReport(null); setNarr(null); setNErr(null);
    try {
      const r = await getReport(kind, start); setReport(r); track("weekly_report_viewed");
      if (kind === "week") { void cacheWeeklyReport(start, r); setNarr(await storedNarrative(start).catch(() => null)); }
    } catch (e) { setError((e as Error).message); }
  }, [kind, start]);
  useEffect(() => { void load(); }, [load]);

  const move = (dir: -1 | 1) => setStart(dir < 0 ? previousRange(kind, start).start : kind === "week" ? addDays(start, 7) : addDays(monthRange(start).end, 1));
  async function genNarrative() {
    setNBusy(true); setNErr(null);
    try { setNarr(await requestNarrative(kind, start)); }
    catch (e) { setNErr(e instanceof CoachError && e.code === "consent_required" ? "Enable the AI coach (Coach page) to allow AI summaries." : (e as Error).message); }
    finally { setNBusy(false); }
  }
  const end = kind === "week" ? weekRange(start).end : monthRange(start).end;

  return (
    <>
      <div className="row">
        <button className="ghost" aria-label="Previous period" onClick={() => move(-1)}>‹</button>
        <strong>{start} → {end}</strong>
        <button className="ghost" aria-label="Next period" disabled={start >= current} onClick={() => move(1)}>›</button>
      </div>
      <ScreenState loading={!report && !error} error={error} onRetry={load}>
        {report && <ReportBody r={report} narr={narr} nBusy={nBusy} nErr={nErr} onGenerate={genNarrative} />}
      </ScreenState>
    </>
  );
}

function ReportBody({ r, narr, nBusy, nErr, onGenerate }: { r: Report; narr: Narrative | null; nBusy: boolean; nErr: string | null; onGenerate: () => void }) {
  const s = r.stats;
  const v = (n: number | null, u = "") => (n === null ? "–" : `${n.toLocaleString("en-US")}${u}`);
  return (
    <>
      {r.notes.map((n) => <p key={n} className="warn">{n}</p>)}
      {s.daysLogged === 0 ? <p className="muted">No food logged in this period.</p> : null}
      <section className="grid stats4">
        <Tile l="Avg calories" v={v(s.avgCalories, " kcal")} /><Tile l="Avg protein" v={v(s.avgProteinG, " g")} />
        <Tile l="Avg fibre" v={v(s.avgFibreG, " g")} /><Tile l="Avg steps" v={v(s.avgSteps)} />
        <Tile l="Workouts" v={String(s.workouts)} /><Tile l="Running" v={`${s.runKm} km`} />
        <Tile l="Weight change" v={s.weightChangeKg === null ? "–" : `${s.weightChangeKg > 0 ? "+" : ""}${s.weightChangeKg} kg`} />
        <Tile l="Days on plan" v={s.adherencePct === null ? "–" : `${s.adherentDays}/${s.daysLogged}`} />
      </section>
      {r.estimates.map((e) => <p key={e} className="muted">{e}</p>)}
      <section className="card"><h2>Improved</h2><ChangeList items={r.improved} empty="Nothing clearly improved versus the previous period." /></section>
      <section className="card"><h2>Declined</h2><ChangeList items={r.declined} empty="Nothing clearly declined." /></section>
      <section className="card"><h2>Biggest priority</h2><p>{r.priority.text}</p>
        <h2>Next focus</h2><ul>{r.nextFocus.map((f) => <li key={f}>{f}</li>)}</ul></section>
      <section className="card stack">
        <h2>Summary</h2>
        {narr ? (
          <>
            {narr.source === "rules" && <p className="muted small">{narr.fallback_reason === "quota_exceeded" ? "Daily AI limit reached" : "AI summary unavailable"} — showing a rules-based summary of your data.</p>}
            <p>{narr.summary}</p>
            {narr.source === "ai" && <span className="chip">AI-written · not medical advice</span>}
          </>
        ) : <p className="muted">Generate a written summary of this report.</p>}
        {nErr && <p role="alert" className="warn">{nErr}</p>}
        <button className="ghost" disabled={nBusy} onClick={onGenerate}>{nBusy ? "Working…" : narr ? "Regenerate summary" : "Generate summary"}</button>
      </section>
    </>
  );
}
const Tile = ({ l, v }: { l: string; v: string }) => <div className="card"><div className="muted small">{l}</div><div className="stat">{v}</div></div>;
