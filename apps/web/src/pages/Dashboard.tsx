import { Link } from "react-router-dom";
import { useProfile } from "../lib/profile";
import { useDay } from "../lib/nutrition";
import { localDate } from "../lib/date";
import { ScreenState } from "../components/ScreenState";
import { MacroBar } from "../components/MacroBars";

export default function Dashboard() {
  const { profile, targets, loading, error, reload } = useProfile();
  const { totals, logs, loading: dLoading, error: dError, reload: dReload } = useDay(localDate());
  return (
    <ScreenState loading={loading || dLoading} error={error ?? dError} onRetry={() => { void reload(); void dReload(); }}>
      <h1>Hi{profile?.name ? `, ${profile.name}` : ""}</h1>
      <section className="card">
        <h2>Daily fitness score</h2>
        <p className="muted">Available once scoring is built (Phase 5). Nothing is estimated in the meantime.</p>
      </section>
      {targets && totals && (
        <section className="card">
          <MacroBar label="Calories" current={totals.calories} target={targets.calories} unit=" kcal" />
          <MacroBar label="Protein" current={totals.protein_g} target={targets.protein_g} unit="g" />
          <MacroBar label="Fibre" current={totals.fibre_g} target={targets.fibre_g} unit="g" />
          <p className="muted">Steps: no activity source connected (target {targets.steps.toLocaleString()}).</p>
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
