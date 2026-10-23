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
  /** Values that must reach the reader in both the html and the text part, per locale. */
  mustContain: Record<EmailLocale, string[]>;
}

export const SAMPLE_OTP = "482915";
export const SAMPLE_ACCEPT_URL = "https://app.example.com/?invite=0b6f6c1e-2c0a-4b8e-9d55-1f3e4a7c9b21";
const RENEWAL = new Date(Date.UTC(2026, 10, 23));
const both = (...values: string[]) => ({ es: values, en: values });

export const EMAIL_SAMPLES: EmailSample[] = [
  {
    name: "verification",
    render: (l) => verificationEmail({ name: "Ana García", otp: SAMPLE_OTP }, l),
    mustContain: both(SAMPLE_OTP, "Ana"),
  },
  { name: "password-reset", render: (l) => passwordResetEmail({ otp: SAMPLE_OTP }, l), mustContain: both(SAMPLE_OTP) },
  { name: "welcome", render: (l) => welcomeEmail({ name: "Ana García" }, l), mustContain: both("Ana", "http://localhost:5173") },
  {
    name: "welcome-google",
    render: (l) => welcomeGoogleEmail({ name: "Ana García" }, l),
    mustContain: both("Ana", "http://localhost:5173"),
  },
  {
    name: "partner-invite",
    render: (l) => partnerInviteEmail({ senderName: "Luis", acceptUrl: SAMPLE_ACCEPT_URL }, l),
    mustContain: both(SAMPLE_ACCEPT_URL, "Luis"),
  },
  {
    name: "subscription-activated",
    render: (l) => subscriptionActivatedEmail({ name: "Ana García", renewalDate: RENEWAL }, l),
    // es-ES puts a no-break space between the amount and the symbol.
    mustContain: {
      es: ["23 de noviembre de 2026", "9,99 €/mes", "Ana"],
      en: ["23 November 2026", "€9.99/mo", "Ana"],
    },
  },
  {
    name: "subscription-cancelled",
    render: (l) => subscriptionCancelledEmail({ name: "Ana García", accessUntilDate: RENEWAL }, l),
    mustContain: {
      es: ["23 de noviembre de 2026", "http://localhost:5173/settings", "Ana"],
      en: ["23 November 2026", "http://localhost:5173/settings", "Ana"],
    },
  },
  {
    name: "payment-failed",
    render: (l) => paymentFailedEmail({ name: "Ana García" }, l),
    mustContain: both("http://localhost:5173/settings", "contact@luisvespa.com", "Ana"),
  },
];
