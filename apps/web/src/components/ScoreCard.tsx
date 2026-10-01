import type { DailyScore } from "@fitness-os/core";

const LABEL: Record<DailyScore["status"], string> = { on_track: "On track", slightly_off: "Slightly off", off_track: "Needs attention", no_data: "No score yet" };

export function ScoreCard({ score }: { score: DailyScore }) {
  return (
    <section className="card" aria-label="Daily fitness score">
      <div className="row">
        <h2>Today's fitness score</h2>
        <span className={`pill ${score.status}`}>{LABEL[score.status]}</span>
      </div>
      <div className="bigscore" aria-label={score.score === null ? "No score" : `${score.score} out of 100`}>
        {score.score === null ? "–" : <>{score.score}<small> / 100</small></>}
      </div>
      <p>{score.explanation}</p>
      {score.score !== null && (
        <details>
          <summary>How this was calculated</summary>
          <ul className="list">
            {score.components.map((c) => (
              <li key={c.key} className="row">
                <span>{c.label}</span>
                <span className="muted">{c.value === null ? "not counted" : `${Math.round(c.value * 100)}% · weight ${c.weight}`} — {c.note}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted small">An adherence score for your plan — not a medical or health score.</p>
    </section>
  );
}
