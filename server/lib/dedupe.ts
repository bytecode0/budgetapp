// Duplicate detection (Phase F, feature #5).
//
// Two expenses are candidate duplicates when they share the exact same amount
// (integer cents — no float tolerance needed thanks to Phase A) and fall within
// WINDOW_DAYS of each other. Typical case: a charge entered manually and later
// re-imported from the bank. An expense and a refund (Expense.kind) of the
// same amount are never duplicates: the refund undoes the purchase.
//
// Two rules keep false positives out (canPair):
//   - Two rows of the same account that came through the same pipeline
//     (file import, or bank sync) with different externalIds are two movements
//     according to the bank itself — two coffees of the same price. Pairs stay
//     possible when one is manual, when the sources differ (a file import and a
//     bank sync of the same account: the real duplicate case) or the accounts
//     differ.
//   - A pair the user marked as "not duplicates" (DuplicateDismissal) never
//     links again. A new expense can still match either one of them.

const WINDOW_DAYS = 2;
const DAY_MS = 86400000;

/** Expense.source values written by the import/bank pipeline (server/lib/ingest/confirm.ts). */
const PIPELINE_SOURCES = new Set(["import", "bank_sync"]);

export interface DedupeItem {
  id: string;
  amount: number;
  date: Date | string;
  kind?: string | null;
  source?: string | null;
  accountId?: string | null;
  externalId?: string | null;
}

/** The key of an unordered pair of expense ids (the ids sorted). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Every unordered pair among the ids, each sorted [smaller, larger]. Dismissing
 *  a group dismisses all of them. */
export function pairsOf(ids: readonly string[]): [string, string][] {
  const unique = [...new Set(ids)].sort();
  const pairs: [string, string][] = [];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) pairs.push([unique[i], unique[j]]);
  }
  return pairs;
}

/** Whether two same-amount, same-kind expenses close in time may be duplicates. */
export function canPair(a: DedupeItem, b: DedupeItem): boolean {
  const sameAccount = !!a.accountId && a.accountId === b.accountId;
  const samePipeline = !!a.source && a.source === b.source && PIPELINE_SOURCES.has(a.source);
  const distinctBankIds = !!a.externalId && !!b.externalId && a.externalId !== b.externalId;
  return !(sameAccount && samePipeline && distinctBankIds);
}

/**
 * Cluster items into groups of likely duplicates. Items are bucketed by kind and amount;
 * within a bucket, two items within WINDOW_DAYS that canPair and whose pair is not in
 * `dismissed` (pairKey values) are linked, and each connected set of 2+ is a group,
 * sorted by date.
 */
export function findDuplicateGroups<T extends DedupeItem>(items: T[], dismissed: ReadonlySet<string> = new Set()): T[][] {
  const byAmount = new Map<string, T[]>();
  for (const it of items) {
    const key = `${it.kind || "expense"}|${it.amount}`;
    const arr = byAmount.get(key) ?? [];
    arr.push(it);
    byAmount.set(key, arr);
  }

  const groups: T[][] = [];
  for (const bucket of byAmount.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => +new Date(a.date) - +new Date(b.date));

    // Union-find over the bucket's indices.
    const parent = sorted.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const gapDays = (+new Date(sorted[j].date) - +new Date(sorted[i].date)) / DAY_MS;
        if (gapDays > WINDOW_DAYS) break; // sorted: every later j is further away
        if (!canPair(sorted[i], sorted[j])) continue;
        if (dismissed.has(pairKey(sorted[i].id, sorted[j].id))) continue;
        parent[root(j)] = root(i);
      }
    }

    const clusters = new Map<number, T[]>();
    sorted.forEach((it, i) => {
      const r = root(i);
      const arr = clusters.get(r) ?? [];
      arr.push(it);
      clusters.set(r, arr);
    });
    for (const cluster of clusters.values()) if (cluster.length >= 2) groups.push(cluster);
  }

  return groups;
}

// n ids store n·(n−1)/2 pairs; a real group is a handful of rows.
const MAX_DISMISS_IDS = 50;

type Rejection = { error: string; status: number };

/**
 * Validates a merge (keep one, delete the rest) against the expenses the caller
 * may delete — the ones they can see (expenseListingFilter, as DELETE
 * /api/expenses/:id). Any id outside that set answers 404, as if it didn't
 * exist, so nothing the caller can't see is deleted or confirmed to exist.
 */
export function mergeTargets(
  keepId: unknown, removeIds: unknown, deletable: ReadonlySet<string>,
): Rejection | { keepId: string; removeIds: string[] } {
  if (typeof keepId !== "string" || !keepId || !Array.isArray(removeIds) || removeIds.length === 0
    || !removeIds.every(id => typeof id === "string" && id)) {
    return { error: "keepId and removeIds are required", status: 400 };
  }
  const ids = [...new Set(removeIds as string[])];
  if (ids.includes(keepId)) return { error: "keepId cannot be in removeIds", status: 400 };
  if (!deletable.has(keepId)) return { error: "Expense to keep not found", status: 404 };
  if (!ids.every(id => deletable.has(id))) return { error: "Expense not found", status: 404 };
  return { keepId, removeIds: ids };
}

/**
 * Validates a "not duplicates" request: 2+ distinct expense ids, all visible to
 * the caller. Returns every pair among them, to store as dismissals.
 */
export function dismissalPairs(ids: unknown, visible: ReadonlySet<string>): Rejection | { pairs: [string, string][] } {
  if (!Array.isArray(ids) || !ids.every(id => typeof id === "string" && id)) {
    return { error: "ids are required", status: 400 };
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length < 2) return { error: "At least two expenses are required", status: 400 };
  if (unique.length > MAX_DISMISS_IDS) return { error: "Too many expenses", status: 400 };
  if (!unique.every(id => visible.has(id))) return { error: "Expense not found", status: 404 };
  return { pairs: pairsOf(unique) };
}
