// Run with:  node --import tsx --test server/lib/ai/index.test.ts
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { aiAvailable, AiUnavailableError, complete } from "./index.js";
import { OPENROUTER_URL } from "./transports/openrouter.js";

const ENV_KEYS = ["AI_PROVIDER", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "AI_MODEL_IMPORT_MAPPING", "APP_URL"] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const KEY = "sk-or-v1-secret0123456789abcdef";

type Call = { url: string; init: RequestInit };
let calls: Call[];

function stubFetch(body: unknown, status = 200) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const req = { system: "Map columns.", prompt: "{\"headers\":[\"Fecha\"]}", json: true, maxTokens: 300 };

beforeEach(() => {
  calls = [];
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = KEY;
  process.env.AI_MODEL_IMPORT_MAPPING = "some/model:free";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("unavailable without provider, key or model — no default, no call", async () => {
  stubFetch({});
  const cases: [string, () => void][] = [
    ["no provider", () => delete process.env.AI_PROVIDER],
    ["none", () => { process.env.AI_PROVIDER = "none"; }],
    ["unknown provider", () => { process.env.AI_PROVIDER = "sk-oops-pasted-a-key"; }],
    ["no key", () => delete process.env.OPENROUTER_API_KEY],
    ["no model", () => delete process.env.AI_MODEL_IMPORT_MAPPING],
    ["other provider's key only", () => { process.env.AI_PROVIDER = "anthropic"; }],
  ];
  for (const [what, setup] of cases) {
    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = KEY;
    process.env.AI_MODEL_IMPORT_MAPPING = "some/model:free";
    setup();
    assert.equal(aiAvailable("importMapping"), false, what);
    await assert.rejects(complete("importMapping", req), (e: Error) => {
      assert.ok(e instanceof AiUnavailableError, what);
      assert.ok(!e.message.includes("sk-oops"), "the provider value is not echoed");
      return true;
    });
  }
  assert.equal(calls.length, 0);
});

test("config is read at call time", () => {
  delete process.env.AI_PROVIDER;
  assert.equal(aiAvailable("importMapping"), false);
  process.env.AI_PROVIDER = "OpenRouter";
  assert.equal(aiAvailable("importMapping"), true);
});

test("openrouter: chat completions with bearer auth, model, JSON mode, timeout and app headers", async () => {
  process.env.APP_URL = "https://budget.example.com/some/path";
  stubFetch({ choices: [{ message: { content: "{\"date\":\"Fecha\"}" } }] });
  const out = await complete("importMapping", req);
  assert.equal(out, "{\"date\":\"Fecha\"}");
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, OPENROUTER_URL);
  assert.equal(init.method, "POST");
  const h = init.headers as Record<string, string>;
  assert.equal(h.Authorization, `Bearer ${KEY}`);
  assert.equal(h["HTTP-Referer"], "https://budget.example.com");
  assert.equal(h["X-Title"], "LifePlan");
  assert.ok(init.signal instanceof AbortSignal);
  const body = JSON.parse(String(init.body));
  assert.equal(body.model, "some/model:free");
  assert.deepEqual(body.messages, [{ role: "system", content: "Map columns." }, { role: "user", content: req.prompt }]);
  assert.equal(body.max_tokens, 300);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("openrouter: no Referer header when APP_URL is missing or not a URL", async () => {
  process.env.APP_URL = "not a url";
  stubFetch({ choices: [{ message: { content: "{}" } }] });
  await complete("importMapping", req);
  assert.equal((calls[0].init.headers as Record<string, string>)["HTTP-Referer"], undefined);
});

test("openrouter: errors carry the status and message, never the key", async () => {
  stubFetch({ error: { message: `Invalid key ${KEY} (also sk-ant-api03-zzzzzzzzzzzz)`, code: 401 } }, 401);
  await assert.rejects(complete("importMapping", req), (e: Error) => {
    assert.match(e.message, /HTTP 401/);
    assert.ok(!e.message.includes(KEY), e.message);
    assert.ok(!e.message.includes("sk-ant-api03"), e.message);
    return true;
  });
});

test("openrouter: a timeout, a non-JSON body and an empty answer throw clear errors", async () => {
  globalThis.fetch = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch;
  await assert.rejects(complete("importMapping", req), /did not respond within 10s/);
  globalThis.fetch = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
  await assert.rejects(complete("importMapping", req), /HTTP 502 with a non-JSON body/);
  stubFetch({ choices: [] });
  await assert.rejects(complete("importMapping", req), /no content/);
});

test("timeout is capped at 10 s whatever the caller asks; shorter is kept", async () => {
  globalThis.fetch = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch;
  await assert.rejects(complete("importMapping", { ...req, timeoutMs: 60_000 }), /within 10s/);
  await assert.rejects(complete("importMapping", { ...req, timeoutMs: 5_000 }), /within 5s/);
});

test("anthropic: the Messages API through the SDK, with the key as x-api-key", async () => {
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-0123456789";
  process.env.AI_MODEL_IMPORT_MAPPING = "claude-haiku-4-5";
  stubFetch({
    id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5", stop_reason: "end_turn", stop_sequence: null,
    content: [{ type: "text", text: "{\"date\":\"Fecha\"}" }], usage: { input_tokens: 1, output_tokens: 1 },
  });
  assert.equal(await complete("importMapping", req), "{\"date\":\"Fecha\"}");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.anthropic\.com\/v1\/messages/);
  const headers = new Headers(calls[0].init.headers as HeadersInit);
  assert.equal(headers.get("x-api-key"), "sk-ant-test-0123456789");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, "claude-haiku-4-5");
  assert.equal(body.system, "Map columns.");
});

test("anthropic: errors never contain the key", async () => {
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-0123456789";
  stubFetch({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key sk-ant-test-0123456789" } }, 401);
  await assert.rejects(complete("importMapping", req), (e: Error) => {
    assert.match(e.message, /HTTP 401/);
    assert.ok(!e.message.includes("sk-ant-test-0123456789"), e.message);
    return true;
  });
});
