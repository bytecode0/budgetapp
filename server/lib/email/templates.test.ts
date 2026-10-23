// Run with:  node --import tsx --test server/lib/email/templates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, safeUrl } from "./components.js";
import { formatMoney } from "./format.js";
import { DICTIONARIES, fill, resolveLocale, type EmailLocale } from "./locales/index.js";
import { EMAIL_SAMPLES } from "./samples.js";
import { partnerInviteEmail, subscriptionActivatedEmail, verificationEmail, welcomeEmail } from "./templates/index.js";

const LOCALES: EmailLocale[] = ["es", "en"];

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
      for (const value of sample.mustContain) {
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
