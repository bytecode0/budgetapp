// Run with:  node --import tsx --test server/lib/emailClient.test.ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendEmail } from "./emailClient.js";

const ENV_KEYS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN", "EMAIL_FROM"] as const;
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

type Call = { url: string; init: RequestInit };
let calls: Call[];

function stubFetch(body: unknown, status = 200) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const message = { to: "ana@example.com", subject: "Hola", html: "<p>Hola</p>", text: "Hola" };
const ok = { success: true, errors: [], messages: [], result: { delivered: ["ana@example.com"], permanent_bounces: [], queued: [] } };

beforeEach(() => {
  calls = [];
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc123";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "tok456";
  process.env.EMAIL_FROM = "LifePlan <contact@luisvespa.com>";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test("posts to the Cloudflare send endpoint with bearer auth and the message as JSON", async () => {
  stubFetch(ok);
  await sendEmail(message);

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/acc123/email/sending/send");
  assert.equal(init.method, "POST");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok456");
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(init.body)), {
    from: "LifePlan <contact@luisvespa.com>",
    to: "ana@example.com",
    subject: "Hola",
    html: "<p>Hola</p>",
    text: "Hola",
  });
});

test("resolves when the email is delivered", async () => {
  stubFetch(ok);
  await assert.doesNotReject(sendEmail(message));
});

test("resolves when the email is queued", async () => {
  stubFetch({ ...ok, result: { delivered: [], permanent_bounces: [], queued: ["ana@example.com"] } });
  await assert.doesNotReject(sendEmail(message));
});

for (const key of ENV_KEYS) {
  test(`throws a clear error and sends nothing when ${key} is missing`, async () => {
    stubFetch(ok);
    delete process.env[key];
    await assert.rejects(sendEmail(message), new RegExp(`${key} is not set`));
    assert.equal(calls.length, 0);
  });
}

test("throws with Cloudflare's error code and message when success is false", async () => {
  stubFetch({ success: false, errors: [{ code: 10001, message: "sender domain not verified" }], messages: [], result: null }, 400);
  await assert.rejects(sendEmail(message), /10001: sender domain not verified/);
});

test("throws when success is false even on HTTP 200", async () => {
  stubFetch({ success: false, errors: [{ code: 10002, message: "nope" }], messages: [], result: null });
  await assert.rejects(sendEmail(message), /10002: nope/);
});

test("throws when the recipient permanently bounces", async () => {
  stubFetch({ ...ok, result: { delivered: [], permanent_bounces: ["ana@example.com"], queued: [] } });
  await assert.rejects(sendEmail(message), /permanent bounce for ana@example\.com/);
});

test("throws a clear error when the response is not JSON", async () => {
  globalThis.fetch = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch;
  await assert.rejects(sendEmail(message), /HTTP 502 with a non-JSON body/);
});

test("never puts the API token in an error message", async () => {
  stubFetch({ success: false, errors: [{ code: 10000, message: "auth error" }], messages: [], result: null }, 403);
  await assert.rejects(sendEmail(message), (err: Error) => !err.message.includes("tok456"));
});
