import { useEffect } from "react";
import { Link } from "react-router-dom";
import { trackOnce } from "../lib/analytics";
import type { NextAction } from "@fitness-os/core";
import { EstimateChip } from "./EstimateChip";

export function NextActions({ actions }: { actions: NextAction[] }) {
  useEffect(() => { if (actions.length) trackOnce("ai_recommendation_viewed"); }, [actions.length]);
  return (
    <section className="card stack" aria-label="What should I do now?">
      <h2>What should I do now?</h2>
      {actions.map((a, i) => (
        <article key={a.id} className={`action ${i === 0 ? "first" : ""}`}>
          <strong>{a.title}</strong>
          <p>{a.detail}</p>
          {a.suggestions.length > 0 && (
            <ul className="list">
              {a.suggestions.map((s) => (
                <li key={s.foodId}>
                  {s.servings} × {s.servingLabel} {s.name} <EstimateChip status={s.status} />
                  <span className="muted"> — {s.calories} kcal · {s.proteinG} g protein{s.fibreG >= 1 ? ` · ${s.fibreG} g fibre` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">{a.why}</p>
          {a.kind === "log" && <Link className="btn" to="/nutrition">Log a meal</Link>}
          {a.id === "add_activity" && <Link className="btn" to="/activity">Add activity</Link>}
        </article>
      ))}
    </section>
  );
}
