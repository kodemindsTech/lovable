import { describe, expect, it } from "vitest";
import { applyEvent, describeSubscription, effectivePlan, formatMoney, hasFeature, trialEligible, type BillingEvent, type SubscriptionState } from "../src";

const T0 = "2026-01-01T00:00:00.000Z";
const day = (n: number, from = T0) => new Date(Date.parse(from) + n * 86_400_000).toISOString();
const started = (o: Partial<Extract<BillingEvent, { type: "subscription_started" }>> = {}): BillingEvent =>
  ({ type: "subscription_started", at: T0, planId: "pro", interval: "month", periodEnd: day(30), ...o });
const run = (...es: BillingEvent[]) => es.reduce<SubscriptionState | null>((s, e) => applyEvent(s, e), null);

describe("lifecycle", () => {
  it("start → active with access until period end", () => {
    const s = run(started())!;
    expect(s.status).toBe("active");
    expect(effectivePlan(s, day(10))).toBe("pro"); expect(effectivePlan(s, day(31))).toBe("free");
  });
  it("trial: access until trial end, then free unless payment succeeds", () => {
    const s = run(started({ trialEnd: day(7), periodEnd: day(7) }))!;
    expect(s.status).toBe("trialing");
    expect(effectivePlan(s, day(3))).toBe("pro"); expect(effectivePlan(s, day(8))).toBe("free");
    const paid = applyEvent(s, { type: "payment_succeeded", at: day(7), periodEnd: day(37) })!;
    expect(paid.status).toBe("active"); expect(effectivePlan(paid, day(20))).toBe("pro");
  });
  it("renewal extends the period", () => {
    const s = run(started(), { type: "payment_succeeded", at: day(30), periodEnd: day(60) })!;
    expect(effectivePlan(s, day(45))).toBe("pro");
  });
  it("payment failure → past_due with grace, then recovery or lapse", () => {
    const s = run(started(), { type: "payment_failed", at: day(30) })!;
    expect(s.status).toBe("past_due"); expect(s.graceUntil).toBe(day(37));
    expect(effectivePlan(s, day(33))).toBe("pro"); expect(effectivePlan(s, day(38))).toBe("free");
    const fixed = applyEvent(s, { type: "payment_succeeded", at: day(34), periodEnd: day(60) })!;
    expect(fixed.status).toBe("active"); expect(fixed.graceUntil).toBeNull(); expect(effectivePlan(fixed, day(50))).toBe("pro");
  });
  it("repeated failures don't extend the grace period", () => {
    const s = run(started(), { type: "payment_failed", at: day(30) }, { type: "payment_failed", at: day(34) })!;
    expect(s.graceUntil).toBe(day(37));
  });
  it("cancel at period end keeps access until then; can be undone", () => {
    const s = run(started(), { type: "cancel_requested", at: day(5), atPeriodEnd: true })!;
    expect(s.cancelAtPeriodEnd).toBe(true); expect(effectivePlan(s, day(20))).toBe("pro"); expect(effectivePlan(s, day(31))).toBe("free");
    expect(describeSubscription(s, day(20))).toMatchObject({ kind: "cancelling", endsAt: day(30) });
    expect(applyEvent(s, { type: "cancel_undone", at: day(6) })!.cancelAtPeriodEnd).toBe(false);
  });
  it("immediate cancel removes access", () => {
    const s = run(started(), { type: "cancel_requested", at: day(5), atPeriodEnd: false })!;
    expect(s.status).toBe("canceled"); expect(effectivePlan(s, day(6))).toBe("free");
    expect(applyEvent(s, { type: "cancel_undone", at: day(7) })!.status).toBe("canceled");
  });
  it("expired is final for payment failure/cancel events", () => {
    const s = run(started(), { type: "subscription_expired", at: day(31) })!;
    expect(applyEvent(s, { type: "payment_failed", at: day(32) })!.status).toBe("expired");
    expect(effectivePlan(s, day(31))).toBe("free");
  });
  it("upgrade is immediate; downgrade waits for renewal", () => {
    const up = run(started(), { type: "plan_changed", at: day(5), planId: "pro_plus", interval: "month", immediate: false })!;
    expect(up.planId).toBe("pro_plus"); expect(up.pendingPlanId).toBeNull();
    const down = run(started({ planId: "pro_plus" }), { type: "plan_changed", at: day(5), planId: "pro", interval: "month", immediate: false })!;
    expect(down.planId).toBe("pro_plus"); expect(down.pendingPlanId).toBe("pro"); expect(effectivePlan(down, day(10))).toBe("pro_plus");
    const renewed = applyEvent(down, { type: "payment_succeeded", at: day(30), periodEnd: day(60) })!;
    expect(renewed.planId).toBe("pro"); expect(renewed.pendingPlanId).toBeNull();
  });
  it("monthly → annual counts as an upgrade", () => {
    expect(run(started(), { type: "plan_changed", at: day(2), planId: "pro", interval: "year", immediate: false })!.interval).toBe("year");
  });
  it("ignores stale out-of-order events and events with no subscription", () => {
    const s = run(started(), { type: "payment_succeeded", at: day(30), periodEnd: day(60) })!;
    const stale = applyEvent(s, { type: "payment_failed", at: day(10) })!;
    expect(stale).toEqual(s);
    expect(applyEvent(null, { type: "payment_failed", at: day(1) })).toBeNull();
    expect(applyEvent(s, started({ at: day(1) }))).toEqual(s);
  });
  it("access lapses after the period if renewal never arrives (with small skew)", () => {
    const s = run(started())!;
    expect(effectivePlan(s, day(30, "2026-01-01T06:00:00.000Z"))).toBe("pro");   // within 12h skew
    expect(effectivePlan(s, day(31))).toBe("free");
  });
});

describe("views & helpers", () => {
  it("describes states for the UI", () => {
    expect(describeSubscription(null, T0)).toEqual({ kind: "free" });
    expect(describeSubscription(run(started())!, day(5))).toMatchObject({ kind: "active", renewsAt: day(30) });
    expect(describeSubscription(run(started({ trialEnd: day(7), periodEnd: day(7) }))!, day(2))).toMatchObject({ kind: "trial" });
    expect(describeSubscription(run(started(), { type: "payment_failed", at: day(30) })!, day(31))).toMatchObject({ kind: "payment_failed" });
    expect(describeSubscription(run(started())!, day(60))).toEqual({ kind: "ended" });
  });
  it("trial eligibility is first-time only and config-driven", () => {
    expect(trialEligible(false, 7)).toBe(true); expect(trialEligible(true, 7)).toBe(false); expect(trialEligible(false, 0)).toBe(false);
  });
  it("feature checks and money formatting", () => {
    expect(hasFeature(["ai_coach"], "ai_coach")).toBe(true); expect(hasFeature([], "ai_coach")).toBe(false); expect(hasFeature(undefined, "ai_coach")).toBe(false);
    expect(formatMoney(29900, "INR")).toMatch(/299/); expect(formatMoney(199900, "INR")).toMatch(/1,999/);
  });
});
