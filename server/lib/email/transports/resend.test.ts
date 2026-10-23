// Run with:  node --import tsx --test server/lib/email/transports/resend.test.ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendEmail } from "../index.js";
import { formatResendSender } from "./resend.js";

const ENV_KEYS = ["EMAIL_PROVIDER", "EMAIL_FROM", "RESEND_API_KEY"] as const;
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

const sentBody = () => JSON.parse(String(calls[0].init.body));
const message = { to: "ana@example.com", subject: "Hola", html: "<p>Hola</p>", text: "Hola" };
const ok = { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" };

beforeEach(() => {
  calls = [];
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_FROM = "LifePlan <contact@luisvespa.com>";
  process.env.RESEND_API_KEY = "re_tok456";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test("posts to /emails with bearer auth, a User-Agent, a timeout and the message as JSON", async () => {
  stubFetch(ok);
  const result = await sendEmail(message);

  assert.deepEqual(result, ok);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(init.method, "POST");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer re_tok456");
  assert.equal(headers["Content-Type"], "application/json");
  assert.ok(headers["User-Agent"]);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(sentBody(), {
    from: "LifePlan <contact@luisvespa.com>",
    to: "ana@example.com",
    subject: "Hola",
    html: "<p>Hola</p>",
    text: "Hola",
  });
});

test("sends reply_to only when the message has a replyTo", async () => {
  stubFetch(ok);
  await sendEmail({ ...message, replyTo: "support@example.com" });
  assert.equal(sentBody().reply_to, "support@example.com");
});

test("sends a bare EMAIL_FROM address as is", async () => {
  process.env.EMAIL_FROM = "contact@luisvespa.com";
  stubFetch(ok);
  await sendEmail(message);
  assert.equal(sentBody().from, "contact@luisvespa.com");
});

test("formatResendSender quotes display names with special characters", () => {
  assert.equal(formatResendSender({ address: "a@b.co", name: "Life Plan" }), "Life Plan <a@b.co>");
  assert.equal(formatResendSender({ address: "a@b.co", name: "Planificación Vital" }), "Planificación Vital <a@b.co>");
  assert.equal(formatResendSender({ address: "a@b.co", name: "Life, Plan" }), '"Life, Plan" <a@b.co>');
  assert.equal(formatResendSender({ address: "a@b.co", name: 'Say "hi"' }), '"Say \\"hi\\"" <a@b.co>');
});

test("maps a Resend error to its name and message, with the HTTP status", async () => {
  stubFetch({ statusCode: 422, name: "validation_error", message: "Invalid `from` field." }, 422);
  await assert.rejects(sendEmail(message), /Resend rejected the email \(HTTP 422\): validation_error: Invalid `from` field\./);
});

test("maps a quota error", async () => {
  stubFetch({ statusCode: 429, name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }, 429);
  await assert.rejects(sendEmail(message), /HTTP 429\): daily_quota_exceeded/);
});

test("strips addresses that Resend echoes in its error text", async () => {
  stubFetch({ statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address (owner@example.com)." }, 403);
  await assert.rejects(sendEmail(message), (err: Error) =>
    /\[address\]/.test(err.message) && !err.message.includes("owner@example.com") && !err.message.includes("ana@example.com"));
});

test("an error without details still throws with the status", async () => {
  stubFetch({}, 500);
  await assert.rejects(sendEmail(message), /HTTP 500\): no error details/);
});

test("a 2xx without an id is a failed send", async () => {
  stubFetch({});
  await assert.rejects(sendEmail(message), /without an email id/);
});

test("throws a clear error when the request times out", async () => {
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;
  await assert.rejects(sendEmail(message), /Resend did not respond within 10s/);
});

test("throws a clear error when the response is not JSON", async () => {
  globalThis.fetch = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch;
  await assert.rejects(sendEmail(message), /Resend returned HTTP 502 with a non-JSON body/);
});

test("never puts the API key in an error message", async () => {
  stubFetch({ statusCode: 401, name: "missing_api_key", message: "Missing API key in the authorization header." }, 401);
  await assert.rejects(sendEmail(message), (err: Error) => !err.message.includes("re_tok456"));
});
