import Stripe from "stripe";

export const FRONTEND_URL = process.env.APP_URL ?? "http://localhost:5173";

// The API version this app was written against. stripe-node's typings only
// accept the SDK's own latest version, so the pinned one is narrowed to that
// type here (the SDK documents this as the way to stay on an older version).
// Response shapes follow this pinned version, not the SDK's typings.
const PINNED_API_VERSION: string = "2025-02-24.acacia";

const REQUIRED_ENV = ["STRIPE_SECRET_KEY", "STRIPE_PREMIUM_PRICE_ID", "STRIPE_WEBHOOK_SECRET"] as const;

/** The Stripe env vars that are missing (unset or empty). Empty = Stripe is configured. */
export function missingStripeEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

/** Billing (Premium purchase) is on only when every Stripe env var is set. */
export function isBillingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return missingStripeEnv(env).length === 0;
}

function requireEnv(name: (typeof REQUIRED_ENV)[number]): string {
  const value = process.env[name];
  if (!value) throw new Error(`Stripe is not configured: ${name} is missing`);
  return value;
}

// Created on first use, not at import: the Stripe constructor throws without a
// key, and this module is loaded by the whole app at startup — a missing key
// must disable the Stripe routes (503), not every route.
let client: Stripe | null = null;

export function getStripe(): Stripe {
  client ??= new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
    apiVersion: PINNED_API_VERSION as typeof Stripe.API_VERSION,
  });
  return client;
}

export function getPremiumPriceId(): string {
  return requireEnv("STRIPE_PREMIUM_PRICE_ID");
}

export function getWebhookSecret(): string {
  return requireEnv("STRIPE_WEBHOOK_SECRET");
}

/** The parts of a Stripe subscription object that syncSubscription reads. */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  // Top-level up to API 2025-02-24.acacia; from 2025-03-31.basil it lives on
  // each subscription item instead. Webhook events are rendered with the
  // webhook endpoint's API version, which can differ from the pinned one, so
  // both shapes reach us.
  current_period_end?: number | null;
  items: { data: { price?: { id: string } | null; current_period_end?: number | null }[] };
}

/** End of the current billing period, from either API shape. Never an Invalid Date. */
export function subscriptionPeriodEnd(sub: StripeSubscriptionLike): Date | null {
  const seconds = sub.current_period_end ?? sub.items.data[0]?.current_period_end;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The Subscription row fields to write for a Stripe subscription. When the
 * period end can't be read, currentPeriodEnd is left out (keeps what's stored)
 * rather than written as null or an Invalid Date.
 */
export function subscriptionSyncData(sub: StripeSubscriptionLike, premiumPriceId: string) {
  const priceId = sub.items.data[0]?.price?.id;
  const currentPeriodEnd = subscriptionPeriodEnd(sub);
  return {
    stripeSubscriptionId: sub.id,
    plan: priceId === premiumPriceId ? "premium" : "free",
    status: sub.status,
    ...(currentPeriodEnd && { currentPeriodEnd }),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}
