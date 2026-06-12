// Rule-based auto-categorization (Fase B).
//
// A CategorizationRule maps a text pattern to an allocation. On expense creation,
// if the user didn't pick an allocation, we run the rules and assign the winner.
// When the user manually re-assigns an expense, we "learn" an exact-match rule on
// its merchant so the same shop is categorized automatically next time.
//
// Matching is deterministic: rules are evaluated in priority order (highest first,
// then oldest first), and the FIRST matching rule wins.
import { prisma } from "./prisma.js";
import { normalizeMerchant } from "./normalizeMerchant.js";

export interface RuleLike {
  matchType: string; // "contains" | "equals" | "regex"
  pattern: string;
  allocationId: string;
}

/** Does a single rule match the given expense? Pure. */
export function ruleMatches(rule: RuleLike, description: string, merchant: string): boolean {
  switch (rule.matchType) {
    case "equals":
      return merchant.length > 0 && merchant === normalizeMerchant(rule.pattern);
    case "regex":
      try {
        return new RegExp(rule.pattern, "i").test(description ?? "");
      } catch {
        return false; // invalid stored regex never matches
      }
    case "contains":
    default: {
      const needle = normalizeMerchant(rule.pattern);
      return needle.length > 0 && merchant.includes(needle);
    }
  }
}

/**
 * Pick the winning allocationId from rules already sorted by precedence
 * (priority desc, then createdAt asc). Returns null when nothing matches. Pure.
 */
export function pickAllocationId(
  sortedRules: RuleLike[],
  description: string,
  merchant: string,
): string | null {
  for (const rule of sortedRules) {
    if (ruleMatches(rule, description, merchant)) return rule.allocationId;
  }
  return null;
}

/** Load the user's rules (in precedence order) and resolve an allocation. */
export async function categorize(
  userId: string,
  description: string,
  merchant: string,
): Promise<string | null> {
  const rules = await prisma.categorizationRule.findMany({
    where: { userId },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  return pickAllocationId(rules, description, merchant);
}

/**
 * Record that `merchant` should map to `allocationId`, as an exact-match learned
 * rule. Idempotent: updates the existing (userId, equals, merchant) rule if present
 * (without downgrading a manual rule's source), otherwise creates a learned one.
 */
export async function learnFromCorrection(
  userId: string,
  merchant: string,
  allocationId: string,
): Promise<void> {
  if (!merchant) return; // nothing to key a rule on

  const where = {
    userId_matchType_pattern: { userId, matchType: "equals", pattern: merchant },
  };
  const existing = await prisma.categorizationRule.findUnique({ where });

  if (existing) {
    if (existing.allocationId !== allocationId) {
      await prisma.categorizationRule.update({ where, data: { allocationId } });
    }
    return;
  }

  await prisma.categorizationRule.create({
    data: { userId, matchType: "equals", pattern: merchant, allocationId, source: "learned" },
  });
}
