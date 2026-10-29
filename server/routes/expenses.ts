import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { normalizeMerchant } from "../lib/normalizeMerchant.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { categorize, learnFromCorrection } from "../lib/categorize.js";
import { findDuplicateGroups } from "../lib/dedupe.js";
import { prepareImport } from "../lib/importStatement.js";
import { aiEnabled, classifyMerchants } from "../lib/ai/classify.js";
import { suggestCategories } from "../lib/ai/suggestCategories.js";
import { rebuildExpenseShares } from "../lib/expenseShares.js";
import { expenseListingFilter } from "../lib/visibility.js";
import { periodBounds } from "../lib/period.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { countedAmounts, syncDebtStatus } from "../lib/debtBalance.js";
import { pickDefaultAccount } from "../lib/defaultAccount.js";

export const expensesRouter = Router();

// `code` lets the client show its own translated message.
const PAID_FROM_CARD = { error: "A card payment must come from another account, not the card itself", code: "paid_from_card" };

// An expense on a "debt" budget line IS a payment of that debt: the debtId is
// inherited from the line, never sent by the client. Returns the debt (with its
// card account, to reject paying a card from itself) or null.
async function debtForAllocation(userId: string, allocationId: string | null) {
  if (!allocationId) return null;
  const alloc = await prisma.allocation.findFirst({
    where: { id: allocationId, userId, type: "debt", debtId: { not: null } },
    select: { debt: { select: { id: true, accountId: true } } },
  });
  return alloc?.debt ?? null;
}

// Validate a requested accountId belongs to the user's pool; if none given (or
// not in the pool), fall back to the caller's default account
// (server/lib/defaultAccount.ts: own first, not a card). Returns null only
// when the pool has no open accounts at all.
async function resolveAccountId(userId: string, authUserId: string, accountId?: string | null): Promise<string | null> {
  if (accountId) {
    const owned = await prisma.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (owned) return owned.id;
  }
  const accounts = await prisma.account.findMany({
    where: { userId, isArchived: false },
    select: { id: true, ownerUserId: true, type: true, isArchived: true, sortOrder: true },
  });
  return pickDefaultAccount(accounts, authUserId);
}

// GET /api/expenses?month=2026-04&allocationId=xxx
expensesRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month, allocationId } = req.query as Record<string, string>;

    const where: any = { userId: req.userId! };

    if (month) {
      const cycleStartDay = await getCycleStartDay(req.userId!);
      const { start, end } = periodBounds(month, cycleStartDay);
      where.date = { gte: start, lt: end };
    }

    if (allocationId) {
      where.allocationId = allocationId === "unassigned" ? null : allocationId;
    }

    // Visibility (Epic H5): at shared_stats, the list shows only the viewer's
    // own transactions; the partner's appear only in aggregates.
    Object.assign(where, await expenseListingFilter(req));

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        allocation: { select: { id: true, name: true, icon: true, type: true } },
        account: { select: { id: true, name: true, type: true } },
        shares: { select: { userId: true, amount: true } },
      },
      orderBy: { date: "desc" },
    });

    // Attach the payer's display name for the attribution UI (Epic H3).
    const payerIds = [...new Set(expenses.map(e => e.payerUserId).filter(Boolean) as string[])];
    const payers = payerIds.length
      ? await prisma.user.findMany({ where: { id: { in: payerIds } }, select: { id: true, name: true, email: true } })
      : [];
    const payerName = Object.fromEntries(payers.map(u => [u.id, u.name ?? u.email]));
    // budgetAmount: what this expense counts as spending. Differs from amount
    // only for a card payment that partly pays for purchases already counted
    // in their own category (server/lib/debtBalance.ts).
    const counted = await countedAmounts(req.userId!);
    const withPayer = expenses.map(e => ({
      ...e,
      budgetAmount: counted.get(e.id) ?? e.amount,
      payerName: e.payerUserId ? (payerName[e.payerUserId] ?? null) : null,
    }));

    return res.json(serializeMoney({ expenses: withPayer }));
  } catch (err) {
    console.error("[expenses/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/expenses/suggest?description=...
// Returns the allocation the rules would assign for this description, without
// writing anything. Powers the live category suggestion in the add-expense form.
expensesRouter.get("/suggest", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const description = String(req.query.description ?? "").trim();
    if (!description) return res.json({ suggestion: null });

    const merchant = normalizeMerchant(description);
    const allocationId = await categorize(req.userId!, description, merchant);
    if (!allocationId) return res.json({ suggestion: null });

    const alloc = await prisma.allocation.findFirst({
      where: { id: allocationId, userId: req.userId! },
      select: { id: true, name: true, icon: true },
    });
    return res.json({
      suggestion: alloc ? { allocationId: alloc.id, name: alloc.name, icon: alloc.icon } : null,
    });
  } catch (err) {
    console.error("[expenses/suggest]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses
expensesRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, description, allocationId, accountId, date, payerUserId, scope, beneficiaryUserId } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    const amountCents = toCents(amount);
    const merchant = normalizeMerchant(description);

    // Auto-categorize: when the user didn't pick an allocation, let the rules decide.
    let resolvedAllocationId: string | null = allocationId || null;
    if (!resolvedAllocationId) {
      resolvedAllocationId = await categorize(req.userId!, description ?? "", merchant);
    }

    // Resolve the account: validate ownership if given, else fall back to the
    // user's default (lowest sortOrder, non-archived) account.
    const resolvedAccountId = await resolveAccountId(req.userId!, req.authUserId!, accountId);

    const paidDebt = await debtForAllocation(req.userId!, resolvedAllocationId);
    if (paidDebt && paidDebt.accountId && paidDebt.accountId === resolvedAccountId) {
      return res.status(400).json(PAID_FROM_CARD);
    }

    // Attribution (Epic H3). Default payer = the account's owner — whose
    // money paid it, which is what household balances settle on
    // (server/lib/balances.ts) — else the logged-in user. The default account
    // is the caller's own, so normally that is the caller. Who ENTERED it is
    // createdByUserId, kept apart. Default scope follows the household model
    // (individual → personal; shared/proportional → shared). All overridable
    // via the body.
    const account = resolvedAccountId
      ? await prisma.account.findUnique({ where: { id: resolvedAccountId }, select: { ownerUserId: true } })
      : null;
    const resolvedPayerId: string = payerUserId || account?.ownerUserId || req.authUserId!;
    let resolvedScope: string = scope === "shared" || scope === "personal" ? scope : "personal";
    if (!scope && req.householdId) {
      const hh = await prisma.household.findUnique({ where: { id: req.householdId }, select: { financialModel: true } });
      resolvedScope = hh && hh.financialModel !== "individual" ? "shared" : "personal";
    }

    const expense = await prisma.expense.create({
      data: {
        userId: req.userId!,
        amount: amountCents,
        description: description ?? "",
        merchant,
        source: "manual",
        allocationId: resolvedAllocationId,
        accountId: resolvedAccountId,
        debtId: paidDebt?.id ?? null,
        date: date ? new Date(date) : new Date(),
        payerUserId: resolvedPayerId,
        createdByUserId: req.authUserId!,
        scope: resolvedScope,
        beneficiaryUserId: resolvedScope === "personal" ? (beneficiaryUserId || null) : null,
        scopeSource: "manual",
      },
      include: {
        allocation: { select: { id: true, name: true, icon: true, type: true, lifePlanId: true } },
        account: { select: { id: true, name: true, type: true } },
      },
    });

    // Shared expenses get split across household members (residue to the payer).
    if (resolvedScope === "shared" && req.householdId) {
      await rebuildExpenseShares(expense.id, amountCents, req.householdId, resolvedPayerId);
    }

    // Auto-contribute to linked life plan if this is a plan allocation
    if (expense.allocation?.type === "plan" && expense.allocation.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: expense.allocation.lifePlanId },
        data: { currentAmount: { increment: amountCents } },
      });
    }

    await syncDebtStatus(req.userId!, [expense.debtId]);

    return res.json(serializeMoney({ expense }));
  } catch (err) {
    console.error("[expenses/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/expenses/duplicates  — groups of likely duplicate expenses
expensesRouter.get("/duplicates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { userId: req.userId! },
      include: {
        allocation: { select: { id: true, name: true, icon: true, type: true } },
        account: { select: { id: true, name: true, type: true } },
      },
      orderBy: { date: "desc" },
    });

    const groups = findDuplicateGroups(expenses);
    return res.json(serializeMoney({ groups }));
  } catch (err) {
    console.error("[expenses/duplicates]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses/merge  — keep one expense, delete the duplicates
// Body: { keepId, removeIds: string[] }
expensesRouter.post("/merge", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { keepId, removeIds } = req.body as { keepId: string; removeIds: string[] };
    if (!keepId || !Array.isArray(removeIds) || removeIds.length === 0) {
      return res.status(400).json({ error: "keepId and removeIds are required" });
    }
    if (removeIds.includes(keepId)) {
      return res.status(400).json({ error: "keepId cannot be in removeIds" });
    }

    // Only operate on the user's own expenses.
    const toRemove = await prisma.expense.findMany({
      where: { id: { in: removeIds }, userId: req.userId! },
      include: { allocation: { select: { type: true, lifePlanId: true } } },
    });
    const keep = await prisma.expense.findFirst({ where: { id: keepId, userId: req.userId! } });
    if (!keep) return res.status(404).json({ error: "Expense to keep not found" });

    // Reverse any plan contributions before deleting, mirroring DELETE /:id.
    for (const e of toRemove) {
      if (e.allocation?.type === "plan" && e.allocation.lifePlanId) {
        await prisma.lifePlan.update({
          where: { id: e.allocation.lifePlanId },
          data: { currentAmount: { decrement: e.amount } },
        });
      }
    }
    await prisma.expense.deleteMany({ where: { id: { in: toRemove.map(e => e.id) }, userId: req.userId! } });
    await syncDebtStatus(req.userId!, toRemove.map(e => e.debtId));

    return res.json({ success: true, removed: toRemove.length });
  } catch (err) {
    console.error("[expenses/merge]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses/import/preview
// Body: { filename, dataBase64 }. Parses the statement and returns rows flagged
// new|duplicate with a suggested category — does NOT write anything.
expensesRouter.post("/import/preview", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { filename, dataBase64 } = req.body as { filename?: string; dataBase64?: string };
    if (!filename || !dataBase64) {
      return res.status(400).json({ error: "filename and dataBase64 are required" });
    }

    const buffer = Buffer.from(dataBase64, "base64");
    let preview;
    try {
      preview = await prepareImport(req.userId!, buffer, filename);
    } catch (e: any) {
      return res.status(422).json({ error: e?.message || "Could not parse the file" });
    }

    // Resolve suggested allocation names for display.
    const ids = [...new Set(preview.rows.map(r => r.suggestedAllocationId).filter(Boolean) as string[])];
    if (ids.length > 0) {
      const allocs = await prisma.allocation.findMany({
        where: { id: { in: ids }, userId: req.userId! },
        select: { id: true, name: true },
      });
      const nameById = Object.fromEntries(allocs.map(a => [a.id, a.name]));
      for (const r of preview.rows) {
        if (r.suggestedAllocationId) r.suggestedAllocationName = nameById[r.suggestedAllocationId] ?? null;
      }
    }

    // NOTE: amounts in `preview` are already euros — do not run serializeMoney.
    return res.json(preview);
  } catch (err) {
    console.error("[expenses/import/preview]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses/import/classify
// Body: { merchants: string[] }. AI-classifies the given (rule-less) merchants
// against the user's allocations. Read-only — returns suggestions the UI merges
// into the preview. 503 when AI isn't configured; degrades to [] on AI failure.
expensesRouter.post("/import/classify", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!aiEnabled()) return res.status(503).json({ error: "AI not configured" });

    const raw = (req.body?.merchants ?? []) as unknown[];
    const merchants = [...new Set(raw.filter((m): m is string => typeof m === "string" && m.length > 0))].slice(0, 40);
    if (merchants.length === 0) return res.json({ suggestions: [] });

    const allocations = await prisma.allocation.findMany({
      where: { userId: req.userId! },
      select: { id: true, name: true },
    });

    const map = await classifyMerchants(merchants, allocations);
    const nameById = Object.fromEntries(allocations.map(a => [a.id, a.name]));
    const suggestions = Object.entries(map)
      .filter(([, id]) => id)
      .map(([merchant, allocationId]) => ({ merchant, allocationId, name: nameById[allocationId!] ?? null }));

    return res.json({ suggestions });
  } catch (err) {
    console.error("[expenses/import/classify]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses/import/suggest-categories
// Body: { merchants: string[] }. AI proposes a category set for the cold-start
// case. Read-only — the UI reviews and creates the accepted ones via /allocations.
expensesRouter.post("/import/suggest-categories", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!aiEnabled()) return res.status(503).json({ error: "AI not configured" });

    const raw = (req.body?.merchants ?? []) as unknown[];
    const merchants = [...new Set(raw.filter((m): m is string => typeof m === "string" && m.length > 0))].slice(0, 40);
    if (merchants.length === 0) return res.json({ categories: [] });

    const categories = await suggestCategories(merchants);
    return res.json({ categories });
  } catch (err) {
    console.error("[expenses/import/suggest-categories]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses/import/confirm
// Body: { accountId?, rows: ImportRow[] }. Inserts debits as expenses and
// credits as income, both source='import'. Idempotent via @@unique externalId.
expensesRouter.post("/import/confirm", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { accountId, rows } = req.body as {
      accountId?: string;
      rows: { kind: string; externalId: string; date: string; description?: string; merchant?: string; amount: number; allocationId?: string | null; category?: string }[];
    };
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows are required" });
    }

    const resolvedAccountId = await resolveAccountId(req.userId!, req.authUserId!, accountId);

    const expenseRows = rows.filter(r => r.kind === "expense");
    const incomeRows = rows.filter(r => r.kind === "income");

    // Rows put on a "debt" line are payments of that debt (see debtForAllocation).
    const debtLines = await prisma.allocation.findMany({
      where: { userId: req.userId!, type: "debt", debtId: { not: null } },
      select: { id: true, debtId: true, debt: { select: { accountId: true } } },
    });
    const debtIdByAllocation = new Map(debtLines.map(a => [a.id, a.debtId]));
    if (debtLines.some(a => a.debt?.accountId && a.debt.accountId === resolvedAccountId
      && expenseRows.some(r => r.allocationId === a.id))) {
      return res.status(400).json(PAID_FROM_CARD);
    }

    const [exp, inc] = await Promise.all([
      prisma.expense.createMany({
        data: expenseRows.map(r => ({
          userId: req.userId!,
          accountId: resolvedAccountId,
          allocationId: r.allocationId || null,
          debtId: (r.allocationId && debtIdByAllocation.get(r.allocationId)) || null,
          amount: toCents(r.amount),
          description: r.description ?? "",
          merchant: r.merchant || normalizeMerchant(r.description ?? ""),
          source: "import",
          externalId: r.externalId,
          date: new Date(r.date),
          createdByUserId: req.authUserId!,
        })),
        skipDuplicates: true, // re-importing the same file is a no-op
      }),
      prisma.income.createMany({
        data: incomeRows.map(r => ({
          userId: req.userId!,
          ownerUserId: req.authUserId!,
          accountId: resolvedAccountId,
          amount: toCents(r.amount),
          description: r.description ?? "",
          merchant: r.merchant || normalizeMerchant(r.description ?? ""),
          category: r.category || "other",
          source: "import",
          externalId: r.externalId,
          date: new Date(r.date),
        })),
        skipDuplicates: true,
      }),
    ]);

    // Learn from the categories assigned during import: every classified merchant
    // becomes a `learned` rule so the rest of this file — and future imports — get
    // auto-categorized. Dedupe by merchant (last assignment wins). Best-effort:
    // a learning failure must not undo the already-committed import.
    try {
      const merchantToAllocation = new Map<string, string>();
      for (const r of expenseRows) {
        const m = r.merchant || normalizeMerchant(r.description ?? "");
        if (m && r.allocationId) merchantToAllocation.set(m, r.allocationId);
      }
      for (const [merchant, allocationId] of merchantToAllocation) {
        await learnFromCorrection(req.userId!, merchant, allocationId);
      }
    } catch (learnErr) {
      console.error("[expenses/import/confirm] learn", learnErr);
    }

    await syncDebtStatus(req.userId!, expenseRows.map(r => r.allocationId && debtIdByAllocation.get(r.allocationId)));

    // Attribution for imported expenses (Epic H3): payer = account owner; split
    // across the household when the pool belongs to one. Only touch rows not yet
    // attributed (payerUserId null), so re-imports don't redo work.
    if (req.householdId && exp.count > 0) {
      const account = resolvedAccountId
        ? await prisma.account.findUnique({ where: { id: resolvedAccountId }, select: { ownerUserId: true } })
        : null;
      const payerUserId = account?.ownerUserId ?? req.authUserId!; // a person, never the pool id
      const created = await prisma.expense.findMany({
        where: { userId: req.userId!, source: "import", payerUserId: null, externalId: { in: expenseRows.map(r => r.externalId) } },
        select: { id: true, amount: true },
      });
      for (const e of created) {
        await prisma.expense.update({ where: { id: e.id }, data: { payerUserId, scope: "shared", scopeSource: "manual" } });
        await rebuildExpenseShares(e.id, e.amount, req.householdId, payerUserId);
      }
    }

    return res.json({ success: true, expenses: exp.count, income: inc.count, inserted: exp.count + inc.count });
  } catch (err) {
    console.error("[expenses/import/confirm]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/expenses/:id/attribution  (Epic H3)
// Body: { scope?, payerUserId?, beneficiaryUserId?, shares?: [{userId, amount}] }
// (amounts in euros). Without explicit shares, a shared expense is re-split from
// the household model; a personal expense clears its shares.
expensesRouter.patch("/:id/attribution", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findFirst({
      where: { id, userId: req.userId! },
      select: { id: true, amount: true, payerUserId: true, scope: true },
    });
    if (!existing) return res.status(404).json({ error: "Expense not found" });

    const { scope, payerUserId, beneficiaryUserId, shares } = req.body as {
      scope?: string; payerUserId?: string; beneficiaryUserId?: string; shares?: { userId: string; amount: number }[];
    };
    const newScope = scope === "shared" || scope === "personal" ? scope : existing.scope;
    const newPayer = payerUserId || existing.payerUserId || req.authUserId!;

    await prisma.expense.update({
      where: { id },
      data: {
        scope: newScope,
        payerUserId: newPayer,
        beneficiaryUserId: newScope === "personal" ? (beneficiaryUserId || null) : null,
        scopeSource: "manual",
      },
    });

    if (newScope === "shared") {
      if (Array.isArray(shares) && shares.length > 0) {
        const data = shares.map(s => ({ expenseId: id, userId: s.userId, amount: toCents(s.amount) }));
        if (data.reduce((a, b) => a + b.amount, 0) !== existing.amount) {
          return res.status(400).json({ error: "Shares must sum to the expense amount" });
        }
        await prisma.expenseShare.deleteMany({ where: { expenseId: id } });
        await prisma.expenseShare.createMany({ data });
      } else {
        await rebuildExpenseShares(id, existing.amount, req.householdId, newPayer);
      }
    } else {
      await prisma.expenseShare.deleteMany({ where: { expenseId: id } });
    }

    const updated = await prisma.expense.findUnique({
      where: { id },
      include: { shares: true, allocation: { select: { id: true, name: true, icon: true, type: true } } },
    });
    return res.json(serializeMoney({ expense: updated }));
  } catch (err) {
    console.error("[expenses/attribution]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/expenses/:id
expensesRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findFirst({
      where: { id, userId: req.userId! },
      include: { allocation: { select: { type: true, lifePlanId: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Expense not found" });

    const { amount, description, allocationId, accountId, date } = req.body;

    // Validate a re-assigned account belongs to the user (ignore invalid ids).
    let accountUpdate: { accountId: string } | undefined;
    if (accountId !== undefined && accountId) {
      const owned = await prisma.account.findFirst({
        where: { id: accountId, userId: req.userId! },
        select: { id: true },
      });
      if (owned) accountUpdate = { accountId: owned.id };
    }

    // Resolve the allocation that will apply after the update
    const newAllocId = allocationId !== undefined ? (allocationId || null) : existing.allocationId;
    const newAlloc = newAllocId ? await prisma.allocation.findFirst({
      where: { id: newAllocId },
      select: { type: true, lifePlanId: true },
    }) : null;
    const newAmount = amount !== undefined ? toCents(amount) : existing.amount;

    // Moving onto / off a "debt" line makes it / stops it being a payment.
    const paidDebt = await debtForAllocation(req.userId!, newAllocId);
    const newAccountId = accountUpdate?.accountId ?? existing.accountId;
    if (paidDebt && paidDebt.accountId && paidDebt.accountId === newAccountId) {
      return res.status(400).json(PAID_FROM_CARD);
    }

    // Reverse old plan contribution
    if (existing.allocation?.type === "plan" && existing.allocation.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: existing.allocation.lifePlanId },
        data: { currentAmount: { decrement: existing.amount } },
      });
    }
    // Apply new plan contribution
    if (newAlloc?.type === "plan" && newAlloc.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: newAlloc.lifePlanId },
        data: { currentAmount: { increment: newAmount } },
      });
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(amount !== undefined && { amount: newAmount }),
        ...(description !== undefined && { description, merchant: normalizeMerchant(description) }),
        ...(allocationId !== undefined && { allocationId: allocationId || null, debtId: paidDebt?.id ?? null }),
        ...(accountUpdate ?? {}),
        ...(date !== undefined && { date: new Date(date) }),
      },
      include: {
        allocation: { select: { id: true, name: true, icon: true, type: true, lifePlanId: true } },
        account: { select: { id: true, name: true, type: true } },
      },
    });

    // Learn from manual re-assignment: when the user moves an expense to a (real)
    // allocation, remember the merchant -> allocation mapping for next time.
    if (allocationId !== undefined && newAllocId && newAllocId !== existing.allocationId) {
      const effectiveMerchant = description !== undefined ? normalizeMerchant(description) : existing.merchant;
      await learnFromCorrection(req.userId!, effectiveMerchant, newAllocId);
    }

    await syncDebtStatus(req.userId!, [existing.debtId, expense.debtId]);

    return res.json(serializeMoney({ expense }));
  } catch (err) {
    console.error("[expenses/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/expenses/:id
expensesRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findFirst({
      where: { id, userId: req.userId! },
      include: { allocation: { select: { type: true, lifePlanId: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Expense not found" });

    await prisma.expense.delete({ where: { id } });
    await syncDebtStatus(req.userId!, [existing.debtId]);

    // Reverse plan contribution if applicable
    if (existing.allocation?.type === "plan" && existing.allocation.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: existing.allocation.lifePlanId },
        data: { currentAmount: { decrement: existing.amount } },
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[expenses/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
