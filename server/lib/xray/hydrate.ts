// Account hydration from a Radiografía Financiera session (R5).
//
// When an anonymous visitor finishes the x-ray and creates an account, we reuse
// the transactions we already parsed (stored on the XRaySession) to populate
// their brand-new account: category allocations, expenses, income and a
// pre-filled monthly income — so they land with zero setup. One-shot and
// idempotent via `claimedByUserId`. After claiming, the raw rows are purged.
import { prisma } from "../prisma.js";
import { normalizeMerchant } from "../normalizeMerchant.js";
import { externalIdFor } from "../importStatement.js";
import { learnFromCorrection } from "../categorize.js";
import { classifyLocal, iconForKey } from "./categories.js";
import { classifyMovement, type MovementType, type MovementKind } from "./wealth.js";
import { describeMovement } from "./transferDetail.js";
import { reconcile } from "./reconcile.js";
import { categoryLabel } from "./labels.js";
import type { ParsedTxn } from "../parsers/bbva.js";
import type { XRayResult, Overrides } from "./analyze.js";

interface StoredTxn { date: string; concept: string; amount: number; balance: number | null; fileIndex?: number; extra?: string }

const FIXED_KEYS = new Set(["housing", "utilities", "insurance"]);

// Wealth movements get their own allocations, not consumption categories.
const SAVINGS_KEY = "__savings__";
const INVESTMENT_KEY = "__investment__";
const GIVING_KEY = "__giving__";
function allocationLabel(key: string, lang: "es" | "en"): string {
  if (key === SAVINGS_KEY) return lang === "es" ? "Ahorro" : "Savings";
  if (key === INVESTMENT_KEY) return lang === "es" ? "Inversión" : "Investments";
  if (key === GIVING_KEY) return lang === "es" ? "Generosidad" : "Giving";
  return categoryLabel(key, lang);
}
function allocationIcon(key: string): string {
  if (key === SAVINGS_KEY) return "🏦";
  if (key === INVESTMENT_KEY) return "📈";
  if (key === GIVING_KEY) return "💛";
  return iconForKey(key);
}

export type HydrateResult = { imported: number } | { skipped: string };

export async function hydrateFromXraySession(userId: string, sessionId: string): Promise<HydrateResult> {
  const session = await prisma.xRaySession.findUnique({ where: { id: sessionId } });
  if (!session) return { skipped: "not_found" };
  if (session.claimedByUserId) return { skipped: "already_claimed" };
  if (session.expiresAt.getTime() < Date.now()) return { skipped: "expired" };

  const stored = (session.transactions as unknown as StoredTxn[]) ?? [];
  const claim = () => prisma.xRaySession.update({
    where: { id: sessionId },
    data: { claimedByUserId: userId, transactions: [], aiCategories: undefined }, // purge raw rows once claimed
  });

  if (!Array.isArray(stored) || stored.length === 0) {
    await claim();
    return { imported: 0 };
  }

  // Signup already seeded the default account + allocations; find the account.
  const account = await prisma.account.findFirst({
    where: { userId, isArchived: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { language: true } });
  const lang = settings?.language === "es" ? "es" : "en" as const;
  const overrides = (session.overrides as unknown as Overrides) ?? {};

  // Prepare transactions (same normalization + movement classification the
  // analyzer used, honoring the user's reclassifications via the same dual key).
  const prepared = stored
    .map(s => ({ t: { date: new Date(s.date), concept: s.concept, amount: s.amount, balance: s.balance, extra: s.extra } as ParsedTxn, fileIndex: s.fileIndex ?? 0 }))
    .filter(p => p.t.amount !== 0 && !isNaN(p.t.date.getTime()))
    .map(p => {
      const merchant = normalizeMerchant(p.t.concept);
      const kind = (p.t.amount < 0 ? "expense" : "income") as "expense" | "income";
      let mv: { type: MovementType; kind: MovementKind } = kind === "expense"
        ? classifyMovement(p.t.concept)
        : { type: "consumption", kind: null };
      let movementKey = merchant;
      if (kind === "expense" && mv.type === "uncertain") {
        movementKey = describeMovement(p.t.concept, mv.kind === "cash" ? "cash" : "transfer").movementKey;
      }
      const ov = overrides[movementKey] ?? overrides[merchant];
      if (kind === "expense" && ov) {
        mv = ov === "wealth" ? { type: "wealth", kind: mv.kind === "investment" ? "investment" : "savings" } : { type: "consumption", kind: null };
      }
      // Route wealth movements to Ahorro/Generosidad/Inversión; everything else to its category.
      let allocKey = classifyLocal(merchant).key;
      if (kind === "expense" && mv.type === "wealth") {
        allocKey = mv.kind === "investment" ? INVESTMENT_KEY : mv.kind === "giving" ? GIVING_KEY : SAVINGS_KEY;
      }
      return { t: p.t, merchant, externalId: externalIdFor(p.t, merchant), kind, allocKey, fileIndex: p.fileIndex, movementType: mv.type, movementKind: mv.kind };
    });

  // Reconcile internal transfers between uploaded accounts and exclude them from
  // both expense and income creation (else a phantom expense+income pair lands).
  const recon = reconcile(prepared.map(p => ({
    kind: p.kind, cents: Math.abs(Math.round(p.t.amount * 100)), date: p.t.date,
    fileIndex: p.fileIndex, concept: p.t.concept, movementType: p.movementType, movementKind: p.movementKind,
  })));
  const active = prepared.filter((_, i) => !recon.internal.has(i));

  const expenses = active.filter(p => p.kind === "expense");
  const incomes = active.filter(p => p.kind === "income");

  // Create an allocation per distinct bucket present, sorted by amount so the
  // biggest come first.
  const keyTotals = new Map<string, number>();
  for (const e of expenses) keyTotals.set(e.allocKey, (keyTotals.get(e.allocKey) ?? 0) + Math.abs(e.t.amount));
  const orderedKeys = [...keyTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const allocationByKey = new Map<string, string>();
  let sortOrder = 10; // after the default allocations
  for (const key of orderedKeys) {
    const created = await prisma.allocation.create({
      data: {
        userId,
        name: allocationLabel(key, lang),
        icon: allocationIcon(key),
        type: FIXED_KEYS.has(key) ? "fixed" : "flexible",
        sortOrder: sortOrder++,
      },
      select: { id: true },
    });
    allocationByKey.set(key, created.id);
  }

  await Promise.all([
    prisma.expense.createMany({
      data: expenses.map(e => ({
        userId,
        accountId: account?.id ?? null,
        allocationId: allocationByKey.get(e.allocKey) ?? null,
        amount: Math.abs(Math.round(e.t.amount * 100)),
        description: e.t.concept,
        merchant: e.merchant,
        source: "import",
        externalId: e.externalId,
        date: e.t.date,
      })),
      skipDuplicates: true,
    }),
    prisma.income.createMany({
      data: incomes.map(i => ({
        userId,
        ownerUserId: userId,
        accountId: account?.id ?? null,
        amount: Math.abs(Math.round(i.t.amount * 100)),
        description: i.t.concept,
        merchant: i.merchant,
        category: /nomina|nómina|payroll|salary|salario/i.test(i.t.concept) ? "salary" : "other",
        source: "import",
        externalId: i.externalId,
        date: i.t.date,
      })),
      skipDuplicates: true,
    }),
  ]);

  // Pre-fill monthly income from the x-ray (helps the budgeting onboarding),
  // only if the user hasn't set one yet.
  const result = session.result as unknown as XRayResult;
  const months = Math.max(1, result?.period?.months ?? 1);
  const monthlyIncomeCents = Math.round(((result?.summary?.totalIncome ?? 0) / months) * 100);
  if (monthlyIncomeCents > 0) {
    await prisma.userSettings.updateMany({
      where: { userId, monthlyIncome: 0 },
      data: { monthlyIncome: monthlyIncomeCents },
    });
  }

  // Learn merchant → allocation so future imports auto-categorize (best-effort).
  try {
    const seen = new Map<string, string>();
    for (const e of expenses) {
      const allocId = allocationByKey.get(e.allocKey);
      if (e.merchant && allocId) seen.set(e.merchant, allocId);
    }
    for (const [merchant, allocationId] of seen) await learnFromCorrection(userId, merchant, allocationId);
  } catch (err) {
    console.error("[xray/hydrate] learn", err);
  }

  await claim();
  return { imported: expenses.length + incomes.length };
}
