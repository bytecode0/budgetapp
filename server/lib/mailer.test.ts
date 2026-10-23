// Run with:  node --import tsx --test server/lib/mailer.test.ts
// The senders used by the routes must forward the locale (and Reply-To) to the
// template and the transport. fetch is stubbed: no network.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  sendPartnerInviteEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendWelcomeGoogleEmail,
} from "./mailer.js";
import {
  sendPaymentFailedEmail,
  sendSubscriptionActivatedEmail,
  sendSubscriptionCancelledEmail,
} from "./subscriptionEmails.js";

const ENV_KEYS = ["EMAIL_PROVIDER", "EMAIL_FROM", "RESEND_API_KEY", "APP_URL", "LOGO_URL"] as const;
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

interface Sent { to: string; subject: string; html: string; text: string; reply_to?: string }
let sent: Sent[];

beforeEach(() => {
  sent = [];
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_FROM = "LifePlan <contact@luisvespa.com>";
  process.env.RESEND_API_KEY = "re_test";
  delete process.env.APP_URL;
  delete process.env.LOGO_URL;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "re-1" }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const date = new Date(Date.UTC(2026, 10, 23));

// Each sender, called with a locale, plus a marker that only that locale's copy has.
const cases: { name: string; send: (locale?: "es" | "en") => Promise<void>; es: RegExp; en: RegExp }[] = [
  { name: "verification", send: (l) => sendVerificationEmail("ana@example.com", "Ana", "482915", l), es: /código de verificación/, en: /verification code/ },
  { name: "password reset", send: (l) => sendPasswordResetEmail("ana@example.com", "482915", l), es: /Restablece/, en: /Reset your/ },
  { name: "welcome", send: (l) => sendWelcomeEmail("ana@example.com", "Ana", l), es: /Te damos la bienvenida/, en: /Welcome to/ },
  { name: "welcome google", send: (l) => sendWelcomeGoogleEmail("ana@example.com", "Ana", l), es: /Te damos la bienvenida/, en: /Welcome to/ },
  {
    name: "partner invite",
    send: (l) => sendPartnerInviteEmail("ana@example.com", "Luis", "https://app.example.com/?invite=x", l),
    es: /te ha invitado/,
    en: /invited you/,
  },
  {
    name: "subscription activated",
    send: (l) => sendSubscriptionActivatedEmail({ to: "ana@example.com", name: "Ana", renewalDate: date, locale: l }),
    es: /Te damos la bienvenida/,
    en: /Welcome to/,
  },
  {
    name: "subscription cancelled",
    send: (l) => sendSubscriptionCancelledEmail({ to: "ana@example.com", name: "Ana", accessUntilDate: date, locale: l }),
    es: /se ha cancelado/,
    en: /has been cancelled/,
  },
  {
    name: "payment failed",
    send: (l) => sendPaymentFailedEmail({ to: "ana@example.com", name: "Ana", locale: l }),
    es: /Acción necesaria/,
    en: /Action required/,
  },
];

for (const c of cases) {
  test(`${c.name}: forwards the locale and defaults to Spanish`, async () => {
    await c.send("en");
    await c.send("es");
    await c.send(undefined);
    assert.equal(sent.length, 3);
    assert.match(sent[0].subject, c.en);
    assert.match(sent[1].subject, c.es);
    assert.match(sent[2].subject, c.es);
    assert.ok(sent.every((m) => m.to === "ana@example.com"));
  });
}

test("cancelled and payment-failed emails go out with Reply-To set to the support address", async () => {
  await sendSubscriptionCancelledEmail({ to: "ana@example.com", name: "Ana", accessUntilDate: date });
  await sendPaymentFailedEmail({ to: "ana@example.com", name: "Ana" });
  await sendSubscriptionActivatedEmail({ to: "ana@example.com", name: "Ana", renewalDate: date });
  assert.equal(sent[0].reply_to, "contact@luisvespa.com");
  assert.equal(sent[1].reply_to, "contact@luisvespa.com");
  assert.equal(sent[2].reply_to, undefined);
});

test("a send failure still rejects, as the routes expect", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" }), { status: 429 })) as typeof fetch;
  await assert.rejects(sendVerificationEmail("ana@example.com", "Ana", "482915", "es"), /Resend rejected the email/);
  await assert.rejects(sendPaymentFailedEmail({ to: "ana@example.com", name: "Ana" }), /Resend rejected the email/);
});
