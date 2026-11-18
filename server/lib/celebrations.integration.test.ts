// "Celebrar los hitos" (LPBETA-13) against a REAL Postgres, through the API:
// the first read is a silent baseline, then only new events show; a private
// debt only for its owner; each one seen once per person (across devices: the
// mark is in the database); POST /seen only takes a current event; a plan's
// starting balance is not celebrated; amounts in euros at the boundary; and
// the marks go with the user. Opt-in: skipped unless TEST_DATABASE_URL is set.
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

  async function api(userId: string | null, method: string, path: string, body?: unknown) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(userId && { cookie: `token=${signToken({ userId })}` }),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() as any };
  }
  const seen = (userId: string, key: unknown) => api(userId, "POST", "/celebrations/seen", { key });
  const list = async (userId: string) => {
    const r = await api(userId, "GET", "/celebrations");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.data.celebrations as { key: string; kind: string; amount?: number | null; name?: string }[];
  };
  const keys = async (userId: string) => (await list(userId)).map(c => c.key);

  // A couple in the legacy pool (the partner's queries run on the owner's
  // data), both past their first read: from here on only new events show.
  async function couple(tag: string) {
    const owner = await prisma.user.create({ data: { email: `${tag}-owner@test.local` } });
    const partner = await prisma.user.create({ data: { email: `${tag}-partner@test.local` } });
    await prisma.userSettings.create({ data: { userId: owner.id } });
    await prisma.userSettings.create({ data: { userId: partner.id, linkedUserId: owner.id } });
    assert.deepEqual(await list(owner.id), []);
    assert.deepEqual(await list(partner.id), []);
    return { owner, partner };
  }

  it("needs a session", async () => {
    assert.equal((await api(null, "GET", "/celebrations")).status, 401);
    assert.equal((await api(null, "POST", "/celebrations/seen", { key: "pyf-first" })).status, 401);
  });

  it("the first read is a silent baseline: what was already true never shows", async () => {
    const user = await prisma.user.create({ data: { email: "old@test.local" } });
    await prisma.userSettings.create({ data: { userId: user.id } });
    const old = await prisma.lifePlan.create({ data: { userId: user.id, title: "Viejo", targetAmount: 100_000, currentAmount: 100_000 } });
    assert.deepEqual(await list(user.id), []);
    assert.deepEqual(await list(user.id), [], "still nothing on the next visit");
    const marks = (await prisma.celebrationSeen.findMany({ where: { userId: user.id } })).map(s => s.key).sort();
    assert.deepEqual(marks, ["baseline", `plan-done:${old.id}`]);
  });

  it("household: shared things for both, a private debt only for its owner; the freed amount in euros", async () => {
    const { owner, partner } = await couple("hh");
    const shared = await prisma.debt.create({ data: {
      userId: owner.id, ownerUserId: owner.id, name: "Coche", kind: "auto_loan", status: "paid_off",
      paymentMode: "installments", installmentAmount: 25_050, visibility: "household",
    } });
    const hers = await prisma.debt.create({ data: {
      userId: owner.id, ownerUserId: partner.id, name: "Préstamo de ella", kind: "installment", status: "paid_off",
      paymentMode: "installments", installmentAmount: 10_000, visibility: "private",
    } });
    // Reached through contributions (written straight to the table, as the ledger does).
    const plan = await prisma.lifePlan.create({ data: { userId: owner.id, title: "Colchón", type: "emergency", targetAmount: 300_000, currentAmount: 300_000 } });

    const ownerSees = await list(owner.id);
    assert.deepEqual(ownerSees.map(c => c.key), [`debt-paid:${shared.id}`, `emergency-done:${plan.id}`]);
    const partnerSees = await keys(partner.id);
    assert.deepEqual(partnerSees.slice(0, 2).sort(), [`debt-paid:${hers.id}`, `debt-paid:${shared.id}`].sort());
    assert.deepEqual(partnerSees.slice(2), [`emergency-done:${plan.id}`]);

    const coche = ownerSees[0];
    assert.equal(coche.amount, 250.5, "cents → euros at the boundary");
    assert.equal(coche.name, "Coche");
    // The owner can't mark the partner's private debt: it isn't one of his.
    assert.equal((await seen(owner.id, `debt-paid:${hers.id}`)).status, 400);
  });

  it("seen once per person, on any device; idempotent; only current events accepted", async () => {
    const { owner, partner } = await couple("seen");
    const plan = await prisma.lifePlan.create({ data: { userId: owner.id, title: "Viaje", targetAmount: 100_000, currentAmount: 100_000 } });
    const key = `plan-done:${plan.id}`;

    assert.deepEqual(await keys(owner.id), [key]);
    let r = await seen(owner.id, key);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.data, { key });
    assert.equal((await seen(owner.id, key)).status, 200, "a second tap is fine");
    assert.equal(await prisma.celebrationSeen.count({ where: { userId: owner.id, key } }), 1);

    // Another device = another session of the same person: still gone.
    assert.deepEqual(await list(owner.id), []);
    // The partner hasn't seen it: "seen" is per real person, not per pool.
    assert.deepEqual(await keys(partner.id), [key]);

    for (const bad of [undefined, "", "DROP TABLE", 42, "baseline", "pyf-first", `plan-done:${plan.id}x`]) {
      r = await seen(owner.id, bad);
      assert.equal(r.status, 400, String(bad));
    }
    assert.equal(await prisma.celebrationSeen.count({ where: { userId: owner.id, key: "pyf-first" } }), 0);
  });

  it("a plan's starting balance is not celebrated; what contributions reach is", async () => {
    const { owner, partner } = await couple("start");
    const created = await api(owner.id, "POST", "/plans", { title: "Casa", targetAmount: 1_000, currentAmount: 600 });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const id: string = created.json.plan.id;
    assert.deepEqual(await list(owner.id), [], "60 % typed at creation: nothing");
    assert.deepEqual(await list(partner.id), [], "nor for the partner");

    // Typed by hand: still nothing.
    assert.equal((await api(owner.id, "PATCH", `/plans/${id}`, { currentAmount: 800 })).status, 200);
    assert.deepEqual(await list(owner.id), []);

    // A contribution in the app takes it to the target: that is celebrated, for both.
    assert.equal((await api(partner.id, "POST", `/plans/${id}/contribute`, { amount: 200 })).status, 200);
    assert.deepEqual(await keys(owner.id), [`plan-done:${id}`]);
    assert.deepEqual(await keys(partner.id), [`plan-done:${id}`]);
  });

  it("paying yourself first this month and a plan's first contribution, from the real figures", async () => {
    const { owner } = await couple("pyf");
    await prisma.userSettings.update({ where: { userId: owner.id }, data: { monthlyIncome: 300_000, payYourselfFirstBps: 1_000 } });
    const plan = await prisma.lifePlan.create({ data: { userId: owner.id, title: "Ahorro", targetAmount: 1_000_000 } });
    const month = period.currentPeriodKey(1);

    // 299.99 € of a 300 € goal: nothing yet, and nothing said about it.
    await prisma.planDeposit.create({ data: { userId: owner.id, planId: plan.id, month, amount: 29_999 } });
    assert.deepEqual(await keys(owner.id), [`plan-first:${plan.id}`]);

    await prisma.planDeposit.update({ where: { planId_month: { planId: plan.id, month } }, data: { amount: 30_000 } });
    assert.deepEqual(await keys(owner.id), ["pyf-first", `plan-first:${plan.id}`]);
  });

  it("three closed months in a row paying yourself first, keyed by the month it reached 3", async () => {
    const { owner } = await couple("streak");
    await prisma.userSettings.update({ where: { userId: owner.id }, data: { monthlyIncome: 100_000, payYourselfFirstBps: 1_000 } });
    const plan = await prisma.lifePlan.create({ data: { userId: owner.id, title: "Hucha", targetAmount: 10_000_000 } });
    const current = period.currentPeriodKey(1);
    for (const i of [1, 2, 3]) {
      await prisma.planDeposit.create({ data: { userId: owner.id, planId: plan.id, month: period.periodKeyOffset(current, -i), amount: 10_000 } });
    }
    const got = await keys(owner.id);
    assert.ok(got.includes(`pyf-streak:${period.periodKeyOffset(current, -1)}:3`), JSON.stringify(got));
  });

  it("the last closed month within budget, only with nothing left uncategorised", async () => {
    const { owner } = await couple("budget");
    const last = period.periodKeyOffset(period.currentPeriodKey(1), -1);
    const { start } = period.periodBounds(last, 1);
    const line = await prisma.allocation.create({ data: { userId: owner.id, name: "Comida", type: "flexible", allocatedAmount: 40_000 } });
    const spent = await prisma.expense.create({ data: { userId: owner.id, allocationId: line.id, amount: 40_000, date: start } });
    const loose = await prisma.expense.create({ data: { userId: owner.id, amount: 1_000, date: start } });
    assert.deepEqual(await list(owner.id), [], "10 € nobody placed: not claimed");

    await prisma.expense.delete({ where: { id: loose.id } });
    assert.deepEqual(await keys(owner.id), [`budget-month:${last}`]);

    await prisma.expense.update({ where: { id: spent.id }, data: { amount: 40_001 } });
    assert.deepEqual(await list(owner.id), [], "one cent over: nothing, and no judgement");
  });

  it("the seen marks go with the user", async () => {
    const { owner } = await couple("gone");
    assert.ok(await prisma.celebrationSeen.count({ where: { userId: owner.id } }) > 0);
    await prisma.user.delete({ where: { id: owner.id } });
    assert.equal(await prisma.celebrationSeen.count({ where: { userId: owner.id } }), 0);
  });
});
