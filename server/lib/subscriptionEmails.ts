// Subscription emails. Each send renders its template and rejects on failure;
// the Stripe routes catch and log. Pass the user's UserSettings.language when known.
import { sendEmail } from "./email/index.js";
import type { EmailLocale } from "./email/locales/index.js";
import {
  paymentFailedEmail,
  subscriptionActivatedEmail,
  subscriptionCancelledEmail,
} from "./email/templates/index.js";

export async function sendSubscriptionActivatedEmail({
  to,
  name,
  renewalDate,
  locale = "es",
}: {
  to: string;
  name: string;
  renewalDate: Date;
  locale?: EmailLocale;
}) {
  await sendEmail({ to, ...subscriptionActivatedEmail({ name, renewalDate }, locale) });
}

export async function sendSubscriptionCancelledEmail({
  to,
  name,
  accessUntilDate,
  locale = "es",
}: {
  to: string;
  name: string;
  accessUntilDate: Date;
  locale?: EmailLocale;
}) {
  await sendEmail({ to, ...subscriptionCancelledEmail({ name, accessUntilDate }, locale) });
}

export async function sendPaymentFailedEmail({
  to,
  name,
  locale = "es",
}: {
  to: string;
  name: string;
  locale?: EmailLocale;
}) {
  await sendEmail({ to, ...paymentFailedEmail({ name }, locale) });
}
