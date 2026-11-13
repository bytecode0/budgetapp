// The monthly peace question (LPBETA-24) against a REAL Postgres, through the
// API: one answer per period (a second one replaces the score), the period
// follows the household's payday, a partner never reads or overwrites the
// other's answer, answers go with the user, and answering counts as activity
// (LPBETA-05), purging an account removes only that person's answers, and a
// missing table never breaks the active-users report. Opt-in: skipped unless TEST_DATABASE_URL is set.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55450/budget_test npm run test:integration
//
// Every table is TRUNCATEd at the start, so the host must be localhost (asserted).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("peace check-ins (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let currentPeriodKey: typeof import("./period.js").currentPeriodKey;
  let stats: typeof import("./activeStats.js");
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

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    ({ currentPeriodKey } = await import("./period.js"));
    stats = await import("./activeStats.js");
    deletion = await import("./accountDeletion.js");
    const app = (await import("../app.js")).default;

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.some(t => t.tablename === "PeaceCheckin"), "schema not pushed to the test database");
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(", ")} CASCADE`);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    await prisma?.$disconnect();
  });

  async function call(userId: string | null, method: string, body?: unknown) {
    const res = await fetch(`${base}/api/checkins`, {
      method,
      headers: {
        ...(userId && { cookie: `token=${signToken({ userId })}` }),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() as any };
  }

  // A couple in the legacy pool: the partner's queries run on the owner's data.
  async function couple(tag: string, cycleStartDay = 1) {
    const owner = await prisma.user.create({ data: { email: `${tag}-owner@test.local` } });
    const partner = await prisma.user.create({ data: { email: `${tag}-partner@test.local` } });
    await prisma.userSettings.create({ data: { userId: owner.id, cycleStartDay } });
    await prisma.userSettings.create({ data: { userId: partner.id, linkedUserId: owner.id } });
    return { owner, partner };
  }

  it("needs a session", async () => {
    assert.equal((await call(null, "GET")).status, 401);
    assert.equal((await call(null, "POST", { score: 3 })).status, 401);
  });

  it("asks until answered, then one answer per period: a second one replaces the score", async () => {
    const { owner } = await couple("once");
    let r = await call(owner.id, "GET");
    assert.equal(r.status, 200);
    assert.equal(r.json.data.ask, true);
    assert.equal(r.json.data.current, null);
    assert.deepEqual(r.json.data.checkins, []);

    r = await call(owner.id, "POST", { score: 2 });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.score, 2);
    const firstAt = r.json.data.createdAt;
    r = await call(owner.id, "POST", { score: 4 });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.createdAt, firstAt, "the first answer's time is kept");

    assert.equal(await prisma.peaceCheckin.count({ where: { userId: owner.id } }), 1);
    r = await call(owner.id, "GET");
    assert.equal(r.json.data.ask, false);
    assert.equal(r.json.data.current, 4);
    assert.equal(r.json.data.checkins.length, 1);
    assert.equal(r.json.data.checkins[0].period, r.json.data.period);
  });

  it("refuses anything but an integer from 1 to 5", async () => {
    const { owner } = await couple("bad");
    for (const score of [0, 6, 2.5, "3", null]) {
      assert.equal((await call(owner.id, "POST", { score })).status, 400, String(score));
    }
    assert.equal((await call(owner.id, "POST", {})).status, 400);
    assert.equal(await prisma.peaceCheckin.count({ where: { userId: owner.id } }), 0);
  });

  it("the period is the household's budget period (the pool's payday), for both members", async () => {
    const { owner, partner } = await couple("payday", 25);
    const expected = currentPeriodKey(25);
    assert.equal((await call(owner.id, "POST", { score: 3 })).json.data.period, expected);
    assert.equal((await call(partner.id, "POST", { score: 3 })).json.data.period, expected);
  });

  it("a partner never reads or overwrites the other's answer", async () => {
    const { owner, partner } = await couple("private");
    // An older answer of the owner's, to show the history is private too.
    await prisma.peaceCheckin.create({ data: { userId: owner.id, period: "2026-01", score: 1 } });
    await call(owner.id, "POST", { score: 5 });

    let r = await call(partner.id, "GET");
    assert.equal(r.json.data.ask, true, "the owner's answer doesn't answer for the partner");
    assert.deepEqual(r.json.data.checkins, []);

    await call(partner.id, "POST", { score: 2 });
    r = await call(partner.id, "GET");
    assert.deepEqual(r.json.data.checkins.map((c: any) => c.score), [2]);

    r = await call(owner.id, "GET");
    assert.deepEqual(r.json.data.checkins.map((c: any) => c.score), [1, 5], "the partner's answer didn't touch the owner's");
    assert.equal(await prisma.peaceCheckin.count({ where: { userId: partner.id } }), 1);
  });

  it("answers go with the user (cascade)", async () => {
    const { owner, partner } = await couple("cascade");
    await call(owner.id, "POST", { score: 3 });
    await call(partner.id, "POST", { score: 4 });
    await prisma.userSettings.deleteMany({ where: { userId: partner.id } });
    await prisma.user.delete({ where: { id: partner.id } });
    assert.equal(await prisma.peaceCheckin.count({ where: { userId: partner.id } }), 0);
    assert.equal(await prisma.peaceCheckin.count({ where: { userId: owner.id } }), 1, "the other member's answer stays");
  });

  it("the account purge removes the deleted person's answers and keeps the survivor's", async () => {
    const { owner, partner } = await couple("purge");
    await call(owner.id, "POST", { score: 4 });
    await call(partner.id, "POST", { score: 2 });
    await prisma.peaceCheckin.create({ data: { userId: partner.id, period: "2026-01", score: 1 } });
    const now = new Date();
    await prisma.user.update({ where: { id: partner.id }, data: { deletionRequestedAt: new Date(now.getTime() - 25 * 3_600_000) } });
    const outcome = await deletion.purgeUser(prisma, partner.id, {
      now, banking: null, deleteStripeCustomer: null, sendDeletedEmail: async () => {},
    });
    assert.equal(outcome, "deleted");
    assert.equal(await prisma.peaceCheckin.count({ where: { userId: partner.id } }), 0);
    const kept = await prisma.peaceCheckin.findMany({ where: { userId: owner.id } });
    assert.deepEqual(kept.map(c => c.score), [4]);
  });

  it("orders answers by when they were given, not by period label (payday change)", async () => {
    const { owner } = await couple("backwards");
    const r0 = await call(owner.id, "GET");
    const current: string = r0.json.data.period;
    // Answered last month under a later label (e.g. before a payday change or
    // while in a partner's pool with another payday).
    const [y, m] = current.split("-").map(Number);
    const laterLabel = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
    await prisma.peaceCheckin.create({ data: { userId: owner.id, period: laterLabel, score: 1, createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    await call(owner.id, "POST", { score: 5 });
    const r = await call(owner.id, "GET");
    assert.deepEqual(r.json.data.checkins.map((c: any) => [c.period, c.score]), [[laterLabel, 1], [current, 5]],
      "the answer just given is the latest, though its label is earlier");
    assert.equal(r.json.data.current, 5);
  });

  it("without the table, the active-users report still runs and the API says it clearly", async () => {
    const { owner } = await couple("missing");
    await prisma.$executeRawUnsafe(`ALTER TABLE "PeaceCheckin" RENAME TO "PeaceCheckin_hidden"`);
    try {
      const input = await stats.loadActivity(prisma, new Date());
      assert.equal(input.notes?.length, 1);
      assert.match(stats.formatActiveStats(stats.computeActiveStats(input, new Date()), new Date()), /PeaceCheckin no existe/);
      const peace = await import("./peace.js");
      assert.equal(await peace.loadPeaceRows(prisma), null);
      assert.equal((await call(owner.id, "GET")).status, 503);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "PeaceCheckin_hidden" RENAME TO "PeaceCheckin"`);
    }
  });

  it("answering counts as activity, for the person who answered", async () => {
    const { owner, partner } = await couple("active");
    const now = new Date();
    let ids = new Set((await stats.loadActivity(prisma, now)).activity.map(a => a.userId));
    assert.ok(!ids.has(partner.id));
    await call(partner.id, "POST", { score: 3 });
    ids = new Set((await stats.loadActivity(prisma, now)).activity.map(a => a.userId));
    assert.ok(ids.has(partner.id), "the partner who answered is active");
    assert.ok(!ids.has(owner.id), "not the pool's owner");
  });
});
