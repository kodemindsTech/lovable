import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { setAiConsent } from "../lib/coach";

const EXPORT_TABLES = ["profiles", "goals", "nutrition_targets", "target_history", "consents", "meal_logs", "food_logs", "water_logs", "workout_sessions", "session_exercises", "workout_sets", "workout_templates", "template_exercises", "activities", "running_sessions", "weight_logs", "body_measurements", "daily_scores", "ai_conversations", "ai_messages"] as const;

export default function Settings() {
  const { session } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setBusy(true); setMsg(null);
    try {
      const out: Record<string, unknown> = { exported_at: new Date().toISOString(), email: session?.user.email };
      for (const t of EXPORT_TABLES) {
        const { data, error } = await supabase.from(t).select("*");
        if (error) throw error;
        out[t] = data;
      }
      const { data: foods, error } = await supabase.from("foods").select("*").eq("owner_id", session!.user.id);
      if (error) throw error;
      out.custom_foods = foods;
      const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = "my-fitness-data.json"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setMsg(`Export failed: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  async function deleteAccount() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) { setMsg(`Could not delete account: ${error.message}`); setBusy(false); return; }
    await supabase.auth.signOut();
  }

  return (
    <>
      <h1>Settings</h1>
      <section className="card stack">
        <h2>Your data</h2>
        <p className="muted">Download everything we store about you as JSON.</p>
        <button disabled={busy} onClick={exportData}>Export my data</button>
      </section>
      <section className="card stack">
        <h2>AI coach</h2>
        <p className="muted">The coach is optional. Withdrawing consent stops it from using your data; you can turn it back on from the Coach page.</p>
        <button className="ghost" disabled={busy} onClick={async () => { try { await setAiConsent(false); setMsg("AI consent withdrawn."); } catch (e) { setMsg((e as Error).message); } }}>Withdraw AI consent</button>
      </section>
      <section className="card stack">
        <h2>Delete account</h2>
        <p className="muted">Permanently deletes your account and all logged data. This cannot be undone.</p>
        <label>Type DELETE to confirm<input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        <button className="danger" disabled={busy || confirm !== "DELETE"} onClick={deleteAccount}>Delete my account</button>
      </section>
      {msg && <p role="alert">{msg}</p>}
      <p className="muted"><Link to="/subscription">Subscription</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link></p>
    </>
  );
}
