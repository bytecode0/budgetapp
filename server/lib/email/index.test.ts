// Run with:  node --import tsx --test server/lib/email/index.test.ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendEmail } from "./index.js";

const ENV_KEYS = [
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "NODE_ENV",
] as const;
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const realLog = console.log;

let urls: string[];
let logged: string[];

const message = { to: "ana@example.com", subject: "Hola", html: "<p>Hola</p>", text: "Tu código: 123456" };

beforeEach(() => {
  urls = [];
  logged = [];
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.EMAIL_FROM = "LifePlan <contact@luisvespa.com>";
  process.env.RESEND_API_KEY = "re_secret_key";
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc123";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "cf_secret_token";
  process.env.NODE_ENV = "development";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const body = url.includes("resend")
      ? { id: "re-1" }
      : { success: true, errors: [], result: { delivered: [message.to] } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const noSecret = (err: Error) =>
  !err.message.includes("re_secret_key") && !err.message.includes("cf_secret_token");

test("EMAIL_PROVIDER=resend sends through Resend", async () => {
  process.env.EMAIL_PROVIDER = "resend";
  assert.deepEqual(await sendEmail(message), { id: "re-1" });
  assert.deepEqual(urls, ["https://api.resend.com/emails"]);
});

test("EMAIL_PROVIDER=cloudflare sends through Cloudflare", async () => {
  process.env.EMAIL_PROVIDER = "cloudflare";
  await sendEmail(message);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/api\.cloudflare\.com\//);
});

test("the provider is read at send time and is case-insensitive", async () => {
  process.env.EMAIL_PROVIDER = "cloudflare";
  await sendEmail(message);
  process.env.EMAIL_PROVIDER = " Resend ";
  await sendEmail(message);
  assert.match(urls[0], /cloudflare/);
  assert.match(urls[1], /resend/);
});

test("a missing EMAIL_PROVIDER throws a clear error and sends nothing", async () => {
  delete process.env.EMAIL_PROVIDER;
  await assert.rejects(sendEmail(message), /EMAIL_PROVIDER is not set \(expected resend \| cloudflare \| console\)/);
  assert.equal(urls.length, 0);
});

test("an unknown EMAIL_PROVIDER throws without echoing its value", async () => {
  process.env.EMAIL_PROVIDER = "re_looks_like_a_key";
  await assert.rejects(sendEmail(message), (err: Error) =>
    /not a known provider/.test(err.message) && !err.message.includes("re_looks_like_a_key"));
  process.env.EMAIL_PROVIDER = "constructor";
  await assert.rejects(sendEmail(message), /not a known provider/);
  assert.equal(urls.length, 0);
});

test("a missing RESEND_API_KEY throws a clear error and sends nothing", async () => {
  process.env.EMAIL_PROVIDER = "resend";
  delete process.env.RESEND_API_KEY;
  await assert.rejects(sendEmail(message), /RESEND_API_KEY is not set/);
  assert.equal(urls.length, 0);
});

test("a missing Cloudflare key throws a clear error and sends nothing", async () => {
  process.env.EMAIL_PROVIDER = "cloudflare";
  delete process.env.CLOUDFLARE_EMAIL_API_TOKEN;
  await assert.rejects(sendEmail(message), /CLOUDFLARE_EMAIL_API_TOKEN is not set/);
  assert.equal(urls.length, 0);
});

test("a missing EMAIL_FROM throws for every provider, with no fallback sender", async () => {
  delete process.env.EMAIL_FROM;
  for (const provider of ["resend", "cloudflare", "console"]) {
    process.env.EMAIL_PROVIDER = provider;
    await assert.rejects(sendEmail(message), /EMAIL_FROM is not set/);
  }
  assert.equal(urls.length, 0);
  assert.equal(logged.length, 0);
});

test("provider errors never contain the API key", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ statusCode: 401, name: "validation_error", message: "API key is invalid" }), { status: 401 })) as typeof fetch;
  process.env.EMAIL_PROVIDER = "resend";
  await assert.rejects(sendEmail(message), noSecret);
});

test("EMAIL_PROVIDER=console logs the message and makes no network call", async () => {
  process.env.EMAIL_PROVIDER = "console";
  assert.deepEqual(await sendEmail(message), { id: "console" });
  assert.equal(urls.length, 0);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Subject: Hola/);
  assert.match(logged[0], /Tu código: 123456/);
});

test("the console transport is refused when NODE_ENV=production", async () => {
  process.env.EMAIL_PROVIDER = "console";
  process.env.NODE_ENV = "production";
  await assert.rejects(sendEmail(message), /refused when NODE_ENV=production/);
  assert.equal(logged.length, 0);
});
