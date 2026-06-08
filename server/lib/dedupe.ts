// Duplicate detection (Phase F, feature #5).
//
// Two expenses are candidate duplicates when they share the exact same amount
// (integer cents — no float tolerance needed thanks to Phase A) and fall within
// WINDOW_DAYS of each other. Typical case: a charge entered manually and later
// re-imported from the bank.

const WINDOW_DAYS = 2;
const DAY_MS = 86400000;

/**
 * Cluster items into groups of likely duplicates. Items are bucketed by amount,
 * then chained while consecutive (date-sorted) entries are within WINDOW_DAYS.
 * Only clusters of 2+ are returned.
 */
export function findDuplicateGroups<T extends { id: string; amount: number; date: Date | string }>(items: T[]): T[][] {
  const byAmount = new Map<number, T[]>();
  for (const it of items) {
    const arr = byAmount.get(it.amount) ?? [];
    arr.push(it);
    byAmount.set(it.amount, arr);
  }

  const groups: T[][] = [];
  for (const bucket of byAmount.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => +new Date(a.date) - +new Date(b.date));

    let cluster: T[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const gapDays = Math.abs(+new Date(sorted[i].date) - +new Date(sorted[i - 1].date)) / DAY_MS;
      if (gapDays <= WINDOW_DAYS) {
        cluster.push(sorted[i]);
      } else {
        if (cluster.length >= 2) groups.push(cluster);
        cluster = [sorted[i]];
      }
    }
    if (cluster.length >= 2) groups.push(cluster);
  }

  return groups;
}
