// Export my data and delete my account (LPBETA-09) against a REAL Postgres:
// the export holds only mine (not the partner's), request → cancel, the purge
// waits 24 h, purging the pool OWNER keeps the partner's data, and the purge
// is idempotent. Opt-in: skipped unless TEST_DATABASE_URL is set.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55444/budget_test npm run test:integration
//
// Every table is TRUNCATEd at the start, so the host must be localhost (asserted).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;

describe("account export and deletion (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let hashOtp: typeof import("./otp.js").hashOtp;
  let createDefaultAllocations: typeof import("./defaults.js").createDefaultAllocations;
  let deletion: typeof import("./accountDeletion.js");
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
    process.env.CRON_SECRET = "cron-test-secret";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    ({ hashOtp } = await import("./otp.js"));
    ({ createDefaultAllocations } = await import("./defaults.js"));
    deletion = await import("./accountDeletion.js");
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

  async function raw(userId: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    return fetch(base + path, {
      method,
      headers: {
        ...(userId && { cookie: `token=${signToken({ userId })}` }),
        ...(body !== undefined && { "content-type": "application/json" }),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function ok(userId: string, method: string, path: string, body?: unknown) {
    const res = await raw(userId, method, path, body);
    const json = await res.json() as any;
    assert.equal(res.status, 200, `${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  }

  async function signUp(name: string, email: string) {
    const user = await prisma.user.create({ data: { name, email, emailVerified: new Date() } });
    await createDefaultAllocations(user.id, "es");
    return user.id;
  }

  /** Asks for the code, then swaps it for a known one (the real one only goes to the console). */
  async function requestDeletion(userId: string) {
    await ok(userId, "POST", "/api/account/deletion/code");
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email!;
    await prisma.otpToken.updateMany({ where: { email, type: "account_deletion" }, data: { tokenHash: hashOtp("246810") } });
    return (await ok(userId, "POST", "/api/account/deletion", { code: "246810" })).data;
  }

  const sent: string[] = [];
  const deps = (now: Date) => ({
    now,
    banking: null,
    cancelStripeSubscription: null,
    sendDeletedEmail: async (email: string) => { sent.push(email); },
  });

  let A = "", B = "";

  it("setup: B joins A's household; each enters their own movements", async () => {
    A = await signUp("Ana", "ana@test.local");
    B = await signUp("Bea", "bea@test.local");
    await ok(A, "POST", "/api/partner/invite", { email: "bea@test.local" });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: A, status: "pending" } });
    await ok(B, "POST", "/api/partner/accept", { token: inv.token });

    await ok(A, "POST", "/api/expenses", { amount: "10.00", description: "ANA-SUPER" });
    await ok(B, "POST", "/api/expenses", { amount: "3.50", description: "BEA-CAFE" });
    await ok(A, "POST", "/api/income", { amount: "2000", description: "ANA-NOMINA" });
    await ok(B, "POST", "/api/income", { amount: "1500", description: "BEA-NOMINA" });
  });

  it("export holds only mine, never the partner's", async () => {
    for (const [me, mine, theirs] of [[B, "BEA", "ANA"], [A, "ANA", "BEA"]] as const) {
      const csvRes = await raw(me, "GET", "/api/account/export/movements");
      assert.equal(csvRes.status, 200);
      assert.match(csvRes.headers.get("content-disposition") ?? "", /attachment; filename="remanso-movimientos-.*\.csv"/);
      const csv = await csvRes.text();
      assert.ok(csv.includes(`${mine}-NOMINA`) && csv.includes(mine === "BEA" ? "BEA-CAFE" : "ANA-SUPER"), csv);
      assert.ok(!csv.includes(theirs), `${mine}'s CSV has ${theirs}'s rows:\n${csv}`);

      const jsonRes = await raw(me, "GET", "/api/account/export");
      assert.equal(jsonRes.status, 200);
      const text = await jsonRes.text();
      const doc = JSON.parse(text);
      assert.equal(doc.format, "remanso-export");
      assert.equal(doc.profile.email, mine === "BEA" ? "bea@test.local" : "ana@test.local");
      assert.deepEqual(doc.movementCounts, { expenses: 1, incomes: 1 });
      // Every exported account is one this person owns; no foreign ids leak.
      const owners = await prisma.account.findMany({ where: { id: { in: doc.accounts.map((a: any) => a.id) } }, select: { ownerUserId: true } });
      assert.ok(owners.length > 0 && owners.every(o => o.ownerUserId === me));
      const other = me === A ? B : A;
      assert.ok(!text.includes(other), "the partner's id appears in the export");
    }
  });

  it("request → cancel: the mark is set with a 24 h due date, then cleared", async () => {
    const wrong = await raw(A, "POST", "/api/account/deletion", { code: "000000" });
    assert.equal(wrong.status, 400);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: A } })).deletionRequestedAt, null);

    const state = await requestDeletion(A);
    assert.equal(new Date(state.dueAt).getTime() - new Date(state.requestedAt).getTime(), 24 * HOUR);
    assert.deepEqual((await ok(A, "GET", "/api/account/deletion")).data, state);
    // A second request keeps the first date.
    assert.deepEqual((await ok(A, "POST", "/api/account/deletion", { code: "x" })).data, state);

    assert.equal((await ok(A, "DELETE", "/api/account/deletion")).data, null);
    assert.equal((await ok(A, "GET", "/api/account/deletion")).data, null);
  });

  it("the cron route needs CRON_SECRET", async () => {
    assert.equal((await raw(null, "GET", "/api/account/cron")).status, 401);
    assert.equal((await raw(null, "GET", "/api/account/cron", undefined, { authorization: "Bearer nope" })).status, 401);
    const res = await raw(null, "GET", "/api/account/cron", undefined, { authorization: "Bearer cron-test-secret" });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json() as any).data, { deleted: 0, failed: 0 });
  });

  it("the purge waits 24 h; then deleting the pool OWNER keeps the partner's data", async () => {
    const state = await requestDeletion(A);
    const requestedAt = new Date(state.requestedAt);
    const bExpense = await prisma.expense.findFirstOrThrow({ where: { description: "BEA-CAFE" } });

    const early = await deletion.runDeletionPurge(prisma, deps(new Date(requestedAt.getTime() + 23 * HOUR)));
    assert.deepEqual(early, { deleted: 0, failed: 0 });
    assert.ok(await prisma.user.findUnique({ where: { id: A } }));

    const due = await deletion.runDeletionPurge(prisma, deps(new Date(requestedAt.getTime() + 25 * HOUR)));
    assert.deepEqual(due, { deleted: 1, failed: 0 });
    assert.deepEqual(sent, ["ana@test.local"]);

    // A and everything of hers is gone.
    assert.equal(await prisma.user.findUnique({ where: { id: A } }), null);
    for (const where of [{ userId: A }, { ownerUserId: A }]) {
      assert.equal(await prisma.account.count({ where }), 0);
      assert.equal(await prisma.income.count({ where }), 0);
    }
    assert.equal(await prisma.expense.count({ where: { description: "ANA-SUPER" } }), 0);
    assert.equal(await prisma.otpToken.count({ where: { email: "ana@test.local" } }), 0);
    assert.equal(await prisma.household.count({ where: { members: { none: {} } } }), 0);

    // B is unlinked and keeps her own data, now in her own scope.
    const bSettings = await prisma.userSettings.findUniqueOrThrow({ where: { userId: B } });
    assert.equal(bSettings.linkedUserId, null);
    const moved = await prisma.expense.findUniqueOrThrow({ where: { id: bExpense.id } });
    assert.equal(moved.userId, B);
    assert.equal(await prisma.income.count({ where: { userId: B, description: "BEA-NOMINA" } }), 1);
    assert.ok(await prisma.account.count({ where: { userId: B, ownerUserId: B } }) > 0);
    // B's session still works and sees her movement.
    const csv = await (await raw(B, "GET", "/api/account/export/movements")).text();
    assert.ok(csv.includes("BEA-CAFE"));
  });

  it("the purge is idempotent: a second run (and a gone user) change nothing", async () => {
    const again = await deletion.runDeletionPurge(prisma, deps(new Date(Date.now() + 48 * HOUR)));
    assert.deepEqual(again, { deleted: 0, failed: 0 });
    assert.equal(await deletion.purgeUser(prisma, A, deps(new Date(Date.now() + 48 * HOUR))), "gone");
    assert.deepEqual(sent, ["ana@test.local"]);
    // A cancelled-then-unmarked user is never due.
    assert.equal(await deletion.purgeUser(prisma, B, deps(new Date(Date.now() + 48 * HOUR))), "not_due");
    assert.ok(await prisma.user.findUnique({ where: { id: B } }));
  });

  it("deleting the MEMBER of a household removes her data and leaves the owner's", async () => {
    const C = await signUp("Carla", "carla@test.local");
    await ok(C, "POST", "/api/partner/invite", { email: "bea@test.local" });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: C, status: "pending" } });
    await ok(B, "POST", "/api/partner/accept", { token: inv.token });
    await ok(C, "POST", "/api/expenses", { amount: "7.00", description: "CARLA-GAS" });
    assert.equal(await prisma.expense.count({ where: { userId: C, description: "BEA-CAFE" } }), 1, "B's data merged into C's pool");

    const state = await requestDeletion(B);
    const result = await deletion.runDeletionPurge(prisma, deps(new Date(new Date(state.requestedAt).getTime() + 25 * HOUR)));
    assert.deepEqual(result, { deleted: 1, failed: 0 });
    assert.equal(await prisma.user.findUnique({ where: { id: B } }), null);
    assert.equal(await prisma.expense.count({ where: { description: { startsWith: "BEA-" } } }), 0);
    assert.equal(await prisma.income.count({ where: { description: { startsWith: "BEA-" } } }), 0);
    assert.equal(await prisma.expense.count({ where: { userId: C, description: "CARLA-GAS" } }), 1);
    assert.equal(await prisma.householdMember.count({ where: { userId: C } }), 1);
  });

  it("a deleted account's session is closed", async () => {
    const res = await raw(A, "GET", "/api/account/deletion");
    assert.equal(res.status, 401);
  });
});
