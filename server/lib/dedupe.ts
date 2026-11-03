// Duplicate detection (Phase F, feature #5).
//
// Two expenses are candidate duplicates when they share the exact same amount
// (integer cents — no float tolerance needed thanks to Phase A) and fall within
// WINDOW_DAYS of each other. Typical case: a charge entered manually and later
// re-imported from the bank. An expense and a refund (Expense.kind) of the
// same amount are never duplicates: the refund undoes the purchase.
//
// Two rules keep false positives out:
//   - canPair: two bank-sync rows of the same account with different
//     externalIds are two movements according to the bank itself (provider ids
//     are stable) — two coffees of the same price. File imports are NOT covered:
//     their externalIds are content hashes that change with the export format,
//     so the same file pipeline can import one movement twice. Pairs stay
//     possible when one is manual, when the sources differ or the accounts do.
//   - A pair the user marked as "not duplicates" (DuplicateDismissal) never
//     links again. A new expense can still match either one of them.
//
// A group is a set in which EVERY pair is a candidate (a clique), never a
// chain: otherwise a manual row would glue two real bank movements into one
// group, a merge would delete one of them, and a dismissed pair would come
// back together through a third row.

const WINDOW_DAYS = 2;
const DAY_MS = 86400000;

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

/** False for two bank-sync rows of the same account with different provider ids. */
export function canPair(a: DedupeItem, b: DedupeItem): boolean {
  const sameAccount = !!a.accountId && a.accountId === b.accountId;
  const bothBankSync = a.source === "bank_sync" && b.source === "bank_sync";
  const distinctBankIds = !!a.externalId && !!b.externalId && a.externalId !== b.externalId;
  return !(sameAccount && bothBankSync && distinctBankIds);
}

/** Whether two expenses may be duplicates of each other (ignoring dismissals):
 *  same kind and amount, within WINDOW_DAYS, and canPair. */
export function candidates(a: DedupeItem, b: DedupeItem): boolean {
  if ((a.kind || "expense") !== (b.kind || "expense") || a.amount !== b.amount) return false;
  if (Math.abs(+new Date(a.date) - +new Date(b.date)) / DAY_MS > WINDOW_DAYS) return false;
  return canPair(a, b);
}

/**
 * Groups of likely duplicates. Items are taken in date order (ties by id) and
 * each joins the first group whose every member is a candidate with it and
 * isn't dismissed with it (`dismissed`: pairKey values); otherwise it starts a
 * new group. Each item is in at most one group; only groups of 2+ are returned.
 */
export function findDuplicateGroups<T extends DedupeItem>(items: T[], dismissed: ReadonlySet<string> = new Set()): T[][] {
  const sorted = [...items].sort((a, b) => +new Date(a.date) - +new Date(b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups: T[][] = [];
  // Only groups of the same kind and amount can take an item: bucket them.
  const byAmount = new Map<string, T[][]>();
  for (const it of sorted) {
    const key = `${it.kind || "expense"}|${it.amount}`;
    const bucket = byAmount.get(key) ?? [];
    byAmount.set(key, bucket);
    const home = bucket.find(g => g.every(m => candidates(m, it) && !dismissed.has(pairKey(m.id, it.id))));
    if (home) { home.push(it); continue; }
    const group = [it];
    bucket.push(group);
    groups.push(group);
  }
  return groups.filter(g => g.length >= 2);
}

// Both requests are bounded: n ids mean n·(n−1)/2 pairs; a real group is a handful of rows.
export const MAX_GROUP_IDS = 50;

type Rejection = { error: string; status: number };

const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(id => typeof id === "string" && id.length > 0);

/** Shape of a merge request, checked before any query. */
export function parseMerge(keepId: unknown, removeIds: unknown): Rejection | { keepId: string; removeIds: string[] } {
  if (typeof keepId !== "string" || !keepId || !isIdList(removeIds) || removeIds.length === 0) {
    return { error: "keepId and removeIds are required", status: 400 };
  }
  const ids = [...new Set(removeIds)];
  if (ids.length > MAX_GROUP_IDS) return { error: "Too many expenses", status: 400 };
  if (ids.includes(keepId)) return { error: "keepId cannot be in removeIds", status: 400 };
  return { keepId, removeIds: ids };
}

/**
 * Checks a parsed merge against the rows the caller may delete — the ones they
 * can see (expenseListingFilter, as DELETE /api/expenses/:id). Any id outside
 * them answers 404, as if it didn't exist. Every removed row must be a
 * candidate duplicate of the kept one, so a merge never deletes a distinct
 * movement (e.g. another bank-sync coffee).
 */
export function checkMerge<T extends DedupeItem>(
  req: { keepId: string; removeIds: string[] }, deletable: readonly T[],
): Rejection | { toRemove: T[] } {
  const byId = new Map(deletable.map(e => [e.id, e]));
  const keep = byId.get(req.keepId);
  if (!keep) return { error: "Expense to keep not found", status: 404 };
  const toRemove = req.removeIds.map(id => byId.get(id));
  if (toRemove.some(e => !e)) return { error: "Expense not found", status: 404 };
  const rows = toRemove as T[];
  if (!rows.every(e => candidates(keep, e))) return { error: "Not a duplicate of the expense to keep", status: 400 };
  return { toRemove: rows };
}

/** Shape of a "not duplicates" request (2+ distinct ids, capped), before any query. */
export function parseDismiss(ids: unknown): Rejection | { ids: string[] } {
  if (!isIdList(ids)) return { error: "ids are required", status: 400 };
  const unique = [...new Set(ids)];
  if (unique.length < 2) return { error: "At least two expenses are required", status: 400 };
  if (unique.length > MAX_GROUP_IDS) return { error: "Too many expenses", status: 400 };
  return { ids: unique };
}

/** Every pair among the ids, once all of them are visible to the caller. */
export function dismissalPairs(ids: string[], visible: ReadonlySet<string>): Rejection | { pairs: [string, string][] } {
  if (!ids.every(id => visible.has(id))) return { error: "Expense not found", status: 404 };
  return { pairs: pairsOf(ids) };
}
