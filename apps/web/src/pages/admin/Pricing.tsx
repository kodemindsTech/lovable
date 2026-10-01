import { useState } from "react";
import { formatMoney } from "@fitness-os/core";
import { supabase } from "../../lib/supabase";
import { useLoad, must } from "../../lib/admin";
import { FEATURE_LABELS } from "../../lib/pricing";
import { ScreenState } from "../../components/ScreenState";

interface Price { id: string; plan_id: string; interval: string; currency: string; amount_minor: number; active: boolean; provider_price_id: string | null }
interface Feat { plan_id: string; feature_key: string; daily_limit: number | null }

export default function PricingAdmin() {
  const l = useLoad(async () => {
    const [p, f] = await Promise.all([supabase.from("plan_prices").select("*").order("plan_id").order("interval"), supabase.from("plan_features").select("*").order("plan_id").order("feature_key")]);
    return { prices: must(p) as Price[], feats: must(f) as Feat[] };
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [np, setNp] = useState({ plan_id: "pro", interval: "month", rupees: "" });
  const [nf, setNf] = useState({ plan_id: "pro", feature_key: "", daily_limit: "" });
  async function run(fn: () => Promise<unknown>) { setMsg(null); try { await fn(); await l.reload(); } catch (e) { setMsg((e as Error).message); } }

  return (
    <ScreenState loading={l.loading} error={l.error} onRetry={l.reload}>
      <p className="muted small">Prices are stored in minor units (paise) and take effect for new checkouts immediately. Existing subscribers' prices are set by your payment provider. All changes are audited.</p>
      {msg && <p role="alert" className="warn">{msg}</p>}
      <section className="card"><h2>Prices</h2>
        <ul className="list">{l.data?.prices.map((p) => (
          <li key={p.id} className="logrow">
            <span>{p.plan_id} · {p.interval} · <strong>{formatMoney(p.amount_minor, p.currency)}</strong>{!p.active && <span className="chip"> inactive</span>}</span>
            <span>
              <button className="ghost" onClick={() => { const r = prompt("New price in rupees", String(p.amount_minor / 100)); if (r && Number(r) > 0) void run(async () => must(await supabase.from("plan_prices").update({ amount_minor: Math.round(Number(r) * 100) }).eq("id", p.id))); }}>Change</button>
              <button className="ghost" onClick={() => run(async () => must(await supabase.from("plan_prices").update({ active: !p.active }).eq("id", p.id)))}>{p.active ? "Deactivate" : "Activate"}</button>
            </span>
          </li>))}</ul>
        <div className="row">
          <select aria-label="Plan" value={np.plan_id} onChange={(e) => setNp({ ...np, plan_id: e.target.value })}><option>pro</option><option>pro_plus</option></select>
          <select aria-label="Interval" value={np.interval} onChange={(e) => setNp({ ...np, interval: e.target.value })}><option>month</option><option>year</option></select>
          <input aria-label="Price in rupees" type="number" min="1" placeholder="₹ price" value={np.rupees} onChange={(e) => setNp({ ...np, rupees: e.target.value })} />
          <button onClick={() => Number(np.rupees) > 0 ? run(async () => must(await supabase.from("plan_prices").insert({ plan_id: np.plan_id, interval: np.interval, currency: "INR", amount_minor: Math.round(Number(np.rupees) * 100) }))) : setMsg("Enter a price.")}>Add price</button>
        </div>
      </section>
      <section className="card"><h2>Plan features & AI limits</h2>
        <ul className="list">{l.data?.feats.map((f) => (
          <li key={`${f.plan_id}:${f.feature_key}`} className="logrow">
            <span>{f.plan_id} · {FEATURE_LABELS[f.feature_key] ?? f.feature_key}{f.daily_limit ? ` · ${f.daily_limit}/day` : ""}</span>
            <span>
              {f.daily_limit !== null && <button className="ghost" onClick={() => { const r = prompt("Daily limit", String(f.daily_limit)); if (r && Number(r) > 0) void run(async () => must(await supabase.from("plan_features").update({ daily_limit: Math.round(Number(r)) }).eq("plan_id", f.plan_id).eq("feature_key", f.feature_key))); }}>Limit</button>}
              <button className="ghost" onClick={() => confirm("Remove this feature from the plan?") && run(async () => must(await supabase.from("plan_features").delete().eq("plan_id", f.plan_id).eq("feature_key", f.feature_key)))}>Remove</button>
            </span>
          </li>))}</ul>
        <div className="row">
          <select aria-label="Plan" value={nf.plan_id} onChange={(e) => setNf({ ...nf, plan_id: e.target.value })}><option>pro</option><option>pro_plus</option></select>
          <input aria-label="Feature key" placeholder="feature_key" value={nf.feature_key} onChange={(e) => setNf({ ...nf, feature_key: e.target.value })} />
          <input aria-label="Daily limit" type="number" min="1" placeholder="daily limit (AI only)" value={nf.daily_limit} onChange={(e) => setNf({ ...nf, daily_limit: e.target.value })} />
          <button onClick={() => nf.feature_key.trim() ? run(async () => must(await supabase.from("plan_features").insert({ plan_id: nf.plan_id, feature_key: nf.feature_key.trim(), daily_limit: nf.daily_limit ? Number(nf.daily_limit) : null }))) : setMsg("Enter a feature key.")}>Add feature</button>
        </div>
      </section>
    </ScreenState>
  );
}
