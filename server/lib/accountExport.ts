// "Export my data" (LPBETA-09): a JSON file with my records and a CSV with my
// movements (expenses, refunds and income), holding ONLY what is mine.
//
// What is "mine" in a household is the split the unlink already makes
// (server/lib/partnerUnlink.ts, planUnlink): the rows that would move to the
// member are hers, the rest of the pool is the owner's. So the two exports of
// a couple never overlap, and each one is exactly what that person keeps if
// they separate — and what is erased if they delete their account
// (server/lib/accountDeletion.ts). Alone, everything in my own scope is mine.
//
// Size: a Vercel Function response is capped at 4.5 MB. Movements, the only
// thing that grows without bound, go to the CSV (~120 bytes a row, so tens of
// thousands of rows fit) and the JSON only counts them. Either file over
// EXPORT_MAX_BYTES is refused with export_too_large (the UI asks the person
// to write to support) instead of failing half-way.
//
// Never exported: other people's ids (pool, owner, payer, partner), the
// household's internal ids, the encrypted bank session id, Stripe ids.
import type { PrismaClient } from "@prisma/client";
import { loadUnlinkInput, planUnlink, type UnlinkPlan } from "./partnerUnlink.js";
import { partnerLinkOf } from "./accountDeletion.js";

export const EXPORT_MAX_BYTES = 4_000_000;
export const EXPORT_FORMAT_VERSION = 1;

type MoveKey = keyof UnlinkPlan["move"];

/** Decides, row by row, whether a pool row is mine. */
export interface Ownership {
  /** userIds to read from: my own scope, and the pool when I am in one. */
  scopes: string[];
  isMine(key: MoveKey, row: { id: string; userId: string }): boolean;
}

/** Pure: the ownership rule for my situation (alone, member, or pool owner). */
export function ownershipFor(me: string, situation:
  | { kind: "solo" }
  | { kind: "member"; poolId: string; plan: UnlinkPlan }
  | { kind: "owner"; plan: UnlinkPlan }): Ownership {
  if (situation.kind === "solo") return { scopes: [me], isMine: (_k, r) => r.userId === me };
  const moving = Object.fromEntries(
    (Object.keys(situation.plan.move) as MoveKey[]).map(k => [k, new Set(situation.plan.move[k])]),
  ) as Record<MoveKey, Set<string>>;
  if (situation.kind === "member") {
    return { scopes: [me, situation.poolId], isMine: (k, r) => r.userId === me || moving[k].has(r.id) };
  }
  return { scopes: [me], isMine: (k, r) => r.userId === me && !moving[k].has(r.id) };
}

export async function loadOwnership(db: PrismaClient, me: string): Promise<Ownership> {
  const link = await partnerLinkOf(db, me);
  if (!link) return ownershipFor(me, { kind: "solo" });
  const plan = planUnlink(await loadUnlinkInput(db, link.memberId, link.poolId));
  return link.memberId === me
    ? ownershipFor(me, { kind: "member", poolId: link.poolId, plan })
    : ownershipFor(me, { kind: "owner", plan });
}

const ISO_DAY = (d: Date) => d.toISOString().slice(0, 10);

/** Integer cents → "-12.34" without floating point. */
export function centsToDecimal(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** One CSV cell: quoted when needed, and a text that a spreadsheet would run
 *  as a formula (=, +, -, @, tab, CR first) is prefixed with an apostrophe. */
export function csvCell(value: string | number | null | undefined, { text = true } = {}): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface MovementRow {
  date: Date;
  type: "expense" | "refund" | "income";
  /** Cents, positive as stored. */
  amount: number;
  currency: string;
  description: string;
  merchant: string;
  category: string;
  account: string;
  debt: string;
  scope: string;
  source: string;
}

export const MOVEMENT_COLUMNS = ["date", "type", "amount", "currency", "description", "merchant", "category", "account", "debt", "scope", "source"] as const;

/** The movements CSV: UTF-8 with a BOM (so spreadsheets read accents), oldest
 *  first, an expense negative and a refund or income positive. */
export function movementsCsv(rows: MovementRow[]): string {
  const lines = [MOVEMENT_COLUMNS.join(",")];
  for (const r of [...rows].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const signed = r.type === "expense" ? -r.amount : r.amount;
    lines.push([
      csvCell(ISO_DAY(r.date), { text: false }), csvCell(r.type), csvCell(centsToDecimal(signed), { text: false }), csvCell(r.currency),
      csvCell(r.description), csvCell(r.merchant), csvCell(r.category), csvCell(r.account), csvCell(r.debt), csvCell(r.scope), csvCell(r.source),
    ].join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function strip<T extends Record<string, unknown>>(row: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!keys.includes(k)) out[k] = v;
  return out as Partial<T>;
}

/** Ids that are the pool's or another person's, never exported. */
const FOREIGN_KEYS = ["userId", "ownerUserId", "householdId", "payerUserId", "beneficiaryUserId", "createdByUserId", "byUserId"];

async function loadMine(db: PrismaClient, me: string) {
  const own = await loadOwnership(db, me);
  const inScope = { userId: { in: own.scopes } };
  const [accounts, debts, connections, incomes, expenses, plans, allocations, rules, recurring] = await Promise.all([
    db.account.findMany({ where: inScope, orderBy: { sortOrder: "asc" } }),
    db.debt.findMany({ where: inScope, orderBy: { sortOrder: "asc" }, include: { adjustments: { orderBy: { date: "asc" } } } }),
    db.bankConnection.findMany({
      where: inScope,
      select: {
        id: true, userId: true, institutionName: true, institutionCountry: true, provider: true, status: true,
        consentGivenAt: true, expiresAt: true, lastSyncedAt: true, createdAt: true,
      },
    }),
    db.income.findMany({ where: inScope }),
    db.expense.findMany({ where: inScope }),
    db.lifePlan.findMany({ where: inScope, include: { deposits: { orderBy: { month: "asc" } } } }),
    db.allocation.findMany({ where: inScope, orderBy: { sortOrder: "asc" }, include: { monthlyBudgets: { orderBy: { month: "asc" } } } }),
    db.categorizationRule.findMany({ where: inScope }),
    db.recurringCommitment.findMany({ where: inScope }),
  ]);
  return {
    own,
    // Names for the CSV come from every visible row, mine or not.
    names: {
      account: new Map(accounts.map(a => [a.id, { name: a.name, currency: a.currency }])),
      debt: new Map(debts.map(d => [d.id, d.name])),
      allocation: new Map(allocations.map(a => [a.id, a.name])),
    },
    accounts: accounts.filter(r => own.isMine("accountIds", r)),
    debts: debts.filter(r => own.isMine("debtIds", r)),
    connections: connections.filter(r => own.isMine("bankConnectionIds", r)),
    incomes: incomes.filter(r => own.isMine("incomeIds", r)),
    expenses: expenses.filter(r => own.isMine("expenseIds", r)),
    plans: plans.filter(r => own.isMine("planIds", r)),
    allocations: allocations.filter(r => own.isMine("allocationIds", r)),
    rules: rules.filter(r => own.isMine("ruleIds", r)),
    // No owner on a recurring commitment: it stays with the pool on unlink.
    recurring: recurring.filter(r => r.userId === me),
  };
}

/** The JSON export document (movements are only counted here: see the CSV). */
export async function buildJsonExport(db: PrismaClient, me: string, now = new Date()) {
  const [user, mine] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: me },
      select: {
        name: true, email: true, emailVerified: true, image: true, createdAt: true, deletionRequestedAt: true,
        settings: { select: { language: true, darkMode: true, cycleStartDay: true, monthlyIncome: true, noCardsAt: true, noLoansAt: true } },
        subscription: { select: { plan: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } },
        householdMemberships: { select: { role: true, status: true, joinedAt: true, household: { select: { name: true } } } },
      },
    }),
    loadMine(db, me),
  ]);
  const { settings, subscription, householdMemberships, ...profile } = user;
  return {
    format: "remanso-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    notes: {
      amounts: "Every amount is in integer cents (1234 = 12.34).",
      movements: "Expenses, refunds and income are in the CSV file (movements).",
      household: "Only your own records: what your partner owns is not included.",
    },
    profile,
    settings: settings && { ...strip(settings, ["monthlyIncome"]), monthlyIncomeCents: settings.monthlyIncome },
    subscription,
    households: householdMemberships.map(m => ({ name: m.household.name, role: m.role, status: m.status, joinedAt: m.joinedAt })),
    accounts: mine.accounts.map(a => strip(a, FOREIGN_KEYS)),
    debts: mine.debts.map(d => ({ ...strip(d, FOREIGN_KEYS), adjustments: d.adjustments.map(a => strip(a, FOREIGN_KEYS)) })),
    bankConnections: mine.connections.map(c => strip(c, FOREIGN_KEYS)),
    plans: mine.plans.map(p => ({ ...strip(p, FOREIGN_KEYS), deposits: p.deposits.map(d => strip(d, FOREIGN_KEYS)) })),
    budgetLines: mine.allocations.map(a => ({ ...strip(a, FOREIGN_KEYS), monthlyBudgets: a.monthlyBudgets.map(m => strip(m, FOREIGN_KEYS)) })),
    categorizationRules: mine.rules.map(r => strip(r, FOREIGN_KEYS)),
    recurringCommitments: mine.recurring.map(r => strip(r, FOREIGN_KEYS)),
    movementCounts: { expenses: mine.expenses.length, incomes: mine.incomes.length },
  };
}

/** The movements of the export as CSV rows. */
export async function buildMovementRows(db: PrismaClient, me: string): Promise<MovementRow[]> {
  const mine = await loadMine(db, me);
  const account = (id: string | null) => (id ? mine.names.account.get(id) : undefined);
  const expenses: MovementRow[] = mine.expenses.map(e => ({
    date: e.date,
    type: e.kind === "refund" ? "refund" : "expense",
    amount: e.amount,
    currency: account(e.accountId)?.currency ?? "EUR",
    description: e.description,
    merchant: e.merchant,
    category: e.allocationId ? mine.names.allocation.get(e.allocationId) ?? "" : "",
    account: account(e.accountId)?.name ?? "",
    debt: e.debtId ? mine.names.debt.get(e.debtId) ?? "" : "",
    scope: e.scope,
    source: e.source,
  }));
  const incomes: MovementRow[] = mine.incomes.map(i => ({
    date: i.date,
    type: "income",
    amount: i.amount,
    currency: account(i.accountId)?.currency ?? "EUR",
    description: i.description,
    merchant: i.merchant,
    category: i.category,
    account: account(i.accountId)?.name ?? "",
    debt: "",
    scope: "personal",
    source: i.source,
  }));
  return [...expenses, ...incomes];
}
