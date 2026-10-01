import { useEffect, useState, type ReactNode } from "react";
import { formatMoney } from "@fitness-os/core";
import { BUILT_FEATURES, FEATURE_LABELS, loadPlans, type PlanView } from "../lib/pricing";
import { ScreenState } from "./ScreenState";

const BASIC = ["Nutrition, calories, protein & fibre tracking", "Workout logging", "Weight & steps", "Basic dashboard"];

export function PlanCards({ renderAction, currentPlan }: { renderAction?: (plan: PlanView) => ReactNode; currentPlan?: string }) {
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setError(null); loadPlans().then(setPlans).catch((e: Error) => setError(e.message)); };
  useEffect(load, []);
  return (
    <ScreenState loading={!plans && !error} error={error} onRetry={load}>
      <div className="plans">
        {plans?.map((p) => {
          const own = new Set(p.features);
          const base = p.id === "pro_plus" ? plans.find((x) => x.id === "pro") : undefined;
          const extra = base ? p.features.filter((f) => !base.features.includes(f)) : p.features;
          return (
            <section key={p.id} className={`card plan ${currentPlan === p.id ? "current" : ""}`} aria-label={`${p.name} plan`}>
              <h2>{p.name}{currentPlan === p.id && <span className="chip"> Your plan</span>}</h2>
              {p.id === "free"
                ? <div className="stat">Free</div>
                : p.prices.length === 0 ? <p className="muted">Pricing coming soon</p>
                : p.prices.map((x) => <div key={x.interval} className="stat">{formatMoney(x.amountMinor, x.currency)}<small className="muted"> / {x.interval === "month" ? "month" : "year"}</small></div>)}
              <ul>
                {p.id === "free" && BASIC.map((f) => <li key={f}>{f}</li>)}
                {p.id === "pro_plus" && <li className="muted">Everything in Pro, plus:</li>}
                {extra.map((f) => <li key={f}>{FEATURE_LABELS[f] ?? f}{!BUILT_FEATURES.has(f) && own.has(f) && <span className="chip"> coming soon</span>}</li>)}
              </ul>
              {renderAction?.(p)}
            </section>
          );
        })}
      </div>
    </ScreenState>
  );
}
