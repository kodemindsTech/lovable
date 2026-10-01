import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useProfile } from "../lib/profile";
import { useDay } from "../lib/nutrition";
import { localDate, addDays } from "../lib/date";
import { listWeights, todaySteps } from "../lib/activity";
import { useIntelligence } from "../lib/intelligence";
import { useAuth } from "../lib/auth";
import { ScreenState } from "../components/ScreenState";
import { MacroBar } from "../components/MacroBars";
import { ScoreCard } from "../components/ScoreCard";
import { NextActions } from "../components/NextActions";
import { FeatureGate } from "../components/FeatureGate";
import { loadWhatChanged, type WhatChanged } from "../lib/reports";
import { ChangeList } from "./Reports";

export default function Dashboard() {
  const { session } = useAuth();
  const today = localDate();
  const { profile, targets, loading, error, reload } = useProfile();
  const { totals, logs, loading: dLoading, error: dError, reload: dReload } = useDay(today);
  const [steps, setStepsToday] = useState<number | null>(null);
  const [weight, setWeightNow] = useState<number | null>(null);
  useEffect(() => {
    todaySteps(today).then(setStepsToday).catch(() => setStepsToday(null));
    listWeights(addDays(today, -365)).then((w) => setWeightNow(w.at(-1)?.kg ?? null)).catch(() => setWeightNow(null));
  }, [today]);

  const [changed, setChanged] = useState<WhatChanged | null>(null);
  useEffect(() => { loadWhatChanged().then(setChanged).catch(() => setChanged(null)); }, []);
  const intel = useIntelligence({ profile, targets, totals, mealsLogged: logs.length, userId: session?.user.id, ready: !loading && !dLoading });

  return (
    <ScreenState loading={loading || dLoading} error={error ?? dError} onRetry={() => { void reload(); void dReload(); }}>
      <h1>Hi{profile?.name ? `, ${profile.name}` : ""}</h1>
      <div className="row quick" aria-label="Quick actions">
        <Link className="btn" to="/nutrition">+ Food</Link><Link className="btn" to="/workout">+ Workout</Link>
        <Link className="btn" to="/progress">+ Weight</Link><Link className="btn" to="/activity">+ Run</Link>
      </div>
      <FeatureGate feature="daily_fitness_score" compact>
      {intel.error ? (
        <div role="alert" className="card">
          <p>Your data is saved. Insights are temporarily unavailable.</p>
          <button onClick={intel.retry}>Retry</button>
        </div>
      ) : intel.data ? <ScoreCard score={intel.data.score} /> : <p role="status" className="muted">Working out your score…</p>}
      </FeatureGate>
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
      {intel.data && <NextActions actions={intel.data.actions} />}
      {changed && (
        <section className="card" aria-label="Weekly trend">
          <h2>What changed</h2>
          <p className="muted small">{changed.weekLabel}</p>
          <ChangeList items={changed.week.slice(0, 3)} empty="No meaningful changes yet." />
          <Link to="/reports">Open reports</Link>
        </section>
      )}
    </ScreenState>
  );
}
