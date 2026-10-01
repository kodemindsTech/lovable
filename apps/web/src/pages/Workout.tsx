import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { localDate } from "../lib/date";
import { deleteSession, listSessions, listTemplates, startSession, type Session, type Template } from "../lib/workouts";
import { ScreenState } from "../components/ScreenState";

export default function Workout() {
  const nav = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [s, t] = await Promise.all([listSessions(), listTemplates()]); setSessions(s); setTemplates(t); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function start(template: string | null, n: string) {
    setBusy(true); setError(null);
    try { const s = await startSession(localDate(), n, template); nav(`/workout/${s.id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <>
      <h1>Workouts</h1>
      <ScreenState loading={loading} error={error} onRetry={load}>
        <section className="card stack">
          <h2>Start a workout</h2>
          <div className="row">
            <input aria-label="Workout name" placeholder="Workout name (e.g. Push day)" value={name} onChange={(e) => setName(e.target.value)} />
            <button disabled={busy} onClick={() => start(null, name)}>Start empty</button>
          </div>
          {templates.length > 0 && (
            <div className="stack">
              <span className="muted">Or start from a template</span>
              <div className="row">{templates.map((t) => <button key={t.id} className="ghost" disabled={busy} onClick={() => start(t.id, t.name)}>{t.name}</button>)}</div>
            </div>
          )}
        </section>
        <section className="card">
          <h2>History</h2>
          {!sessions.length && <p className="muted">No workouts logged yet.</p>}
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id} className="logrow">
                <Link to={`/workout/${s.id}`}>
                  <strong>{s.workout_name}</strong>
                  <div className="muted">{s.local_date}{s.duration_min ? ` · ${s.duration_min} min` : ""} · {s.completed ? "Completed" : "In progress"}</div>
                </Link>
                <button className="ghost" aria-label={`Delete ${s.workout_name} on ${s.local_date}`}
                  onClick={async () => { if (confirm("Delete this workout and its sets?")) { try { await deleteSession(s.id); await load(); } catch (e) { setError((e as Error).message); } } }}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      </ScreenState>
    </>
  );
}
