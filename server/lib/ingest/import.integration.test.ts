// Statement import end to end against a REAL Postgres, through the real routes
// (/api/expenses/import/preview + /confirm, /api/accounts, /api/debts,
// /api/accounts/:id/import-profile): what a file becomes, dedup across files
// and re-imports, and the money it moves (counted spending, derived debt
// balances, life plans). Opt-in: skipped unless TEST_DATABASE_URL is set, so
// `npm run test` and CI stay database-free.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/budget_test npm run test:integration
//
// The database must be a throwaway local one with the schema pushed
// (`DATABASE_URL=<it> npx prisma db push --skip-generate`): every table is
// TRUNCATEd at the start, so the host must be localhost (asserted).
//
// Every movement is dated September 2026 (period "2026-09"). Card debts are
// anchored on 1 Aug 2026 (as if the card had been added then): the ledger only
// reads movements after the anchor (server/lib/debtBalance.ts), and an anchor
// of "now" would leave fixed-date rows out of it.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as XLSX from "xlsx";
import { buildBbva } from "./fixtures/makeFixtures.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const PERIOD = "2026-09";
const CARD_ANCHOR = new Date("2026-08-01T00:00:00Z");

// The client's preview rows (src/app/hooks/useImport.ts), as far as these tests read them.
interface PreviewRow {
  externalId: string;
  date: string;
  description: string;
  merchant: string;
  amount: number;
  kind: "expense" | "income" | "payment" | "refund" | "needs_review";
  status: "new" | "duplicate";
  suggestedAllocationId: string | null;
  debtId?: string | null;
  duplicateReason?: string;
  possibleDuplicate?: unknown;
  learnedPayment?: { preselect: boolean };
  warnings?: string[];
}
interface Preview {
  rows: PreviewRow[];
  newCount: number;
  duplicateCount: number;
  expenseCount: number;
  incomeCount: number;
  paymentCount?: number;
  refundCount?: number;
  reviewCount?: number;
  source?: string;
  mode?: "account" | "card";
  purchasesSign?: "negative" | "positive" | "unknown";
  purchasesSignDetected?: boolean;
  accountId: string | null;
}
interface ConfirmRow {
  kind: "expense" | "income" | "payment" | "refund";
  externalId: string;
  date: string;
  description: string;
  merchant: string;
  amount: number;
  allocationId?: string | null;
  debtId?: string | null;
}

describe("statement import (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  // Loaded in before(), after the env points at the test database.
  let prisma: typeof import("../prisma.js").prisma;
  let signToken: typeof import("../jwt.js").signToken;
  let createDefaultAllocations: typeof import("../defaults.js").createDefaultAllocations;
  let debtLib: typeof import("../debtBalance.js");
  let periodLib: typeof import("../period.js");
  let server: Server;
  let base: string;

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);
    // Set before anything imports Prisma or the app (dotenv never overrides a
    // variable that is already set). Email goes to the console, never out.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "integration-test-secret";
    process.env.NODE_ENV = "test";
    process.env.EMAIL_PROVIDER = "console";
    process.env.EMAIL_FROM = "LifePlan <test@example.com>";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    // Production runs in UTC, so the test does too. Period bounds are UTC
    // whatever the zone (server/lib/period.ts, unit-tested west of UTC).
    process.env.TZ = "UTC";

    ({ prisma } = await import("../prisma.js"));
    ({ signToken } = await import("../jwt.js"));
    ({ createDefaultAllocations } = await import("../defaults.js"));
    debtLib = await import("../debtBalance.js");
    periodLib = await import("../period.js");
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

  // ── helpers ────────────────────────────────────────────────────────────

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

  let userSeq = 0;
  /** What signup does: the user row, then default lines + Main account. */
  async function signUp(name: string) {
    const n = ++userSeq;
    const user = await prisma.user.create({ data: { name, email: `u${n}@test.local`, emailVerified: new Date() } });
    await createDefaultAllocations(user.id, "es");
    return { id: user.id, email: user.email! };
  }

  async function mainAccount(userId: string) {
    return (await prisma.account.findFirstOrThrow({ where: { userId, type: "checking" } })).id;
  }

  async function defaultLine(userId: string, type: "fixed" | "flexible") {
    return (await prisma.allocation.findFirstOrThrow({ where: { userId, isDefault: true, type } })).id;
  }

  /** A card account (its debt is created by the server) whose debt is
   *  anchored on CARD_ANCHOR with `owedEuros` pre-existing debt. */
  async function cardAccount(userId: string, name: string, owedEuros: number) {
    const account = (await ok(userId, "POST", "/api/accounts", { name, type: "card", currentBalance: owedEuros, cardPaymentMode: "full" })).account;
    const debt = await prisma.debt.findFirstOrThrow({ where: { accountId: account.id } });
    await prisma.debt.update({ where: { id: debt.id }, data: { balanceAsOf: CARD_ANCHOR } });
    return { accountId: account.id as string, debtId: debt.id };
  }

  const csv = (lines: string[]) => new TextEncoder().encode(lines.join("\n") + "\n");
  const xlsx = (wb: XLSX.WorkBook) => new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);

  async function previewCall(userId: string, accountId: string, filename: string, bytes: Uint8Array, purchasesSign?: "negative" | "positive") {
    return call(userId, "POST", "/api/expenses/import/preview", {
      filename, accountId, dataBase64: Buffer.from(bytes).toString("base64"),
      ...(purchasesSign ? { purchasesSign } : {}),
    });
  }

  async function preview(userId: string, accountId: string, filename: string, bytes: Uint8Array, purchasesSign?: "negative" | "positive"): Promise<Preview> {
    const r = await previewCall(userId, accountId, filename, bytes, purchasesSign);
    assert.equal(r.status, 200, `preview ${filename} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** The rows the import screen checks by default (ImportStatement.tsx):
   *  every new row except card credits to review, possible duplicates and
   *  rows in another currency — and none while a card file's sign is unknown. */
  function preselected(p: Preview): PreviewRow[] {
    if (p.purchasesSign === "unknown") return [];
    return p.rows.filter(r => r.status === "new" && r.kind !== "needs_review" && !r.possibleDuplicate && !r.warnings?.includes("currency_mismatch"));
  }

  /** What the import screen sends for `rows` (handleConfirm): a bank row the
   *  server calls a payment goes as a payment of its debt unless it was only
   *  a weak learned guess; a card payment whose card couldn't be told goes as
   *  an expense; a review row goes as what the user resolved it to. */
  function toConfirm(p: Preview, rows: PreviewRow[], opts: {
    allocation?: Record<string, string | null>;
    resolve?: Record<string, "payment" | "refund">;
  } = {}): ConfirmRow[] {
    return rows.flatMap(r => {
      let kind: ConfirmRow["kind"] | undefined;
      let debtId = r.debtId ?? null;
      if (r.kind === "needs_review") kind = opts.resolve?.[r.externalId];
      else if (p.mode !== "card" && (r.kind === "payment" || r.warnings?.includes("card_payment_unassigned"))) {
        const target = r.kind !== "payment" || (r.learnedPayment && !r.learnedPayment.preselect) ? null : r.debtId ?? null;
        kind = target ? "payment" : "expense";
        debtId = target;
      } else kind = r.kind;
      if (!kind) return [];
      const allocationId = r.externalId in (opts.allocation ?? {})
        ? opts.allocation![r.externalId]
        : (r.kind !== "payment" ? r.suggestedAllocationId : null);
      return [{
        kind,
        externalId: r.externalId,
        date: r.date,
        description: r.description,
        merchant: r.merchant,
        amount: r.amount,
        allocationId: kind === "expense" || kind === "refund" ? allocationId ?? null : undefined,
        debtId: kind === "payment" ? debtId : undefined,
      }];
    });
  }

  async function confirm(userId: string, accountId: string, rows: ConfirmRow[]) {
    return ok(userId, "POST", "/api/expenses/import/confirm", { accountId, rows }) as Promise<{ expenses: number; income: number; inserted: number }>;
  }

  /** Counted spending of PERIOD, as the dashboard sums it (countedAmounts: a
   *  card payment counts only for the pre-existing debt, a refund negative). */
  async function dashboard(userId: string) {
    const r = await ok(userId, "GET", `/api/dashboard/household?period=${PERIOD}`);
    const cents = (euros: number) => Math.round(euros * 100);
    return {
      spent: cents(r.health.expenses),
      income: cents(r.health.income),
      byCategory: new Map<string | null, number>((r.byCategory as any[]).map(c => [c.allocationId, cents(c.total)])),
    };
  }

  /** The same sum straight from countedAmounts() over the period's expenses. */
  async function countedSpending(userId: string) {
    const { start, end } = periodLib.periodBounds(PERIOD, 1);
    const [counted, expenses] = await Promise.all([
      debtLib.countedAmounts(userId),
      prisma.expense.findMany({ where: { userId, date: { gte: start, lt: end } }, select: { id: true, amount: true } }),
    ]);
    return expenses.reduce((s, e) => s + (counted.get(e.id) ?? e.amount), 0);
  }

  /** Live balance (debtBalance.ts), checked against what GET /api/debts shows. */
  async function debtBalance(userId: string, debtId: string) {
    const [ledger] = await debtLib.loadDebtLedgers(userId, [debtId]);
    const derived = debtLib.debtState(ledger).balance;
    const listed = ((await ok(userId, "GET", "/api/debts")).debts as any[]).find(d => d.id === debtId);
    assert.ok(listed, `debt ${debtId} not listed`);
    assert.equal(Math.round(listed.currentBalance * 100), derived, "GET /api/debts disagrees with the ledger");
    return derived;
  }

  async function stored(userId: string) {
    const [expenses, incomes] = await Promise.all([
      prisma.expense.count({ where: { userId } }),
      prisma.income.count({ where: { userId } }),
    ]);
    return { expenses, incomes };
  }

  async function invite(senderId: string, email: string): Promise<string> {
    await ok(senderId, "POST", "/api/partner/invite", { email });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId, status: "pending" }, orderBy: { createdAt: "desc" } });
    return inv.token;
  }

  // ── files ──────────────────────────────────────────────────────────────

  const BBVA_EXPENSES = 19, BBVA_INCOMES = 6;
  const BBVA_SPENT = 255793;   // every money-out row of the fixture, in cents
  const BBVA_INCOME = 202250;  // every money-in row

  // Scenario b: the card statement (purchases negative) and the bank one.
  const CARD_B = csv([
    "Fecha;Concepto;Importe",
    "10/09/2026;COMPRA EN SUPERMERCADO DEMO;-50,00",
    "22/09/2026;PAGO RECIBIDO GRACIAS;350,00",
  ]);
  const BANK_B = csv([
    "Fecha;Concepto;Importe",
    "20/09/2026;LIQUIDACION TARJETA VISA;-350,00",
  ]);

  // ── a ──────────────────────────────────────────────────────────────────

  it("a. BBVA fixture into a checking account: all preselected rows land once; re-import adds nothing", async () => {
    const u = await signUp("Ana");
    const main = await mainAccount(u.id);
    const file = xlsx(buildBbva());

    const p = await preview(u.id, main, "bbva.xlsx", file);
    assert.equal(p.source, "bbva");
    assert.equal(p.mode, "account");
    assert.equal(p.rows.length, BBVA_EXPENSES + BBVA_INCOMES);
    assert.deepEqual([p.expenseCount, p.incomeCount, p.newCount, p.duplicateCount], [BBVA_EXPENSES, BBVA_INCOMES, 25, 0]);
    // No card yet: "LIQUIDACION TARJETA" can't be told to a debt → an expense, flagged.
    const liq = p.rows.find(r => r.warnings?.includes("card_payment_unassigned"));
    assert.ok(liq && liq.kind === "expense" && liq.amount === 150, JSON.stringify(liq));

    const rows = toConfirm(p, preselected(p));
    assert.equal(rows.length, 25, "every row is preselected on a fresh account");
    const r = await confirm(u.id, main, rows);
    assert.deepEqual([r.expenses, r.income], [BBVA_EXPENSES, BBVA_INCOMES]);
    assert.deepEqual(await stored(u.id), { expenses: BBVA_EXPENSES, incomes: BBVA_INCOMES });
    assert.equal(await prisma.expense.count({ where: { userId: u.id, source: "import", accountId: main } }), BBVA_EXPENSES);

    const d = await dashboard(u.id);
    assert.equal(d.spent, BBVA_SPENT);
    assert.equal(d.income, BBVA_INCOME);
    assert.equal(await countedSpending(u.id), BBVA_SPENT);

    // Re-import: the preview sees every row as already there, and confirming
    // the same rows again writes nothing.
    const again = await preview(u.id, main, "bbva.xlsx", file);
    assert.deepEqual([again.newCount, again.duplicateCount], [0, 25]);
    assert.ok(again.rows.every(x => x.duplicateReason === "same_movement"));
    assert.equal(preselected(again).length, 0);
    const r2 = await confirm(u.id, main, rows);
    assert.equal(r2.inserted, 0);
    assert.deepEqual(await stored(u.id), { expenses: BBVA_EXPENSES, incomes: BBVA_INCOMES });
    assert.equal((await dashboard(u.id)).spent, BBVA_SPENT);
  });

  // ── b ──────────────────────────────────────────────────────────────────

  /** One user, 300 € card debt; the card file and the bank file imported in
   *  `order`, every preselected row confirmed. */
  async function cardPaymentScenario(order: "card-first" | "bank-first") {
    const u = await signUp(`B ${order}`);
    const main = await mainAccount(u.id);
    const card = await cardAccount(u.id, "Visa Demo", 300);
    const flexible = await defaultLine(u.id, "flexible");

    const importCard = async () => {
      const p = await preview(u.id, card.accountId, "visa.csv", CARD_B, "negative");
      assert.equal(p.mode, "card");
      const purchase = p.rows.find(r => r.amount === 50)!;
      const payment = p.rows.find(r => r.amount === 350)!;
      assert.equal(purchase.kind, "expense");
      assert.equal(payment.kind, "payment");
      assert.equal(payment.debtId, card.debtId);
      const rows = toConfirm(p, preselected(p), { allocation: { [purchase.externalId]: flexible } });
      if (rows.length) await confirm(u.id, card.accountId, rows);
      return { purchase, payment };
    };
    const importBank = async () => {
      const p = await preview(u.id, main, "banco.csv", BANK_B);
      assert.equal(p.mode, "account");
      const [payment] = p.rows;
      assert.equal(payment.kind, "payment", JSON.stringify(payment));
      assert.equal(payment.debtId, card.debtId);
      assert.equal(p.incomeCount, 0);
      const rows = toConfirm(p, preselected(p));
      if (rows.length) await confirm(u.id, main, rows);
      return { payment };
    };

    if (order === "card-first") {
      const c = await importCard();
      assert.equal(c.payment.status, "new");
      const b = await importBank();
      assert.equal(b.payment.status, "duplicate", "the bank charge is the payment the card file already recorded");
      assert.equal(b.payment.duplicateReason, "same_payment");
    } else {
      const b = await importBank();
      assert.equal(b.payment.status, "new");
      const c = await importCard();
      assert.equal(c.payment.status, "duplicate", "the card's 'pago recibido' is the payment the bank file already recorded");
      assert.equal(c.payment.duplicateReason, "same_payment");
      assert.equal(c.purchase.status, "new");
    }
    return { u, main, card };
  }

  async function assertCardPaymentMoney(userId: string, debtId: string) {
    // 50 € purchase + the 300 € of pre-existing debt the 350 € paid; the other
    // 50 € paid the purchase, already counted in its category.
    assert.equal((await dashboard(userId)).spent, 35000);
    assert.equal(await countedSpending(userId), 35000);
    assert.equal(await debtBalance(userId, debtId), 0);
    assert.equal((await dashboard(userId)).income, 0);
    assert.equal(await prisma.income.count({ where: { userId } }), 0);
    // Exactly one payment stored, one purchase.
    assert.equal(await prisma.expense.count({ where: { userId, debtId } }), 1);
    assert.equal(await prisma.expense.count({ where: { userId } }), 2);
  }

  for (const order of ["card-first", "bank-first"] as const) {
    it(`b. card payment seen from both files (${order}): spend 350 €, card debt 0, no income`, async () => {
      const { u, main, card } = await cardPaymentScenario(order);
      await assertCardPaymentMoney(u.id, card.debtId);

      // Importing both files again, in either order, changes nothing.
      for (const [acc, name, file, sign] of [
        [main, "banco.csv", BANK_B, undefined],
        [card.accountId, "visa.csv", CARD_B, "negative"],
        [main, "banco.csv", BANK_B, undefined],
      ] as const) {
        const p = await preview(u.id, acc, name, file, sign);
        assert.equal(p.newCount, 0, `${name}: ${JSON.stringify(p.rows)}`);
        assert.equal(preselected(p).length, 0);
      }
      await assertCardPaymentMoney(u.id, card.debtId);
    });
  }

  // ── c ──────────────────────────────────────────────────────────────────

  it("c. a labelled refund on the card lowers its category and the debt; Activity lists it as a refund", async () => {
    const u = await signUp("Carla");
    const card = await cardAccount(u.id, "Visa Carla", 0);
    const flexible = await defaultLine(u.id, "flexible");

    const p = await preview(u.id, card.accountId, "visa.csv", csv([
      "Fecha;Concepto;Importe",
      "10/09/2026;COMPRA TIENDA ROPA EJEMPLO;-60,00",
      "14/09/2026;DEVOLUCION TIENDA ROPA EJEMPLO;20,00",
    ]), "negative");
    const refund = p.rows.find(r => r.amount === 20)!;
    assert.equal(refund.kind, "refund");
    assert.equal(p.refundCount, 1);
    const rows = toConfirm(p, preselected(p), { allocation: Object.fromEntries(p.rows.map(r => [r.externalId, flexible])) });
    assert.equal(rows.length, 2);
    await confirm(u.id, card.accountId, rows);

    const d = await dashboard(u.id);
    assert.equal(d.byCategory.get(flexible), 4000);
    assert.equal(d.spent, 4000);
    assert.equal(await countedSpending(u.id), 4000);
    assert.equal(await debtBalance(u.id, card.debtId), 4000);
    assert.equal(d.income, 0);

    const listed = (await ok(u.id, "GET", `/api/expenses?month=${PERIOD}`)).expenses as any[];
    const r = listed.find(e => e.externalId === refund.externalId);
    assert.ok(r, "refund missing from the Activity list");
    assert.equal(r.kind, "refund");
    assert.equal(r.amount, 20);
    assert.equal(r.budgetAmount, -20);
    assert.equal(r.allocationId, flexible);
    assert.equal(r.accountId, card.accountId);
  });

  // ── d ──────────────────────────────────────────────────────────────────

  it("d. an ambiguous card credit waits for the user: rejected unresolved, a payment once resolved", async () => {
    const u = await signUp("Dani");
    const main = await mainAccount(u.id);
    const card = await cardAccount(u.id, "Visa Dani", 600);

    const p = await preview(u.id, card.accountId, "visa.csv", csv([
      "Fecha;Concepto;Importe",
      "05/09/2026;COMPRA EN FARMACIA DEMO;-50,00",
      "06/09/2026;COMPRA EN LIBRERIA DEMO;-30,00",
      "10/09/2026;AJUSTE SALDO 0001;600,00",
    ]), "negative");
    const credit = p.rows.find(r => r.amount === 600)!;
    assert.equal(credit.kind, "needs_review");
    assert.equal(credit.status, "new");
    assert.ok(credit.warnings?.includes("ambiguous_credit"));
    assert.equal(credit.debtId, card.debtId);
    assert.equal(p.reviewCount, 1);
    assert.ok(!preselected(p).includes(credit), "a credit to review is never preselected");

    // Sent as is (no choice), or as a payment of no debt: rejected, nothing written.
    const before = await stored(u.id);
    const asIs = { ...toConfirm(p, [credit], { resolve: { [credit.externalId]: "payment" } })[0], kind: "needs_review" };
    const rejected = await call(u.id, "POST", "/api/expenses/import/confirm", { accountId: card.accountId, rows: [...toConfirm(p, preselected(p)), asIs] });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, "invalid_rows");
    const noDebt = { ...asIs, kind: "payment", debtId: null };
    const rejected2 = await call(u.id, "POST", "/api/expenses/import/confirm", { accountId: card.accountId, rows: [...toConfirm(p, preselected(p)), noDebt] });
    assert.equal(rejected2.status, 404);
    assert.equal(rejected2.body.code, "debt_not_found");
    assert.deepEqual(await stored(u.id), before);

    // Resolved as a payment: written against the card's debt, from no account.
    await confirm(u.id, card.accountId, toConfirm(p, [...preselected(p), credit], { resolve: { [credit.externalId]: "payment" } }));
    const payment = await prisma.expense.findFirstOrThrow({ where: { userId: u.id, externalId: credit.externalId } });
    assert.deepEqual([payment.kind, payment.debtId, payment.accountId, payment.amount], ["expense", card.debtId, null, 60000]);

    // The bank's charge for it is the same payment.
    const bank = await preview(u.id, main, "banco.csv", csv([
      "Fecha;Concepto;Importe",
      "12/09/2026;LIQUIDACION TARJETA VISA;-600,00",
    ]));
    assert.equal(bank.rows[0].kind, "payment");
    assert.equal(bank.rows[0].status, "duplicate");
    assert.equal(preselected(bank).length, 0);

    // 600 + 50 + 30 − 600.
    assert.equal(await debtBalance(u.id, card.debtId), 8000);
    assert.equal((await dashboard(u.id)).spent, 8000 + 60000);
    assert.equal((await dashboard(u.id)).income, 0);
  });

  // ── e ──────────────────────────────────────────────────────────────────

  it("e. a card file with only payments: sign unknown, nothing preselected, until the user says it", async () => {
    const u = await signUp("Eva");
    const card = await cardAccount(u.id, "Visa Eva", 400);
    const file = csv([
      "Fecha;Concepto;Importe",
      "05/09/2026;PAGO RECIBIDO GRACIAS;200,00",
      "20/09/2026;PAGO RECIBIDO GRACIAS;150,00",
    ]);

    const p = await preview(u.id, card.accountId, "visa.csv", file);
    assert.equal(p.mode, "card");
    assert.equal(p.purchasesSign, "unknown");
    assert.equal(p.purchasesSignDetected, true);
    assert.equal(preselected(p).length, 0);

    // Told: purchases are negative, so these credits are payments of the card.
    const told = await preview(u.id, card.accountId, "visa.csv", file, "negative");
    assert.equal(told.purchasesSign, "negative");
    assert.equal(told.purchasesSignDetected, false);
    assert.deepEqual(told.rows.map(r => [r.kind, r.debtId, r.status]), [["payment", card.debtId, "new"], ["payment", card.debtId, "new"]]);
    assert.equal(preselected(told).length, 2);

    // The other convention reads the same lines as purchases: the choice decides.
    const flipped = await preview(u.id, card.accountId, "visa.csv", file, "positive");
    assert.deepEqual(flipped.rows.map(r => r.kind), ["expense", "expense"]);

    await confirm(u.id, card.accountId, toConfirm(told, preselected(told)));
    assert.equal(await debtBalance(u.id, card.debtId), 5000);
  });

  // ── f ──────────────────────────────────────────────────────────────────

  it("f. rows on a plan line add to the life plan once; a refund on it takes money back", async () => {
    const u = await signUp("Fede");
    const main = await mainAccount(u.id);
    const card = await cardAccount(u.id, "Visa Fede", 0);
    const created = await ok(u.id, "POST", "/api/plans", { title: "Viaje", targetAmount: 1000, monthlyContribution: 100, autoCreateAllocation: true });
    const planId = created.plan.id as string;
    const planLine = created.allocation.id as string;
    const planAmount = async () => (await prisma.lifePlan.findUniqueOrThrow({ where: { id: planId } })).currentAmount;
    assert.equal(await planAmount(), 0);

    const bankFile = csv(["Fecha;Concepto;Importe", "15/09/2026;TRASPASO A CUENTA VIAJE;-100,00"]);
    const p = await preview(u.id, main, "banco.csv", bankFile);
    const rows = toConfirm(p, preselected(p), { allocation: { [p.rows[0].externalId]: planLine } });
    await confirm(u.id, main, rows);
    assert.equal(await planAmount(), 10000);

    // The same rows confirmed again, and the file previewed again: no second contribution.
    assert.equal((await confirm(u.id, main, rows)).inserted, 0);
    assert.equal(await planAmount(), 10000);
    assert.equal((await preview(u.id, main, "banco.csv", bankFile)).newCount, 0);

    // A refund put on the plan line subtracts — once.
    const cp = await preview(u.id, card.accountId, "visa.csv", csv(["Fecha;Concepto;Importe", "18/09/2026;DEVOLUCION AGENCIA VIAJES DEMO;30,00"]), "negative");
    assert.equal(cp.rows[0].kind, "refund");
    const refundRows = toConfirm(cp, preselected(cp), { allocation: { [cp.rows[0].externalId]: planLine } });
    await confirm(u.id, card.accountId, refundRows);
    assert.equal(await planAmount(), 7000);
    assert.equal((await confirm(u.id, card.accountId, refundRows)).inserted, 0);
    assert.equal(await planAmount(), 7000);
  });

  // ── g ──────────────────────────────────────────────────────────────────

  it("g. import profile: a saved mapping reads an unrecognised CSV; only the account's owner reads or writes it", async () => {
    const A = await signUp("Gema");
    const B = await signUp("Gus");   // joins A's household
    const C = await signUp("Hugo");  // a stranger
    const main = await mainAccount(A.id);
    const file = csv(["Día;Qué;Cuánto", "15/09/2026;Algo raro;-12,50", "16/09/2026;Otra cosa;30,00"]);

    const unread = await previewCall(A.id, main, "raro.csv", file);
    assert.equal(unread.status, 422);
    assert.equal(unread.body.code, "unrecognized_columns");
    assert.equal(unread.body.sample?.[0]?.rows?.[0]?.[0], "Día");

    assert.deepEqual((await ok(A.id, "GET", `/api/accounts/${main}/import-profile`)).data, { importProfile: null });
    const mapping = { date: "Día", amount: "Cuánto", description: ["Qué"] };
    const saved = await ok(A.id, "PATCH", `/api/accounts/${main}/import-profile`, { importProfile: mapping });
    assert.deepEqual(saved.data.importProfile, mapping);
    assert.deepEqual((await ok(A.id, "GET", `/api/accounts/${main}/import-profile`)).data.importProfile, mapping);
    const bad = await call(A.id, "PATCH", `/api/accounts/${main}/import-profile`, { importProfile: { amount: "Cuánto", description: [] } });
    assert.equal(bad.status, 400);

    const p = await preview(A.id, main, "raro.csv", file);
    assert.equal(p.source, "mapping");
    assert.deepEqual(p.rows.map(r => [r.date, r.kind, r.amount, r.description]), [
      ["2026-09-15", "expense", 12.5, "Algo raro"],
      ["2026-09-16", "income", 30, "Otra cosa"],
    ]);

    // B joins A's household: A's account is shared with B, but only A may
    // read or change how its files are read.
    await ok(B.id, "POST", "/api/partner/accept", { token: await invite(A.id, B.email) });
    const other = { importProfile: { date: "Día", amount: "Cuánto", description: ["Qué"], purchasesSign: "positive" } };
    const asMember = [
      await call(B.id, "GET", `/api/accounts/${main}/import-profile`),
      await call(B.id, "PATCH", `/api/accounts/${main}/import-profile`, other),
    ];
    assert.deepEqual(asMember.map(r => r.status), [403, 403], JSON.stringify(asMember));
    // Made private, the account doesn't exist for B.
    await prisma.account.update({ where: { id: main }, data: { visibility: "private" } });
    const asMemberPrivate = [
      await call(B.id, "GET", `/api/accounts/${main}/import-profile`),
      await call(B.id, "PATCH", `/api/accounts/${main}/import-profile`, other),
    ];
    assert.deepEqual(asMemberPrivate.map(r => r.status), [404, 404]);
    // A stranger: not found either way.
    const asStranger = [
      await call(C.id, "GET", `/api/accounts/${main}/import-profile`),
      await call(C.id, "PATCH", `/api/accounts/${main}/import-profile`, other),
    ];
    assert.deepEqual(asStranger.map(r => r.status), [404, 404]);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: main } });
    assert.deepEqual(account.importProfile, mapping, "a non-owner changed the mapping");
  });

  // ── h ──────────────────────────────────────────────────────────────────

  it("h. confirm validates every row first: one bad row and nothing is written", async () => {
    const u = await signUp("Inés");
    const main = await mainAccount(u.id);
    const p = await preview(u.id, main, "banco.csv", csv([
      "Fecha;Concepto;Importe",
      "15/09/2026;SUPERMERCADO DEMO;-25,00",
      "16/09/2026;NOMINA EJEMPLO;1500,00",
    ]));
    const good = toConfirm(p, preselected(p));
    assert.equal(good.length, 2);
    const before = await stored(u.id);
    const bad = (patch: Record<string, unknown>) => ({ ...good[0], externalId: "bad-row", ...patch });

    for (const [why, row] of [
      ["impossible date", bad({ date: "2026-02-30" })],
      ["not a date", bad({ date: "15/09/2026" })],
      ["more than a year ahead", bad({ date: "2099-01-01" })],
      ["amount over the Int column", bad({ amount: 30_000_000 })],
      ["negative amount", bad({ amount: -5 })],
      ["zero amount", bad({ amount: 0 })],
      ["unknown kind", bad({ kind: "transfer" })],
    ] as const) {
      const r = await call(u.id, "POST", "/api/expenses/import/confirm", { accountId: main, rows: [...good, row] });
      assert.ok(r.status === 400 || r.status === 422, `${why}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(typeof r.body.code, "string", `${why}: no code in ${JSON.stringify(r.body)}`);
      assert.equal(typeof r.body.error, "string");
      assert.deepEqual(await stored(u.id), before, `${why}: rows were written`);
    }

    // A category that doesn't exist: a 404 with its code, nothing written.
    const r = await call(u.id, "POST", "/api/expenses/import/confirm", {
      accountId: main, rows: [...good, bad({ allocationId: "does-not-exist" })],
    });
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(r.body.code, "allocation_not_found");
    assert.deepEqual(await stored(u.id), before, "a failed confirm wrote part of the file");

    // And the good rows alone go through.
    const done = await confirm(u.id, main, good);
    assert.deepEqual([done.expenses, done.income], [1, 1]);
  });

  // ── i ──────────────────────────────────────────────────────────────────

  it("i. a category from another pool is refused everywhere: nothing written, the other plan untouched", async () => {
    const owner = await signUp("Iker");
    const intruder = await signUp("Irene");
    const created = await ok(owner.id, "POST", "/api/plans", { title: "Casa", targetAmount: 1000, monthlyContribution: 100, autoCreateAllocation: true });
    const planId = created.plan.id as string;
    const foreignLine = created.allocation.id as string;
    const planAmount = async () => (await prisma.lifePlan.findUniqueOrThrow({ where: { id: planId } })).currentAmount;
    const main = await mainAccount(intruder.id);
    const own = await defaultLine(intruder.id, "flexible");
    const refused = (r: { status: number; body: any }, what: string) => {
      assert.equal(r.status, 404, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, "allocation_not_found", what);
    };

    refused(await call(intruder.id, "POST", "/api/expenses", { amount: 50, description: "x", allocationId: foreignLine }), "POST /api/expenses");
    refused(await call(intruder.id, "POST", "/api/expenses", { amount: 50, description: "x", allocationId: 42 }), "POST /api/expenses (not a string)");
    const mine = (await ok(intruder.id, "POST", "/api/expenses", { amount: 50, description: "x", allocationId: own })).expense;
    refused(await call(intruder.id, "PATCH", `/api/expenses/${mine.id}`, { allocationId: foreignLine }), "PATCH /api/expenses/:id");
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: mine.id } })).allocationId, own);

    const p = await preview(intruder.id, main, "banco.csv", csv(["Fecha;Concepto;Importe", "15/09/2026;TRASPASO;-100,00"]));
    const before = await stored(intruder.id);
    refused(await call(intruder.id, "POST", "/api/expenses/import/confirm", {
      accountId: main, rows: toConfirm(p, preselected(p), { allocation: { [p.rows[0].externalId]: foreignLine } }),
    }), "import confirm");
    assert.deepEqual(await stored(intruder.id), before);

    refused(await call(intruder.id, "POST", "/api/rules", { pattern: "traspaso", allocationId: foreignLine }), "POST /api/rules");
    refused(await call(intruder.id, "POST", "/api/monthly-budgets/save", { month: PERIOD, budgets: [{ allocationId: foreignLine, allocatedAmount: 10 }] }), "monthly budgets");

    assert.equal(await planAmount(), 0, "another user's plan was credited");
    assert.equal(await prisma.expense.count({ where: { allocationId: foreignLine } }), 0);
  });

  // ── j ──────────────────────────────────────────────────────────────────

  it("j. a partner's private account can't be previewed, imported into or spent from; a shared one can", async () => {
    const A = await signUp("Julia");
    const B = await signUp("Jon");   // joins A's household
    const C = await signUp("Jose");  // a stranger
    const main = await mainAccount(A.id);
    await ok(A.id, "PATCH", `/api/accounts/${main}/import-profile`, { importProfile: { date: "Día", amount: "Cuánto", description: ["Qué"] } });
    await ok(B.id, "POST", "/api/partner/accept", { token: await invite(A.id, B.email) });
    const file = csv(["Día;Qué;Cuánto", "15/09/2026;Algo raro;-12,50"]);
    const notFound = (r: { status: number; body: any }, what: string) => {
      assert.equal(r.status, 404, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, "account_not_found", what);
    };

    // Shared with the household: B may import into it (with its saved mapping).
    const shared = await preview(B.id, main, "raro.csv", file);
    assert.equal(shared.source, "mapping");
    assert.equal(shared.accountId, main);

    // Private: it doesn't exist for B — no preview (nor its mapping), no
    // import, no manual expense, no move onto it; never a silent fallback.
    await prisma.account.update({ where: { id: main }, data: { visibility: "private" } });
    notFound(await previewCall(B.id, main, "raro.csv", file), "preview");
    const byB = () => prisma.expense.count({ where: { createdByUserId: B.id } }); // B writes into the pool
    const before = await byB();
    notFound(await call(B.id, "POST", "/api/expenses/import/confirm", { accountId: main, rows: toConfirm(shared, preselected(shared)) }), "confirm");
    notFound(await call(B.id, "POST", "/api/expenses", { amount: 10, description: "x", accountId: main }), "POST /api/expenses");
    const bExpense = (await ok(B.id, "POST", "/api/expenses", { amount: 10, description: "x" })).expense;
    assert.notEqual(bExpense.accountId, main, "the default account is one B can see");
    notFound(await call(B.id, "PATCH", `/api/expenses/${bExpense.id}`, { accountId: main }), "PATCH /api/expenses/:id");
    assert.equal(await byB(), before + 1, "only the default-account expense was written");

    // Its owner still can; a stranger never could.
    assert.equal((await preview(A.id, main, "raro.csv", file)).accountId, main);
    notFound(await previewCall(C.id, main, "raro.csv", file), "stranger preview");
    notFound(await call(C.id, "POST", "/api/expenses", { amount: 10, description: "x", accountId: main }), "stranger POST /api/expenses");
  });
});
