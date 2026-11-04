// LPBETA-15/16/17 against a REAL Postgres, through the real routes: the
// rate-limit counter under concurrency, the emailed-code limits, the Google
// sign-in that drops a password nobody verified, and the AI budget. Opt-in:
// skipped unless TEST_DATABASE_URL is set (see
// server/lib/ingest/import.integration.test.ts for the setup). Every table is
// TRUNCATEd, so the host must be localhost. The AI provider is a fake local
// server (ANTHROPIC_BASE_URL): nothing leaves the machine.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("security limits (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let rateLimit: typeof import("./rateLimit.js");
  let googleSignIn: typeof import("./googleSignIn.js").googleSignIn;
  let server: Server;
  let base: string;
  let fakeAi: Server;
  const aiRequests: { merchants: string[] }[] = [];

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);

    // A stand-in for the Anthropic API: records what it was sent and puts
    // every merchant in the first allocation.
    fakeAi = createServer((req, res) => {
      let body = "";
      req.on("data", c => { body += c; });
      req.on("end", () => {
        const sent = JSON.parse(JSON.parse(body).messages[0].content) as { allocations?: { id: string }[]; merchants: string[] };
        aiRequests.push({ merchants: sent.merchants });
        const classifications = sent.merchants.map(merchant => ({ merchant, allocationId: sent.allocations?.[0]?.id ?? null }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_test", type: "message", role: "assistant", model: "test", stop_reason: "tool_use", stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "tool_use", id: "tu_test", name: "submit", input: { classifications } }],
        }));
      });
    });
    fakeAi.listen(0);
    await new Promise<void>(resolve => fakeAi.once("listening", () => resolve()));

    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "integration-test-secret";
    process.env.NODE_ENV = "test";
    process.env.EMAIL_PROVIDER = "console";
    process.env.EMAIL_FROM = "LifePlan <test@example.com>";
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    process.env.AI_PROVIDER = "anthropic"; // suggest-mapping (server/lib/ai/index.ts); never reached over the limit
    process.env.AI_MODEL_IMPORT_MAPPING = "test-model";
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fakeAi.address() as AddressInfo).port}`;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    rateLimit = await import("./rateLimit.js");
    ({ googleSignIn } = await import("./googleSignIn.js"));
    const app = (await import("../app.js")).default;

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.some(t => t.tablename === "RateLimitHit"), "schema not pushed to the test database");
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"public"."${t.tablename}"`).join(", ")} CASCADE`);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()));
    await new Promise<void>(resolve => fakeAi?.close(() => resolve()));
    await prisma?.$disconnect();
  });

  // Every request here comes from the same IP: each test starts with fresh counters.
  beforeEach(async () => {
    await prisma.rateLimitHit.deleteMany({});
  });

  // The email transport logs every message; keep the test output readable.
  async function quiet<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    console.log = () => {};
    try { return await fn(); } finally { console.log = log; }
  }

  async function post(path: string, body: unknown, userId?: string) {
    const res = await quiet(() => fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(userId && { cookie: `token=${signToken({ userId })}` }) },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  }

  it("counts every hit exactly once under concurrency, and deletes old windows", async () => {
    const store = rateLimit.prismaRateLimitStore(prisma);
    const windowStart = new Date("2026-11-04T10:00:00Z");
    const counts = await Promise.all(Array.from({ length: 25 }, () => store.increment("t:concurrent", windowStart)));
    assert.deepEqual([...counts].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));

    await store.increment("t:old", new Date("2026-11-01T10:00:00Z"));
    await store.deleteOlderThan(new Date("2026-11-02T10:00:00Z"));
    const keys = (await prisma.rateLimitHit.findMany()).map(r => r.key);
    assert.deepEqual(keys, ["t:concurrent"]);
  });

  it("send-reset: the fourth request in an hour sends nothing, and answers like an unknown email", async () => {
    await prisma.user.create({ data: { email: "reset@test.local", emailVerified: new Date(), passwordHash: "x" } });
    const unknown = await post("/api/auth/send-reset", { email: "nobody@test.local" });

    const tokenIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await post("/api/auth/send-reset", { email: "reset@test.local" });
      assert.deepEqual(r, unknown, `request ${i + 1} answers like an unknown email`);
      const tokens = await prisma.otpToken.findMany({ where: { email: "reset@test.local", type: "password_reset" } });
      assert.equal(tokens.length, 1);
      tokenIds.push(tokens[0].id);
    }
    assert.equal(new Set(tokenIds.slice(0, 3)).size, 3, "the first three each made a new code");
    assert.equal(tokenIds[3], tokenIds[2], "the fourth made none");
  });

  it("resend-otp: over the limit answers like an unknown email; a bad type is refused", async () => {
    await prisma.user.create({ data: { email: "resend@test.local", passwordHash: "x" } });
    const unknown = await post("/api/auth/resend-otp", { email: "nobody@test.local", type: "email_verification" });
    for (let i = 0; i < 3; i++) await post("/api/auth/resend-otp", { email: "resend@test.local", type: "email_verification" });
    const before = await prisma.otpToken.findFirst({ where: { email: "resend@test.local" } });
    await prisma.otpToken.updateMany({ where: { email: "resend@test.local" }, data: { createdAt: new Date(Date.now() - 120_000) } });
    assert.deepEqual(await post("/api/auth/resend-otp", { email: "resend@test.local", type: "email_verification" }), unknown);
    const afterLimit = await prisma.otpToken.findFirst({ where: { email: "resend@test.local" } });
    assert.equal(afterLimit?.id, before?.id, "no new code over the limit");

    assert.equal((await post("/api/auth/resend-otp", { email: "resend@test.local", type: "anything" })).status, 400);
  });

  it("register: the fourth code in an hour is a 429 rate_limited", async () => {
    const body = { name: "Reg", email: "reg@test.local", password: "password123" };
    for (let i = 0; i < 3; i++) assert.equal((await post("/api/auth/register", body)).status, 200);
    const r = await post("/api/auth/register", body);
    assert.equal(r.status, 429);
    assert.equal(r.body.code, "rate_limited");
  });

  it("one IP can't request codes for many addresses", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < rateLimit.CODE_IP_HOURLY.limit + 1; i++) {
      statuses.push((await post("/api/auth/register", { name: "N", email: `ip${i}@test.local`, password: "password123" })).status);
    }
    assert.deepEqual(statuses.slice(0, -1), Array(rateLimit.CODE_IP_HOURLY.limit).fill(200));
    assert.equal(statuses.at(-1), 429);
  });

  it("Google: a password set on an unverified account stops working once Google verifies it", async () => {
    // The attacker registers the friend's email with their own password.
    assert.equal((await post("/api/auth/register", { name: "Attacker", email: "friend@test.local", password: "attacker-pass" })).status, 200);
    const login = () => post("/api/auth/login", { email: "friend@test.local", password: "attacker-pass" });
    assert.equal((await login()).body.code, "EMAIL_NOT_VERIFIED", "the password is right, only unverified");

    // Google says the email isn't verified: nothing changes.
    assert.deepEqual(await googleSignIn(prisma, { email: "friend@test.local", verified_email: false }), { error: "unverified" });
    assert.equal((await prisma.user.findUnique({ where: { email: "friend@test.local" } }))?.emailVerified, null);

    // The friend signs in with Google.
    const result = await googleSignIn(prisma, { email: "friend@test.local", name: "Friend", verified_email: true });
    assert.ok("userId" in result && !result.isNewUser);
    const user = await prisma.user.findUnique({ where: { email: "friend@test.local" } });
    assert.ok(user?.emailVerified);
    assert.equal(user?.passwordHash, null);
    const r = await login();
    assert.equal(r.status, 401, "the attacker's password no longer signs in");

    // And registering again can't put a password back on the verified account.
    assert.equal((await post("/api/auth/register", { name: "Attacker", email: "friend@test.local", password: "attacker-pass" })).status, 409);
  });

  it("Google keeps the password of an account its owner already verified", async () => {
    const passwordHash = await bcrypt.hash("owner-pass", 4);
    await prisma.user.create({ data: { email: "owner@test.local", emailVerified: new Date(), passwordHash } });
    await googleSignIn(prisma, { email: "owner@test.local", verified_email: true });
    const r = await post("/api/auth/login", { email: "owner@test.local", password: "owner-pass" });
    assert.equal(r.status, 200);
  });

  it("AI: a long merchant reaches the AI cut to 100 characters; the 31st call in the hour is a 429", async () => {
    const user = await prisma.user.create({ data: { email: "ai@test.local", emailVerified: new Date() } });
    const allocation = await prisma.allocation.create({ data: { userId: user.id, name: "Super" } });
    const long = "MERCADONA VALENCIA ".repeat(500);

    aiRequests.length = 0;
    const first = await post("/api/expenses/import/classify", { merchants: [long, "Repsol"] }, user.id);
    assert.equal(first.status, 200);
    assert.deepEqual(aiRequests[0].merchants, [long.slice(0, 100), "Repsol"]);
    assert.deepEqual(first.body.suggestions, [
      { merchant: long, allocationId: allocation.id, name: "Super" },
      { merchant: "Repsol", allocationId: allocation.id, name: "Super" },
    ], "the suggestion comes back under the name the client sent");

    for (let i = 1; i < rateLimit.AI_HOURLY.limit; i++) {
      const path = i % 2 ? "/api/expenses/import/suggest-categories" : "/api/expenses/import/classify";
      assert.equal((await post(path, { merchants: ["Repsol"] }, user.id)).status, 200, `call ${i + 1}`);
    }
    const calls = aiRequests.length;
    const over = await post("/api/expenses/import/classify", { merchants: ["Repsol"] }, user.id);
    assert.equal(over.status, 429);
    assert.equal(over.body.code, "rate_limited");
    assert.equal(aiRequests.length, calls, "the AI wasn't called");

    const mapping = await post("/api/expenses/import/suggest-mapping", { headers: ["Fecha", "Importe"], headerShapes: ["TEXT(5)", "TEXT(7)"], shapes: [["dd/mm/yyyy", "-#,##"]] }, user.id);
    assert.equal(mapping.status, 429, "suggest-mapping shares the budget");
    assert.equal(mapping.body.code, "rate_limited");
  });
});
