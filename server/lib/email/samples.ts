// Sample data for every template, shared by `npm run email:preview` and the
// template tests. No network, no DB.
import type { RenderedEmail } from "./components.js";
import type { EmailLocale } from "./locales/index.js";
import {
  partnerInviteEmail,
  passwordResetEmail,
  paymentFailedEmail,
  subscriptionActivatedEmail,
  subscriptionCancelledEmail,
  verificationEmail,
  welcomeEmail,
  welcomeGoogleEmail,
} from "./templates/index.js";

export interface EmailSample {
  name: string;
  render: (locale: EmailLocale) => RenderedEmail;
  /** Values that must reach the reader in both the html and the text part. */
  mustContain: string[];
}

const OTP = "482915";
const ACCEPT_URL = "https://app.example.com/?invite=0b6f6c1e-2c0a-4b8e-9d55-1f3e4a7c9b21";
const RENEWAL = new Date(Date.UTC(2026, 10, 23));

export const EMAIL_SAMPLES: EmailSample[] = [
  { name: "verification", render: (l) => verificationEmail({ name: "Ana García", otp: OTP }, l), mustContain: [OTP, "Ana"] },
  { name: "password-reset", render: (l) => passwordResetEmail({ otp: OTP }, l), mustContain: [OTP] },
  { name: "welcome", render: (l) => welcomeEmail({ name: "Ana García" }, l), mustContain: ["Ana"] },
  { name: "welcome-google", render: (l) => welcomeGoogleEmail({ name: "Ana García" }, l), mustContain: ["Ana"] },
  {
    name: "partner-invite",
    render: (l) => partnerInviteEmail({ senderName: "Luis", acceptUrl: ACCEPT_URL }, l),
    mustContain: [ACCEPT_URL, "Luis"],
  },
  {
    name: "subscription-activated",
    render: (l) => subscriptionActivatedEmail({ name: "Ana García", renewalDate: RENEWAL }, l),
    mustContain: ["2026", "9"],
  },
  {
    name: "subscription-cancelled",
    render: (l) => subscriptionCancelledEmail({ name: "Ana García", accessUntilDate: RENEWAL }, l),
    mustContain: ["2026", "/settings"],
  },
  { name: "payment-failed", render: (l) => paymentFailedEmail({ name: "Ana García" }, l), mustContain: ["/settings"] },
];
