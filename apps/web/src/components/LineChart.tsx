export interface ChartPoint { x: string; y: number }

/** Plots only the points it is given (no smoothing or interpolation of missing days). */
export function LineChart({ points, label, unit, target }: { points: ChartPoint[]; label: string; unit: string; target?: number | null }) {
  if (points.length < 2)
    return <p className="muted">Log at least two entries to see a chart.{points.length === 1 ? ` Latest: ${points[0]!.y} ${unit}.` : ""}</p>;
  const W = 600, H = 200, P = 28;
  const t0 = Date.parse(points[0]!.x), t1 = Date.parse(points.at(-1)!.x);
  const ys = points.map((p) => p.y).concat(target != null ? [target] : []);
  const lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo || 1) * 0.15;
  const X = (d: string) => P + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const Y = (v: number) => H - P - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: from ${points[0]!.y} to ${points.at(-1)!.y} ${unit}`}>
        {target != null && <line x1={P} x2={W - P} y1={Y(target)} y2={Y(target)} className="chart-target" />}
        <path d={d} className="chart-line" fill="none" />
        {points.map((p) => <circle key={p.x} cx={X(p.x)} cy={Y(p.y)} r="3.5" className="chart-dot"><title>{p.x}: {p.y} {unit}</title></circle>)}
        <text x={P} y={H - 6} className="chart-axis">{points[0]!.x}</text>
        <text x={W - P} y={H - 6} textAnchor="end" className="chart-axis">{points.at(-1)!.x}</text>
        <text x={4} y={Y(hi)} className="chart-axis">{hi}</text>
        <text x={4} y={Y(lo)} className="chart-axis">{lo}</text>
      </svg>
      {target != null && <figcaption className="muted">Dashed line: target {target} {unit}</figcaption>}
    </figure>
  );
}
