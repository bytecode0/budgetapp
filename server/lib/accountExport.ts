// "Export my data" (LPBETA-09): a JSON file with my records and a CSV with my
// movements (expenses, refunds and income), holding ONLY what is mine.
//
// What is "mine" in a household:
//   - accounts, debts, bank connections, income: the rows I own (ownerUserId),
//     wherever they sit (my scope, the pool, or a former partner's pool where
//     an old cross-owner pair left one) — so a partner's half of such a pair
//     is never in my export, and mine always is;
//   - savings plans: the ones I own; the pool's owner also gets the plans
//     with no owner (made before plans had one), marked "ownerless";
//   - expenses, budget lines (with their monthly budgets) and categorisation
//     rules: the split the unlink makes (server/lib/partnerUnlink.ts,
//     planUnlink) — what would move to the member is hers, the rest of the
//     pool is the owner's, so a couple's two exports never overlap;
//   - recurring commitments have no owner: they are in the pool owner's export.
// On top of that, the visibility rule every listing uses (server/lib/poolRefs.ts):
// nothing on another member's private debt, debt line or account is ever
// exported, while my own private rows always are.
// Alone, everything in my own scope is mine.
//
// Size: a Vercel Function response is capped at 4.5 MB. Movements, the only
// thing that grows without bound, go to the CSV (~120 bytes a row, so tens of
// thousands of rows fit) and the JSON only counts them. Either file over
// EXPORT_MAX_BYTES is refused with export_too_large (the UI asks the person
// to write to support) instead of failing half-way.
//
// Never exported: other people's ids (pool, owner, payer, partner), the
// household's internal ids, the encrypted bank session id, the bank's account
// identifiers, Stripe ids.
import type { PrismaClient } from "@prisma/client";
import { loadUnlinkInput, planUnlink, type UnlinkPlan } from "./partnerUnlink.js";
import { partnerLinkOf } from "./accountDeletion.js";
import { notOnHiddenDebt, notOnHiddenLine, visibleExpenseWhere, visibleIncomeWhere } from "./poolRefs.js";

export const EXPORT_MAX_BYTES = 4_000_000;
export const EXPORT_FORMAT_VERSION = 1;

type SplitKey = "expenseIds" | "allocationIds" | "ruleIds";
export type Situation =
  | { kind: "solo" }
  | { kind: "member"; poolId: string; plan: UnlinkPlan }
  | { kind: "owner"; plan: UnlinkPlan };

/** Decides, row by row, whether a row is mine. */
export interface Ownership {
  me: string;
  situation: Situation;
  /** userIds to read from: my own scope, and the pool when I am in one. */
  scopes: string[];
  /** Rows with a real owner (accounts, debts, connections, income). */
  owns(row: { ownerUserId: string }): boolean;
  /** Savings plans: mine, or ownerless ones in the pool I hold. */
  ownsPlan(row: { userId: string; ownerUserId: string | null }): boolean;
  /** Rows without an owner column: the unlink's split. */
  inMyShare(key: SplitKey, row: { id: string; userId: string }): boolean;
}

/** Pure: the ownership rule for my situation (alone, member, or pool owner). */
export function ownershipFor(me: string, situation: Situation): Ownership {
  const moving = situation.kind === "solo" ? null : {
    expenseIds: new Set(situation.plan.move.expenseIds),
    allocationIds: new Set(situation.plan.move.allocationIds),
    ruleIds: new Set(situation.plan.move.ruleIds),
  };
  const holdsPool = situation.kind !== "member";
  return {
    me,
    situation,
    scopes: situation.kind === "member" ? [me, situation.poolId] : [me],
    owns: r => r.ownerUserId === me,
    ownsPlan: r => r.ownerUserId === me || (r.ownerUserId === null && holdsPool && r.userId === me),
    inMyShare: (k, r) =>
      !moving ? r.userId === me
        : situation.kind === "member" ? r.userId === me || moving[k].has(r.id)
        : r.userId === me && !moving[k].has(r.id),
  };
}

export async function loadOwnership(db: PrismaClient, me: string): Promise<Ownership> {
  const link = await partnerLinkOf(db, me);
  if (!link) return ownershipFor(me, { kind: "solo" });
  const plan = planUnlink(await loadUnlinkInput(db, link.memberId, link.poolId));
  return link.memberId === me
    ? ownershipFor(me, { kind: "member", poolId: link.poolId, plan })
    : ownershipFor(me, { kind: "owner", plan });
}

/** The expenses I may export: in my scopes and never on another member's
 *  private debt, debt line or account (the same rule as every listing,
 *  server/lib/poolRefs.ts) — my own private ones always are. */
const exportableExpenses = (own: Ownership) => ({ userId: { in: own.scopes }, ...visibleExpenseWhere(own.me) });

/** How many of my expenses there are: a count alone, ids only when the
 *  household split has to be applied row by row. */
async function countMyExpenses(db: PrismaClient, own: Ownership): Promise<number> {
  if (own.situation.kind === "solo") return db.expense.count({ where: exportableExpenses(own) });
  const rows = await db.expense.findMany({ where: exportableExpenses(own), select: { id: true, userId: true } });
  return rows.filter(r => own.inMyShare("expenseIds", r)).length;
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

/** Ids that are the pool's or another person's, and the bank's own account
 *  identifiers: never exported. */
const FOREIGN_KEYS = [
  "userId", "ownerUserId", "householdId", "payerUserId", "beneficiaryUserId", "createdByUserId", "byUserId",
  "externalAccountId", "externalAccountKey",
];

async function loadRecords(db: PrismaClient, own: Ownership) {
  const inScope = { userId: { in: own.scopes } };
  // Rows I own wherever they are (an old cross-owner pair can leave one in a
  // former partner's pool).
  const ownedAnywhere = { OR: [inScope, { ownerUserId: own.me }] };
  const [accounts, debts, connections, plans, allocations, rules, recurring] = await Promise.all([
    db.account.findMany({ where: ownedAnywhere, orderBy: { sortOrder: "asc" } }),
    db.debt.findMany({ where: ownedAnywhere, orderBy: { sortOrder: "asc" }, include: { adjustments: { orderBy: { date: "asc" } } } }),
    db.bankConnection.findMany({
      where: ownedAnywhere,
      select: {
        id: true, userId: true, ownerUserId: true, institutionName: true, institutionCountry: true, provider: true, status: true,
        consentGivenAt: true, expiresAt: true, lastSyncedAt: true, createdAt: true,
      },
    }),
    db.lifePlan.findMany({ where: inScope, include: { deposits: { orderBy: { month: "asc" } } } }),
    // Never another member's private debt line, nor what points at it.
    db.allocation.findMany({
      where: { ...inScope, ...notOnHiddenDebt(own.me) }, orderBy: { sortOrder: "asc" }, include: { monthlyBudgets: { orderBy: { month: "asc" } } },
    }),
    db.categorizationRule.findMany({ where: { ...inScope, ...notOnHiddenLine(own.me) } }),
    db.recurringCommitment.findMany({ where: { ...inScope, ...notOnHiddenLine(own.me) } }),
  ]);
  return {
    accounts: accounts.filter(own.owns),
    debts: debts.filter(own.owns),
    connections: connections.filter(own.owns),
    plans: plans.filter(own.ownsPlan),
    allocations: allocations.filter(r => own.inMyShare("allocationIds", r)),
    rules: rules.filter(r => own.inMyShare("ruleIds", r)),
    // No owner on a recurring commitment: it stays with the pool on unlink.
    recurring: recurring.filter(r => r.userId === own.me),
  };
}

/** The JSON export document (movements are only counted here: see the CSV). */
export async function buildJsonExport(db: PrismaClient, me: string, now = new Date()) {
  const own = await loadOwnership(db, me);
  const [user, mine, expenseCount, incomeCount] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: me },
      select: {
        name: true, email: true, emailVerified: true, image: true, createdAt: true, deletionRequestedAt: true,
        settings: { select: { language: true, darkMode: true, cycleStartDay: true, monthlyIncome: true, noCardsAt: true, noLoansAt: true } },
        subscription: { select: { plan: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } },
        householdMemberships: { select: { role: true, status: true, joinedAt: true, household: { select: { name: true } } } },
        // My answers to the monthly peace question (LPBETA-24): always the person's own.
        peaceCheckins: { select: { period: true, score: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    loadRecords(db, own),
    countMyExpenses(db, own),
    db.income.count({ where: { ownerUserId: me, ...visibleIncomeWhere(me) } }),
  ]);
  const { settings, subscription, householdMemberships, peaceCheckins, ...profile } = user;
  return {
    format: "remanso-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    notes: {
      amounts: "Every amount is in integer cents (1234 = 12.34).",
      movements: "Expenses, refunds and income are in the CSV file (movements).",
      household: "Only your own records: what your partner owns is not included.",
      peaceCheckins: "Your answers to the monthly question about how you feel about your money, one per budget period (YYYY-MM), from 1 (very uneasy) to 5 (at peace).",
      ownerless: "Budget lines (with their monthly budgets), categorisation rules and recurring commitments have no owner: in a household they belong to the shared data and are exported to the person who holds it (the household's owner), except the lines of your own debts and plans. Plans marked ownerless: true were created before plans had an owner and are exported the same way.",
    },
    profile,
    settings: settings && { ...strip(settings, ["monthlyIncome"]), monthlyIncomeCents: settings.monthlyIncome },
    subscription,
    households: householdMemberships.map(m => ({ name: m.household.name, role: m.role, status: m.status, joinedAt: m.joinedAt })),
    accounts: mine.accounts.map(a => strip(a, FOREIGN_KEYS)),
    debts: mine.debts.map(d => ({ ...strip(d, FOREIGN_KEYS), adjustments: d.adjustments.map(a => strip(a, FOREIGN_KEYS)) })),
    bankConnections: mine.connections.map(c => strip(c, FOREIGN_KEYS)),
    plans: mine.plans.map(p => ({
      ...strip(p, FOREIGN_KEYS), ownerless: p.ownerUserId === null, deposits: p.deposits.map(d => strip(d, FOREIGN_KEYS)),
    })),
    budgetLines: mine.allocations.map(a => ({ ...strip(a, FOREIGN_KEYS), monthlyBudgets: a.monthlyBudgets.map(m => strip(m, FOREIGN_KEYS)) })),
    categorizationRules: mine.rules.map(r => strip(r, FOREIGN_KEYS)),
    recurringCommitments: mine.recurring.map(r => strip(r, FOREIGN_KEYS)),
    peaceCheckins,
    movementCounts: { expenses: expenseCount, incomes: incomeCount },
  };
}

/** The movements of the export as CSV rows. */
export async function buildMovementRows(db: PrismaClient, me: string): Promise<MovementRow[]> {
  const own = await loadOwnership(db, me);
  const inScope = { userId: { in: own.scopes } };
  // Names only of what I own or what the household shares (never a partner's private row).
  const visible = { OR: [{ ownerUserId: me }, { visibility: "household" }] };
  const [expenses, incomes, accounts, debts, allocations] = await Promise.all([
    db.expense.findMany({ where: exportableExpenses(own) }),
    db.income.findMany({ where: { ownerUserId: me, ...visibleIncomeWhere(me) } }),
    db.account.findMany({ where: { AND: [{ OR: [inScope, { ownerUserId: me }] }, visible] }, select: { id: true, name: true, currency: true } }),
    db.debt.findMany({ where: { ...inScope, ...visible }, select: { id: true, name: true } }),
    db.allocation.findMany({ where: { ...inScope, ...notOnHiddenDebt(me) }, select: { id: true, name: true } }),
  ]);
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const debtName = new Map(debts.map(d => [d.id, d.name]));
  const lineName = new Map(allocations.map(a => [a.id, a.name]));
  const account = (id: string | null) => (id ? accountById.get(id) : undefined);
  const expenseRows: MovementRow[] = expenses.filter(e => own.inMyShare("expenseIds", e)).map(e => ({
    date: e.date,
    type: e.kind === "refund" ? "refund" : "expense",
    amount: e.amount,
    currency: account(e.accountId)?.currency ?? "EUR",
    description: e.description,
    merchant: e.merchant,
    category: e.allocationId ? lineName.get(e.allocationId) ?? "" : "",
    account: account(e.accountId)?.name ?? "",
    debt: e.debtId ? debtName.get(e.debtId) ?? "" : "",
    scope: e.scope,
    source: e.source,
  }));
  const incomeRows: MovementRow[] = incomes.map(i => ({
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
  return [...expenseRows, ...incomeRows];
}
