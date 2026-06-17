// Budget suggestions from spending history (Phase K).
//
// Deterministic — NOT AI. The amount a category should be budgeted is computed
// from the user's own classified history (median of monthly totals), which is
// exact, free, and auditable. The AI's job (Phase J) was classifying text into
// categories; turning that history into a number is arithmetic, not a task for
// an LLM. Works with no API key configured.
import { prisma } from "./prisma.js";

export type Confidence = "high" | "medium" | "low";

export interface BudgetSuggestion {
  allocationId: string;
  suggested: number; // cents, rounded to the nearest €5
  monthsObserved: number; // months (in window) with any spend in this category
  confidence: Confidence;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function roundToFiveEuros(cents: number): number {
  return Math.round(cents / 500) * 500;
}

/**
 * Suggest a monthly budget per allocation = median of its monthly totals over the
 * last `monthsBack` COMPLETE months (the current, partial month is excluded).
 * Savings ("plan") allocations are skipped. Returns only allocations with spend.
 */
export async function suggestBudgets(userId: string, monthsBack = 6): Promise<BudgetSuggestion[]> {
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), 1); // first of current (partial) month — exclusive

  // The complete months in the window, oldest → newest.
  const windowMonths: string[] = [];
  for (let i = monthsBack; i >= 1; i--) {
    windowMonths.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }

  const [expenses, allocations] = await Promise.all([
    prisma.expense.findMany({
      where: { userId, allocationId: { not: null }, date: { gte: windowStart, lt: windowEnd } },
      select: { allocationId: true, amount: true, date: true },
    }),
    prisma.allocation.findMany({
      where: { userId },
      select: { id: true, type: true },
    }),
  ]);

  if (expenses.length === 0) return [];

  // Don't drag medians down with months before the user had any data: clamp the
  // window to start at the earliest month with spend.
  let earliest = windowMonths[windowMonths.length - 1];
  for (const e of expenses) {
    const m = monthKey(e.date);
    if (m < earliest) earliest = m;
  }
  const months = windowMonths.filter(m => m >= earliest);

  // allocationId → monthKey → total cents
  const byAllocMonth = new Map<string, Map<string, number>>();
  for (const e of expenses) {
    const id = e.allocationId!;
    const m = monthKey(e.date);
    const inner = byAllocMonth.get(id) ?? new Map<string, number>();
    inner.set(m, (inner.get(m) ?? 0) + e.amount);
    byAllocMonth.set(id, inner);
  }

  const isPlan = new Set(allocations.filter(a => a.type === "plan").map(a => a.id));

  const suggestions: BudgetSuggestion[] = [];
  for (const [allocationId, perMonth] of byAllocMonth) {
    if (isPlan.has(allocationId)) continue;
    // Totals across every in-range month (0 when the category had no spend that month).
    const totals = months.map(m => perMonth.get(m) ?? 0);
    const monthsObserved = totals.filter(t => t > 0).length;
    if (monthsObserved === 0) continue;
    const suggested = roundToFiveEuros(median(totals));
    if (suggested <= 0) continue;
    const confidence: Confidence = monthsObserved >= 3 ? "high" : monthsObserved === 2 ? "medium" : "low";
    suggestions.push({ allocationId, suggested, monthsObserved, confidence });
  }

  return suggestions;
}
