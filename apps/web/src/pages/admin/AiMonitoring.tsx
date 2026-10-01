import { supabase } from "../../lib/supabase";
import { useLoad, must } from "../../lib/admin";
import { ScreenState } from "../../components/ScreenState";

interface Flagged { message_id: string; created_at: string; source: string; user_message: string | null; reply: string }

export default function AiMonitoring() {
  const s = useLoad(async () => must(await supabase.rpc("admin_ai_stats", { p_days: 30 })) as { by_source: Record<string, number>; safety_flagged: number; conversations: number; requests_by_kind: Record<string, number> });
  const f = useLoad(async () => (must(await supabase.rpc("admin_flagged_messages", { p_limit: 50 })) ?? []) as Flagged[]);
  return (
    <>
      <ScreenState loading={s.loading} error={s.error} onRetry={s.reload}>
        {s.data && (
          <section className="card"><h2>Last 30 days</h2>
            <p>Conversations: {s.data.conversations} · Safety-flagged replies: {s.data.safety_flagged}</p>
            <p className="muted">Replies by source: {Object.entries(s.data.by_source).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"} · Requests: {Object.entries(s.data.requests_by_kind).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}</p>
          </section>
        )}
      </ScreenState>
      <section className="card">
        <h2>Flagged exchanges</h2>
        <p className="muted small">Shown without any user identity so safety and quality can be reviewed. Disclosed in the Privacy page. Each view is audited. Do not try to identify users.</p>
        <ScreenState loading={f.loading} error={f.error} onRetry={f.reload}>
          {f.data && !f.data.length ? <p className="muted">Nothing flagged.</p> : (
            <ul className="list">{f.data?.map((m) => (
              <li key={m.message_id} className="stack"><span className="muted small">{m.created_at.slice(0, 16).replace("T", " ")} · {m.source}</span>
                <div><strong>User:</strong> {m.user_message ?? "(unavailable)"}</div><div><strong>Reply:</strong> {m.reply}</div></li>))}</ul>
          )}
        </ScreenState>
      </section>
    </>
  );
}
