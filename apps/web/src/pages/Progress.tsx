import { useCallback, useEffect, useState } from "react";
import { weightStats, type WeightPoint } from "@fitness-os/core";
import { addDays, localDate } from "../lib/date";
import { activeGoal, latestMeasurements, listWeights, saveMeasurement, setWeight, type Measurement } from "../lib/activity";
import { ScreenState } from "../components/ScreenState";
import { LineChart } from "../components/LineChart";

const fmt = (v: number | null, unit = "") => (v === null ? "–" : `${v}${unit}`);

export default function Progress() {
  const today = localDate();
  const [weights, setWeights] = useState<WeightPoint[]>([]);
  const [goal, setGoal] = useState<{ startKg: number; targetKg: number | null } | null>(null);
  const [meas, setMeas] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [kg, setKg] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [w, g, m] = await Promise.all([listWeights(addDays(today, -365)), activeGoal(), latestMeasurements()]);
      setWeights(w); setGoal(g); setMeas(m);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [today]);
  useEffect(() => { void load(); }, [load]);

  const s = weightStats(weights, { asOf: today, startKg: goal?.startKg ?? null, targetKg: goal?.targetKg ?? null });
  const last90 = weights.filter((p) => p.date >= addDays(today, -90));

  async function save() {
    const n = Number(kg);
    if (!(n >= 30 && n <= 300)) return setMsg("Enter a weight between 30 and 300 kg.");
    setMsg(null);
    try { await setWeight(today, n); setKg(""); await load(); } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <h1>Progress</h1>
      <ScreenState loading={loading} error={error} onRetry={load}>
        <section className="card stack">
          <h2>Weight</h2>
          <div className="row">
            <input type="number" step="0.1" min="30" max="300" placeholder="Today's weight (kg)" aria-label="Today's weight (kg)" value={kg} onChange={(e) => setKg(e.target.value)} />
            <button onClick={save}>Save weight</button>
          </div>
          {msg && <p role="alert" className="warn">{msg}</p>}
          {!weights.length ? <p className="muted">No weight logged yet.</p> : (
            <>
              <div className="grid">
                <Tile label="Current" value={fmt(s.current, " kg")} />
                <Tile label="7-day average" value={fmt(s.avg7, " kg")} />
                <Tile label="Change since start" value={fmt(s.change, " kg")} />
                <Tile label="To target" value={fmt(s.remainingToTarget, " kg")} />
              </div>
              <p className="muted">
                {s.trendKgPerWeek === null
                  ? "30-day trend: needs at least 3 weigh-ins over 7+ days."
                  : `30-day trend: ${s.trendKgPerWeek > 0 ? "+" : ""}${s.trendKgPerWeek} kg/week (based on your logged weights).`}
              </p>
              <LineChart points={last90.map((p) => ({ x: p.date, y: p.kg }))} label="Weight" unit="kg" target={goal?.targetKg} />
            </>
          )}
        </section>
        <MeasurementsCard today={today} latest={meas} onSave={async (m) => { try { await saveMeasurement(today, m); await load(); return null; } catch (e) { return (e as Error).message; } }} />
      </ScreenState>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="muted">{label}</div><div className="stat">{value}</div></div>;
}

const FIELDS = [["waist_cm", "Waist (cm)"], ["chest_cm", "Chest (cm)"], ["arms_cm", "Arms (cm)"], ["hips_cm", "Hips (cm)"], ["thighs_cm", "Thighs (cm)"], ["body_fat_pct", "Body fat % (from a measurement you trust)"]] as const;

function MeasurementsCard({ today, latest, onSave }: { today: string; latest: Measurement[]; onSave: (m: Record<string, number>) => Promise<string | null> }) {
  const [f, setF] = useState<Record<string, string>>({}); const [err, setErr] = useState<string | null>(null);
  async function save() {
    const m = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]));
    if (!Object.keys(m).length) return setErr("Enter at least one measurement.");
    if (Object.values(m).some((v) => !(v > 0))) return setErr("Measurements must be greater than 0.");
    const e = await onSave(m); setErr(e); if (!e) setF({});
  }
  return (
    <section className="card stack">
      <h2>Body measurements (optional)</h2>
      <p className="muted">Body-fat % is only what you enter or import — it is never estimated for you.</p>
      <div className="stack">{FIELDS.map(([k, l]) => (
        <label key={k}>{l}<input type="number" step="0.1" min="0" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
      ))}</div>
      {err && <p role="alert" className="warn">{err}</p>}
      <button onClick={save}>Save for {today}</button>
      {latest.length > 0 && (
        <ul className="list">{latest.map((m) => (
          <li key={m.id} className="logrow"><span>{m.local_date}</span>
            <span className="muted">{FIELDS.filter(([k]) => m[k] != null).map(([k, l]) => `${l.split(" (")[0]} ${m[k]}`).join(" · ")}</span></li>
        ))}</ul>
      )}
    </section>
  );
}
