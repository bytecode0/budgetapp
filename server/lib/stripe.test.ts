import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

// Empty, not deleted: dotenv (loaded by server/app) never overrides a var that
// is already set, so a local .env can't sneak the keys back in.
process.env.STRIPE_SECRET_KEY = "";
process.env.STRIPE_PREMIUM_PRICE_ID = "";
process.env.STRIPE_WEBHOOK_SECRET = "";

const { isBillingEnabled, missingStripeEnv, subscriptionPeriodEnd, subscriptionSyncData } = await import("./stripe.js");

const PERIOD_END = 1_767_225_600; // 2026-01-01T00:00:00Z

test("missingStripeEnv lists every unset Stripe var", () => {
  assert.deepEqual(missingStripeEnv(), [
    "STRIPE_SECRET_KEY",
    "STRIPE_PREMIUM_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
  ]);
});

const ALL_STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_PREMIUM_PRICE_ID: "price_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
};

test("isBillingEnabled is true only when every Stripe var is set", () => {
  assert.equal(isBillingEnabled(ALL_STRIPE_ENV), true);
  assert.equal(isBillingEnabled({ ...ALL_STRIPE_ENV, STRIPE_WEBHOOK_SECRET: undefined }), false);
  assert.equal(isBillingEnabled({ ...ALL_STRIPE_ENV, STRIPE_PREMIUM_PRICE_ID: "" }), false);
  assert.equal(isBillingEnabled({}), false);
});

test("missingStripeEnv reads the env it is given", () => {
  assert.deepEqual(missingStripeEnv(ALL_STRIPE_ENV), []);
  assert.deepEqual(missingStripeEnv({ ...ALL_STRIPE_ENV, STRIPE_SECRET_KEY: "" }), ["STRIPE_SECRET_KEY"]);
});

test("the app loads without Stripe env vars and the webhook answers 503", async () => {
  const { default: app } = await import("../app.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Stripe is not configured" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("period end is read from the subscription (API <= 2025-02-24.acacia)", () => {
  const end = subscriptionPeriodEnd({
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: PERIOD_END,
    items: { data: [{ price: { id: "price_premium" } }] },
  });
  assert.equal(end?.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("period end falls back to the first item (API >= 2025-03-31.basil)", () => {
  const end = subscriptionPeriodEnd({
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_premium" }, current_period_end: PERIOD_END }] },
  });
  assert.equal(end?.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("period end is null, never an Invalid Date, when absent or garbage", () => {
  const base = { id: "sub_1", status: "active", cancel_at_period_end: false };
  assert.equal(subscriptionPeriodEnd({ ...base, items: { data: [] } }), null);
  assert.equal(subscriptionPeriodEnd({ ...base, current_period_end: null, items: { data: [{}] } }), null);
  assert.equal(subscriptionPeriodEnd({ ...base, current_period_end: Number.NaN, items: { data: [] } }), null);
  assert.equal(subscriptionPeriodEnd({ ...base, current_period_end: 1e20, items: { data: [] } }), null);
});

test("subscriptionSyncData maps a premium subscription to state and dates", () => {
  const data = subscriptionSyncData(
    {
      id: "sub_1",
      status: "active",
      cancel_at_period_end: true,
      items: { data: [{ price: { id: "price_premium" }, current_period_end: PERIOD_END }] },
    },
    "price_premium"
  );
  assert.deepEqual(data, {
    stripeSubscriptionId: "sub_1",
    plan: "premium",
    status: "active",
    currentPeriodEnd: new Date(PERIOD_END * 1000),
    cancelAtPeriodEnd: true,
  });
});

test("subscriptionSyncData: other price is free; unreadable period end is left out", () => {
  const data = subscriptionSyncData(
    { id: "sub_2", status: "past_due", cancel_at_period_end: false, items: { data: [{ price: { id: "price_other" } }] } },
    "price_premium"
  );
  assert.equal(data.plan, "free");
  assert.equal(data.status, "past_due");
  assert.ok(!("currentPeriodEnd" in data));
});
