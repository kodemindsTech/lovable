import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useLoad, must } from "../../lib/admin";
import { ScreenState } from "../../components/ScreenState";

interface A { user_id: string; role: string; created_at: string }
interface Log { id: number; actor_id: string | null; action: string; target: string | null; created_at: string; meta: unknown }

export function AdminsAdmin() {
  const l = useLoad(async () => (must(await supabase.from("admin_users").select("*").order("created_at")) ?? []) as A[]);
  const [email, setEmail] = useState(""); const [role, setRole] = useState("support"); const [msg, setMsg] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) { setMsg(null); try { await fn(); await l.reload(); } catch (e) { setMsg((e as Error).message); } }
  return (
    <>
      <p className="muted small">Roles: <b>support</b> (user directory, feedback, AI review), <b>content</b> (foods, exercises, announcements, feedback), <b>finance</b> (plans, pricing, subscriptions, users), <b>super</b> (everything). The last super admin can't be removed.</p>
      <div className="row"><input aria-label="User email" type="email" placeholder="Existing user's email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{["support", "content", "finance", "super"].map((r) => <option key={r}>{r}</option>)}</select>
        <button onClick={() => email.trim() ? run(async () => { must(await supabase.rpc("admin_add_admin", { p_email: email.trim(), p_role: role })); setEmail(""); }) : setMsg("Enter an email.")}>Add / change</button></div>
      {msg && <p role="alert" className="warn">{msg}</p>}
      <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
        <ul className="list">{l.data?.map((a) => (
          <li key={a.user_id} className="logrow"><span><code>{a.user_id.slice(0, 8)}…</code> <span className="chip">{a.role}</span></span>
            <button className="ghost" onClick={() => confirm("Remove this admin?") && run(async () => must(await supabase.from("admin_users").delete().eq("user_id", a.user_id)))}>Remove</button></li>))}</ul>
      </ScreenState>
    </>
  );
}

export function AuditAdmin() {
  const l = useLoad(async () => (must(await supabase.from("audit_logs").select("id,actor_id,action,target,created_at,meta").order("id", { ascending: false }).limit(100)) ?? []) as Log[]);
  return (
    <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
      <p className="muted small">Latest 100 entries. Admin edits of shared data, user-directory lookups and flagged-chat views are recorded automatically.</p>
      <div className="tablewrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>{l.data?.map((a) => <tr key={a.id}><td>{a.created_at.slice(0, 19).replace("T", " ")}</td><td><code>{a.actor_id?.slice(0, 8) ?? "system"}</code></td><td>{a.action}</td><td>{a.target}</td></tr>)}</tbody></table></div>
    </ScreenState>
  );
}
