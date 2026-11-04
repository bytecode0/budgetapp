// Who can be named on the household's money, against a REAL Postgres
// (LPBETA-23): an expense's payer, beneficiary and share holders, and an
// account's new owner, must be ACTIVE members of the caller's household — or
// the caller themself when there is no household. Opt-in like the other
// integration tests: skipped unless TEST_DATABASE_URL is set; every table is
// TRUNCATEd, so localhost only.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/budget_test npm run test:integration
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("payer, split and account owner (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let createDefaultAllocations: typeof import("./defaults.js").createDefaultAllocations;
  let server: Server;
  let base: string;

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "integration-test-secret";
    process.env.NODE_ENV = "test";
    process.env.EMAIL_PROVIDER = "console";
    process.env.EMAIL_FROM = "LifePlan <test@example.com>";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    ({ createDefaultAllocations } = await import("./defaults.js"));
    const app = (await import("../app.js")).default;

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.length > 0, "schema not pushed to the test database");
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(", ")} CASCADE`);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    await prisma?.$disconnect();
  });

  async function call(userId: string, method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        cookie: `token=${signToken({ userId })}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() as Record<string, any> };
  }

  async function ok(userId: string, method: string, path: string, body?: unknown) {
    const r = await call(userId, method, path, body);
    assert.equal(r.status, 200, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async function refused(userId: string, method: string, path: string, body: unknown) {
    const r = await call(userId, method, path, body);
    assert.equal(r.status, 400, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, "not_household_member");
  }

  let seq = 0;
  async function signUp(name: string) {
    const email = `${name.toLowerCase()}${++seq}@test.local`;
    const user = await prisma.user.create({ data: { name, email, emailVerified: new Date() } });
    await createDefaultAllocations(user.id, "es");
    return { id: user.id, email };
  }

  /** A (owner) and B (member) in one household, plus C, a stranger to it. */
  async function people() {
    const A = await signUp("Ana");
    const B = await signUp("Bea");
    const C = await signUp("Carla");
    await ok(A.id, "POST", "/api/partner/invite", { email: B.email });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: A.id, status: "pending" } });
    await ok(B.id, "POST", "/api/partner/accept", { token: inv.token });
    const householdId = (await ok(A.id, "GET", "/api/households/current")).household.id as string;
    return { A: A.id, B: B.id, C: C.id, householdId };
  }

  const setStatus = (householdId: string, userId: string, status: string) =>
    prisma.householdMember.update({ where: { householdId_userId: { householdId, userId } }, data: { status } });

  it("an expense's payer and beneficiary must be active members of the household", async () => {
    const p = await people();
    const before = await prisma.expense.count();
    await refused(p.A, "POST", "/api/expenses", { amount: 10, description: "x", payerUserId: p.C });
    await refused(p.A, "POST", "/api/expenses", { amount: 10, description: "x", scope: "personal", beneficiaryUserId: p.C });
    await refused(p.A, "POST", "/api/expenses", { amount: 10, description: "x", payerUserId: { id: p.B } });
    assert.equal(await prisma.expense.count(), before, "nothing was written");

    const made = (await ok(p.A, "POST", "/api/expenses", { amount: 10, description: "x", payerUserId: p.B, scope: "shared" })).expense;
    assert.equal(made.payerUserId, p.B);

    // A member who is only invited, or who left, can't be named either.
    for (const status of ["invited", "left"]) {
      await setStatus(p.householdId, p.B, status);
      await refused(p.A, "POST", "/api/expenses", { amount: 10, description: "x", payerUserId: p.B });
      await refused(p.A, "PATCH", `/api/expenses/${made.id}/attribution`, { payerUserId: p.B });
    }
    await setStatus(p.householdId, p.B, "active");
  });

  it("a split names only active members, and a refused one leaves the expense as it was", async () => {
    const p = await people();
    const id = (await ok(p.A, "POST", "/api/expenses", { amount: 30, description: "Cena", scope: "personal" })).expense.id;
    const path = `/api/expenses/${id}/attribution`;

    await refused(p.A, "PATCH", path, { scope: "shared", shares: [{ userId: p.A, amount: 15 }, { userId: p.C, amount: 15 }] });
    await refused(p.A, "PATCH", path, { scope: "shared", shares: [{ userId: p.A, amount: 30 }, { amount: 0 }] });
    await refused(p.A, "PATCH", path, { scope: "personal", beneficiaryUserId: p.C });
    const dup = await call(p.A, "PATCH", path, { scope: "shared", shares: [{ userId: p.A, amount: 15 }, { userId: p.A, amount: 15 }] });
    assert.equal(dup.status, 400);
    // Shares that don't add up are refused before the scope is written.
    const short = await call(p.A, "PATCH", path, { scope: "shared", shares: [{ userId: p.A, amount: 10 }, { userId: p.B, amount: 10 }] });
    assert.equal(short.status, 400);

    const row = await prisma.expense.findUniqueOrThrow({ where: { id }, include: { shares: true } });
    assert.equal(row.scope, "personal", "no refused call changed the expense");
    assert.equal(row.shares.length, 0);

    const done = (await ok(p.A, "PATCH", path, { scope: "shared", shares: [{ userId: p.A, amount: 20 }, { userId: p.B, amount: 10 }] })).expense;
    assert.equal(done.scope, "shared");
    assert.equal(done.shares.length, 2);
  });

  it("without a household, the only person to name is the caller", async () => {
    const S = (await signUp("Sol")).id;
    const other = (await signUp("Otro")).id;
    await refused(S, "POST", "/api/expenses", { amount: 5, description: "x", payerUserId: other });
    const mine = (await ok(S, "POST", "/api/expenses", { amount: 5, description: "x", payerUserId: S })).expense;
    assert.equal(mine.payerUserId, S);

    const account = await prisma.account.findFirstOrThrow({ where: { userId: S } });
    await refused(S, "PATCH", `/api/accounts/${account.id}`, { ownerUserId: other });
    await ok(S, "PATCH", `/api/accounts/${account.id}`, { ownerUserId: S });
  });

  it("an account can only be handed to an active member", async () => {
    const p = await people();
    const account = await prisma.account.findFirstOrThrow({ where: { userId: p.A, ownerUserId: p.A, type: "checking" } });
    const path = `/api/accounts/${account.id}`;

    await refused(p.A, "PATCH", path, { ownerUserId: p.C });
    await refused(p.A, "PATCH", path, { ownerUserId: 42 });
    for (const status of ["invited", "left"]) {
      await setStatus(p.householdId, p.B, status);
      await refused(p.A, "PATCH", path, { ownerUserId: p.B });
    }
    assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).ownerUserId, p.A);

    await setStatus(p.householdId, p.B, "active");
    await ok(p.A, "PATCH", path, { ownerUserId: p.B });
    assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).ownerUserId, p.B);
  });
});
