import { useState } from "react";
import { DEFAULT_WEIGHTS } from "@fitness-os/core";
import { supabase } from "../../lib/supabase";
import { useLoad, must } from "../../lib/admin";
import { ScreenState } from "../../components/ScreenState";

interface Flag { key: string; description: string | null; enabled: boolean; rollout_percent: number }
interface Setting { key: string; value: unknown }

/** Returns an error message if the value is invalid for a known key, else null. */
export function validateSetting(key: string, v: unknown): string | null {
  if (key === "score_weights") {
    if (!v || typeof v !== "object") return "Must be an object.";
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) { if (!(k in DEFAULT_WEIGHTS)) return `Unknown weight "${k}".`; if (typeof o[k] !== "number" || !(o[k] as number >= 0)) return `"${k}" must be a number ≥ 0.`; }
    return Object.values(o).some((x) => (x as number) > 0) ? null : "At least one weight must be above 0.";
  }
  if (key === "billing") {
    if (!v || typeof v !== "object") return "Must be an object.";
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!["grace_days", "trial_days", "period_skew_hours"].includes(k)) return `Unknown field "${k}".`;
      if (!Number.isInteger(x) || (x as number) < 0 || (x as number) > 365) return `"${k}" must be a whole number between 0 and 365.`;
    }
  }
  return null;
}

export function FlagsAdmin() {
  const l = useLoad(async () => (must(await supabase.from("feature_flags").select("*").order("key")) ?? []) as Flag[]);
  const [err, setErr] = useState<string | null>(null);
  async function up(k: string, patch: Partial<Flag>) { setErr(null); try { must(await supabase.from("feature_flags").update({ ...patch, updated_at: new Date().toISOString() }).eq("key", k)); await l.reload(); } catch (e) { setErr((e as Error).message); } }
  return (
    <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
      <p className="muted small">Flags take effect on the next request. Rollout is a stable per-user percentage. Turning <code>ai_coach</code> off is the AI kill switch: the coach and report summaries fall back to rules-based answers.</p>
      {err && <p role="alert" className="warn">{err}</p>}
      <ul className="list">{l.data?.map((f) => (
        <li key={f.key} className="logrow"><div><strong>{f.key}</strong><div className="muted small">{f.description}</div></div>
          <span><label className="inline"><input type="checkbox" checked={f.enabled} onChange={(e) => up(f.key, { enabled: e.target.checked })} /> on</label>
            <label className="inline">rollout % <input type="number" min={0} max={100} defaultValue={f.rollout_percent} onBlur={(e) => { const n = Number(e.target.value); if (n >= 0 && n <= 100 && n !== f.rollout_percent) void up(f.key, { rollout_percent: Math.round(n) }); }} /></label></span></li>))}</ul>
    </ScreenState>
  );
}

export function SettingsAdmin() {
  const l = useLoad(async () => (must(await supabase.from("app_settings").select("key,value").order("key")) ?? []) as Setting[]);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null);
  async function save(k: string, raw: string) {
    setMsg(null);
    let v: unknown; try { v = JSON.parse(raw); } catch { return setMsg(`${k}: not valid JSON.`); }
    const bad = validateSetting(k, v); if (bad) return setMsg(`${k}: ${bad}`);
    try { must(await supabase.from("app_settings").update({ value: v, updated_at: new Date().toISOString() }).eq("key", k)); setDrafts((d) => { const { [k]: _x, ...r } = d; return r; }); await l.reload(); setMsg(`${k} saved.`); } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
      <p className="muted small">Super admins only. Values are validated for known keys; every change is audited.</p>
      {msg && <p role="status">{msg}</p>}
      {l.data?.map((s) => (
        <section key={s.key} className="card stack"><h2>{s.key}</h2>
          <textarea rows={4} aria-label={`${s.key} value`} value={drafts[s.key] ?? JSON.stringify(s.value, null, 2)} onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })} />
          {s.key in drafts && <button onClick={() => save(s.key, drafts[s.key]!)}>Save {s.key}</button>}
        </section>))}
    </ScreenState>
  );
}
