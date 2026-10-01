import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingConfig, BillingEvent, Interval, PlanId, SubscriptionState } from "@fitness-os/core";

/**
 * Payment-provider boundary. The app never touches card data; the provider hosts checkout and is the
 * source of truth for payments. Provider state changes arrive as webhooks, are verified, normalised to
 * `BillingEvent`s, and applied by the core state machine.
 *
 * NO real provider is implemented yet: integrating Razorpay (or another) needs the merchant's account,
 * keys, plan ids and webhook secret. `FakeBillingProvider` exists for tests and local development only.
 */
export interface CheckoutRequest {
  userId: string; email?: string; planId: Exclude<PlanId, "free">; interval: Interval;
  amountMinor: number; currency: string; providerPriceId: string | null; trialDays: number;
  successUrl: string; cancelUrl: string;
}
export interface ParsedWebhook { providerEventId: string; userId: string; event: BillingEvent }

export interface BillingProvider {
  readonly name: string;
  createCheckout(r: CheckoutRequest): Promise<{ url: string }>;
  /** Result arrives via webhook. */
  cancelSubscription(r: { providerSubscriptionId: string; atPeriodEnd: boolean }): Promise<void>;
  changePlan(r: { providerSubscriptionId: string; planId: Exclude<PlanId, "free">; interval: Interval; providerPriceId: string | null; immediate: boolean }): Promise<void>;
  /** Verifies authenticity and returns a normalised event, or null for events we don't care about. Throws on a bad signature. */
  parseWebhook(rawBody: string, signature: string | undefined): ParsedWebhook | null;
}

export class InvalidSignature extends Error {}

/** Test/dev provider: HMAC-signed JSON webhooks in our own normalised shape. Never use in production. */
export class FakeBillingProvider implements BillingProvider {
  readonly name = "fake";
  calls: { method: string; args: unknown }[] = [];
  constructor(private secret: string) { if (!secret) throw new Error("FakeBillingProvider needs a secret"); }

  sign(rawBody: string): string { return createHmac("sha256", this.secret).update(rawBody).digest("hex"); }

  async createCheckout(r: CheckoutRequest) { this.calls.push({ method: "createCheckout", args: r }); return { url: `${r.successUrl}&fake_checkout=1` }; }
  async cancelSubscription(r: { providerSubscriptionId: string; atPeriodEnd: boolean }) { this.calls.push({ method: "cancel", args: r }); }
  async changePlan(r: { providerSubscriptionId: string }) { this.calls.push({ method: "change", args: r }); }

  parseWebhook(rawBody: string, signature: string | undefined): ParsedWebhook | null {
    const expected = Buffer.from(this.sign(rawBody), "hex");
    const got = Buffer.from(signature ?? "", "hex");
    if (!signature || got.length !== expected.length || !timingSafeEqual(got, expected)) throw new InvalidSignature("bad signature");
    const b = JSON.parse(rawBody) as { id?: string; user_id?: string; event?: BillingEvent };
    if (!b.id || !b.user_id || !b.event?.type) return null;
    return { providerEventId: b.id, userId: b.user_id, event: b.event };
  }
}

export interface BillingStore {
  getState(userId: string): Promise<SubscriptionState | null>;
  apply(a: { provider: string; providerEventId: string; type: string; userId: string; occurredAt: string; payload: unknown; state: SubscriptionState | null }): Promise<"applied" | "duplicate" | "ignored" | "no_state">;
  config(): Promise<BillingConfig & { trialDays: number }>;
}
export interface BillingDeps { provider: BillingProvider; store: BillingStore; appUrl: string }
