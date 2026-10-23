// Run with:  node --import tsx --test server/lib/email/templates.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, safeUrl } from "./components.js";
import { formatMoney } from "./format.js";
import { DICTIONARIES, fill, parseLocale, resolveLocale, type EmailLocale } from "./locales/index.js";
import { EMAIL_SAMPLES } from "./samples.js";
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

const LOCALES: EmailLocale[] = ["es", "en"];

// Samples expect the default app URL and no logo, whatever the shell has set.
beforeEach(() => {
  delete process.env.APP_URL;
  delete process.env.LOGO_URL;
});

function keyPaths(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keyPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  ).sort();
}

function leafStrings(obj: object): string[] {
  return Object.values(obj).flatMap((v) => (typeof v === "object" && v !== null ? leafStrings(v) : [String(v)]));
}

test("es and en dictionaries have exactly the same keys, all non-empty", () => {
  assert.deepEqual(keyPaths(DICTIONARIES.en), keyPaths(DICTIONARIES.es));
  for (const locale of LOCALES) {
    for (const s of leafStrings(DICTIONARIES[locale])) assert.ok(s.trim(), `empty string in ${locale}`);
  }
});

for (const sample of EMAIL_SAMPLES) {
  for (const locale of LOCALES) {
    test(`${sample.name} (${locale}) renders a subject, html and text with its key values in both parts`, () => {
      const email = sample.render(locale);
      assert.ok(email.subject.trim());
      assert.ok(email.html.includes("<!DOCTYPE html>"));
      assert.ok(email.html.includes(`lang="${locale}"`));
      assert.ok(email.text.trim());
      for (const value of sample.mustContain[locale]) {
        assert.ok(email.html.includes(escapeHtml(value)), `html lacks ${value}`);
        assert.ok(email.text.includes(value), `text lacks ${value}`);
      }
      // No placeholder left unfilled, no markup in the text part.
      for (const part of [email.subject, email.html, email.text]) assert.doesNotMatch(part, /\{\w+\}/);
      assert.doesNotMatch(email.text, /<\/?[a-z][^>]*>/i);
    });
  }
}

test("the two locales actually differ", () => {
  for (const sample of EMAIL_SAMPLES) {
    assert.notEqual(sample.render("es").subject, sample.render("en").subject, sample.name);
  }
});

test("OTP appears in the subject of the code emails", () => {
  for (const locale of LOCALES) {
    assert.match(verificationEmail({ name: "Ana", otp: "123456" }, locale).subject, /123456/);
  }
});

test("interpolated user values are escaped in the html and left readable in the text", () => {
  const evil = `<script>alert("x")</script> & 'Bob'`;
  for (const locale of LOCALES) {
    const invite = partnerInviteEmail({ senderName: evil, acceptUrl: "https://app.example.com/?invite=abc" }, locale);
    assert.ok(!invite.html.includes("<script>"));
    assert.ok(invite.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Bob&#39;"));
    assert.ok(invite.text.includes(evil));

    const welcome = welcomeEmail({ name: `<img src=x onerror=alert(1)> Smith` }, locale);
    assert.ok(!welcome.html.includes("<img src=x"));
    assert.ok(welcome.html.includes("&lt;img"));
  }
});

test("a user value containing a placeholder is not re-interpolated", () => {
  const email = welcomeEmail({ name: "{product}" }, "en");
  assert.match(email.subject, /Welcome to LifePlan, \{product\}!/);
});

test("an empty name uses the nameless variant instead of a dangling comma", () => {
  for (const locale of LOCALES) {
    const email = welcomeEmail({ name: "  " }, locale);
    assert.doesNotMatch(email.subject, /, !|,\s*!/);
    const invite = partnerInviteEmail({ senderName: "", acceptUrl: "https://app.example.com/?invite=abc" }, locale);
    assert.ok(invite.subject.startsWith(DICTIONARIES[locale].partnerInvite.fallbackSender));
  }
});

test("links must be http(s) or mailto", () => {
  assert.throws(() => safeUrl("javascript:alert(1)"), /not http\(s\) or mailto/);
  assert.throws(() => partnerInviteEmail({ senderName: "Luis", acceptUrl: "javascript:alert(1)" }, "es"));
  assert.equal(safeUrl("https://a.example/?x=1&y=2"), "https://a.example/?x=1&amp;y=2");
});

test("the Premium price is formatted per locale from integer cents", () => {
  assert.equal(formatMoney(999, "EUR", "es").replace(/\s/g, " "), "9,99 €");
  assert.equal(formatMoney(999, "EUR", "en"), "€9.99");
  const es = subscriptionActivatedEmail({ name: "Ana", renewalDate: new Date(Date.UTC(2026, 10, 23)) }, "es");
  assert.match(es.text, /9,99\s€\/mes/);
  assert.match(es.text, /23 de noviembre de 2026/);
  const en = subscriptionActivatedEmail({ name: "Ana", renewalDate: new Date(Date.UTC(2026, 10, 23)) }, "en");
  assert.match(en.text, /€9\.99\/mo/);
  assert.match(en.text, /23 November 2026/);
});

test("no template hardcodes a euro sign; it only comes from the formatter", () => {
  for (const locale of LOCALES) {
    assert.ok(!leafStrings(DICTIONARIES[locale]).some((s) => s.includes("€")));
  }
});

test("resolveLocale defaults to Spanish", () => {
  assert.equal(resolveLocale(undefined), "es");
  assert.equal(resolveLocale(null), "es");
  assert.equal(resolveLocale("es"), "es");
  assert.equal(resolveLocale("fr"), "es");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("en-GB"), "en");
});

test("fill leaves unknown placeholders visible", () => {
  assert.equal(fill("{a} {b}", { a: "1" }), "1 {b}");
});

test("links in emails use APP_URL at render time", () => {
  const saved = process.env.APP_URL;
  process.env.APP_URL = "https://budget.example.com/";
  try {
    const email = welcomeEmail({ name: "Ana" }, "es");
    assert.ok(email.html.includes('href="https://budget.example.com"'));
    assert.ok(email.text.includes("https://budget.example.com"));
  } finally {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  }
});

test("parseLocale accepts exactly es or en", () => {
  assert.equal(parseLocale("es"), "es");
  assert.equal(parseLocale("en"), "en");
  for (const bad of [undefined, null, "", "EN", "en-GB", " es", "fr", 1, {}, ["es"]]) {
    assert.equal(parseLocale(bad), null, String(bad));
  }
});

test("emails that ask for a reply set Reply-To to the support address; the others do not", () => {
  const date = new Date(Date.UTC(2026, 10, 23));
  for (const locale of LOCALES) {
    assert.equal(subscriptionCancelledEmail({ name: "Ana", accessUntilDate: date }, locale).replyTo, "contact@luisvespa.com");
    assert.equal(paymentFailedEmail({ name: "Ana" }, locale).replyTo, "contact@luisvespa.com");
    assert.equal(subscriptionActivatedEmail({ name: "Ana", renewalDate: date }, locale).replyTo, undefined);
    assert.equal(verificationEmail({ name: "Ana", otp: "1" }, locale).replyTo, undefined);
  }
});

test("a scheme-less APP_URL or bad LOGO_URL does not stop an OTP email; they are left out and logged once", () => {
  const realError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  process.env.APP_URL = "budget.luisvespa.com";
  process.env.LOGO_URL = "javascript:alert(1)";
  try {
    for (const locale of LOCALES) {
      const email = verificationEmail({ name: "Ana", otp: "482915" }, locale);
      assert.ok(email.html.includes("482915"));
      assert.ok(!email.html.includes("budget.luisvespa.com"));
      assert.ok(!email.text.includes("budget.luisvespa.com"));
      assert.ok(!email.html.includes("javascript:"));
      assert.ok(!email.html.includes("<img"));
      assert.ok(passwordResetEmail({ otp: "482915" }, locale).html.includes("482915"));
    }
    // A content link that is the point of the email still refuses a bad URL.
    assert.throws(() => welcomeEmail({ name: "Ana" }, "es"), /not http\(s\) or mailto/);
  } finally {
    console.error = realError;
  }
  const appErrors = errors.filter((e) => e.includes("APP_URL"));
  const logoErrors = errors.filter((e) => e.includes("LOGO_URL"));
  assert.equal(appErrors.length, 1);
  assert.equal(logoErrors.length, 1);
  assert.ok(!errors.some((e) => e.includes("budget.luisvespa.com")));
});

test("a valid LOGO_URL is used in the header", () => {
  process.env.LOGO_URL = "https://cdn.example.com/logo.png";
  assert.ok(verificationEmail({ name: "Ana", otp: "1" }, "es").html.includes('src="https://cdn.example.com/logo.png"'));
});

test("no email promises features the app doesn't have", () => {
  const banned = [/PDF/i, /tiempo real/i, /real-time/i, /insignia/i, /badge/i, /\bIA\b/, /\bAI\b/, /planes de vida/i, /life plans/i, /camino financiero/i, /desconectaros/i];
  const date = new Date(Date.UTC(2026, 10, 23));
  const all = LOCALES.flatMap((l) => [
    welcomeEmail({ name: "Ana" }, l),
    welcomeGoogleEmail({ name: "Ana" }, l),
    partnerInviteEmail({ senderName: "Luis", acceptUrl: "https://app.example.com/?invite=x" }, l),
    subscriptionActivatedEmail({ name: "Ana", renewalDate: date }, l),
    subscriptionCancelledEmail({ name: "Ana", accessUntilDate: date }, l),
    paymentFailedEmail({ name: "Ana" }, l),
  ]);
  for (const email of all) {
    for (const re of banned) assert.doesNotMatch(email.text, re, `${email.subject} matches ${re}`);
  }
});
