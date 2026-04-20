import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-02-24.acacia" as any,
});

export const PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID!;
export const FRONTEND_URL = process.env.APP_URL ?? "http://localhost:5173";
