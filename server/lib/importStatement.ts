// Statement import: the database around the ingest core (server/lib/ingest/).
//
//   file bytes (or rows read in the browser) ──readStatement──▶ NormalizedRow[]
//   + the account, its card debt, the user's debts, stored movements nearby
//   ──classifyRows──▶ what each row is + dedup ──▶ ImportPreview (euros, for the UI)
//
// Nothing is written here; /api/expenses/import/confirm writes what the user
// keeps. Amounts are cents until the preview is built, where they become euros
// (the API speaks euros; the confirm route converts back with toCents).
import { prisma } from "./prisma.js";
import { pickAllocationId } from "./categorize.js";
import { normalizeMerchant } from "./normalizeMerchant.js";
import { classifyRows, LATE_PAYMENT_DAYS, statementIds, type ExistingMovement, type PlannedKind, type PossibleDuplicate, type PurchasesSign, type StoredPayment, type PurchasesSignGuess, type RowWarning } from "./ingest/classify.js";
import { assertRowCount, readStatement } from "./ingest/read.js";
import { suggestLearnedPayments } from "./ingest/learnedPayments.js";
import { storedMapping } from "./ingest/validate.js";
import type { NormalizedRow, SkippedRow, StatementSource } from "./ingest/types.js";

export type ImportKind = PlannedKind;

export interface ImportRow {
  externalId: string;
  date: string;          // ISO day (yyyy-mm-dd)
  description: string;
  merchant: string;
  amount: number;        // euros, absolute
  signedAmount: number;  // euros, signed from the holder's view (for display)
  kind: ImportKind;
  status: "new" | "duplicate";
  suggestedAllocationId: string | null;
  suggestedAllocationName: string | null;
  /** payment rows: the debt it pays; needs_review: the card's debt, if the
   *  user resolves it as a payment. */
  debtId?: string | null;
  /** A fee charged with the movement above it (Revolut). */
  isFee?: boolean;
  duplicateReason?: "same_movement" | "same_payment";
  /** Same amount, ±2 days, same account, other source: the user decides. */
  possibleDuplicate?: PossibleDuplicate;
  /** Bank rows whose debt the user may change: stored payments of the same
   *  amount nearby, by debt (classify.ts), to warn on the debt picked. */
  storedPayments?: StoredPayment[];
  /** A payment proposed from a learned rule: the user confirms it. */
  learnedPayment?: { preselect: boolean };
  warnings?: RowWarning[];
}

export interface ImportPreview {
  rows: ImportRow[];
  newCount: number;
  duplicateCount: number;
  expenseCount: number;
  incomeCount: number;
  paymentCount?: number;
  refundCount?: number;
  /** Card credits the user must call payment or refund before importing. */
  reviewCount?: number;
  possibleDuplicateCount?: number;
  /** Rows the file lists but that aren't movements yet (pending, declined…). */
  skipped?: SkippedRow[];
  source?: StatementSource;
  mode?: "account" | "card";
  /** Debts a bank row may pay (the preview lets the user pick or change a
   *  payment's debt): the active ones, never the imported card's own. */
  debts?: { id: string; name: string }[];
  /** Card files: how purchases appeared, and whether that was guessed.
   *  "unknown": the file doesn't say — the user must choose before importing. */
  purchasesSign?: PurchasesSignGuess;
  purchasesSignDetected?: boolean;
}

export interface PrepareImportInput {
  accountId: string | null;
  /** A statement file… */
  file?: { bytes: Uint8Array; filename: string };
  /** …or rows already read in the browser (decision O; stage 2). */
  rows?: NormalizedRow[];
  /** Overrides the card sign convention (saved mapping, or detected). */
  purchasesSign?: PurchasesSign;
}

const DAY_MS = 86400000;
// Covers every matching window of classify.ts (late payment 10, same payment 4, possible duplicate 2).
const WINDOW_DAYS = LATE_PAYMENT_DAYS + 1;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const euros = (cents: number) => cents / 100;

async function loadExisting(userId: string, where: object): Promise<ExistingMovement[]> {
  const [expenses, incomes] = await Promise.all([
    prisma.expense.findMany({
      where: { userId, ...where },
      select: { id: true, externalId: true, accountId: true, debtId: true, kind: true, amount: true, date: true, description: true, source: true },
    }),
    prisma.income.findMany({
      where: { userId, ...where },
      select: { id: true, externalId: true, accountId: true, amount: true, date: true, description: true, source: true },
    }),
  ]);
  return [
    ...expenses.map(e => ({ ...e, table: "expense" as const, amountCents: e.amount, date: isoDay(e.date) })),
    ...incomes.map(i => ({ ...i, table: "income" as const, debtId: null, kind: "income", amountCents: i.amount, date: isoDay(i.date) })),
  ];
}

export async function prepareImport(userId: string, input: PrepareImportInput): Promise<ImportPreview> {
  const account = input.accountId
    ? await prisma.account.findFirst({
      where: { id: input.accountId, userId },
      select: { id: true, type: true, currency: true, importProfile: true },
    })
    : null;
  const mapping = storedMapping(account?.importProfile);

  const read = input.rows
    ? { rows: input.rows, skipped: [] as SkippedRow[], source: "rows" as const, purchasesSign: undefined }
    : readStatement(input.file!.bytes, input.file!.filename, { mapping });
  assertRowCount(read.rows.length);

  const [debts, debtLines, rules, allocations] = await Promise.all([
    prisma.debt.findMany({
      where: { userId },
      select: { id: true, name: true, kind: true, accountId: true, status: true, installmentAmount: true, minimumPayment: true },
    }),
    prisma.allocation.findMany({ where: { userId, type: "debt", debtId: { not: null } }, select: { id: true, debtId: true } }),
    prisma.categorizationRule.findMany({ where: { userId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }),
    prisma.allocation.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);
  const lineByDebt = new Map(debtLines.map(a => [a.debtId!, a.id]));
  const debtByLine = new Map(debtLines.map(a => [a.id, a.debtId!]));
  const cardDebt = account?.type === "card"
    ? debts.find(d => d.accountId === account.id && d.kind === "credit_card") ?? null
    : null;
  const isCard = account?.type === "card";

  // Rules first: a specific merchant the user already put on a debt's line is
  // PROPOSED as a payment of that debt (learnedPayments.ts) — and the core
  // must know before dedup, to recognise it as the same payment.
  const ruleFor = (r: { description: string; merchant: string }) => pickAllocationId(rules, r.description, r.merchant);

  const context = {
    account: {
      id: account?.id ?? null,
      type: account?.type ?? "checking",
      currency: account?.currency ?? "EUR",
      cardDebtId: cardDebt?.id ?? null,
    },
    debts: debts.filter(d => d.status === "active"),
    purchasesSign: input.purchasesSign ?? read.purchasesSign,
  };

  // Stored movements around the file's dates (all accounts: a card payment is
  // stored against the bank account or none), plus any stored under the
  // batch's ids even if their date was edited since — one query, one
  // classification.
  const days = read.rows.map(r => r.date).sort();
  const ids = statementIds({ ...context, rows: read.rows });
  const existing = days.length
    ? await loadExisting(userId, {
      OR: [
        {
          date: {
            gte: new Date(Date.parse(days[0]) - WINDOW_DAYS * DAY_MS),
            lt: new Date(Date.parse(days[days.length - 1]) + (WINDOW_DAYS + 1) * DAY_MS),
          },
        },
        { externalId: { in: ids } },
      ],
    })
    : [];

  // Rule-learned payments (bank accounts only: a card can't pay itself): the
  // money-out rows, by the merchant key classify gives them.
  const learnedPayments = isCard ? undefined : suggestLearnedPayments(
    read.rows
      .filter(r => r.amountCents < 0)
      .map(r => ({ rowIndex: r.rowIndex, description: r.description, merchant: normalizeMerchant(r.description), amountCents: -r.amountCents })),
    { accountId: account?.id ?? null, ruleFor, debtByLine, debts: new Map(context.debts.map(d => [d.id, d])) },
  );
  const result = classifyRows({ ...context, rows: read.rows, existing, learnedPayments });

  const nameById = new Map(allocations.map(a => [a.id, a.name]));
  const rows: ImportRow[] = result.rows.map(p => {
    let suggested: string | null = null;
    if (p.kind === "payment") suggested = (p.debtId && lineByDebt.get(p.debtId)) || null;
    // needs_review: the category it takes if the user calls it a refund.
    else if ((p.kind === "expense" || p.kind === "refund" || p.kind === "needs_review") && !p.isFee && p.status === "new") {
      const rule = ruleFor(p);
      suggested = rule && !debtByLine.has(rule) ? rule : null; // never a debt line for a purchase
    }
    return {
      externalId: p.externalId,
      date: p.date,
      description: p.description,
      merchant: p.merchant,
      amount: euros(p.amountCents),
      signedAmount: euros(p.signedCents),
      kind: p.kind,
      status: p.status,
      suggestedAllocationId: suggested,
      suggestedAllocationName: suggested ? nameById.get(suggested) ?? null : null,
      debtId: p.debtId,
      isFee: p.isFee,
      ...(p.duplicateReason ? { duplicateReason: p.duplicateReason } : {}),
      ...(p.possibleDuplicate ? { possibleDuplicate: p.possibleDuplicate } : {}),
      ...(p.storedPayments ? { storedPayments: p.storedPayments } : {}),
      ...(p.learnedPayment ? { learnedPayment: p.learnedPayment } : {}),
      warnings: p.warnings,
    };
  });

  const count = (f: (r: ImportRow) => boolean) => rows.filter(f).length;
  return {
    rows,
    newCount: count(r => r.status === "new"),
    duplicateCount: count(r => r.status === "duplicate"),
    expenseCount: count(r => r.kind === "expense"),
    incomeCount: count(r => r.kind === "income"),
    paymentCount: count(r => r.kind === "payment"),
    refundCount: count(r => r.kind === "refund"),
    reviewCount: count(r => r.kind === "needs_review" && r.status === "new"),
    possibleDuplicateCount: count(r => r.status === "new" && !!r.possibleDuplicate),
    skipped: read.skipped,
    source: read.source,
    debts: context.debts.filter(d => !(account && d.accountId === account.id)).map(d => ({ id: d.id, name: d.name })),
    mode: result.mode,
    ...(result.purchasesSign ? { purchasesSign: result.purchasesSign, purchasesSignDetected: result.purchasesSignDetected } : {}),
  };
}
