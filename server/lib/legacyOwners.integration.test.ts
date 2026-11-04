// The legacy-owners backfill (LPBETA-04) against a REAL Postgres. Opt-in:
// skipped unless TEST_DATABASE_URL is set (setup: server/lib/ingest/
// import.integration.test.ts). Every table is TRUNCATEd: localhost only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("legacy owners backfill (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let backfill: typeof import("../scripts/backfillLegacyOwners.js").backfillLegacyOwners;

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ({ prisma } = await import("./prisma.js"));
    ({ backfillLegacyOwners: backfill } = await import("../scripts/backfillLegacyOwners.js"));
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.length > 0, "schema not pushed to the test database");
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
  });

  after(async () => { await prisma?.$disconnect(); });

  it("fills only what is certain, and is idempotent", async () => {
    const solo = await prisma.user.create({ data: { email: "solo@test.local" } });
    const owner = await prisma.user.create({ data: { email: "owner@test.local" } });
    const partner = await prisma.user.create({ data: { email: "partner@test.local" } });
    const joined = new Date("2026-10-01T00:00:00Z");
    const household = await prisma.household.create({ data: { name: "Casa" } });
    await prisma.householdMember.create({ data: { householdId: household.id, userId: owner.id, role: "owner", joinedAt: new Date("2026-08-01T00:00:00Z") } });
    await prisma.householdMember.create({ data: { householdId: household.id, userId: partner.id, joinedAt: joined } });
    await prisma.userSettings.create({ data: { userId: partner.id, linkedUserId: owner.id } });

    await prisma.expense.createMany({ data: [
      { userId: solo.id, amount: 100, createdByUserId: null },
      { userId: owner.id, amount: 200, createdByUserId: null, createdAt: new Date("2026-09-15T00:00:00Z") }, // before the partner
      { userId: owner.id, amount: 300, createdByUserId: null, createdAt: new Date("2026-10-15T00:00:00Z") }, // after: ambiguous
      { userId: owner.id, amount: 400, createdByUserId: partner.id },                                        // already attributed
    ] });
    await prisma.lifePlan.create({ data: { userId: solo.id, title: "Plan", targetAmount: 1000 } });

    const dry = await backfill(prisma, false);
    assert.deepEqual(dry, { pools: 2, expenses: { fill: 2, ambiguous: 1 }, plans: { fill: 1, ambiguous: 0 } });
    assert.equal(await prisma.expense.count({ where: { createdByUserId: null } }), 3, "a dry run writes nothing");

    await backfill(prisma, true);
    assert.equal(await prisma.expense.count({ where: { userId: solo.id, createdByUserId: solo.id } }), 1);
    assert.equal(await prisma.expense.count({ where: { userId: owner.id, createdByUserId: owner.id } }), 1);
    assert.equal(await prisma.expense.count({ where: { createdByUserId: null } }), 1, "the ambiguous row stays");
    assert.equal(await prisma.expense.count({ where: { createdByUserId: partner.id } }), 1, "attributed rows are untouched");
    assert.equal(await prisma.lifePlan.count({ where: { ownerUserId: solo.id } }), 1);

    const again = await backfill(prisma, false);
    assert.deepEqual(again, { pools: 1, expenses: { fill: 0, ambiguous: 1 }, plans: { fill: 0, ambiguous: 0 } });
  });
});
