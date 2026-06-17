// Contribution / split engine (Epics H3 + H4).
//
// Pure functions that turn a shared expense into per-member shares according to
// the household's financial model. Deterministic and exact: the cent residue
// from integer division is always assigned to the payer so Σ shares == amount.
//
//   - proportional → weights from each member's income
//   - shared / equal → equal weights
//   - custom → per-member customSharePct (basis points)

export type SplitBasis = "income" | "equal" | "custom";

/** Equal weight (1) per member. */
export function equalWeights(userIds: string[]): Map<string, number> {
  return new Map(userIds.map(id => [id, 1]));
}

/**
 * Weights from each member's income. Falls back to equal weights when no member
 * has positive income (avoids a zero-total split).
 */
export function incomeWeights(userIds: string[], incomeByUser: Record<string, number>): Map<string, number> {
  const total = userIds.reduce((s, id) => s + Math.max(0, incomeByUser[id] ?? 0), 0);
  if (total <= 0) return equalWeights(userIds);
  return new Map(userIds.map(id => [id, Math.max(0, incomeByUser[id] ?? 0)]));
}

/** Weights from explicit per-member basis points (custom split). */
export function customWeights(sharePctByUser: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(sharePctByUser).map(([id, bp]) => [id, Math.max(0, bp)]));
}

/**
 * Split `amountCents` across the given weights into integer cents. Each member
 * gets floor(amount * w / totalW); the leftover cents (amount − Σ floors) go to
 * `residueTo` so the result always sums exactly to `amountCents`.
 */
export function splitByWeights(
  amountCents: number,
  weights: Map<string, number>,
  residueTo: string,
): Map<string, number> {
  const ids = [...weights.keys()];
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  const total = ids.reduce((s, id) => s + (weights.get(id) ?? 0), 0);
  if (total <= 0) {
    // Degenerate: equal split.
    return splitByWeights(amountCents, equalWeights(ids), residueTo);
  }

  let assigned = 0;
  for (const id of ids) {
    const share = Math.floor((amountCents * (weights.get(id) ?? 0)) / total);
    out.set(id, share);
    assigned += share;
  }

  const residueKey = out.has(residueTo) ? residueTo : ids[0];
  out.set(residueKey, (out.get(residueKey) ?? 0) + (amountCents - assigned));
  return out;
}

/**
 * Compute member shares for a shared expense. `payerUserId` receives the rounding
 * residue and is included even if absent from `memberIds` (e.g. paid for the
 * household but not a weighted member — rare).
 */
export function computeShares(opts: {
  amountCents: number;
  basis: SplitBasis;
  memberIds: string[];
  payerUserId: string;
  incomeByUser?: Record<string, number>;
  customSharePctByUser?: Record<string, number>;
}): Map<string, number> {
  const { amountCents, basis, memberIds, payerUserId, incomeByUser = {}, customSharePctByUser = {} } = opts;
  const ids = memberIds.includes(payerUserId) ? memberIds : [...memberIds, payerUserId];

  let weights: Map<string, number>;
  if (basis === "income") weights = incomeWeights(ids, incomeByUser);
  else if (basis === "custom") weights = customWeights(Object.fromEntries(ids.map(id => [id, customSharePctByUser[id] ?? 0])));
  else weights = equalWeights(ids);

  return splitByWeights(amountCents, weights, payerUserId);
}
