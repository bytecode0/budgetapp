// Run with:  node --import tsx --test server/lib/email/transports/cloudflare.test.ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendEmail } from "../index.js";
import { parseSender } from "../sender.js";

const ENV_KEYS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN", "EMAIL_FROM"] as const;
const SAVED_KEYS = [...ENV_KEYS, "EMAIL_PROVIDER"] as const;
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

function sentBody() {
  return JSON.parse(String(calls[0].init.body));
}

const message = { to: "ana@example.com", subject: "Hola", html: "<p>Hola</p>", text: "Hola" };
const result = (r: Partial<Record<"delivered" | "queued" | "permanent_bounces" | "suppressed_recipients", string[]>>) => ({
  success: true,
  errors: [],
  messages: [],
  result: { delivered: [], permanent_bounces: [], queued: [], ...r },
});
const ok = result({ delivered: ["ana@example.com"] });

beforeEach(() => {
  calls = [];
  for (const k of SAVED_KEYS) savedEnv[k] = process.env[k];
  process.env.EMAIL_PROVIDER = "cloudflare";
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc123";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "tok456";
  process.env.EMAIL_FROM = "LifePlan <contact@luisvespa.com>";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of SAVED_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test("posts to the Cloudflare send endpoint with bearer auth, a timeout and the message as JSON", async () => {
  stubFetch(ok);
  await sendEmail(message);

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/acc123/email/sending/send");
  assert.equal(init.method, "POST");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok456");
  assert.equal(headers["Content-Type"], "application/json");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(sentBody(), {
    from: { address: "contact@luisvespa.com", name: "LifePlan" },
    to: "ana@example.com",
    subject: "Hola",
    html: "<p>Hola</p>",
    text: "Hola",
  });
});

test("sends a bare EMAIL_FROM address as a plain string", async () => {
  process.env.EMAIL_FROM = "contact@luisvespa.com";
  stubFetch(ok);
  await sendEmail(message);
  assert.equal(sentBody().from, "contact@luisvespa.com");
});

test("parseSender handles named, quoted, bare and invalid senders", () => {
  assert.deepEqual(parseSender("LifePlan <contact@luisvespa.com>"), { address: "contact@luisvespa.com", name: "LifePlan" });
  assert.deepEqual(parseSender('"Life Plan" <contact@luisvespa.com>'), { address: "contact@luisvespa.com", name: "Life Plan" });
  assert.deepEqual(parseSender("<contact@luisvespa.com>"), { address: "contact@luisvespa.com" });
  assert.deepEqual(parseSender("  contact@luisvespa.com "), { address: "contact@luisvespa.com" });
  for (const bad of ["LifePlan", "LifePlan <contact>", "a b@c.d", "LifePlan contact@luisvespa.com"]) {
    assert.throws(() => parseSender(bad), /EMAIL_FROM must be/);
  }
});

test("throws a clear error and sends nothing when EMAIL_FROM cannot be parsed", async () => {
  process.env.EMAIL_FROM = "LifePlan";
  stubFetch(ok);
  await assert.rejects(sendEmail(message), /EMAIL_FROM must be/);
  assert.equal(calls.length, 0);
});

test("resolves when the email is delivered", async () => {
  stubFetch(ok);
  await assert.doesNotReject(sendEmail(message));
});

test("resolves when the email is queued", async () => {
  stubFetch(result({ queued: ["ana@example.com"] }));
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

test("sends reply_to only when the message has a replyTo", async () => {
  stubFetch(ok);
  await sendEmail({ ...message, replyTo: "support@example.com" });
  assert.equal(sentBody().reply_to, "support@example.com");
});

test("strips addresses that Cloudflare echoes in its error text", async () => {
  stubFetch({ success: false, errors: [{ code: 10003, message: "recipient ana@example.com is invalid" }], messages: [], result: null }, 400);
  await assert.rejects(sendEmail(message), (err: Error) =>
    /10003: recipient \[address\] is invalid/.test(err.message) && !err.message.includes("ana@example.com"));
});

test("throws on a permanent bounce, without naming the recipient", async () => {
  stubFetch(result({ permanent_bounces: ["ana@example.com"] }));
  await assert.rejects(sendEmail(message), (err: Error) =>
    /1 permanent bounce/.test(err.message) && !err.message.includes("ana@example.com"));
});

test("throws when the recipient is on the suppression list, without naming it", async () => {
  stubFetch(result({ suppressed_recipients: ["ana@example.com"] }));
  await assert.rejects(sendEmail(message), (err: Error) =>
    /1 suppressed/.test(err.message) && !err.message.includes("ana@example.com"));
});

test("throws when the recipient is neither delivered nor queued", async () => {
  stubFetch(result({ delivered: ["someone-else@example.com"] }));
  await assert.rejects(sendEmail(message), /did not accept the recipient/);
});

test("throws when success is true but result is null", async () => {
  stubFetch({ success: true, errors: [], messages: [], result: null });
  await assert.rejects(sendEmail(message), /did not accept the recipient/);
});

test("throws a clear error when the request times out", async () => {
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;
  await assert.rejects(sendEmail(message), /did not respond within 10s/);
});

test("throws a clear error when the response is not JSON", async () => {
  globalThis.fetch = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch;
  await assert.rejects(sendEmail(message), /HTTP 502 with a non-JSON body/);
});

test("never puts the API token in an error message", async () => {
  stubFetch({ success: false, errors: [{ code: 10000, message: "auth error" }], messages: [], result: null }, 403);
  await assert.rejects(sendEmail(message), (err: Error) => !err.message.includes("tok456"));
});
