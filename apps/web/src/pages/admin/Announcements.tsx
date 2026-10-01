import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useLoad, must } from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { ScreenState } from "../../components/ScreenState";

interface N { id: string; title: string; body: string; audience: string; ends_at: string | null; active: boolean; created_at: string }

export default function Announcements() {
  const { session } = useAuth();
  const l = useLoad(async () => (must(await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50)) ?? []) as N[]);
  const [f, setF] = useState({ title: "", body: "", audience: "all", ends: "" });
  const [msg, setMsg] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) { setMsg(null); try { await fn(); await l.reload(); } catch (e) { setMsg((e as Error).message); } }
  return (
    <>
      <p className="muted small">In-app announcements only (no email or push). Shown on users' dashboards until dismissed.</p>
      <section className="card stack">
        <input aria-label="Title" placeholder="Title (max 120)" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea aria-label="Message" rows={3} placeholder="Message (max 600)" maxLength={600} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <div className="row">
          <select aria-label="Audience" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="all">Everyone</option><option value="free">Free plan</option><option value="paid">Paid plans</option></select>
          <label className="inline">Ends <input type="date" value={f.ends} onChange={(e) => setF({ ...f, ends: e.target.value })} /></label>
          <button onClick={() => f.title.trim() && f.body.trim()
            ? run(async () => { must(await supabase.from("notifications").insert({ title: f.title.trim(), body: f.body.trim(), audience: f.audience, ends_at: f.ends ? new Date(`${f.ends}T23:59:59`).toISOString() : null, created_by: session?.user.id })); setF({ title: "", body: "", audience: "all", ends: "" }); })
            : setMsg("Title and message are required.")}>Publish</button>
        </div>
      </section>
      {msg && <p role="alert" className="warn">{msg}</p>}
      <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
        <ul className="list">{l.data?.map((n) => (
          <li key={n.id} className="logrow"><div><strong>{n.title}</strong> <span className="chip">{n.audience}</span>{!n.active && <span className="chip"> off</span>}<div className="muted small">{n.body}</div></div>
            <span><button className="ghost" onClick={() => run(async () => must(await supabase.from("notifications").update({ active: !n.active }).eq("id", n.id)))}>{n.active ? "Turn off" : "Turn on"}</button>
              <button className="ghost" onClick={() => confirm("Delete this announcement?") && run(async () => must(await supabase.from("notifications").delete().eq("id", n.id)))}>Delete</button></span></li>))}</ul>
      </ScreenState>
    </>
  );
}
