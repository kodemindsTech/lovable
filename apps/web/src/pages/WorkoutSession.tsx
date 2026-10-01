import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { personalBests, suggestNext, type SessionSets } from "@fitness-os/core";
import {
  addExerciseToSession, addSet, deleteSet, history, loadSession, removeExerciseFromSession, saveTemplate,
  searchExercises, updateSession, type Exercise, type SetRow, type Session,
} from "../lib/workouts";
import { ScreenState } from "../components/ScreenState";
import { useEntitlements } from "../lib/entitlements";

type Hist = { date: string; sets: SessionSets }[];

export default function WorkoutSession() {
  const { id = "" } = useParams();
  const [data, setData] = useState<{ session: Session; exercises: Exercise[]; sets: SetRow[] } | null>(null);
  const [hist, setHist] = useState<Record<string, Hist>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await loadSession(id);
      setData(d);
      const entries = await Promise.all(d.exercises.map(async (e) => [e.id, await history(e.id, id)] as const));
      setHist(Object.fromEntries(entries));
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    setActionErr(null);
    try { await fn(); await load(); } catch (e) { setActionErr((e as Error).message); }
  }

  return (
    <ScreenState loading={loading} error={error} onRetry={load}>
      {data && (
        <>
          <p><Link to="/workout">‹ Workouts</Link></p>
          <h1>{data.session.workout_name}</h1>
          <p className="muted">{data.session.local_date} · {data.session.completed ? "Completed" : "In progress"}</p>
          {actionErr && <p role="alert" className="warn">{actionErr}</p>}
          {data.exercises.map((ex) => (
            <ExerciseCard key={ex.id} ex={ex} sets={data.sets.filter((s) => s.exercise_id === ex.id)} hist={hist[ex.id] ?? []}
              onAdd={(w, r, d) => run(() => addSet({ session: id, exercise: ex.id, setNumber: data.sets.filter((s) => s.exercise_id === ex.id).length + 1, weightKg: w, reps: r, durationS: d }))}
              onDeleteSet={(sid) => run(() => deleteSet(sid))}
              onRemove={() => run(() => removeExerciseFromSession(id, ex.id))} />
          ))}
          {!data.exercises.length && <p className="muted">No exercises yet. Add one to start logging sets.</p>}
          {picking
            ? <ExercisePicker exclude={data.exercises.map((e) => e.id)} onClose={() => setPicking(false)}
                onPick={(e) => run(async () => { await addExerciseToSession(id, e.id, data.exercises.length); setPicking(false); })} />
            : <button onClick={() => setPicking(true)}>+ Add exercise</button>}
          <Finish session={data.session} hasExercises={data.exercises.length > 0}
            onSave={(patch) => run(() => updateSession(id, patch))}
            onTemplate={(name) => run(() => saveTemplate(id, name))} />
        </>
      )}
    </ScreenState>
  );
}

function ExerciseCard(p: {
  ex: Exercise; sets: SetRow[]; hist: Hist;
  onAdd: (w: number | null, r: number | null, d: number | null) => void; onDeleteSet: (id: string) => void; onRemove: () => void;
}) {
  const [w, setW] = useState(""); const [r, setR] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { has } = useEntitlements();
  const sug = suggestNext(p.hist.map((h) => h.sets), { equipment: p.ex.equipment });
  const pb = personalBests(p.hist.map((h) => h.sets));
  const last = p.hist[0];
  const duration = p.ex.tracks === "duration", showWeight = p.ex.tracks === "weight_reps";

  function add() {
    const n = Number(r), wt = w === "" ? null : Number(w);
    if (!(n > 0)) { setErr(duration ? "Enter seconds." : "Enter reps (at least 1)."); return; }
    if (wt !== null && !(wt >= 0)) { setErr("Weight can't be negative."); return; }
    setErr(null);
    p.onAdd(showWeight ? wt : null, duration ? null : n, duration ? n : null);
    setR("");
  }

  return (
    <section className="card stack">
      <div className="row"><h2>{p.ex.name}</h2><button className="ghost" onClick={p.onRemove}>Remove</button></div>
      <div className="muted">{p.ex.muscle_group} · {p.ex.equipment}</div>
      {last && <div className="muted">Last time ({last.date}): {last.sets.map((s) => duration ? `${s.reps ?? ""}` : `${s.weightKg ?? "BW"}×${s.reps}`).join(", ")}</div>}
      {!duration && !has("workout_progression") && <p className="muted small">Progression suggestions are part of Pro. <Link to="/subscription">See plans</Link></p>}
      {!duration && has("workout_progression") && (
        <div className="suggest" aria-label="Suggestion">
          <strong>{sug.kind === "no_history" ? "Suggestion" : "Next target"}</strong>
          <div>{sug.reason}</div>
          {pb.best1RMKg && <div className="muted">Heaviest {pb.heaviestKg ?? "–"} kg · est. 1RM {pb.best1RMKg} kg (estimate)</div>}
        </div>
      )}
      <ol className="list">
        {p.sets.map((s) => (
          <li key={s.id} className="logrow">
            <span>Set {s.set_number}: {duration ? `${s.duration_s}s` : `${s.weight_kg ?? "BW"}${s.weight_kg != null ? " kg" : ""} × ${s.reps}`}</span>
            <button className="ghost" aria-label={`Delete set ${s.set_number} of ${p.ex.name}`} onClick={() => p.onDeleteSet(s.id)}>Delete</button>
          </li>
        ))}
      </ol>
      <div className="row">
        {showWeight && <input type="number" min="0" step="0.5" placeholder="kg" aria-label={`Weight for ${p.ex.name}`} value={w} onChange={(e) => setW(e.target.value)} />}
        <input type="number" min="1" placeholder={duration ? "seconds" : "reps"} aria-label={`${duration ? "Seconds" : "Reps"} for ${p.ex.name}`} value={r} onChange={(e) => setR(e.target.value)} />
        <button onClick={add}>Add set</button>
      </div>
      {err && <p role="alert" className="warn">{err}</p>}
    </section>
  );
}

function ExercisePicker({ exclude, onPick, onClose }: { exclude: string[]; onPick: (e: Exercise) => void; onClose: () => void }) {
  const [q, setQ] = useState(""); const [res, setRes] = useState<Exercise[]>([]); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!q.trim()) { setRes([]); return; }
    const t = setTimeout(() => { searchExercises(q).then(setRes).catch((e: Error) => setErr(e.message)); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="card stack" role="dialog" aria-label="Add exercise">
      <div className="row"><input autoFocus aria-label="Search exercises" placeholder="Search exercises (e.g. bench, squat, back)" value={q} onChange={(e) => setQ(e.target.value)} /><button className="link" onClick={onClose}>Close</button></div>
      {err && <p role="alert">{err}</p>}
      {q.trim() && !res.length && <p className="muted">No exercises found.</p>}
      <ul className="list">
        {res.filter((e) => !exclude.includes(e.id)).map((e) => (
          <li key={e.id}><button className="item" onClick={() => onPick(e)}><span>{e.name}</span><span className="muted">{e.muscle_group} · {e.equipment}</span></button></li>
        ))}
      </ul>
    </div>
  );
}

function Finish({ session, hasExercises, onSave, onTemplate }: {
  session: Session; hasExercises: boolean;
  onSave: (p: Partial<Pick<Session, "completed" | "duration_min" | "notes">>) => void; onTemplate: (name: string) => void;
}) {
  const [dur, setDur] = useState(session.duration_min?.toString() ?? "");
  const [notes, setNotes] = useState(session.notes ?? "");
  return (
    <section className="card stack">
      <h2>Finish</h2>
      <label>Duration (minutes)<input type="number" min="0" max="1440" value={dur} onChange={(e) => setDur(e.target.value)} /></label>
      <label>Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="row">
        <button onClick={() => onSave({ completed: !session.completed, duration_min: dur === "" ? null : Number(dur), notes: notes || null })}>
          {session.completed ? "Reopen workout" : "Complete workout"}
        </button>
        <button className="ghost" onClick={() => onSave({ duration_min: dur === "" ? null : Number(dur), notes: notes || null })}>Save details</button>
        {hasExercises && <button className="ghost" onClick={() => { const n = prompt("Template name", session.workout_name); if (n) onTemplate(n); }}>Save as template</button>}
      </div>
    </section>
  );
}
