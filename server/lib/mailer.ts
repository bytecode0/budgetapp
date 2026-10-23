// Account emails. Each send renders its template and rejects on failure (missing
// config, provider error, rejected recipient); callers decide whether that is
// fatal for their request. Pass the user's UserSettings.language when known.
import { sendEmail } from "./email/index.js";
import type { EmailLocale } from "./email/locales/index.js";
import {
  partnerInviteEmail,
  passwordResetEmail,
  verificationEmail,
  welcomeEmail,
  welcomeGoogleEmail,
} from "./email/templates/index.js";

export async function sendVerificationEmail(email: string, name: string, otp: string, locale: EmailLocale = "es") {
  await sendEmail({ to: email, ...verificationEmail({ name, otp }, locale) });
}

export async function sendPasswordResetEmail(email: string, otp: string, locale: EmailLocale = "es") {
  await sendEmail({ to: email, ...passwordResetEmail({ otp }, locale) });
}

export async function sendWelcomeEmail(email: string, name: string, locale: EmailLocale = "es") {
  await sendEmail({ to: email, ...welcomeEmail({ name }, locale) });
}

export async function sendWelcomeGoogleEmail(email: string, name: string, locale: EmailLocale = "es") {
  await sendEmail({ to: email, ...welcomeGoogleEmail({ name }, locale) });
}

export async function sendPartnerInviteEmail(
  invitedEmail: string,
  senderName: string,
  acceptUrl: string,
  locale: EmailLocale = "es",
) {
  await sendEmail({ to: invitedEmail, ...partnerInviteEmail({ senderName, acceptUrl }, locale) });
}
