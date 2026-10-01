import { Link } from "react-router-dom";
import { useProfile } from "../lib/profile";
import { useDay } from "../lib/nutrition";
import { localDate } from "../lib/date";
import { ScreenState } from "../components/ScreenState";
import { MacroBar } from "../components/MacroBars";
import { useEffect, useState } from "react";
import { listWeights, todaySteps } from "../lib/activity";
import { addDays } from "../lib/date";

export default function Dashboard() {
  const { profile, targets, loading, error, reload } = useProfile();
  const today = localDate();
  const [steps, setStepsToday] = useState<number | null>(null);
  const [weight, setWeightNow] = useState<number | null>(null);
  useEffect(() => {
    todaySteps(today).then(setStepsToday).catch(() => setStepsToday(null));
    listWeights(addDays(today, -365)).then((w) => setWeightNow(w.at(-1)?.kg ?? null)).catch(() => setWeightNow(null));
  }, [today]);
  const { totals, logs, loading: dLoading, error: dError, reload: dReload } = useDay(localDate());
  return (
    <ScreenState loading={loading || dLoading} error={error ?? dError} onRetry={() => { void reload(); void dReload(); }}>
      <h1>Hi{profile?.name ? `, ${profile.name}` : ""}</h1>
      <div className="row quick" aria-label="Quick actions">
        <Link className="btn" to="/nutrition">+ Food</Link><Link className="btn" to="/workout">+ Workout</Link>
        <Link className="btn" to="/progress">+ Weight</Link><Link className="btn" to="/activity">+ Run</Link>
      </div>
      <section className="card">
        <h2>Daily fitness score</h2>
        <p className="muted">Available once scoring is built (Phase 5). Nothing is estimated in the meantime.</p>
      </section>
      {targets && totals && (
        <section className="card">
          <MacroBar label="Calories" current={totals.calories} target={targets.calories} unit=" kcal" />
          <MacroBar label="Protein" current={totals.protein_g} target={targets.protein_g} unit="g" />
          <MacroBar label="Fibre" current={totals.fibre_g} target={targets.fibre_g} unit="g" />
          {steps == null
            ? <p className="muted">Steps: none entered. <Link to="/activity">Add activity</Link> (target {targets.steps.toLocaleString()}).</p>
            : <MacroBar label="Steps" current={steps} target={targets.steps} unit="" />}
          <p className="muted">Weight: {weight == null ? "not logged yet" : `${weight} kg (latest entry)`} · <Link to="/progress">Progress</Link></p>
        </section>
      )}
      <section className="card">
        <h2>What should I do now?</h2>
        {logs.length ? (
          <p className="muted">Recommendations arrive in Phase 5.</p>
        ) : (
          <p className="muted">No meals logged today. <Link to="/nutrition">Log your first meal</Link></p>
        )}
      </section>
    </ScreenState>
  );
}
