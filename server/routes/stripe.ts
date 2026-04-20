import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { stripe, PREMIUM_PRICE_ID, FRONTEND_URL } from "../lib/stripe.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import {
  sendSubscriptionActivatedEmail,
  sendSubscriptionCancelledEmail,
  sendPaymentFailedEmail,
} from "../lib/subscriptionEmails.js";

export const stripeRouter = Router();

// ── Helper: build user response payload ──────────────────────────────────────
function planPayload(sub: {
  plan: string;
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}) {
  return {
    plan: sub.plan,
    subscriptionStatus: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}

// ── Helper: upsert subscription from Stripe subscription object ───────────────
async function syncSubscription(
  userId: string,
  stripeSub: {
    id: string;
    status: string;
    current_period_end: number;
    cancel_at_period_end: boolean;
    items: { data: { price: { id: string } }[] };
  }
) {
  const priceId = stripeSub.items.data[0]?.price?.id;
  const plan = priceId === PREMIUM_PRICE_ID ? "premium" : "free";
  return prisma.subscription.update({
    where: { userId },
    data: {
      stripeSubscriptionId: stripeSub.id,
      plan,
      status: stripeSub.status,
      currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    },
  });
}

// ── POST /checkout ────────────────────────────────────────────────────────────
stripeRouter.post("/checkout", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.authUserId!;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Get or create Stripe customer
    let customerId = user.subscription?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        name: user.name ?? undefined,
        metadata: { userId },
      });
      customerId = customer.id;
      await prisma.subscription.upsert({
        where: { userId },
        update: { stripeCustomerId: customerId },
        create: { userId, stripeCustomerId: customerId, plan: "free" },
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: PREMIUM_PRICE_ID, quantity: 1 }],
      success_url: `${FRONTEND_URL}/settings?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/settings`,
      client_reference_id: userId,
      metadata: { userId },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout]", err);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── GET /confirm-session ──────────────────────────────────────────────────────
stripeRouter.get("/confirm-session", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.authUserId!;
  const { session_id } = req.query as Record<string, string>;

  if (!session_id) return res.status(400).json({ error: "session_id is required" });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription"],
    });

    if (session.payment_status !== "paid" || session.status !== "complete") {
      return res.status(400).json({ error: "SESSION_NOT_COMPLETE" });
    }

    const stripeSub = session.subscription as any;
    const sub = await syncSubscription(userId, stripeSub);

    // Only send email if this is fresh activation (status became active from non-active)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.email && sub.currentPeriodEnd) {
      sendSubscriptionActivatedEmail({
        to: user.email,
        name: user.name ?? "there",
        renewalDate: sub.currentPeriodEnd,
      }).catch((e) => console.error("[confirm-session] email failed:", e));
    }

    return res.json(planPayload(sub));
  } catch (err) {
    console.error("[stripe/confirm-session]", err);
    return res.status(500).json({ error: "Failed to confirm session" });
  }
});

// ── GET /billing-info ─────────────────────────────────────────────────────────
stripeRouter.get("/billing-info", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.authUserId!;
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) return res.json({ plan: "free", subscriptionStatus: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });

    // Fetch payment method if available
    let paymentMethod: { brand?: string; last4?: string; expMonth?: number; expYear?: number } | null = null;
    if (sub.stripeSubscriptionId) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
          expand: ["default_payment_method"],
        });
        const pm = stripeSub.default_payment_method as any;
        if (pm?.card) {
          paymentMethod = {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          };
        }
      } catch {
        // non-fatal — just return without payment method
      }
    }

    return res.json({ ...planPayload(sub), paymentMethod });
  } catch (err) {
    console.error("[stripe/billing-info]", err);
    return res.status(500).json({ error: "Failed to fetch billing info" });
  }
});

// ── POST /cancel-subscription ─────────────────────────────────────────────────
stripeRouter.post("/cancel-subscription", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.authUserId!;
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub?.stripeSubscriptionId) {
      return res.status(400).json({ error: "No active subscription found" });
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    const updated = await prisma.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.email && updated.currentPeriodEnd) {
      sendSubscriptionCancelledEmail({
        to: user.email,
        name: user.name ?? "there",
        accessUntilDate: updated.currentPeriodEnd,
      }).catch((e) => console.error("[cancel-subscription] email failed:", e));
    }

    return res.json(planPayload(updated));
  } catch (err) {
    console.error("[stripe/cancel-subscription]", err);
    return res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// ── POST /reactivate-subscription ────────────────────────────────────────────
stripeRouter.post("/reactivate-subscription", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.authUserId!;
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub?.stripeSubscriptionId) {
      return res.status(400).json({ error: "No subscription found" });
    }

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    const updated = await prisma.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: false },
    });

    return res.json(planPayload(updated));
  } catch (err) {
    console.error("[stripe/reactivate-subscription]", err);
    return res.status(500).json({ error: "Failed to reactivate subscription" });
  }
});

// ── POST /create-setup-intent ─────────────────────────────────────────────────
stripeRouter.post("/create-setup-intent", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.authUserId!;
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub?.stripeCustomerId) {
      return res.status(400).json({ error: "No Stripe customer found" });
    }
    const intent = await stripe.setupIntents.create({
      customer: sub.stripeCustomerId,
      usage: "off_session",
    });
    return res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error("[stripe/create-setup-intent]", err);
    return res.status(500).json({ error: "Failed to create setup intent" });
  }
});

// ── POST /update-payment-method ───────────────────────────────────────────────
stripeRouter.post("/update-payment-method", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.authUserId!;
  const { paymentMethodId } = req.body;
  if (!paymentMethodId) return res.status(400).json({ error: "paymentMethodId is required" });
  try {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub?.stripeCustomerId) {
      return res.status(400).json({ error: "No Stripe customer found" });
    }

    await stripe.paymentMethods.attach(paymentMethodId, { customer: sub.stripeCustomerId });
    await stripe.customers.update(sub.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    if (sub.stripeSubscriptionId) {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        default_payment_method: paymentMethodId,
      });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("[stripe/update-payment-method]", err);
    return res.status(500).json({ error: "Failed to update payment method" });
  }
});

// ── POST /webhook ─────────────────────────────────────────────────────────────
stripeRouter.post("/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  let event: any;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("[stripe/webhook] signature verification failed:", err.message);
    return res.status(400).json({ error: "Webhook signature invalid" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const userId: string = session.client_reference_id ?? session.metadata?.userId;
        if (!userId) break;

        if (session.payment_status === "paid" && session.subscription) {
          const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
          const sub = await syncSubscription(userId, stripeSub as any);
          const user = await prisma.user.findUnique({ where: { id: userId } });
          if (user?.email && sub.currentPeriodEnd) {
            sendSubscriptionActivatedEmail({
              to: user.email,
              name: user.name ?? "there",
              renewalDate: sub.currentPeriodEnd,
            }).catch(() => {});
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const stripeSub = event.data.object as any;
        const sub = await prisma.subscription.findUnique({
          where: { stripeSubscriptionId: stripeSub.id },
        });
        if (!sub) break;

        const wasActive = sub.status === "active";
        const updated = await syncSubscription(sub.userId, stripeSub);

        if (!wasActive && updated.status === "active" && updated.currentPeriodEnd) {
          const user = await prisma.user.findUnique({ where: { id: sub.userId } });
          if (user?.email) {
            sendSubscriptionActivatedEmail({
              to: user.email,
              name: user.name ?? "there",
              renewalDate: updated.currentPeriodEnd,
            }).catch(() => {});
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const stripeSub = event.data.object as any;
        const sub = await prisma.subscription.findUnique({
          where: { stripeSubscriptionId: stripeSub.id },
        });
        if (!sub) break;

        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            plan: "free",
            status: "cancelled",
            stripeSubscriptionId: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          },
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        const sub = await prisma.subscription.findFirst({
          where: { stripeCustomerId: invoice.customer },
        });
        if (!sub) break;

        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: "past_due" },
        });

        const user = await prisma.user.findUnique({ where: { id: sub.userId } });
        if (user?.email) {
          sendPaymentFailedEmail({
            to: user.email,
            name: user.name ?? "there",
          }).catch(() => {});
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as any;
        if (invoice.billing_reason === "subscription_create") break; // handled by checkout.session.completed
        const sub = await prisma.subscription.findFirst({
          where: { stripeCustomerId: invoice.customer },
        });
        if (!sub) break;

        const periodEnd = invoice.lines?.data?.[0]?.period?.end;
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: "active",
            ...(periodEnd && { currentPeriodEnd: new Date(periodEnd * 1000) }),
          },
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[stripe/webhook] processing error:", err);
    // Return 200 anyway — we don't want Stripe to retry non-recoverable errors
  }

  return res.json({ received: true });
});
