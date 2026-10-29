// Linking a connection's bank accounts to the user's accounts (§5.3).
//
//   bank current/savings account → an Account (new, or one of the user's own
//     non-card accounts); its balance follows the bank.
//   bank card account → an Account of type "card" (new, or one of the user's
//     own cards) AND its debt (server/lib/cardDebt.ts: created when missing),
//     the debt linked too. The card Account's balance is never written: what's
//     owed lives in the debt, reconciled from the bank's balance.
//
// Only the connection's owner links, and only to accounts they own: never a
// partner's account, private or shared (mutationAccess in ownership.ts).
import { prisma } from "../prisma.js";
import { createCardDebt } from "../cardDebt.js";
import { mutationAccess } from "../ownership.js";
import { owedFromCardBalance } from "./sync.js";
import type { BankingProviderClient, BankProviderAccount } from "./types.js";

export interface LinkMapping {
  externalAccountId: string;
  /** Link to this existing account… */
  accountId?: string;
  /** …or create one. `type` only chooses between checking and savings. */
  create?: { name?: string; type?: string };
}

export interface LocalAccount {
  id: string;
  userId: string;
  ownerUserId: string;
  visibility: string;
  type: string;
  isArchived: boolean;
}

export type LinkAction =
  | { provider: BankProviderAccount; accountId: string }
  | { provider: BankProviderAccount; create: { name: string; type: string } };

export type LinkPlan = { actions: LinkAction[] } | { error: string; code: string; status: number };

const MAX_NAME = 100;
const NON_CARD_TYPES = new Set(["checking", "savings"]);

export const LINK_ERRORS = {
  invalid: { error: "mappings array is required", code: "banking_invalid_mappings", status: 400 },
  unknownBankAccount: { error: "Bank account not found in this connection", code: "banking_unknown_account", status: 400 },
  accountNotFound: { error: "Account not found", code: "account_not_found", status: 404 },
  notOwner: { error: "Only the account's owner can link it to a bank", code: "banking_account_not_owned", status: 403 },
  typeMismatch: { error: "A bank card links to a card account, a bank account to a non-card account", code: "banking_type_mismatch", status: 400 },
  duplicateTarget: { error: "Two bank accounts can't link to the same account", code: "banking_duplicate_target", status: 400 },
} as const;

/** Pure: validates what the user asked against the connection's bank
 *  accounts and the pool's accounts. */
export function planLinks(
  mappings: unknown,
  providerAccounts: BankProviderAccount[],
  localAccounts: LocalAccount[],
  ctx: { userId: string; authUserId: string },
): LinkPlan {
  if (!Array.isArray(mappings) || mappings.length === 0 || mappings.length > 50) return LINK_ERRORS.invalid;
  const providerById = new Map(providerAccounts.map(a => [a.id, a]));
  const localById = new Map(localAccounts.filter(a => a.userId === ctx.userId).map(a => [a.id, a]));
  const actions: LinkAction[] = [];
  const targets = new Set<string>();
  const seenProvider = new Set<string>();
  for (const m of mappings as LinkMapping[]) {
    if (!m || typeof m.externalAccountId !== "string") return LINK_ERRORS.invalid;
    const provider = providerById.get(m.externalAccountId);
    if (!provider || seenProvider.has(provider.id)) return LINK_ERRORS.unknownBankAccount;
    seenProvider.add(provider.id);
    const isCard = provider.kind === "card";
    if (typeof m.accountId === "string" && m.accountId) {
      const local = localById.get(m.accountId);
      // Another member's private account doesn't exist for the caller.
      const access = local ? mutationAccess(local, ctx.authUserId) : "hidden";
      if (!local || local.isArchived || access === "hidden") return LINK_ERRORS.accountNotFound;
      if (access !== "ok") return LINK_ERRORS.notOwner;
      if ((local.type === "card") !== isCard) return LINK_ERRORS.typeMismatch;
      if (targets.has(local.id)) return LINK_ERRORS.duplicateTarget;
      targets.add(local.id);
      actions.push({ provider, accountId: local.id });
    } else if (m.create && typeof m.create === "object") {
      const name = (typeof m.create.name === "string" ? m.create.name.trim() : "") || provider.name || "";
      const type = isCard ? "card" : NON_CARD_TYPES.has(m.create.type ?? "") ? m.create.type! : provider.kind;
      actions.push({ provider, create: { name: name.slice(0, MAX_NAME), type } });
    } else {
      return LINK_ERRORS.invalid;
    }
  }
  return { actions };
}

export interface LinkContext {
  userId: string;
  authUserId: string;
  householdId: string | null | undefined;
  connectionId: string;
}

/** Applies a validated plan. Balances are read now (the user is present) so a
 *  new card's debt starts from what the bank says is owed. Returns the local
 *  account ids linked. */
export async function applyLinks(client: BankingProviderClient, ctx: LinkContext, actions: LinkAction[], fallbackName: string): Promise<string[]> {
  const linked: string[] = [];
  for (const action of actions) {
    const { provider } = action;
    const isCard = provider.kind === "card";
    const balance = await client.getAccountBalance(provider.id, provider.kind);
    const link = { bankConnectionId: ctx.connectionId, externalAccountId: provider.id, externalAccountKey: provider.stableKey ?? null };
    // Read before anything is unlinked below: the review state carries on only
    // when this account was already linked to this same bank account.
    const before = "accountId" in action
      ? await prisma.account.findUniqueOrThrow({ where: { id: action.accountId }, select: { bankConnectionId: true, externalAccountId: true } })
      : null;
    const sameLink = !!before && before.bankConnectionId === ctx.connectionId && before.externalAccountId === provider.id;

    // One local account per bank account in a connection.
    await prisma.account.updateMany({
      where: { userId: ctx.userId, bankConnectionId: ctx.connectionId, externalAccountId: provider.id, ...("accountId" in action && { id: { not: action.accountId } }) },
      data: { bankConnectionId: null, externalAccountId: null, externalAccountKey: null, balanceSource: "manual" },
    });
    await prisma.debt.updateMany({
      where: { userId: ctx.userId, bankConnectionId: ctx.connectionId, externalAccountId: provider.id },
      data: { bankConnectionId: null, externalAccountId: null, balanceSource: "manual" },
    });

    let accountId: string;
    if ("accountId" in action) {
      await prisma.account.update({
        where: { id: action.accountId },
        data: {
          ...link,
          ...(!sameLink && { bankReviewedAt: null, bankPendingReview: 0, bankDismissedIds: [] }),
          ...(!isCard && { balanceSource: "bank_sync" }),
        },
      });
      accountId = action.accountId;
    } else {
      const lastOrder = await prisma.account.findFirst({ where: { userId: ctx.userId }, orderBy: { sortOrder: "desc" } });
      const created = await prisma.account.create({
        data: {
          userId: ctx.userId,
          ownerUserId: ctx.authUserId,
          householdId: ctx.householdId ?? null,
          name: action.create.name || fallbackName,
          type: action.create.type,
          currency: provider.currency,
          ...link,
          ...(isCard
            ? {} // a card's balance stays 0: what's owed is its debt
            : { currentBalance: balance?.amountCents ?? 0, balanceSource: "bank_sync", ...(balance && { balanceSyncedAt: new Date() }) }),
          sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
        },
      });
      accountId = created.id;
    }

    if (isCard) {
      const account = await prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { id: true, name: true, visibility: true, ownerUserId: true },
      });
      let debt = await prisma.debt.findFirst({ where: { userId: ctx.userId, accountId, kind: "credit_card" }, select: { id: true } });
      if (!debt) {
        await createCardDebt(
          { userId: ctx.userId, householdId: ctx.householdId },
          account,
          { paymentMode: "full", owed: balance ? owedFromCardBalance(balance.amountCents) : 0 },
        );
        debt = await prisma.debt.findFirst({ where: { userId: ctx.userId, accountId, kind: "credit_card" }, select: { id: true } });
      }
      if (debt) {
        await prisma.debt.update({
          where: { id: debt.id },
          data: { bankConnectionId: ctx.connectionId, externalAccountId: provider.id, balanceSource: "bank_sync" },
        });
      }
    }
    linked.push(accountId);
  }
  return linked;
}

/** After a reconnect the provider hands out new account ids: re-point the
 *  accounts (and card debts) already linked to this connection by their
 *  stable key. Returns how many were re-linked. */
export async function relinkByStableKey(connectionId: string, accounts: BankProviderAccount[]): Promise<number> {
  let relinked = 0;
  for (const a of accounts) {
    if (!a.stableKey) continue;
    const local = await prisma.account.findFirst({
      where: { bankConnectionId: connectionId, externalAccountKey: a.stableKey },
      select: { id: true, externalAccountId: true },
    });
    if (!local || local.externalAccountId === a.id) continue;
    await prisma.account.update({ where: { id: local.id }, data: { externalAccountId: a.id } });
    await prisma.debt.updateMany({ where: { bankConnectionId: connectionId, accountId: local.id }, data: { externalAccountId: a.id } });
    relinked++;
  }
  return relinked;
}

/** Unlinks the accounts (and card debts) of a connection whose bank account
 *  id is not among `keepIds` — after a reconnect, the ones the new consent
 *  doesn't cover. Movements stay; the user can link them again. */
export async function unlinkMissing(connectionId: string, keepIds: string[]): Promise<number> {
  const stale = { bankConnectionId: connectionId, externalAccountId: { notIn: keepIds } };
  await prisma.debt.updateMany({ where: stale, data: { bankConnectionId: null, externalAccountId: null, balanceSource: "manual" } });
  const { count } = await prisma.account.updateMany({
    where: stale,
    data: { bankConnectionId: null, externalAccountId: null, externalAccountKey: null, balanceSource: "manual", bankReviewedAt: null, bankPendingReview: 0, bankDismissedIds: [] },
  });
  return count;
}
