import { useProfile } from "../lib/profile";
import { ScreenState } from "../components/ScreenState";

export default function Dashboard() {
  const { profile, targets, loading, error, reload } = useProfile();
  return (
    <ScreenState loading={loading} error={error} onRetry={reload}>
      <h1>Hi{profile?.name ? `, ${profile.name}` : ""}</h1>
      <section className="card">
        <h2>Daily fitness score</h2>
        <p className="muted">Available once you start logging (Phase 5).</p>
      </section>
      {targets && (
        <section className="grid">
          <Stat label="Calories" value={`0 / ${targets.calories}`} />
          <Stat label="Protein" value={`0 / ${targets.protein_g} g`} />
          <Stat label="Fibre" value={`0 / ${targets.fibre_g} g`} />
          <Stat label="Steps" value={`0 / ${targets.steps}`} />
        </section>
      )}
      <section className="card">
        <h2>What should I do now?</h2>
        <p className="muted">No meals logged today. Food logging arrives in Phase 2.</p>
      </section>
    </ScreenState>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="muted">{label}</div><div className="stat">{value}</div></div>;
}
