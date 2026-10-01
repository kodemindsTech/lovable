import { formatMoney } from "@fitness-os/core";
import { supabase } from "../../lib/supabase";
import { canSee, useAdminRole, useLoad, must } from "../../lib/admin";
import { ScreenState } from "../../components/ScreenState";

type M = Record<string, number | null | Record<string, number | null>>;
const v = (n: unknown, suffix = "") => (n === null || n === undefined ? "–" : `${n}${suffix}`);

export default function Overview() {
  const { role } = useAdminRole();
  const m = useLoad(async () => must(await supabase.rpc("admin_metrics")) as M);
  const ai = useLoad(async () => (canSee(role, ["support"]) ? must(await supabase.rpc("admin_ai_stats", { p_days: 30 })) : null) as Promise<{ by_source: Record<string, number>; safety_flagged: number; conversations: number } | null>, [role]);
  const d = m.data;
  const ret = (d?.retention ?? {}) as Record<string, number | null>;
  return (
    <ScreenState loading={m.loading} error={m.error} onRetry={m.reload}>
      {d && (
        <>
          <section className="grid stats4">
            <T l="Total users" v={v(d.total_users)} /><T l="DAU" v={v(d.dau)} /><T l="WAU" v={v(d.wau)} /><T l="MAU" v={v(d.mau)} />
            <T l="D1 retention" v={v(ret.d1, "%")} /><T l="D7 retention" v={v(ret.d7, "%")} /><T l="D30 retention" v={v(ret.d30, "%")} />
            <T l="Paying users" v={v(d.paying_users)} />
            <T l="Conversion (ever paid)" v={v(d.conversion_pct, "%")} /><T l="Monthly churn" v={v(d.monthly_churn_pct, "%")} />
            <T l="MRR" v={d.mrr_minor == null ? "–" : formatMoney(Number(d.mrr_minor), "INR")} />
            <T l="ARPU" v={d.arpu_minor == null ? "–" : formatMoney(Number(d.arpu_minor), "INR")} />
            <T l="Food logs (30d)" v={`${v(d.food_logs_30d)} · ${v(d.users_logging_food_30d)} users`} />
            <T l="Workouts (30d)" v={`${v(d.workouts_completed_30d)} · ${v(d.users_logging_workouts_30d)} users`} />
            <T l="AI requests (30d)" v={v(d.ai_requests_30d)} />
            {ai.data && <T l="Safety-flagged (30d)" v={v(ai.data.safety_flagged)} />}
          </section>
          <p className="muted small">Aggregates only. LTV and CAC need acquisition-cost data and are not computed. Revenue assumes INR prices; churn and conversion are approximations from subscription records. Retention is based on first-party app events.</p>
        </>
      )}
    </ScreenState>
  );
}
const T = ({ l, v: val }: { l: string; v: string }) => <div className="card"><div className="muted small">{l}</div><div className="stat">{val}</div></div>;
