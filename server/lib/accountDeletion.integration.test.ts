// Export my data and delete my account (LPBETA-09) against a REAL Postgres:
// the export holds only mine (not the partner's), request → cancel, a cancel
// during a purge is refused, the purge waits 24 h, a Stripe failure leaves
// everything as it was, deleting the pool OWNER hands the pool to the partner
// (she keeps everything she has a claim on), deleting the MEMBER erases her
// everywhere, and the purge is idempotent. Opt-in: skipped unless
// TEST_DATABASE_URL is set.
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
  let debtLib: typeof import("./debtBalance.js");
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
    debtLib = await import("./debtBalance.js");
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

  async function link(ownerId: string, memberId: string, memberEmail: string) {
    await ok(ownerId, "POST", "/api/partner/invite", { email: memberEmail });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: ownerId, status: "pending" } });
    await ok(memberId, "POST", "/api/partner/accept", { token: inv.token });
  }

  /** Asks for the code, then swaps it for a known one (the real one only goes to the console). */
  async function requestDeletion(userId: string) {
    await ok(userId, "POST", "/api/account/deletion/code");
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email!;
    await prisma.otpToken.updateMany({ where: { email, type: "account_deletion" }, data: { tokenHash: hashOtp("246810") } });
    return (await ok(userId, "POST", "/api/account/deletion", { code: "246810" })).data as { requestedAt: string; dueAt: string };
  }

  const sent: string[] = [];
  const deletedCustomers: string[] = [];
  const deps = (now: Date, stripe: "ok" | "fail" | "off" = "ok") => ({
    now,
    banking: null,
    deleteStripeCustomer: stripe === "off" ? null : async (id: string) => {
      if (stripe === "fail") throw new Error("stripe down");
      deletedCustomers.push(id);
    },
    sendDeletedEmail: async (email: string) => { sent.push(email); },
  });
  const summary = (deleted: number, extra: Partial<{ failed: number; skipped: number; remaining: number }> = {}) =>
    ({ deleted, failed: 0, skipped: 0, remaining: 0, ...extra });

  /** What each of `person`'s own expenses (entered by her; with no creator,
   *  paid by her) counts as spending, by month — the rule: deleting the other
   *  person never changes a closed month of the survivor. */
  async function countedByMonth(scope: string, person: string, alsoIds: string[] = []): Promise<Record<string, number>> {
    const counted = await debtLib.countedAmounts(scope);
    const rows = await prisma.expense.findMany({
      where: { userId: scope, OR: [{ createdByUserId: person }, { createdByUserId: null, payerUserId: person }, { id: { in: alsoIds } }] },
      select: { id: true, amount: true, date: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) {
      const month = r.date.toISOString().slice(0, 7);
      out[month] = (out[month] ?? 0) + (counted.get(r.id) ?? r.amount);
    }
    return out;
  }
  async function liveBalance(scope: string, debtId: string): Promise<number> {
    const [ledger] = await debtLib.loadDebtLedgers(scope, [debtId]);
    return debtLib.debtState(ledger).balance;
  }
  const after25h = (state: { requestedAt: string }) => new Date(new Date(state.requestedAt).getTime() + 25 * HOUR);

  let A = "", B = "", C = "";
  const ids: Record<string, string> = {};

  it("setup: B joins A's household; each enters their own movements", async () => {
    A = await signUp("Ana", "ana@test.local");
    B = await signUp("Bea", "bea@test.local");
    await link(A, B, "bea@test.local");

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
      const owners = await prisma.account.findMany({ where: { id: { in: doc.accounts.map((a: any) => a.id) } }, select: { ownerUserId: true } });
      assert.ok(owners.length > 0 && owners.every(o => o.ownerUserId === me));
      assert.ok(!text.includes(me === A ? B : A), "the partner's id appears in the export");
      assert.ok(!/externalAccount(Id|Key)/.test(text));
    }
  });

  it("export follows the listings' visibility: never the partner's private items, always my own", async () => {
    const privAccount = await prisma.account.create({ data: { userId: A, ownerUserId: A, name: "ANA-PRIVATE-ACC", type: "checking", visibility: "private" } });
    await prisma.expense.create({ data: { userId: A, amount: 400, description: "ANA-PRIVATE-BUY", accountId: privAccount.id, createdByUserId: A, payerUserId: A } });
    const privDebt = await prisma.debt.create({ data: { userId: A, ownerUserId: A, name: "ANA-PRIVATE-DEBT", kind: "other", visibility: "private", currentBalance: 9_000 } });
    const privLine = await prisma.allocation.create({ data: { userId: A, name: "ANA-PRIVATE-LINE", type: "debt", debtId: privDebt.id } });
    // A legacy row: B's expense in A's private debt line.
    await prisma.expense.create({ data: { userId: A, amount: 100, description: "BEA-IN-HIDDEN-LINE", allocationId: privLine.id, createdByUserId: B, payerUserId: B } });

    const bJson = await (await raw(B, "GET", "/api/account/export")).text();
    const bCsv = await (await raw(B, "GET", "/api/account/export/movements")).text();
    for (const name of ["ANA-PRIVATE-ACC", "ANA-PRIVATE-BUY", "ANA-PRIVATE-DEBT", "ANA-PRIVATE-LINE", "BEA-IN-HIDDEN-LINE"]) {
      assert.ok(!bJson.includes(name) && !bCsv.includes(name), `B's export shows ${name}`);
    }
    const aJson = await (await raw(A, "GET", "/api/account/export")).text();
    const aCsv = await (await raw(A, "GET", "/api/account/export/movements")).text();
    for (const name of ["ANA-PRIVATE-ACC", "ANA-PRIVATE-DEBT", "ANA-PRIVATE-LINE"]) assert.ok(aJson.includes(name), `A's export lacks ${name}`);
    assert.ok(aCsv.includes("ANA-PRIVATE-BUY") && aCsv.includes("ANA-PRIVATE-ACC"));
  });

  it("request → cancel: the mark is set with a 24 h due date, then cleared", async () => {
    const wrong = await raw(A, "POST", "/api/account/deletion", { code: "000000" });
    assert.equal(wrong.status, 400);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: A } })).deletionRequestedAt, null);

    const state = await requestDeletion(A);
    assert.equal(new Date(state.dueAt).getTime() - new Date(state.requestedAt).getTime(), 24 * HOUR);
    assert.deepEqual((await ok(A, "GET", "/api/account/deletion")).data, state);
    assert.deepEqual((await ok(A, "POST", "/api/account/deletion", { code: "x" })).data, state, "a second request keeps the first date");

    assert.equal((await ok(A, "DELETE", "/api/account/deletion")).data, null);
    assert.equal((await ok(A, "GET", "/api/account/deletion")).data, null);
  });

  it("a cancel while the purge holds the account is refused with 409, not half-done", async () => {
    await requestDeletion(A);
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    let locked!: () => void;
    const isLocked = new Promise<void>(r => { locked = r; });
    const purgeLike = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${A} FOR UPDATE`;
      locked();
      await held;
    }, { timeout: 20_000 });
    await isLocked;
    const res = await raw(A, "DELETE", "/api/account/deletion");
    assert.equal(res.status, 409);
    assert.equal((await res.json() as any).code, "deletion_in_progress");
    release();
    await purgeLike;
    assert.notEqual((await prisma.user.findUniqueOrThrow({ where: { id: A } })).deletionRequestedAt, null);
    // Between the purge's short steps the claim (deletionStartedAt) says the same.
    await prisma.user.update({ where: { id: A }, data: { deletionStartedAt: new Date() } });
    assert.equal((await raw(A, "DELETE", "/api/account/deletion")).status, 409);
    // A claim over an hour old belongs to a run that died: cancelling works.
    await prisma.user.update({ where: { id: A }, data: { deletionStartedAt: new Date(Date.now() - 2 * HOUR) } });
    await ok(A, "DELETE", "/api/account/deletion");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: A } })).deletionStartedAt, null);
  });

  it("the cron route needs CRON_SECRET", async () => {
    assert.equal((await raw(null, "GET", "/api/account/cron")).status, 401);
    assert.equal((await raw(null, "GET", "/api/account/cron", undefined, { authorization: "Bearer nope" })).status, 401);
    const res = await raw(null, "GET", "/api/account/cron", undefined, { authorization: "Bearer cron-test-secret" });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json() as any).data, summary(0));
  });

  it("the deletion code shares the emailed-code limits (3 an hour per address) → 429 rate_limited", async () => {
    const G = await signUp("Gema", "gema@test.local");
    for (let i = 0; i < 3; i++) {
      await ok(G, "POST", "/api/account/deletion/code");
      await prisma.otpToken.deleteMany({ where: { email: "gema@test.local" } }); // past the 1/min pace
    }
    const res = await raw(G, "POST", "/api/account/deletion/code");
    assert.equal(res.status, 429);
    assert.equal((await res.json() as any).code, "rate_limited");
  });

  // ── deleting the pool OWNER: the pool is handed to the partner ─────────

  it("setup: pool data the partner has a claim on, and cross-owner pairs", async () => {
    ids.household = (await prisma.householdMember.findFirstOrThrow({ where: { userId: A, role: "owner" } })).householdId;
    await prisma.userSettings.update({ where: { userId: A }, data: { cycleStartDay: 15 } });
    const line = await prisma.allocation.findFirstOrThrow({ where: { userId: A, type: "flexible", isDefault: true } });
    ids.line = line.id;
    await prisma.allocation.update({ where: { id: line.id }, data: { allocatedAmount: 45_000 } });
    ids.monthly = (await prisma.monthlyBudget.create({ data: { userId: A, allocationId: line.id, month: "2026-11", allocatedAmount: 40_000 } })).id;
    ids.rule = (await prisma.categorizationRule.create({ data: { userId: A, pattern: "mercadona", allocationId: line.id } })).id;
    ids.recurring = (await prisma.recurringCommitment.create({ data: { userId: A, merchant: "netflix", avgAmount: 1299 } })).id;
    // A plan from before plans had an owner, with a deposit by each.
    ids.ownerlessPlan = (await prisma.lifePlan.create({ data: { userId: A, title: "Vacaciones", targetAmount: 100_000 } })).id;
    ids.depositA = (await prisma.planDeposit.create({ data: { userId: A, planId: ids.ownerlessPlan, amount: 5_000, month: "2026-10", byUserId: A } })).id;
    ids.depositB = (await prisma.planDeposit.create({ data: { userId: A, planId: ids.ownerlessPlan, amount: 7_000, month: "2026-11", byUserId: B } })).id;
    ids.anaPlan = (await prisma.lifePlan.create({ data: { userId: A, ownerUserId: A, title: "ANA-PLAN", targetAmount: 50_000 } })).id;
    // A shared expense A entered and B paid, split in two.
    ids.sharedPaidByB = (await prisma.expense.create({
      data: {
        userId: A, amount: 1_000, description: "SHARED-B-PAID", payerUserId: B, createdByUserId: A, scope: "shared",
        shares: { create: [{ userId: A, amount: 500 }, { userId: B, amount: 500 }] },
      },
    })).id;
    // Cross-owner pair 1: B's card with A's debt on it (from before the same-owner rule).
    ids.bCard = (await prisma.account.create({ data: { userId: A, ownerUserId: B, name: "Visa Bea", type: "card" } })).id;
    ids.aDebtOnBCard = (await prisma.debt.create({ data: { userId: A, ownerUserId: A, name: "Deuda Visa", kind: "credit_card", accountId: ids.bCard } })).id;
    await prisma.expense.create({ data: { userId: A, amount: 2_500, description: "BEA-CARD-BUY", accountId: ids.bCard, payerUserId: B, createdByUserId: B } });
    // Cross-owner pair 2: B's loan drawn on A's account, live 100 + 20 = 120 €.
    ids.aAccount = (await prisma.account.create({ data: { userId: A, ownerUserId: A, name: "Cuenta Ana", type: "checking" } })).id;
    ids.bDebtOnAAccount = (await prisma.debt.create({
      data: { userId: A, ownerUserId: B, name: "Préstamo Bea", kind: "other", accountId: ids.aAccount, currentBalance: 10_000, balanceAsOf: new Date("2026-01-01T00:00:00Z") },
    })).id;
    await prisma.expense.create({ data: { userId: A, amount: 2_000, description: "ANA-ON-HER-ACCOUNT", accountId: ids.aAccount, createdByUserId: A, payerUserId: A } });
    // …and a payment of it dated in the future (must not be subtracted twice).
    await prisma.expense.create({
      data: { userId: A, amount: 1_500, description: "BEA-LOAN-FUTURE", debtId: ids.bDebtOnAAccount, payerUserId: B, createdByUserId: B, date: new Date(Date.now() + 40 * 24 * HOUR) },
    });
    // A's own card, used and paid by B too (same owner: no pair).
    const old = new Date("2026-09-01T00:00:00Z");
    ids.aCard = (await prisma.account.create({ data: { userId: A, ownerUserId: A, name: "Visa Ana", type: "card" } })).id;
    ids.aCardDebt = (await prisma.debt.create({ data: { userId: A, ownerUserId: A, name: "Visa Ana", kind: "credit_card", accountId: ids.aCard, balanceAsOf: old } })).id;
    await prisma.expense.create({ data: { userId: A, amount: 3_000, description: "ANA-CARD-BUY", accountId: ids.aCard, payerUserId: A, createdByUserId: A, date: new Date("2026-09-05T12:00:00Z") } });
    // As POST /api/expenses stores them: the payer defaults to the card's owner (A).
    await prisma.expense.create({ data: { userId: A, amount: 2_000, description: "BEA-ON-ANA-CARD", accountId: ids.aCard, payerUserId: A, createdByUserId: B, date: new Date("2026-09-06T12:00:00Z") } });
    await prisma.expense.create({ data: { userId: A, amount: 4_000, description: "BEA-PAYS-ANA-CARD", debtId: ids.aCardDebt, payerUserId: A, createdByUserId: B, date: new Date("2026-10-02T12:00:00Z") } });
    // The shared expense A entered and B paid becomes hers too (its creator is erased).
    ids.bCountedBefore = JSON.stringify(await countedByMonth(A, B, [ids.sharedPaidByB]));
    ids.bLoanLiveBefore = String(await liveBalance(A, ids.bDebtOnAAccount));
  });

  it("the purge waits 24 h; a Stripe failure changes nothing, and unconfigured billing never deletes a live subscription", async () => {
    await prisma.subscription.create({ data: { userId: A, stripeCustomerId: "cus_ana", stripeSubscriptionId: "sub_ana", plan: "premium", status: "active" } });
    const state = await requestDeletion(A);
    ids.aRequestedAt = state.requestedAt;

    const early = await deletion.runDeletionPurge(prisma, deps(new Date(new Date(state.requestedAt).getTime() + 23 * HOUR)));
    assert.deepEqual(early, summary(0));
    const outOfTime = await deletion.runDeletionPurge(prisma, deps(after25h(state)), { budgetMs: 0 });
    assert.deepEqual(outOfTime, summary(0, { remaining: 1 }));

    const off = await deletion.runDeletionPurge(prisma, deps(after25h(state), "off"));
    assert.deepEqual(off, summary(0, { skipped: 1 }));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: A } })).deletionStartedAt, null, "claim released");

    const failed = await deletion.runDeletionPurge(prisma, deps(after25h(state), "fail"));
    assert.deepEqual(failed, summary(0, { failed: 1 }));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: A } })).deletionStartedAt, null, "claim released");
    // Nothing irreversible happened: still there, still linked, pool untouched.
    assert.ok(await prisma.user.findUnique({ where: { id: A } }));
    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: B } })).linkedUserId, A);
    assert.equal(await prisma.expense.count({ where: { userId: A, description: "BEA-CAFE" } }), 1);
    assert.equal((await prisma.debt.findUniqueOrThrow({ where: { id: ids.bDebtOnAAccount } })).accountId, ids.aAccount);
  });

  it("deleting the pool OWNER hands the pool to the partner, with everything she has a claim on", async () => {
    const due = await deletion.runDeletionPurge(prisma, deps(after25h({ requestedAt: ids.aRequestedAt })));
    assert.deepEqual(due, summary(1));
    assert.deepEqual(deletedCustomers, ["cus_ana"]);
    assert.deepEqual(sent, ["ana@test.local"]);

    // A and what was only hers are gone.
    assert.equal(await prisma.user.findUnique({ where: { id: A } }), null);
    for (const where of [{ userId: A }, { ownerUserId: A }]) {
      assert.equal(await prisma.account.count({ where }), 0);
      assert.equal(await prisma.debt.count({ where }), 0);
      assert.equal(await prisma.income.count({ where }), 0);
    }
    for (const description of ["ANA-SUPER", "ANA-ON-HER-ACCOUNT"]) assert.equal(await prisma.expense.count({ where: { description } }), 0);
    assert.equal(await prisma.subscription.count({ where: { userId: A } }), 0);
    assert.equal(await prisma.lifePlan.count({ where: { id: ids.anaPlan } }), 0);
    assert.equal(await prisma.otpToken.count({ where: { email: "ana@test.local" } }), 0);
    for (const field of ["payerUserId", "createdByUserId", "beneficiaryUserId"] as const) {
      assert.equal(await prisma.expense.count({ where: { [field]: A } }), 0, field);
    }
    assert.equal(await prisma.expenseShare.count({ where: { userId: A } }), 0);

    // B: unlinked, the pool's budget period, owner of the household.
    const bSettings = await prisma.userSettings.findUniqueOrThrow({ where: { userId: B } });
    assert.equal(bSettings.linkedUserId, null);
    assert.equal(bSettings.cycleStartDay, 15);
    const membership = await prisma.householdMember.findFirstOrThrow({ where: { userId: B, householdId: ids.household } });
    assert.equal(membership.role, "owner");
    assert.equal((await prisma.household.findUniqueOrThrow({ where: { id: ids.household } })).name, "Hogar de Bea");

    // Budget line with its amount, monthly budget, rule, recurring.
    const line = await prisma.allocation.findUniqueOrThrow({ where: { id: ids.line } });
    assert.equal(line.userId, B);
    assert.equal(line.allocatedAmount, 45_000);
    assert.equal((await prisma.monthlyBudget.findUniqueOrThrow({ where: { id: ids.monthly } })).userId, B);
    assert.equal((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: ids.rule } })).userId, B);
    assert.equal((await prisma.recurringCommitment.findUniqueOrThrow({ where: { id: ids.recurring } })).userId, B);

    // The ownerless plan and both deposits (A's authorship erased).
    assert.equal((await prisma.lifePlan.findUniqueOrThrow({ where: { id: ids.ownerlessPlan } })).userId, B);
    const deposits = await prisma.planDeposit.findMany({ where: { planId: ids.ownerlessPlan }, orderBy: { month: "asc" } });
    assert.deepEqual(deposits.map(d => [d.userId, d.amount, d.byUserId]), [[B, 5_000, null], [B, 7_000, B]]);

    // The shared expense she paid, its shares still adding up (all hers now).
    const shared = await prisma.expense.findUniqueOrThrow({ where: { id: ids.sharedPaidByB }, include: { shares: true } });
    assert.equal(shared.userId, B);
    assert.equal(shared.payerUserId, B);
    assert.equal(shared.createdByUserId, null);
    assert.deepEqual(shared.shares.map(s => [s.userId, s.amount]), [[B, 1_000]]);

    // Pair 1: her card keeps its debt, now hers, still fed by her purchase.
    assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: ids.bCard } })).userId, B);
    const cardDebt = await prisma.debt.findUniqueOrThrow({ where: { id: ids.aDebtOnBCard } });
    assert.deepEqual([cardDebt.userId, cardDebt.ownerUserId, cardDebt.accountId], [B, B, ids.bCard]);
    // Pair 2: her loan keeps its live balance, no longer on A's account; the
    // future-dated payment counts once (anchor 120 €, live 105 €).
    const loan = await prisma.debt.findUniqueOrThrow({ where: { id: ids.bDebtOnAAccount } });
    assert.deepEqual([loan.userId, loan.accountId, loan.currentBalance], [B, null, 12_000]);
    assert.equal(await liveBalance(B, ids.bDebtOnAAccount), Number(ids.bLoanLiveBefore));
    // A's card that B used and paid: kept, hers, renamed, with its whole ledger.
    const aCard = await prisma.account.findUniqueOrThrow({ where: { id: ids.aCard } });
    const aCardDebt = await prisma.debt.findUniqueOrThrow({ where: { id: ids.aCardDebt } });
    assert.deepEqual([aCard.userId, aCard.ownerUserId, aCard.name], [B, B, "Tarjeta compartida"]);
    assert.deepEqual([aCardDebt.ownerUserId, aCardDebt.accountId, aCardDebt.name], [B, ids.aCard, "Tarjeta compartida"]);
    const anaCardBuy = await prisma.expense.findFirstOrThrow({ where: { description: "ANA-CARD-BUY" } });
    assert.deepEqual([anaCardBuy.userId, anaCardBuy.payerUserId, anaCardBuy.createdByUserId], [B, null, null]);
    // B's purchase and payment on A's card survive, hers.
    for (const description of ["BEA-ON-ANA-CARD", "BEA-PAYS-ANA-CARD"]) {
      const e = await prisma.expense.findFirstOrThrow({ where: { description } });
      assert.deepEqual([e.userId, e.createdByUserId], [B, B], description);
    }
    // The rule: no month of B's counted spending changed.
    assert.equal(JSON.stringify(await countedByMonth(B, B)), ids.bCountedBefore);

    // Her own movements, in her scope; her session sees them in her export.
    assert.equal(await prisma.expense.count({ where: { userId: B, description: { in: ["BEA-CAFE", "BEA-CARD-BUY"] } } }), 2);
    assert.equal(await prisma.income.count({ where: { userId: B, description: "BEA-NOMINA" } }), 1);
    const csv = await (await raw(B, "GET", "/api/account/export/movements")).text();
    assert.ok(csv.includes("BEA-CAFE") && csv.includes("SHARED-B-PAID"));
    assert.equal(await prisma.household.count({ where: { members: { none: {} } } }), 0);
  });

  it("the purge is idempotent: a second run (and a gone user) change nothing", async () => {
    const later = new Date(Date.now() + 48 * HOUR);
    assert.deepEqual(await deletion.runDeletionPurge(prisma, deps(later)), summary(0));
    assert.equal(await deletion.purgeUser(prisma, A, deps(later)), "gone");
    assert.equal(await deletion.purgeUser(prisma, B, deps(later)), "not_due");
    assert.deepEqual(sent, ["ana@test.local"]);
  });

  // ── deleting the MEMBER: unlinked, then erased everywhere ───────────────

  it("deleting the MEMBER removes her data and every trace of her in the owner's", async () => {
    C = await signUp("Carla", "carla@test.local");
    await link(C, B, "bea@test.local");
    await ok(C, "POST", "/api/expenses", { amount: "7.00", description: "CARLA-GAS" });
    assert.equal(await prisma.expense.count({ where: { userId: C, description: "BEA-CAFE" } }), 1, "B's data merged into C's pool");
    // C's shared expense, split with B; one C entered for B's benefit.
    ids.cShared = (await prisma.expense.create({
      data: {
        userId: C, amount: 600, description: "CARLA-SHARED", payerUserId: C, createdByUserId: C, scope: "shared",
        shares: { create: [{ userId: C, amount: 300 }, { userId: B, amount: 300 }] },
      },
    })).id;
    ids.cForB = (await prisma.expense.create({ data: { userId: C, amount: 900, description: "CARLA-FOR-BEA", payerUserId: C, createdByUserId: C, beneficiaryUserId: B } })).id;
    // Cross-owner pairs: C's debt on B's checking; B's debt on C's card.
    ids.bChecking = (await prisma.account.create({ data: { userId: C, ownerUserId: B, name: "Cuenta Bea 2", type: "checking" } })).id;
    ids.cDebtOnB = (await prisma.debt.create({
      data: { userId: C, ownerUserId: C, name: "Deuda Carla", kind: "other", accountId: ids.bChecking, currentBalance: 3_000, balanceAsOf: new Date("2026-01-01T00:00:00Z") },
    })).id;
    await prisma.expense.create({ data: { userId: C, amount: 500, description: "BEA-ON-CHECKING", accountId: ids.bChecking, payerUserId: B, createdByUserId: B } });
    ids.cCard = (await prisma.account.create({ data: { userId: C, ownerUserId: C, name: "Visa Carla", type: "card" } })).id;
    ids.bDebtOnCCard = (await prisma.debt.create({ data: { userId: C, ownerUserId: B, name: "Deuda Visa Carla", kind: "credit_card", accountId: ids.cCard } })).id;
    // B's debts that C pays: one on no account, one on C's checking (a pair).
    ids.bLoanCPays = (await prisma.debt.create({ data: { userId: C, ownerUserId: B, name: "Préstamo Bea 2", kind: "other", currentBalance: 50_000, balanceAsOf: new Date("2026-08-01T00:00:00Z") } })).id;
    await prisma.expense.create({ data: { userId: C, amount: 10_000, description: "CARLA-PAYS-BEA-LOAN", debtId: ids.bLoanCPays, payerUserId: C, createdByUserId: C, date: new Date("2026-09-10T12:00:00Z") } });
    ids.cChecking = (await prisma.account.create({ data: { userId: C, ownerUserId: C, name: "Cuenta Carla", type: "checking" } })).id;
    ids.bDebtOnCChecking = (await prisma.debt.create({ data: { userId: C, ownerUserId: B, name: "Línea Bea", kind: "other", accountId: ids.cChecking, balanceAsOf: new Date("2026-08-01T00:00:00Z") } })).id;
    await prisma.expense.create({ data: { userId: C, amount: 2_000, description: "CARLA-ON-CHECKING", accountId: ids.cChecking, payerUserId: C, createdByUserId: C, date: new Date("2026-09-11T12:00:00Z") } });
    await prisma.expense.create({ data: { userId: C, amount: 1_500, description: "CARLA-PAYS-LINE", debtId: ids.bDebtOnCChecking, payerUserId: C, createdByUserId: C, date: new Date("2026-09-20T12:00:00Z") } });
    const cCountedBefore = JSON.stringify(await countedByMonth(C, C));

    // Rows B still owns in a former partner's scope, with no link any more.
    const F = await signUp("Fede", "fede@test.local");
    ids.bAccInF = (await prisma.account.create({ data: { userId: F, ownerUserId: B, name: "BEA-LEFT-IN-F", type: "checking" } })).id;
    await prisma.income.create({ data: { userId: F, ownerUserId: B, amount: 900, description: "BEA-INCOME-IN-F" } });
    ids.fDebtOnB = (await prisma.debt.create({ data: { userId: F, ownerUserId: F, name: "Deuda Fede", kind: "other", accountId: ids.bAccInF, currentBalance: 1_000, balanceAsOf: new Date("2026-01-01T00:00:00Z") } })).id;
    ids.fCard = (await prisma.account.create({ data: { userId: F, ownerUserId: F, name: "Visa Fede", type: "card" } })).id;
    ids.bDebtOnFCard = (await prisma.debt.create({ data: { userId: F, ownerUserId: B, name: "Deuda Visa Fede", kind: "credit_card", accountId: ids.fCard } })).id;
    // B's loan in F's scope, paid from her account there; and F's own spending.
    ids.bAcc2InF = (await prisma.account.create({ data: { userId: F, ownerUserId: B, name: "BEA-ACC2-IN-F", type: "checking" } })).id;
    ids.bLoanInF = (await prisma.debt.create({ data: { userId: F, ownerUserId: B, name: "BEA-LOAN-IN-F", kind: "other", currentBalance: 20_000, balanceAsOf: new Date("2026-08-01T00:00:00Z") } })).id;
    for (const date of ["2026-09-03T12:00:00Z", "2026-10-03T12:00:00Z"]) {
      await prisma.expense.create({
        data: { userId: F, amount: 5_000, description: "BEA-LOAN-PAY-IN-F", debtId: ids.bLoanInF, accountId: ids.bAcc2InF, payerUserId: B, createdByUserId: B, date: new Date(date) },
      });
    }
    await prisma.expense.create({ data: { userId: F, amount: 3_300, description: "FEDE-SUPER", payerUserId: F, createdByUserId: F, date: new Date("2026-09-04T12:00:00Z") } });
    const fCountedBefore = JSON.stringify(await countedByMonth(F, F));
    // …which her export includes.
    const bJson = await (await raw(B, "GET", "/api/account/export")).text();
    assert.ok(bJson.includes("BEA-LEFT-IN-F") && bJson.includes("Deuda Visa Fede"));
    assert.ok((await (await raw(B, "GET", "/api/account/export/movements")).text()).includes("BEA-INCOME-IN-F"));

    // Someone else's pending invite to her email.
    const D = await signUp("Dani", "dani@test.local");
    await prisma.partnerInvite.create({ data: { senderId: D, invitedEmail: "bea@test.local", token: "tok-dani-bea", expiresAt: new Date(Date.now() + 86_400_000) } });

    const state = await requestDeletion(B);
    assert.deepEqual(await deletion.runDeletionPurge(prisma, deps(after25h(state))), summary(1));

    // C's months are what they were; the debts C pays are now C's.
    assert.equal(JSON.stringify(await countedByMonth(C, C)), cCountedBefore);
    for (const id of [ids.bLoanCPays, ids.bDebtOnCChecking]) {
      const d = await prisma.debt.findUniqueOrThrow({ where: { id } });
      assert.deepEqual([d.userId, d.ownerUserId, d.name], [C, C, "Deuda compartida"]);
    }
    assert.equal((await prisma.debt.findUniqueOrThrow({ where: { id: ids.bDebtOnCChecking } })).accountId, ids.cChecking);
    // In F's scope: hers gone, F's debt frozen off her account, her debt on F's card now F's.
    assert.equal(await prisma.account.count({ where: { id: ids.bAccInF } }), 0);
    assert.equal(await prisma.income.count({ where: { description: "BEA-INCOME-IN-F" } }), 0);
    const fDebt = await prisma.debt.findUniqueOrThrow({ where: { id: ids.fDebtOnB } });
    assert.deepEqual([fDebt.accountId, fDebt.currentBalance], [null, 1_000]);
    assert.deepEqual((await prisma.debt.findUniqueOrThrow({ where: { id: ids.bDebtOnFCard } })).ownerUserId, F);
    // Her loan and its payments are gone from F's scope; F's months unchanged.
    assert.equal(await prisma.debt.count({ where: { id: ids.bLoanInF } }), 0);
    assert.equal(await prisma.expense.count({ where: { description: "BEA-LOAN-PAY-IN-F" } }), 0);
    assert.equal(await prisma.account.count({ where: { id: ids.bAcc2InF } }), 0);
    assert.equal(JSON.stringify(await countedByMonth(F, F)), fCountedBefore);

    assert.equal(await prisma.user.findUnique({ where: { id: B } }), null);
    assert.equal(await prisma.expense.count({ where: { description: { startsWith: "BEA-" } } }), 0);
    assert.equal(await prisma.income.count({ where: { description: { startsWith: "BEA-" } } }), 0);
    for (const where of [{ userId: B }, { ownerUserId: B }]) {
      assert.equal(await prisma.account.count({ where }), 0);
      assert.equal(await prisma.debt.count({ where }), 0);
      assert.equal(await prisma.income.count({ where }), 0);
      assert.equal(await prisma.bankConnection.count({ where }), 0);
    }
    for (const field of ["payerUserId", "createdByUserId", "beneficiaryUserId"] as const) {
      assert.equal(await prisma.expense.count({ where: { [field]: B } }), 0, field);
    }
    assert.equal(await prisma.expenseShare.count({ where: { userId: B } }), 0);
    assert.equal(await prisma.partnerInvite.count({ where: { invitedEmail: "bea@test.local" } }), 0);

    // C keeps hers, consistent.
    assert.equal(await prisma.expense.count({ where: { userId: C, description: "CARLA-GAS" } }), 1);
    const shared = await prisma.expense.findUniqueOrThrow({ where: { id: ids.cShared }, include: { shares: true } });
    assert.deepEqual(shared.shares.map(s => [s.userId, s.amount]), [[C, 600]]);
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: ids.cForB } })).beneficiaryUserId, null);
    const frozen = await prisma.debt.findUniqueOrThrow({ where: { id: ids.cDebtOnB } });
    assert.deepEqual([frozen.accountId, frozen.currentBalance], [null, 3_500], "C's debt keeps its live balance (30 + 5 €)");
    const cardDebt = await prisma.debt.findUniqueOrThrow({ where: { id: ids.bDebtOnCCard } });
    assert.deepEqual([cardDebt.ownerUserId, cardDebt.accountId], [C, ids.cCard], "her card's debt belongs to the card's owner");
    assert.equal(await prisma.householdMember.count({ where: { userId: C } }), 1);
  });

  it("a deleted account's session is closed", async () => {
    assert.equal((await raw(A, "GET", "/api/account/deletion")).status, 401);
    assert.equal((await raw(B, "GET", "/api/account/deletion")).status, 401);
  });
});
