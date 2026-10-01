import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useLoad, must } from "../../lib/admin";
import { ScreenState } from "../../components/ScreenState";

interface Fb { id: string; category: string; message: string; page: string | null; status: string; admin_note: string | null; created_at: string }

export default function FeedbackAdmin() {
  const [status, setStatus] = useState("new");
  const l = useLoad(async () => (must(await supabase.from("feedback").select("id,category,message,page,status,admin_note,created_at").eq("status", status).order("created_at", { ascending: false }).limit(100)) ?? []) as Fb[], [status]);
  const [err, setErr] = useState<string | null>(null);
  async function update(id: string, patch: Partial<Fb>) { setErr(null); try { must(await supabase.from("feedback").update(patch).eq("id", id)); await l.reload(); } catch (e) { setErr((e as Error).message); } }
  return (
    <>
      <div className="tabs">{["new", "reviewed", "closed"].map((s) => <button key={s} className={status === s ? "" : "ghost"} onClick={() => setStatus(s)}>{s}</button>)}</div>
      {err && <p role="alert" className="warn">{err}</p>}
      <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
        {l.data && !l.data.length ? <p className="muted">No {status} feedback.</p> : l.data?.map((f) => (
          <section key={f.id} className="card stack">
            <div className="muted small">{f.created_at.slice(0, 10)} · {f.category}{f.page ? ` · ${f.page}` : ""}</div>
            <p>{f.message}</p>
            <textarea rows={2} aria-label="Admin note" defaultValue={f.admin_note ?? ""} onBlur={(e) => e.target.value !== (f.admin_note ?? "") && void update(f.id, { admin_note: e.target.value || null })} placeholder="Internal note" />
            <div className="row" style={{ justifyContent: "flex-start" }}>{["new", "reviewed", "closed"].filter((s) => s !== f.status).map((s) => <button key={s} className="ghost" onClick={() => update(f.id, { status: s })}>Mark {s}</button>)}</div>
          </section>
        ))}
      </ScreenState>
    </>
  );
}
