export interface BillingInfo {
  plan: "free" | "premium";
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paymentMethod?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
}

export async function createCheckoutSession(): Promise<{ url: string }> {
  const res = await fetch("/api/stripe/checkout", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to create checkout session");
  return res.json();
}

export async function confirmSession(sessionId: string): Promise<BillingInfo> {
  const res = await fetch(`/api/stripe/confirm-session?session_id=${sessionId}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to confirm session");
  return res.json();
}

export async function getBillingInfo(): Promise<BillingInfo> {
  const res = await fetch("/api/stripe/billing-info", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch billing info");
  return res.json();
}

export async function cancelSubscription(): Promise<BillingInfo> {
  const res = await fetch("/api/stripe/cancel-subscription", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to cancel subscription");
  return res.json();
}

export async function reactivateSubscription(): Promise<BillingInfo> {
  const res = await fetch("/api/stripe/reactivate-subscription", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to reactivate subscription");
  return res.json();
}

export async function createSetupIntent(): Promise<{ clientSecret: string }> {
  const res = await fetch("/api/stripe/create-setup-intent", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to create setup intent");
  return res.json();
}

export async function updatePaymentMethod(paymentMethodId: string): Promise<void> {
  const res = await fetch("/api/stripe/update-payment-method", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentMethodId }),
  });
  if (!res.ok) throw new Error("Failed to update payment method");
}
