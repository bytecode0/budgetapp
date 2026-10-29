// Writes confirmed import rows: the database side of planImportWrites
// (writes.ts). One path for every source — a statement the user imports
// (/api/expenses/import/confirm, source "import") and bank movements
// (server/lib/banking/sync.ts, source "bank_sync") — so both get the same
// debt payments, life plan contributions, learned rules and household
// attribution.
import { prisma } from "../prisma.js";
import { learnFromCorrection } from "../categorize.js";
import { planContributions } from "../planContribution.js";
import { rebuildExpenseShares } from "../expenseShares.js";
import { syncDebtStatus } from "../debtBalance.js";
import { isGenericMerchant } from "./learnedPayments.js";
import { planImportWrites, type ConfirmRow } from "./writes.js";

export interface ConfirmImportContext {
  /** The pool (req.userId). */
  userId: string;
  /** The real person importing (req.authUserId): createdBy / income owner. */
  authUserId: string;
  /** Their active household, when they have one (attribution). */
  householdId: string | null | undefined;
  /** The account the rows belong to; already checked visible to authUserId. */
  accountId: string | null;
  source: "import" | "bank_sync";
}

export interface ImportSummary {
  expenses: number;
  refunds: number;
  incomes: number;
  payments: { debtId: string; name: string | null; count: number }[];
}

export type ConfirmImportResult =
  | { error: string; code?: string; status: number }
  | { expenses: number; income: number; inserted: number; summary: ImportSummary };

export async function confirmImport(ctx: ConfirmImportContext, rows: ConfirmRow[]): Promise<ConfirmImportResult> {
  const { userId, authUserId, accountId, source } = ctx;
  const [debtLines, debts] = await Promise.all([
    prisma.allocation.findMany({
      where: { userId, type: "debt", debtId: { not: null } },
      select: { id: true, debtId: true, debt: { select: { accountId: true } } },
    }),
    prisma.debt.findMany({ where: { userId }, select: { id: true, accountId: true, name: true } }),
  ]);
  const plan = planImportWrites(rows, {
    today: new Date().toISOString().slice(0, 10),
    accountId,
    debtLines: debtLines.map(l => ({ id: l.id, debtId: l.debtId!, debtAccountId: l.debt?.accountId ?? null })),
    debts: debts.map(d => ({ id: d.id, accountId: d.accountId })),
  });
  if ("error" in plan) return plan;

  // One transaction: a batch is written whole or not at all, and a life plan
  // gets credited only for the rows this call actually inserted (rows
  // already stored — a re-import, or a concurrent confirm that got there
  // first — are skipped by the unique externalId and not returned).
  // Rows on a "plan" line contribute to its life plan like manual ones
  // (refunds take money back out); DELETE/PATCH reverse it.
  const { exp, inc, inserted } = await prisma.$transaction(async tx => {
    const inserted = await tx.expense.createManyAndReturn({
      data: plan.expenses.map(e => ({ ...e, userId, source, createdByUserId: authUserId })),
      skipDuplicates: true, // re-importing the same rows is a no-op
      select: { kind: true, amount: true, allocationId: true, debtId: true },
    });
    const inc = await tx.income.createMany({
      data: plan.incomes.map(i => ({ ...i, userId, ownerUserId: authUserId, source })),
      skipDuplicates: true,
    });
    const planLines = await tx.allocation.findMany({
      where: { userId, type: "plan", lifePlanId: { not: null } },
      select: { id: true, lifePlanId: true },
    });
    const deltas = planContributions(inserted, new Map(planLines.map(l => [l.id, l.lifePlanId!])));
    for (const [lifePlanId, delta] of deltas) {
      await tx.lifePlan.update({ where: { id: lifePlanId }, data: { currentAmount: { increment: delta } } });
    }
    return { exp: { count: inserted.length }, inc, inserted };
  }, { timeout: 30_000 }); // an interactive transaction defaults to 5 s; a statement may hold 5,000 rows

  // Learn from the categories assigned: every classified merchant becomes a
  // `learned` rule so future imports and syncs get auto-categorized. Dedupe
  // by merchant (last assignment wins). Best-effort: a learning failure must
  // not undo the committed rows. A payment from a bank account teaches its
  // debt line (the next statement proposes it as a payment, for the user to
  // confirm) — unless the merchant is a generic label ("Transferencia
  // realizada"…) that could be anything; refunds and a card statement's own
  // payment lines don't teach either.
  try {
    const merchantToAllocation = new Map<string, string>();
    for (const e of plan.expenses) {
      if (!e.allocationId || !e.merchant || e.kind === "refund" || (e.debtId && !e.accountId)) continue;
      if (e.debtId && isGenericMerchant(e.merchant)) continue;
      merchantToAllocation.set(e.merchant, e.allocationId);
    }
    for (const [merchant, allocationId] of merchantToAllocation) {
      await learnFromCorrection(userId, merchant, allocationId);
    }
  } catch (learnErr) {
    console.error(`[ingest/confirm:${source}] learn`, learnErr);
  }

  await syncDebtStatus(userId, plan.expenses.map(e => e.debtId));

  // Attribution (Epic H3): payer = account owner; split across the household
  // when the pool belongs to one. Only rows not yet attributed (payerUserId
  // null), so re-imports don't redo work. Refunds get the same payer — so
  // they're listed to them at shared_stats and count (negative) in their
  // per-person spending — but stay personal: household balances
  // (server/lib/balances.ts) add up what each member fronted and don't read refunds.
  if (ctx.householdId && exp.count > 0) {
    const account = accountId
      ? await prisma.account.findUnique({ where: { id: accountId }, select: { ownerUserId: true } })
      : null;
    const payerUserId = account?.ownerUserId ?? authUserId; // a person, never the pool id
    await prisma.expense.updateMany({
      where: {
        userId, source, kind: "refund", payerUserId: null,
        externalId: { in: plan.expenses.filter(e => e.kind === "refund").map(e => e.externalId) },
      },
      data: { payerUserId },
    });
    const created = await prisma.expense.findMany({
      where: {
        userId, source, kind: "expense", payerUserId: null,
        externalId: { in: plan.expenses.map(e => e.externalId) },
      },
      select: { id: true, amount: true },
    });
    for (const e of created) {
      await prisma.expense.update({ where: { id: e.id }, data: { payerUserId, scope: "shared", scopeSource: "manual" } });
      await rebuildExpenseShares(e.id, e.amount, ctx.householdId, payerUserId);
    }
  }

  // What this call wrote, for the summary ("23 expenses, 2 incomes, 1 payment
  // to the PASS card"): payments by the debt they pay.
  const nameByDebt = new Map(debts.map(d => [d.id, d.name]));
  const paymentsByDebt = new Map<string, number>();
  for (const e of inserted) if (e.debtId) paymentsByDebt.set(e.debtId, (paymentsByDebt.get(e.debtId) ?? 0) + 1);
  const summary: ImportSummary = {
    expenses: inserted.filter(e => e.kind === "expense" && !e.debtId).length,
    refunds: inserted.filter(e => e.kind === "refund").length,
    incomes: inc.count,
    payments: [...paymentsByDebt].map(([debtId, count]) => ({ debtId, name: nameByDebt.get(debtId) ?? null, count })),
  };
  return { expenses: exp.count, income: inc.count, inserted: exp.count + inc.count, summary };
}
