import { progress } from "@fitness-os/core";

export function MacroBar({ label, current, target, unit }: { label: string; current: number; target: number; unit: string }) {
  const p = progress(current, target);
  return (
    <div className="macro">
      <div className="row"><span>{label}</span><span>{Math.round(current)} / {target}{unit}</span></div>
      <div className="bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(current)} aria-valuemin={0} aria-valuemax={target}>
        <div className="fill" style={{ width: `${Math.min(100, p.pct)}%` }} />
      </div>
    </div>
  );
}
