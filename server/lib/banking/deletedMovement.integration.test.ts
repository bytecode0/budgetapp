// A bank movement the user deletes stays deleted (production bug, Nov 2026):
// a Bizum from a partner came in by bank sync as income; deleting it in
// Activity removed the row, but the next sync read the same days again
// (the cursor stays OVERLAP_DAYS back), found the movement "new" and wrote it
// again, so the 200 € came back in every income total. Against a REAL
// Postgres; opt-in, skipped unless TEST_DATABASE_URL is set.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55443/budget_test npm run test:integration
//
// The database must be a throwaway local one with the schema pushed: every
// table is TRUNCATEd at the start, so the host must be localhost (asserted).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { BankingProviderClient, BankProviderTxn } from "./types.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("a deleted bank movement stays deleted (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("../prisma.js").prisma;
  let signToken: typeof import("../jwt.js").signToken;
  let createDefaultAllocations: typeof import("../defaults.js").createDefaultAllocations;
  let periodLib: typeof import("../period.js");
  let syncAccount: typeof import("./sync.js").syncAccount;
  let applyLinks: typeof import("./link.js").applyLinks;
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
    process.env.EMAIL_FROM = "Remanso <test@example.com>";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;

    ({ prisma } = await import("../prisma.js"));
    ({ signToken } = await import("../jwt.js"));
    ({ createDefaultAllocations } = await import("../defaults.js"));
    periodLib = await import("../period.js");
    ({ syncAccount } = await import("./sync.js"));
    ({ applyLinks } = await import("./link.js"));
    const app = (await import("../../app.js")).default;

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
    return { status: res.status, body: await res.json() as any };
  }

  async function ok(userId: string, method: string, path: string, body?: unknown) {
    const r = await call(userId, method, path, body);
    assert.equal(r.status, 200, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** A provider that always returns the same booked movements. */
  function fakeBank(txns: BankProviderTxn[]): BankingProviderClient {
    const unused = () => Promise.reject(new Error("not used by the sync"));
    return {
      listInstitutions: unused,
      startAuthorization: unused,
      createSession: unused,
      getSession: unused,
      getAccount: unused,
      getAccountBalance: async () => null,
      getAccountTransactions: async () => ({ booked: txns, pendingCount: 0, invalidCount: 0 }),
      deleteSession: unused,
    };
  }

  /** A user with a checking account already linked and reviewed. */
  async function linkedUser(name: string, email: string) {
    const user = await prisma.user.create({ data: { name, email, emailVerified: new Date() } });
    await createDefaultAllocations(user.id, "es");
    const connection = await prisma.bankConnection.create({
      data: { userId: user.id, ownerUserId: user.id, institutionId: "Test Bank", institutionName: "Test Bank", requisitionId: "", status: "active" },
    });
    const account = await prisma.account.create({
      data: {
        userId: user.id, ownerUserId: user.id, name: "Cuenta", type: "checking",
        bankConnectionId: connection.id, externalAccountId: "acc-1",
        bankReviewedAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    return { userId: user.id, connection: { id: connection.id, userId: user.id, ownerUserId: user.id }, accountId: account.id };
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const month = () => periodLib.currentPeriodKey(1);

  async function sync(u: Awaited<ReturnType<typeof linkedUser>>, client: BankingProviderClient) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: u.accountId } });
    return syncAccount(client, u.connection, { ...account, bankReviewedAt: account.bankReviewedAt! }, null, new Date());
  }

  /** Income as every total reads it: Home (/review), the month card, Activity's list. */
  async function incomeTotals(userId: string) {
    const review = await ok(userId, "GET", `/api/monthly-budgets/review?month=${month()}`);
    const card = (await ok(userId, "GET", `/api/dashboard/month?month=${month()}`)).data;
    const listed = (await ok(userId, "GET", `/api/income?month=${month()}`)).incomes as { amount: number }[];
    return { home: review.householdIncome, card: card.householdIncome, activity: listed.reduce((s, i) => s + i.amount, 0) };
  }

  it("a deleted bank income is not written again by the next sync, and stops counting everywhere", async () => {
    const u = await linkedUser("Luis", "luis@example.com");
    await ok(u.userId, "POST", "/api/income", { amount: 3000, description: "Nómina", category: "salary" });
    const bizum = fakeBank([{ id: "tx-bizum-1", date: today(), description: "BIZUM DE PAREJA", amountCents: 20000, currency: "EUR" }]);

    assert.equal((await sync(u, bizum)).written, 1);
    assert.deepEqual(await incomeTotals(u.userId), { home: 3200, card: 3200, activity: 3200 });

    const row = await prisma.income.findFirstOrThrow({ where: { userId: u.userId, source: "bank_sync" } });
    await ok(u.userId, "DELETE", `/api/income/${row.id}`);
    assert.deepEqual(await incomeTotals(u.userId), { home: 3000, card: 3000, activity: 3000 });

    // The daily sync reads the same days again (overlap window).
    assert.equal((await sync(u, bizum)).written, 0);
    assert.equal(await prisma.income.count({ where: { userId: u.userId, source: "bank_sync" } }), 0);
    assert.deepEqual(await incomeTotals(u.userId), { home: 3000, card: 3000, activity: 3000 });

    // The bank's review preview doesn't offer it again either.
    const account = await prisma.account.findUniqueOrThrow({ where: { id: u.accountId } });
    assert.deepEqual(account.bankDismissedIds, [row.externalId]);
  });

  it("a deleted bank expense is not written again either; a manual delete touches no account", async () => {
    const u = await linkedUser("Marta", "marta@example.com");
    const line = await prisma.allocation.findFirstOrThrow({ where: { userId: u.userId, type: { not: "generosity" } } });
    await prisma.categorizationRule.create({ data: { userId: u.userId, matchType: "contains", pattern: "supermercado", allocationId: line.id } });
    const shop = fakeBank([{ id: "tx-shop-1", date: today(), description: "SUPERMERCADO CENTRO", amountCents: -4500, currency: "EUR" }]);

    assert.equal((await sync(u, shop)).written, 1);
    const row = await prisma.expense.findFirstOrThrow({ where: { userId: u.userId, source: "bank_sync" } });
    await ok(u.userId, "DELETE", `/api/expenses/${row.id}`);
    assert.equal((await sync(u, shop)).written, 0);
    assert.equal(await prisma.expense.count({ where: { userId: u.userId, source: "bank_sync" } }), 0);

    const manual = (await ok(u.userId, "POST", "/api/income", { amount: 10, accountId: u.accountId })).income;
    await ok(u.userId, "DELETE", `/api/income/${manual.id}`);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: u.accountId } });
    assert.deepEqual(account.bankDismissedIds, [row.externalId]);
  });

  it("a bank income moved to another account and then deleted still stays deleted", async () => {
    const u = await linkedUser("Pablo", "pablo@example.com");
    const other = await prisma.account.create({ data: { userId: u.userId, ownerUserId: u.userId, name: "Efectivo", type: "cash" } });
    const bizum = fakeBank([{ id: "tx-bizum-2", date: today(), description: "BIZUM DE PAREJA", amountCents: 20000, currency: "EUR" }]);

    assert.equal((await sync(u, bizum)).written, 1);
    const row = await prisma.income.findFirstOrThrow({ where: { userId: u.userId, source: "bank_sync" } });
    await ok(u.userId, "PATCH", `/api/income/${row.id}`, { accountId: other.id });
    await ok(u.userId, "DELETE", `/api/income/${row.id}`);

    assert.equal((await sync(u, bizum)).written, 0);
    assert.equal(await prisma.income.count({ where: { userId: u.userId, source: "bank_sync" } }), 0);
  });

  it("re-linking the same bank account (same stable key) under a new consent keeps the dismissed ids", async () => {
    const u = await linkedUser("Sara", "sara@example.com");
    await prisma.account.update({ where: { id: u.accountId }, data: { externalAccountKey: "key-1", bankDismissedIds: ["gone"] } });
    const consent = await prisma.bankConnection.create({
      data: { userId: u.userId, ownerUserId: u.userId, institutionId: "Test Bank", institutionName: "Test Bank", requisitionId: "", status: "active" },
    });
    const ctx = { userId: u.userId, authUserId: u.userId, householdId: null, connectionId: consent.id };
    const bank = fakeBank([]);

    await applyLinks(bank, ctx, [{ provider: { id: "acc-2", currency: "EUR", kind: "checking", stableKey: "key-1" }, accountId: u.accountId }], "Cuenta");
    let account = await prisma.account.findUniqueOrThrow({ where: { id: u.accountId } });
    assert.deepEqual(account.bankDismissedIds, ["gone"]);
    assert.equal(account.bankReviewedAt, null); // a new consent is still reviewed again

    // Another bank account linked onto it: its old list means nothing there.
    await applyLinks(bank, ctx, [{ provider: { id: "acc-3", currency: "EUR", kind: "checking", stableKey: "key-2" }, accountId: u.accountId }], "Cuenta");
    account = await prisma.account.findUniqueOrThrow({ where: { id: u.accountId } });
    assert.deepEqual(account.bankDismissedIds, []);
  });
});
