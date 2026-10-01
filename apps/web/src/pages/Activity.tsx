import { useCallback, useEffect, useState } from "react";
import { formatPace, paceMinPerKm, runStats } from "@fitness-os/core";
import { addDays, localDate } from "../lib/date";
import { deleteActivity, listActivities, logOther, logRun, setSteps, toRuns, type ActivityRow } from "../lib/activity";
import { ScreenState } from "../components/ScreenState";

export default function Activity() {
  const today = localDate();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setRows(await listActivities(addDays(today, -90))); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [today]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) { setMsg(null); try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); return false; } return true; }
  const stats = runStats(toRuns(rows), today);
  const todaysSteps = rows.find((r) => r.type === "steps" && r.local_date === today)?.steps ?? null;

  return (
    <>
      <h1>Activity</h1>
      <ScreenState loading={loading} error={error} onRetry={load}>
        {msg && <p role="alert" className="warn">{msg}</p>}
        <section className="card stack">
          <h2>Activity source</h2>
          <p className="muted">Connect activity source — Health Connect, Apple Health, Strava, Fitbit and Garmin aren't available yet. Until then, enter your activity manually below; manual entries are labelled as such.</p>
          <button disabled>Connect activity source (coming soon)</button>
        </section>
        <StepsForm current={todaysSteps} onSave={(n) => run(() => setSteps(today, n))} />
        <RunForm onSave={(km, min, kcal, hr) => run(() => logRun(today, km, min, kcal, hr))} />
        <OtherForm onSave={(t, km, min, kcal) => run(() => logOther(today, t, km, min, kcal))} />
        <section className="card">
          <h2>Running summary</h2>
          {stats.runs === 0 ? <p className="muted">No runs logged yet.</p> : (
            <ul className="list">
              <li>This week: {stats.weekKm} km · This month: {stats.monthKm} km · {stats.runsPerWeek} runs/week</li>
              <li>Average pace: {formatPace(stats.avgPaceMinPerKm)} · Best pace (≥1 km): {formatPace(stats.bestPaceMinPerKm)} · Longest: {stats.longestKm} km</li>
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Recent activity</h2>
          {!rows.length && <p className="muted">No activity yet. Add steps or a run above.</p>}
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id} className="logrow">
                <div>
                  <strong>{r.type === "steps" ? `${r.steps?.toLocaleString()} steps` : labelFor(r)}</strong>
                  <div className="muted">{r.local_date} · {r.source}</div>
                </div>
                <button className="ghost" aria-label={`Delete ${r.type} on ${r.local_date}`} onClick={() => run(() => deleteActivity(r.id))}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      </ScreenState>
    </>
  );
}

function labelFor(r: ActivityRow) {
  const parts = [r.type[0]!.toUpperCase() + r.type.slice(1)];
  if (r.distance_km) parts.push(`${r.distance_km} km`);
  if (r.duration_min) parts.push(`${r.duration_min} min`);
  if (r.type === "run" && r.distance_km && r.duration_min) parts.push(formatPace(paceMinPerKm(r.distance_km, r.duration_min)));
  if (r.active_kcal) parts.push(`${r.active_kcal} kcal`);
  return parts.join(" · ");
}

const opt = (s: string) => (s.trim() === "" ? null : Number(s));

function StepsForm({ current, onSave }: { current: number | null; onSave: (n: number) => Promise<boolean> }) {
  const [v, setV] = useState(""); const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card stack">
      <h2>Steps today</h2>
      <p className="muted">{current == null ? "No steps entered today." : `Entered: ${current.toLocaleString()} steps. Saving again replaces it.`}</p>
      <div className="row">
        <input type="number" min="0" max="200000" aria-label="Steps today" placeholder="Total steps" value={v} onChange={(e) => setV(e.target.value)} />
        <button onClick={async () => { const n = Number(v); if (v === "" || !(n >= 0)) return setErr("Enter your step count."); setErr(null); if (await onSave(Math.round(n))) setV(""); }}>Save steps</button>
      </div>
      {err && <p role="alert" className="warn">{err}</p>}
    </section>
  );
}

function RunForm({ onSave }: { onSave: (km: number, min: number, kcal: number | null, hr: number | null) => Promise<boolean> }) {
  const [f, setF] = useState({ km: "", min: "", kcal: "", hr: "" }); const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const pace = Number(f.km) > 0 && Number(f.min) > 0 ? formatPace(paceMinPerKm(Number(f.km), Number(f.min))) : null;
  return (
    <section className="card stack">
      <h2>Log a run</h2>
      <div className="row">
        <input type="number" min="0" step="0.01" placeholder="km" aria-label="Distance (km)" value={f.km} onChange={set("km")} />
        <input type="number" min="0" step="0.1" placeholder="minutes" aria-label="Duration (minutes)" value={f.min} onChange={set("min")} />
      </div>
      <div className="row">
        <input type="number" min="0" placeholder="kcal (optional)" aria-label="Calories (optional)" value={f.kcal} onChange={set("kcal")} />
        <input type="number" min="30" max="250" placeholder="avg HR (optional)" aria-label="Average heart rate (optional)" value={f.hr} onChange={set("hr")} />
      </div>
      {pace && <p className="muted">Pace: {pace}</p>}
      {err && <p role="alert" className="warn">{err}</p>}
      <button onClick={async () => {
        const km = Number(f.km), min = Number(f.min);
        if (!(km > 0) || !(min > 0)) return setErr("Enter distance and duration greater than 0.");
        setErr(null);
        if (await onSave(km, min, opt(f.kcal), opt(f.hr))) setF({ km: "", min: "", kcal: "", hr: "" });
      }}>Save run</button>
    </section>
  );
}

function OtherForm({ onSave }: { onSave: (t: "walk" | "cycle" | "other", km: number | null, min: number | null, kcal: number | null) => Promise<boolean> }) {
  const [t, setT] = useState<"walk" | "cycle" | "other">("walk");
  const [f, setF] = useState({ km: "", min: "", kcal: "" }); const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card stack">
      <h2>Log other activity</h2>
      <select aria-label="Activity type" value={t} onChange={(e) => setT(e.target.value as typeof t)}>
        <option value="walk">Walk</option><option value="cycle">Cycling</option><option value="other">Other</option>
      </select>
      <div className="row">
        <input type="number" min="0" step="0.01" placeholder="km" aria-label="Distance (km)" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
        <input type="number" min="0" step="0.1" placeholder="minutes" aria-label="Duration (minutes)" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
        <input type="number" min="0" placeholder="kcal (optional)" aria-label="Active calories (optional)" value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value })} />
      </div>
      {err && <p role="alert" className="warn">{err}</p>}
      <button onClick={async () => {
        const km = opt(f.km), min = opt(f.min);
        if ((km ?? 0) <= 0 && (min ?? 0) <= 0) return setErr("Enter a distance or a duration.");
        setErr(null);
        if (await onSave(t, km && km > 0 ? km : null, min && min > 0 ? min : null, opt(f.kcal))) setF({ km: "", min: "", kcal: "" });
      }}>Save activity</button>
    </section>
  );
}
