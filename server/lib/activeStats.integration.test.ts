// The active-users loader (LPBETA-05) against a REAL Postgres: which rows count
// as a person's activity and whose it is. Opt-in: skipped unless
// TEST_DATABASE_URL is set (see server/lib/ingest/import.integration.test.ts
// for the setup). Every table is TRUNCATEd, so the host must be localhost.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("active users (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let stats: typeof import("./activeStats.js");

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.TZ = "UTC";
    ({ prisma } = await import("./prisma.js"));
    stats = await import("./activeStats.js");
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.length > 0, "schema not pushed to the test database");
    const list = tables.map(t => `"public"."${t.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  it("counts what people did, not what the daily bank sync wrote", async () => {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const user = (email: string) => prisma.user.create({ data: { email } });

    const manual = await user("manual@test.local");     // entered an expense by hand
    const partner = await user("partner@test.local");   // entered one in manual's pool
    const synced = await user("synced@test.local");     // only the daily sync wrote rows
    const reviewer = await user("reviewer@test.local"); // reviewed bank movements
    const saver = await user("saver@test.local");       // made a plan deposit
    const earner = await user("earner@test.local");     // entered an income
    await user("idle@test.local");                       // nothing

    await prisma.expense.createMany({
      data: [
        { userId: manual.id, createdByUserId: manual.id, amount: 1000, source: "manual" },
        { userId: manual.id, createdByUserId: partner.id, amount: 500, source: "import" },
        { userId: synced.id, createdByUserId: synced.id, amount: 700, source: "bank_sync" },
      ],
    });
    await prisma.income.create({ data: { userId: earner.id, ownerUserId: earner.id, amount: 200000, source: "manual" } });
    await prisma.income.create({ data: { userId: synced.id, ownerUserId: synced.id, amount: 200000, source: "bank_sync" } });
    await prisma.user.update({ where: { id: reviewer.id }, data: { lastBankReviewAt: ago(2) } });

    const plan = await prisma.lifePlan.create({ data: { userId: saver.id, ownerUserId: saver.id, title: "Fondo", targetAmount: 100000 } });
    await prisma.planDeposit.create({ data: { userId: saver.id, planId: plan.id, amount: 5000, month: "2026-11" } });

    const household = await prisma.household.create({ data: { name: "Casa" } });
    await prisma.householdMember.createMany({ data: [
      { householdId: household.id, userId: manual.id, role: "owner" },
      { householdId: household.id, userId: partner.id },
    ] });

    const s = stats.computeActiveStats(await stats.loadActivity(prisma, now), now);
    assert.equal(s.registered.total, 7);
    // manual, partner, reviewer, saver, earner — not synced, not idle.
    assert.equal(s.active.last30, 5);
    assert.equal(s.active.last7, 5);
    assert.equal(s.householdsOfTwo, 1);
    assert.equal(s.withPlan, 1);
    assert.equal(s.depositedLast30, 1);

    const text = stats.formatActiveStats(s, now);
    for (const secret of ["@test.local", manual.id, "Fondo", "Casa", "1000", "200000"]) {
      assert.ok(!text.includes(secret), `report leaks ${secret}`);
    }
  });

  it("credits who did it in a household, and legacy rows to the pool owner", async () => {
    const list = (await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
      .map(t => `"public"."${t.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
    const now = new Date();
    const owner = await prisma.user.create({ data: { email: "owner@test.local" } });
    const partner = await prisma.user.create({ data: { email: "partner@test.local" } });
    const legacyOwner = await prisma.user.create({ data: { email: "legacy@test.local" } });

    // The partner deposits into a plan the owner created, in the owner's pool.
    const plan = await prisma.lifePlan.create({ data: { userId: owner.id, ownerUserId: owner.id, title: "Viaje", targetAmount: 100000 } });
    await prisma.planDeposit.create({ data: { userId: owner.id, planId: plan.id, byUserId: partner.id, amount: 3000, month: "2026-11" } });
    // An expense from before createdByUserId existed: the pool owner's.
    await prisma.expense.create({ data: { userId: legacyOwner.id, createdByUserId: null, amount: 900, source: "manual" } });

    const s = stats.computeActiveStats(await stats.loadActivity(prisma, now), now);
    const input = await stats.loadActivity(prisma, now);
    const activeIds = new Set(input.activity.map(a => a.userId));
    assert.ok(activeIds.has(partner.id), "the partner who deposited is active");
    assert.ok(!activeIds.has(owner.id), "the plan's creator did nothing");
    assert.ok(activeIds.has(legacyOwner.id), "a legacy row counts for the pool owner");
    assert.equal(s.active.last30, 2);
    assert.equal(s.depositedLast30, 1);
  });

  it("changing an old deposit this month is activity", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 90 * DAY_MS);
    const saver = await prisma.user.create({ data: { email: "old-saver@test.local", createdAt: old } });
    const plan = await prisma.lifePlan.create({ data: { userId: saver.id, ownerUserId: saver.id, title: "Casa", targetAmount: 100000 } });
    const deposit = await prisma.planDeposit.create({ data: { userId: saver.id, planId: plan.id, amount: 1000, month: "2026-08", createdAt: old } });
    await prisma.$executeRaw`UPDATE "PlanDeposit" SET "updatedAt" = ${old} WHERE id = ${deposit.id}`;
    let ids = new Set((await stats.loadActivity(prisma, now)).activity.map(a => a.userId));
    assert.ok(!ids.has(saver.id), "an untouched 90-day-old deposit is not activity");

    await prisma.planDeposit.update({ where: { id: deposit.id }, data: { amount: 2000, byUserId: saver.id } });
    ids = new Set((await stats.loadActivity(prisma, now)).activity.map(a => a.userId));
    assert.ok(ids.has(saver.id));
  });
});
