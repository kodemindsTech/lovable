import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { FeatureKey } from "@fitness-os/core";
import { FEATURE_LABELS } from "../lib/pricing";
import { useEntitlements } from "../lib/entitlements";
import { ScreenState } from "./ScreenState";

/** Shows children only if the plan includes the feature; otherwise an upgrade prompt. Fails closed on load errors. */
export function FeatureGate({ feature, children, compact }: { feature: FeatureKey; children: ReactNode; compact?: boolean }) {
  const { has, loading, error, reload } = useEntitlements();
  if (loading || error) return <ScreenState loading={loading} error={error} onRetry={reload} />;
  if (has(feature)) return <>{children}</>;
  return (
    <section className="card stack" aria-label="Upgrade required">
      <h2>{FEATURE_LABELS[feature] ?? feature} is part of Pro</h2>
      {!compact && <p className="muted">Upgrade to unlock it. Your data stays yours either way, and the free features keep working.</p>}
      <Link className="btn" to="/subscription">See plans</Link>
    </section>
  );
}
