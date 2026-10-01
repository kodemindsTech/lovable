import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useLoad, must } from "../../lib/admin";
import { ScreenState } from "../../components/ScreenState";

interface Row { user_id: string; email: string; created_at: string; onboarding_completed: boolean; plan: string; sub_status: string | null }

export default function Users() {
  const [q, setQ] = useState(""); const [term, setTerm] = useState("");
  const l = useLoad(async () => (must(await supabase.rpc("admin_list_users", { p_search: term || null, p_limit: 50, p_offset: 0 })) ?? []) as Row[], [term]);
  return (
    <>
      <p className="muted small">Account basics only — admins cannot see users' food, workout, weight or chat data. Each lookup is recorded in the audit log.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <input aria-label="Search by email" placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} /><button>Search</button>
      </form>
      <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
        {l.data && !l.data.length ? <p className="muted">No users found.</p> : (
          <div className="tablewrap"><table><thead><tr><th>Email</th><th>Joined</th><th>Onboarded</th><th>Plan</th><th>Status</th></tr></thead>
            <tbody>{l.data?.map((u) => <tr key={u.user_id}><td>{u.email}</td><td>{u.created_at.slice(0, 10)}</td><td>{u.onboarding_completed ? "Yes" : "No"}</td><td>{u.plan}</td><td>{u.sub_status ?? "–"}</td></tr>)}</tbody></table></div>
        )}
      </ScreenState>
    </>
  );
}
