import type { ReactNode } from "react";

/** Standard loading / error / empty states (PRD §53). */
export function ScreenState(p: {
  loading?: boolean; error?: string | null; onRetry?: () => void; empty?: string | null; children?: ReactNode;
}) {
  if (p.loading) return <p role="status" className="muted">Loading…</p>;
  if (p.error)
    return (
      <div role="alert" className="card">
        <p>Something went wrong: {p.error}</p>
        {p.onRetry && <button onClick={p.onRetry}>Retry</button>}
      </div>
    );
  if (p.empty) return <p className="muted">{p.empty}</p>;
  return <>{p.children}</>;
}
