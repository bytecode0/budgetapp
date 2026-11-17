// "Celebrar los hitos" (LPBETA-13) against a REAL Postgres, through the API:
// celebrations derived from the pool's data, a private debt only for its
// owner, each one seen once per person (across devices: the mark is in the
// database), amounts in euros at the boundary, and the marks go with the user.
// Opt-in: skipped unless TEST_DATABASE_URL is set.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55450/budget_test npm run test:integration
//
// Every table is TRUNCATEd at the start, so the host must be localhost (asserted).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("celebrations (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let period: typeof import("./period.js");
  let server: Server;
  let base: string;

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "integration-test-secret";
    process.env.NODE_ENV = "test";

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    period = await import("./period.js");
    const app = (await import("../app.js")).default;

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.some(t => t.tablename === "CelebrationSeen"), "schema not pushed to the test database");
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(", ")} CASCADE`);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    await prisma?.$disconnect();
  });

  async function call(userId: string | null, method: string, path = "", body?: unknown) {
    const res = await fetch(`${base}/api/celebrations${path}`, {
      method,
      headers: {
        ...(userId && { cookie: `token=${signToken({ userId })}` }),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() as any };
  }
  const list = async (userId: string) => {
    const r = await call(userId, "GET");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.celebrations as { key: string; kind: string; amount?: number | null; name?: string }[];
  };

  // A couple in the legacy pool: the partner's queries run on the owner's data.
  async function couple(tag: string) {
    const owner = await prisma.user.create({ data: { email: `${tag}-owner@test.local` } });
    const partner = await prisma.user.create({ data: { email: `${tag}-partner@test.local` } });
    await prisma.userSettings.create({ data: { userId: owner.id } });
    await prisma.userSettings.create({ data: { userId: partner.id, linkedUserId: owner.id } });
    return { owner, partner };
  }

  it("needs a session", async () => {
    assert.equal((await call(null, "GET")).status, 401);
    assert.equal((await call(null, "POST", "/seen", { key: "pyf-first" })).status, 401);
  });

  it("nothing to celebrate on an empty account", async () => {
    const { owner } = await couple("empty");
    assert.deepEqual(await list(owner.id), []);
  });

  it("household: shared things for both, a private debt only for its owner; the freed amount in euros", async () => {
    const { owner, partner } = await couple("hh");
    const shared = await prisma.debt.create({ data: {
      userId: owner.id, ownerUserId: owner.id, name: "Coche", kind: "auto_loan", status: "paid_off",
      paymentMode: "installments", installmentAmount: 25_050, visibility: "household",
    } });
    const mine = await prisma.debt.create({ data: {
      userId: owner.id, ownerUserId: partner.id, name: "Préstamo de ella", kind: "installment", status: "paid_off",
      paymentMode: "installments", installmentAmount: 10_000, visibility: "private",
    } });
    const plan = await prisma.lifePlan.create({ data: { userId: owner.id, title: "Colchón", type: "emergency", targetAmount: 300_000, currentAmount: 300_000 } });

    const ownerSees = await list(owner.id);
    const partnerSees = await list(partner.id);
    assert.deepEqual(ownerSees.map(c => c.key), [`debt-paid:${shared.id}`, `emergency-done:${plan.id}`]);
    assert.deepEqual(partnerSees.slice(0, 2).map(c => c.key).sort(), [`debt-paid:${mine.id}`, `debt-paid:${shared.id}`].sort());
    assert.equal(partnerSees[2]?.key, `emergency-done:${plan.id}`);
    assert.equal(partnerSees.length, 3);
    const coche = ownerSees.find(c => c.key === `debt-paid:${shared.id}`)!;
    assert.equal(coche.amount, 250.5, "cents → euros at the boundary");
    assert.equal(coche.name, "Coche");
  });

  it("seen once per person, on any device; idempotent; junk keys refused", async () => {
    const { owner, partner } = await couple("seen");
    const plan = await prisma.lifePlan.create({ data: { userId: owner.id, title: "Viaje", targetAmount: 100_000, currentAmount: 100_000 } });
    const key = `plan-done:${plan.id}`;

    assert.deepEqual((await list(owner.id)).map(c => c.key), [key]);
    let r = await call(owner.id, "POST", "/seen", { key });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data, { key });
    assert.equal((await call(owner.id, "POST", "/seen", { key })).status, 200, "a second tap is fine");
    assert.equal(await prisma.celebrationSeen.count({ where: { userId: owner.id } }), 1);

    // Another device = another session of the same person: still gone.
    assert.deepEqual(await list(owner.id), []);
    // The partner hasn't seen it: "seen" is per real person, not per pool.
    assert.deepEqual((await list(partner.id)).map(c => c.key), [key]);
    assert.equal(await prisma.celebrationSeen.count({ where: { userId: partner.id } }), 0);

    for (const bad of [undefined, "", "DROP TABLE", 42, "a:b:c:d:e"]) {
      r = await call(owner.id, "POST", "/seen", { key: bad });
      assert.equal(r.status, 400, String(bad));
    }
  });

  it("paying yourself first this month and a plan's first contribution, from the real figures", async () => {
    const { owner } = await couple("pyf");
    await prisma.userSettings.update({ where: { userId: owner.id }, data: { monthlyIncome: 300_000, payYourselfFirstBps: 1_000 } });
    const plan = await prisma.lifePlan.create({ data: { userId: owner.id, title: "Ahorro", targetAmount: 1_000_000 } });
    const month = period.currentPeriodKey(1);

    // 299.99 € of a 300 € goal: nothing yet, and nothing said about it.
    await prisma.planDeposit.create({ data: { userId: owner.id, planId: plan.id, month, amount: 29_999 } });
    assert.deepEqual((await list(owner.id)).map(c => c.key), [`plan-first:${plan.id}`]);

    await prisma.planDeposit.update({ where: { planId_month: { planId: plan.id, month } }, data: { amount: 30_000 } });
    assert.deepEqual((await list(owner.id)).map(c => c.key), ["pyf-first", `plan-first:${plan.id}`]);
  });

  it("the last closed month within its budget, by categorised spending in cents", async () => {
    const { owner } = await couple("budget");
    const last = period.periodKeyOffset(period.currentPeriodKey(1), -1);
    const { start } = period.periodBounds(last, 1);
    const line = await prisma.allocation.create({ data: { userId: owner.id, name: "Comida", type: "flexible", allocatedAmount: 40_000 } });
    const spent = await prisma.expense.create({ data: { userId: owner.id, allocationId: line.id, amount: 40_000, date: start } });
    // Uncategorised money doesn't count against the budget (as on Home).
    await prisma.expense.create({ data: { userId: owner.id, amount: 99_999, date: start } });
    assert.deepEqual((await list(owner.id)).map(c => c.key), [`budget-month:${last}`]);

    await prisma.expense.update({ where: { id: spent.id }, data: { amount: 40_001 } });
    assert.deepEqual(await list(owner.id), [], "one cent over: nothing, and no judgement");
  });

  it("the seen marks go with the user", async () => {
    const { owner } = await couple("gone");
    await call(owner.id, "POST", "/seen", { key: "pyf-first" });
    assert.equal(await prisma.celebrationSeen.count({ where: { userId: owner.id } }), 1);
    await prisma.user.delete({ where: { id: owner.id } });
    assert.equal(await prisma.celebrationSeen.count({ where: { userId: owner.id } }), 0);
  });
});
