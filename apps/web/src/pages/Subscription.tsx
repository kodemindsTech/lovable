import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { describeSubscription, type SubscriptionState } from "@fitness-os/core";
import { callApi, CoachError } from "../lib/coach";
import { useEntitlements } from "../lib/entitlements";
import { PlanCards } from "../components/PlanCards";
import { ScreenState } from "../components/ScreenState";

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function Subscription() {
  const { ent, loading, error, reload } = useEntitlements();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // After returning from checkout the webhook may lag: refresh a few times.
  useEffect(() => {
    if (params.get("checkout") !== "success") return;
    let n = 0; const t = setInterval(() => { void reload(); if (++n >= 5) clearInterval(t); }, 3000);
    void reload(); return () => clearInterval(t);
  }, [params, reload]);

  async function act(path: string, body: object, ok: string) {
    setBusy(true); setMsg(null);
    try { const r = await callApi<{ checkout_url?: string }>(path, body); if (r.checkout_url) { window.location.assign(r.checkout_url); return; } setMsg(ok); await reload(); }
    catch (e) { setMsg(e instanceof CoachError && e.code === "billing_not_configured" ? "Payments aren't available yet." : (e as Error).message); }
    finally { setBusy(false); }
  }

  const sub = ent?.subscription;
  const view = describeSubscription(sub ? {
    planId: sub.plan_id, interval: sub.interval, status: sub.status, currentPeriodEnd: sub.current_period_end, trialEnd: sub.trial_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end, graceUntil: sub.grace_until, pendingPlanId: sub.pending_plan_id as SubscriptionState["pendingPlanId"], pendingInterval: null,
    lastEventAt: null, providerCustomerId: null, providerSubscriptionId: null } : null, new Date().toISOString());

  return (
    <>
      <h1>Subscription</h1>
      <ScreenState loading={loading && !ent} error={error} onRetry={reload}>
        {params.get("checkout") === "success" && <p role="status" className="card">Thanks! We're confirming your payment — this can take a moment.</p>}
        {params.get("checkout") === "cancelled" && <p role="status" className="muted">Checkout cancelled. You haven't been charged.</p>}
        <section className="card stack" aria-label="Current plan">
          <h2>Your plan: {ent?.plan === "free" ? "Free" : ent?.plan === "pro" ? "Pro" : "Pro+"}</h2>
          {view.kind === "trial" && <p>Free trial ends {fmt(view.endsAt)}. Cancel any time before then to avoid being charged.</p>}
          {view.kind === "active" && <p>Renews on {fmt(view.renewsAt)}.</p>}
          {view.kind === "cancelling" && <p>Cancelled — you keep access until {fmt(view.endsAt)}.</p>}
          {view.kind === "payment_failed" && <p role="alert" className="warn">Your last payment failed. Update your payment method with your provider; you keep access until {fmt(view.graceUntil)}.</p>}
          {view.kind === "ended" && <p className="muted">Your subscription has ended. You're on the Free plan.</p>}
          {sub?.pending_plan_id && <p className="muted">A plan change takes effect at your next renewal.</p>}
          {(view.kind === "active" || view.kind === "trial" || view.kind === "payment_failed") && (
            <button className="ghost" disabled={busy} onClick={() => { if (confirm("Cancel at the end of your current period?")) void act("/v1/billing/cancel", { at_period_end: true }, "Cancellation requested. You keep access until the end of the period."); }}>Cancel subscription</button>
          )}
          {msg && <p role="status">{msg}</p>}
        </section>
        <PlanCards currentPlan={ent?.plan} renderAction={(p) => {
          if (p.id === "free" || (sub?.status === "past_due" && ent?.plan !== "free")) return null;
          const hasSub = !!sub && ["active", "trialing"].includes(sub.status) && ent?.plan !== "free";
          return (
            <div className="row" style={{ justifyContent: "flex-start" }}>
              {p.prices.map((x) => {
                const same = sub?.plan_id === p.id && sub.interval === x.interval && hasSub;
                return <button key={x.interval} disabled={busy || same} onClick={() => void act(hasSub ? "/v1/billing/change" : "/v1/billing/checkout", { plan: p.id, interval: x.interval }, "Plan change requested.")}>
                  {same ? "Current" : hasSub ? `Switch to ${x.interval === "month" ? "monthly" : "yearly"}` : ent?.trial_eligible && p.id === "pro" ? `Start free trial (${x.interval === "month" ? "monthly" : "yearly"})` : `Choose ${x.interval === "month" ? "monthly" : "yearly"}`}
                </button>;
              })}
            </div>
          );
        }} />
        <p className="muted small">Payments are handled by our payment provider; we never see or store your card details. Prices are shown before tax.</p>
      </ScreenState>
    </>
  );
}
