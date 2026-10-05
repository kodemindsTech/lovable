import { useState } from "react";
import App from "../App";
import { flags, resetDemo } from "./backend";

/** Wraps the real app with a demo bar. Switching views remounts the app (fresh providers) without a page reload. */
export function DemoShell() {
  const [v, setV] = useState(0);
  const [, force] = useState(0);
  const set = (patch: Partial<typeof flags>) => { Object.assign(flags, patch); setV((x) => x + 1); force((x) => x + 1); window.location.hash = "#/"; };
  return (
    <>
      <div className="demobar" role="region" aria-label="Demo controls">
        <strong>Demo</strong><span className="muted small">Sample data in your browser · AI replies simulated · nothing is saved</span>
        <span className="democtl">
          <label>Plan <select aria-label="Demo plan" value={flags.plan} onChange={(e) => set({ plan: e.target.value as "free" | "pro" })}><option value="pro">Pro</option><option value="free">Free</option></select></label>
          <label className="inline"><input type="checkbox" checked={flags.admin} onChange={(e) => set({ admin: e.target.checked })} /> Admin</label>
          <button className="ghost" onClick={() => { resetDemo(); setV((x) => x + 1); window.location.hash = "#/"; }}>Reset</button>
        </span>
      </div>
      <App key={v} />
    </>
  );
}
