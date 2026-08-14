// Radiografía Financiera — stateless analysis core.
//
// Takes parsed statement transactions (no DB, no user) and produces the full
// "x-ray": summary, spend-by-category, gastos hormiga, recurring commitments,
// detected savings/investment, the health index and actionable opportunities.
// Everything is computed locally; AI is an optional enhancement for category
// naming, never a dependency.
//
// Outflows are split (R7) into consumption / wealth (savings+investment) /
// uncertain (transfers+cash). Only consumption counts as "spending"; wealth and
// uncertain are excluded from expenses so a saver isn't wrongly penalized. The
// user can reclassify uncertain movements (overrides) and everything recomputes.
//
// Internally we work in integer cents (no float drift); the returned payload is
// in euros, rounded to 2 decimals, ready to serialize as JSON.
import type { ParsedTxn } from "../parsers/bbva.js";
import { normalizeMerchant, isNoiseOnly } from "../normalizeMerchant.js";
import { detectRecurringFrom, type RecurringInput } from "../recurring.js";
import { classifyLocal } from "./categories.js";
import { classifyMovement, type MovementType, type MovementKind } from "./wealth.js";
import { classifyIncome, describeIncomeUncertain, type IncomeReason, type IncomeClass } from "./income.js";
import { describeMovement } from "./transferDetail.js";
import { reconcile, type ReconInput } from "./reconcile.js";
import { computeHealthIndex, type HealthIndex } from "./healthIndex.js";
import { computeArchetype, type ArchetypeResult } from "./archetype.js";
import { detectDebtPayments, computeFuturoComprometido, type DebtKind } from "./debts.js";
import type { SuggestedCategory } from "../ai/suggestCategories.js";

// A parsed transaction tagged with which uploaded file it came from (multi-account).
// A missing fileIndex is treated as 0, so the single-file path is unchanged.
export type TaggedTxn = ParsedTxn & { fileIndex?: number };

const ANT_MAX_TICKET_CENTS = 2000;   // ≤ €20 counts as a "small" charge
const ANT_MIN_COUNT = 3;             // repeated at least 3× over the window
const RECURRING_MIN_CENTS = 400;     // €4 — below this a stable charge is a leak, not a subscription

// User reclassification of a merchant's movement type (from the correction card).
// What the user can tell us a movement really was. "giving" is its own answer,
// not a flavour of spending: money given away is stewardship in this product's
// model (and drives the Mayordomo Fiel archetype), so it must not be lumped in
// with consumption.
// The four things an outflow can actually be. "wealth" is the legacy value kept
// so overrides stored by earlier sessions still resolve — it means "savings".
export type MovementAnswer = "consumption" | "savings" | "investment" | "giving";
// The two things an ambiguous INFLOW can actually be: real income, or money
// that was already yours moving around (own-account transfer, cash redeposit).
export type IncomeAnswer = "income" | "notIncome";
export type Overrides = Record<string, MovementAnswer | IncomeAnswer | "wealth">;

export interface XRayCategory {
  key: string;
  icon: string;
  label: string | null;
  total: number;
  monthlyAvg: number;
  annualized: number;
  pct: number;
  txnCount: number;
}

// Shared by both ambiguous-movement lists (outflow transfers/cash AND inflow
// cash-deposits/self-transfers) — same shape, same amount-subgrouping logic.
export interface AmbiguousItem {
  // Every override key this row stands for. Usually one; an "assorted amounts"
  // row carries all the one-off amounts it collapsed together, so a single
  // answer applies to all of them.
  keys: string[];
  detail: string | null;
  merchant: string;
  total: number;
  count: number;
  // Set when the row is a repeated exact amount (e.g. 4 × €150), null for the
  // assorted-amounts row. Lets the UI show the standing arrangement.
  amountEach: number | null;
  kind: "transfer" | "cash";
}

export interface XRayResult {
  period: { from: string; to: string; months: number };
  summary: {
    totalIncome: number;
    totalExpenses: number;   // consumption only
    net: number;             // income − consumption (what wasn't consumed)
    savingsRate: number;     // net / income
    transactionCount: number;
  };
  categories: XRayCategory[];
  antExpenses: {
    monthlyAvg: number;
    annualized: number;
    items: { merchant: string; count: number; total: number; avgTicket: number }[];
  };
  recurring: {
    monthlyTotal: number;
    annualized: number;
    count: number;
    items: { merchant: string; monthlyAmount: number; annualized: number; categoryKey: string }[];
  };
  // Detected savings + giving + investment (money kept or given, not spent).
  wealth: {
    total: number;
    savings: number;
    giving: number;
    investment: number;
    items: { merchant: string; total: number; kind: "savings" | "giving" | "investment" }[];
  };
  // Ambiguous OUTFLOWS (transfers, cash) awaiting user confirmation.
  uncertain: {
    total: number;
    items: AmbiguousItem[];
  };
  // Inflows that are NOT counted in summary.totalIncome, split into two piles:
  // `excluded` was dropped automatically (tax refunds, loan disbursements,
  // card refunds — unambiguous, no user input needed) and is purely
  // informational; `uncertain` needs the user's answer (income vs. not) and
  // is NOT counted until they give it, the same conservative default already
  // used for ambiguous outflows.
  income: {
    excluded: { total: number; items: { reason: IncomeReason; total: number; count: number }[] };
    uncertain: { total: number; items: AmbiguousItem[] };
  };
  // Transfers between the user's OWN uploaded accounts, reconciled out of everything.
  internalTransfers: {
    count: number;
    total: number;
    items: { detail: string | null; total: number; count: number }[];
  };
  // Liquid balance (stock) of the uploaded accounts — the running balance of each
  // account's most recent movement. Only present when the statement carries it.
  balances: {
    hasData: boolean;
    total: number;
    accounts: { fileIndex: number; balance: number }[];
    runwayMonths: number | null;   // total balance ÷ avg monthly consumption
  };
  // Debt/cuota payments detected among the recurring commitments — the
  // "futuro comprometido" (% of income already reserved to fragmented debt).
  // Mortgage is detected but excluded from monthlyTotal/pctOfIncome (see debts.ts).
  debts: {
    monthlyTotal: number;
    pctOfIncome: number;
    items: { merchant: string; kind: DebtKind; monthlyAmount: number }[];
    mortgage: { detected: boolean; monthlyAmount: number } | null;
  };
  topMerchants: { merchant: string; total: number; count: number }[];
  health: HealthIndex;
  // Who this person is with money, computed on its own axes. `health.stage` is
  // still the score band; this is the identity shown to the user.
  archetype: ArchetypeResult;
  opportunities: { id: string; annualSaving: number; params: Record<string, number> }[];
}

const eur = (cents: number) => Math.round(cents) / 100;
const toCents = (euros: number) => Math.round(euros * 100);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

interface PreparedTxn {
  merchant: string;
  concept: string;
  date: Date;
  cents: number;
  fileIndex: number;
  kind: "expense" | "income";
  movementType: MovementType;
  movementKind: MovementKind;
  movementKey: string;      // grouping/override key: merchant, "t:"/"c:" for uncertain outflows, "in:" for uncertain inflows
  detail: string | null;    // display detail for uncertain (name / "••1234")
  categoryKey: string;
  icon: string;
  label: string | null;
  // Only meaningful when kind === "income". Defaults to "income" for expenses
  // so nothing else has to branch on kind first.
  incomeType: "income" | "excluded" | "uncertain";
  incomeReason: IncomeReason | null;
}

function aiLookup(ai?: SuggestedCategory[]): Map<string, { label: string; icon: string }> {
  const map = new Map<string, { label: string; icon: string }>();
  if (!ai) return map;
  for (const cat of ai) for (const m of cat.merchants) map.set(m, { label: cat.name, icon: cat.icon });
  return map;
}

// Groups ambiguous movements by counterparty (movementKey), used for BOTH
// ambiguous outflows (transfers/cash) and ambiguous inflows (cash deposits,
// self-transfers) — the shape and the reasoning are identical either direction.
//
// Same counterparty, different intent: a recurring €150 to "Luis Vespa" can be
// a tithe while a €300 to the same name is a move to his own savings. So within
// each counterparty we split out every REPEATED amount as its own row — a
// repeated exact amount is a standing arrangement, and the user can answer it
// in one go. One-off amounts collapse into a single "assorted" row: splitting
// those would turn 40 nameless Bizums into 40 questions without telling us
// anything more.
function groupAmbiguousMovements(txns: PreparedTxn[]): AmbiguousItem[] {
  const groups = new Map<string, PreparedTxn[]>();
  for (const e of txns) {
    const list = groups.get(e.movementKey);
    if (list) list.push(e); else groups.set(e.movementKey, [e]);
  }

  const items: AmbiguousItem[] = [];
  for (const [groupKey, txnsInGroup] of groups) {
    const first = txnsInGroup[0];
    const kind = first.movementKind === "cash" ? "cash" : ("transfer" as "transfer" | "cash");
    const base = { detail: first.detail, merchant: first.merchant, kind };

    const byAmount = new Map<number, PreparedTxn[]>();
    for (const e of txnsInGroup) {
      const list = byAmount.get(e.cents);
      if (list) list.push(e); else byAmount.set(e.cents, [e]);
    }

    const oneOffs: PreparedTxn[] = [];
    for (const [cents, list] of byAmount) {
      if (list.length >= 2) {
        items.push({
          ...base,
          keys: [`${groupKey}#${cents}`],
          total: eur(cents * list.length),
          count: list.length,
          amountEach: eur(cents),
        });
      } else {
        oneOffs.push(...list);
      }
    }
    if (oneOffs.length > 0) {
      items.push({
        ...base,
        // Answering this row applies to every amount inside it.
        keys: oneOffs.map(e => `${groupKey}#${e.cents}`),
        total: eur(sum(oneOffs.map(e => e.cents))),
        count: oneOffs.length,
        amountEach: null,
      });
    }
  }
  return items.sort((a, b) => b.total - a.total);
}

export function analyze(txns: TaggedTxn[], aiCategories?: SuggestedCategory[], overrides: Overrides = {}): XRayResult {
  const ai = aiLookup(aiCategories);

  const prepared: PreparedTxn[] = txns
    .filter(t => t.amount !== 0)
    .map(t => {
      // All the text the bank gave us. `concept` alone is often a generic label
      // ("Transferencia realizada", "Bizum") with the real meaning in the extra
      // detail columns, so every keyword decision below reads the full text.
      const fullText = t.extra ? `${t.concept} ${t.extra}` : t.concept;
      // Merchant identity normally comes from `concept` — for a card payment that
      // IS the shop, and using the full text would duplicate the name. But when
      // the label is pure bank boilerplate it names nothing ("realizada"), so the
      // detail text is the only place the counterparty appears.
      const merchant = isNoiseOnly(t.concept) ? normalizeMerchant(fullText) : normalizeMerchant(t.concept);
      // Category from the merchant; if that says "other", retry against the full
      // text so a transfer labelled "Alquiler los valles" still lands in housing.
      let local = classifyLocal(merchant);
      if (local.key === "other") {
        const fromDetail = classifyLocal(normalizeMerchant(fullText));
        if (fromDetail.key !== "other") local = fromDetail;
      }
      const aiOv = ai.get(merchant);
      const kind = (t.amount < 0 ? "expense" : "income") as "expense" | "income";

      // Base movement type (outflows only), then the grouping/override key: for
      // uncertain movements it's a namespaced "t:"/"c:" key; otherwise the merchant.
      let mv = kind === "expense" ? classifyMovement(fullText) : { type: "consumption" as MovementType, kind: null as MovementKind };
      let movementKey = merchant;
      let detail: string | null = null;
      if (kind === "expense" && mv.type === "uncertain") {
        const md = describeMovement(fullText, mv.kind === "cash" ? "cash" : "transfer");
        movementKey = md.movementKey;
        detail = md.detail;
      }

      // Income-side classification: is this actually earned money, or your own
      // money coming back (tax refund, loan disbursement, card refund — auto-
      // excluded), or genuinely ambiguous (cash redeposit, an inflow from
      // another account of yours — surfaced for the user to confirm)?
      let incomeClass: IncomeClass = { type: "income" };
      if (kind === "income") {
        incomeClass = classifyIncome(fullText);
        if (incomeClass.type === "uncertain") {
          const d = describeIncomeUncertain(fullText, incomeClass.reason);
          movementKey = d.key;
          detail = d.detail;
        }
      }

      // Apply the user's reclassification (uncertain → keyed by movementKey;
      // consumption/wealth → keyed by merchant — the namespaces never collide).
      // Most specific first: this counterparty at this exact amount, then the
      // whole counterparty, then the merchant. The fallbacks keep answers stored
      // by older sessions (which had no per-amount keys) working.
      const ov = overrides[`${movementKey}#${Math.abs(toCents(t.amount))}`]
        ?? overrides[movementKey]
        ?? overrides[merchant];
      if (kind === "expense" && ov) {
        if (ov === "investment") mv = { type: "wealth", kind: "investment" };
        else if (ov === "savings") mv = { type: "wealth", kind: "savings" };
        else if (ov === "giving") mv = { type: "wealth", kind: "giving" };
        // Legacy "wealth": keep whatever we detected, defaulting to savings.
        else if (ov === "wealth") mv = { type: "wealth", kind: mv.kind === "investment" ? "investment" : "savings" };
        else mv = { type: "consumption", kind: null };
      } else if (kind === "income" && incomeClass.type === "uncertain" && ov) {
        // The reason is kept either way — it's the label shown for the
        // "excluded" case, not just a marker for the still-open question.
        if (ov === "income") incomeClass = { type: "income" };
        else if (ov === "notIncome") incomeClass = { type: "excluded", reason: incomeClass.reason };
      }

      return {
        merchant,
        // The full bank text, not just the primary label: everything downstream
        // that reads `concept` (reconcile, debt detection) is keyword matching,
        // never display, so it should see all the detail the bank gave us.
        concept: fullText,
        date: t.date,
        cents: Math.abs(toCents(t.amount)),
        fileIndex: t.fileIndex ?? 0,
        kind,
        movementType: mv.type,
        movementKind: mv.kind,
        movementKey,
        detail,
        categoryKey: aiOv ? slug(aiOv.label) : local.key,
        icon: aiOv?.icon ?? local.icon,
        label: aiOv?.label ?? null,
        incomeType: incomeClass.type,
        incomeReason: incomeClass.type === "income" ? null : incomeClass.reason,
      };
    });

  // Reconcile transfers between the user's own uploaded accounts and drop them —
  // an internal movement is neither spending, income nor a savings-outflow. This
  // is a no-op for single-file uploads. savingsRate = (income − consumption)/income
  // is unaffected by a matched pair (one transfer-in leaves income, one outflow
  // leaves consumption/wealth), so the score stays correct and nothing is double-counted.
  const reconInput: ReconInput[] = prepared.map(p => ({
    kind: p.kind, cents: p.cents, date: p.date, fileIndex: p.fileIndex,
    concept: p.concept, movementType: p.movementType, movementKind: p.movementKind,
  }));
  const internalTxns = reconcile(reconInput);
  const active = prepared.filter((_, i) => !internalTxns.internal.has(i));

  // Only confirmed real income counts toward totalIncome — excluded (tax
  // refunds, loans, card refunds) and unresolved-uncertain inflows are handled
  // separately below and must not inflate the denominator every ratio uses.
  const incomes = active.filter(p => p.kind === "income" && p.incomeType === "income");
  const incomeExcludedTxns = active.filter(p => p.kind === "income" && p.incomeType === "excluded");
  const incomeUncertainTxns = active.filter(p => p.kind === "income" && p.incomeType === "uncertain");
  const outflows = active.filter(p => p.kind === "expense");
  const consumption = outflows.filter(p => p.movementType === "consumption");
  const wealthTxns = outflows.filter(p => p.movementType === "wealth");
  const uncertainTxns = outflows.filter(p => p.movementType === "uncertain");

  const dates = active.map(p => p.date).sort((a, b) => a.getTime() - b.getTime());
  const monthsSet = new Set(active.map(p => monthKey(p.date)));
  const months = Math.max(1, monthsSet.size);

  const totalConsumptionC = sum(consumption.map(e => e.cents));
  const totalIncomeC = sum(incomes.map(i => i.cents));
  const netC = totalIncomeC - totalConsumptionC; // money not consumed (savings + investment + uncertain + leftover)

  // ---- Categories (consumption only) ----
  const catMap = new Map<string, { icon: string; label: string | null; cents: number; count: number }>();
  for (const e of consumption) {
    const cur = catMap.get(e.categoryKey) ?? { icon: e.icon, label: e.label, cents: 0, count: 0 };
    cur.cents += e.cents;
    cur.count += 1;
    catMap.set(e.categoryKey, cur);
  }
  const categories: XRayCategory[] = [...catMap.entries()]
    .map(([key, v]) => ({
      key, icon: v.icon, label: v.label,
      total: eur(v.cents),
      monthlyAvg: eur(v.cents / months),
      annualized: eur((v.cents / months) * 12),
      pct: totalConsumptionC > 0 ? v.cents / totalConsumptionC : 0,
      txnCount: v.count,
    }))
    .sort((a, b) => b.total - a.total);

  // ---- Recurring (consumption only) ----
  const recurringInput: RecurringInput[] = consumption.map(e => ({ merchant: e.merchant, amount: e.cents, date: e.date }));
  const recurring = detectRecurringFrom(recurringInput, {
    minMonths: months >= 3 ? 3 : Math.max(2, months),
    minInBand: months >= 3 ? 3 : 2,
  }).filter(r => r.avgAmount >= RECURRING_MIN_CENTS);
  const recurringMerchants = new Set(recurring.map(r => r.merchant));
  const recurringMonthlyC = sum(recurring.map(r => r.avgAmount));

  // ---- Debt / cuota detection ("futuro comprometido") ----
  // Debt payments stay counted in expenses/categories exactly like today —
  // this only ADDS a new field, it doesn't remove anything from consumption.
  const debtDetection = detectDebtPayments(
    recurring.map(r => ({ merchant: r.merchant, avgAmount: r.avgAmount })),
    consumption.map(e => ({ merchant: e.merchant, concept: e.concept, amount: e.cents })),
  );
  const futuroComprometido = computeFuturoComprometido(debtDetection.monthlyTotal, totalIncomeC / months);

  // ---- Gastos hormiga (small, frequent, discretionary consumption) ----
  const antExcludeKeys = new Set(["cash", "housing", "utilities", "insurance", "health"]);
  const byMerchant = new Map<string, { cents: number; count: number }>();
  for (const e of consumption) {
    if (recurringMerchants.has(e.merchant)) continue;
    if (antExcludeKeys.has(classifyLocal(e.merchant).key)) continue;
    const cur = byMerchant.get(e.merchant) ?? { cents: 0, count: 0 };
    cur.cents += e.cents;
    cur.count += 1;
    byMerchant.set(e.merchant, cur);
  }
  const antItems = [...byMerchant.entries()]
    .filter(([, v]) => v.count >= ANT_MIN_COUNT && v.cents / v.count <= ANT_MAX_TICKET_CENTS)
    .map(([merchant, v]) => ({ merchant, count: v.count, total: eur(v.cents), avgTicket: eur(v.cents / v.count) }))
    .sort((a, b) => b.total - a.total);
  const antTotalC = sum(antItems.map(a => toCents(a.total)));

  // ---- Wealth (savings + giving + investment) ----
  const wealthByMerchant = new Map<string, { cents: number; kind: "savings" | "giving" | "investment" }>();
  for (const e of wealthTxns) {
    const kind = e.movementKind === "investment" ? "investment" : e.movementKind === "giving" ? "giving" : "savings";
    const cur = wealthByMerchant.get(e.merchant) ?? { cents: 0, kind };
    cur.cents += e.cents;
    wealthByMerchant.set(e.merchant, cur);
  }
  const wealthItems = [...wealthByMerchant.entries()]
    .map(([merchant, v]) => ({ merchant, total: eur(v.cents), kind: v.kind }))
    .sort((a, b) => b.total - a.total);
  const savingsC = sum(wealthTxns.filter(e => e.movementKind !== "investment" && e.movementKind !== "giving").map(e => e.cents));
  const givingTxns = wealthTxns.filter(e => e.movementKind === "giving");
  const givingC = sum(givingTxns.map(e => e.cents));
  // The archetype's giving axis needs the *shape* of the habit, not just a total:
  // in how many distinct months it happened, and how stable the amounts are.
  const givingMonths = new Set(givingTxns.map(e => monthKey(e.date))).size;
  const givingAmounts = givingTxns.map(e => e.cents);
  const investmentC = sum(wealthTxns.filter(e => e.movementKind === "investment").map(e => e.cents));

  // ---- Ambiguous outflows (transfers + cash) and ambiguous inflows (cash
  // deposits, self-transfers) share the exact same grouping shape — see
  // groupAmbiguousMovements below — so both use the one function.
  const uncertainItems = groupAmbiguousMovements(uncertainTxns);
  const incomeUncertainItems = groupAmbiguousMovements(incomeUncertainTxns);

  const incomeExcludedByReason = new Map<IncomeReason, { cents: number; count: number }>();
  for (const e of incomeExcludedTxns) {
    const cur = incomeExcludedByReason.get(e.incomeReason!) ?? { cents: 0, count: 0 };
    cur.cents += e.cents;
    cur.count += 1;
    incomeExcludedByReason.set(e.incomeReason!, cur);
  }
  const incomeExcludedItems = [...incomeExcludedByReason.entries()]
    .map(([reason, v]) => ({ reason, total: eur(v.cents), count: v.count }))
    .sort((a, b) => b.total - a.total);

  // ---- Top merchants (consumption) ----
  const merchantTotals = new Map<string, { cents: number; count: number }>();
  for (const e of consumption) {
    const cur = merchantTotals.get(e.merchant) ?? { cents: 0, count: 0 };
    cur.cents += e.cents;
    cur.count += 1;
    merchantTotals.set(e.merchant, cur);
  }
  const topMerchants = [...merchantTotals.entries()]
    .filter(([m]) => m)
    .map(([merchant, v]) => ({ merchant, total: eur(v.cents), count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // ---- Health index ----
  const monthlyNet = [...monthsSet].sort().map(mk => {
    const inc = sum(incomes.filter(i => monthKey(i.date) === mk).map(i => i.cents));
    const exp = sum(consumption.filter(e => monthKey(e.date) === mk).map(e => e.cents));
    return eur(inc - exp);
  });
  const health = computeHealthIndex({
    monthlyIncome: eur(totalIncomeC / months),
    monthlyExpenses: eur(totalConsumptionC / months),
    monthlyRecurring: eur(recurringMonthlyC),
    monthlyAnt: eur(antTotalC / months),
    recurringCount: recurring.length,
    monthlyNet,
    months,
    debtPctOfIncome: futuroComprometido.pctOfIncome,
  });

  // ---- Archetype (identity, on its own two axes — NOT derived from the score) ----
  const archetype = computeArchetype({
    monthsCovered: months,
    incomeCents: totalIncomeC,
    givingMonths,
    givingAmounts,
    savingsCents: savingsC,
    investmentCents: investmentC,
    debtPctOfIncome: futuroComprometido.pctOfIncome,
  });

  // ---- Opportunities ----
  const diningC = sum(
    consumption.filter(e => ["restaurants", "delivery"].includes(classifyLocal(e.merchant).key)).map(e => e.cents),
  );
  const opportunities = buildOpportunities({
    diningAnnualC: (diningC / months) * 12,
    antAnnualC: (antTotalC / months) * 12,
    recurringAnnualC: recurringMonthlyC * 12,
    recurringCount: recurring.length,
    monthlyNetSavingC: netC / months,
    monthlyExpensesC: totalConsumptionC / months,
  });

  // ---- Account balances (liquid worth). Per account, the running balance of its
  // most-recent movement; summed across uploaded accounts. Independent of the flow
  // reconciliation — a balance already reflects every movement in that account. ----
  const latestByFile = new Map<number, { date: Date; cents: number }>();
  for (const t of txns) {
    if (t.amount === 0 || t.balance == null) continue;
    const fi = t.fileIndex ?? 0;
    const cur = latestByFile.get(fi);
    if (!cur || t.date.getTime() >= cur.date.getTime()) latestByFile.set(fi, { date: t.date, cents: toCents(t.balance) });
  }
  const balanceAccounts = [...latestByFile.entries()]
    .map(([fileIndex, v]) => ({ fileIndex, balance: eur(v.cents), cents: v.cents }))
    .sort((a, b) => a.fileIndex - b.fileIndex);
  const balanceTotalC = balanceAccounts.reduce((s, a) => s + a.cents, 0);
  const monthlyConsumptionC = totalConsumptionC / months;
  const balances = {
    hasData: balanceAccounts.length > 0,
    total: eur(balanceTotalC),
    accounts: balanceAccounts.map(({ fileIndex, balance }) => ({ fileIndex, balance })),
    runwayMonths: balanceAccounts.length > 0 && monthlyConsumptionC > 0
      ? Math.round((balanceTotalC / monthlyConsumptionC) * 10) / 10
      : null,
  };

  return {
    period: {
      from: dates.length ? isoDay(dates[0]) : "",
      to: dates.length ? isoDay(dates[dates.length - 1]) : "",
      months,
    },
    summary: {
      totalIncome: eur(totalIncomeC),
      totalExpenses: eur(totalConsumptionC),
      net: eur(netC),
      savingsRate: totalIncomeC > 0 ? netC / totalIncomeC : 0,
      transactionCount: prepared.length,
    },
    categories,
    antExpenses: {
      monthlyAvg: eur(antTotalC / months),
      annualized: eur((antTotalC / months) * 12),
      items: antItems.slice(0, 10),
    },
    recurring: {
      monthlyTotal: eur(recurringMonthlyC),
      annualized: eur(recurringMonthlyC * 12),
      count: recurring.length,
      items: recurring
        .map(r => ({ merchant: r.merchant, monthlyAmount: eur(r.avgAmount), annualized: eur(r.avgAmount * 12), categoryKey: classifyLocal(r.merchant).key }))
        .sort((a, b) => b.annualized - a.annualized),
    },
    wealth: {
      total: eur(savingsC + givingC + investmentC),
      savings: eur(savingsC),
      giving: eur(givingC),
      investment: eur(investmentC),
      items: wealthItems,
    },
    uncertain: {
      total: eur(sum(uncertainTxns.map(e => e.cents))),
      items: uncertainItems,
    },
    income: {
      excluded: {
        total: eur(sum(incomeExcludedTxns.map(e => e.cents))),
        items: incomeExcludedItems,
      },
      uncertain: {
        total: eur(sum(incomeUncertainTxns.map(e => e.cents))),
        items: incomeUncertainItems,
      },
    },
    internalTransfers: {
      count: internalTxns.count,
      total: eur(internalTxns.totalCents),
      items: internalTxns.items,
    },
    balances,
    debts: {
      monthlyTotal: eur(debtDetection.monthlyTotal),
      pctOfIncome: futuroComprometido.pctOfIncome,
      items: debtDetection.items.map(i => ({ merchant: i.merchant, kind: i.kind, monthlyAmount: eur(i.monthlyAmount) })),
      mortgage: debtDetection.mortgage
        ? { detected: true, monthlyAmount: eur(debtDetection.mortgage.monthlyAmount) }
        : null,
    },
    topMerchants,
    health,
    archetype,
    opportunities,
  };
}

interface OppInput {
  diningAnnualC: number;
  antAnnualC: number;
  recurringAnnualC: number;
  recurringCount: number;
  monthlyNetSavingC: number;
  monthlyExpensesC: number;
}

function buildOpportunities(inp: OppInput): XRayResult["opportunities"] {
  const out: XRayResult["opportunities"] = [];

  if (inp.diningAnnualC > 0) out.push({ id: "cut_dining_20", annualSaving: eur(inp.diningAnnualC * 0.2), params: { pct: 20 } });
  if (inp.antAnnualC > 0) out.push({ id: "halve_ant", annualSaving: eur(inp.antAnnualC * 0.5), params: { pct: 50 } });
  if (inp.recurringCount >= 4 && inp.recurringAnnualC > 0) out.push({ id: "review_subscriptions", annualSaving: eur(inp.recurringAnnualC * 0.25), params: { count: inp.recurringCount } });

  if (inp.monthlyNetSavingC > 0 && inp.monthlyExpensesC > 0) {
    const targetC = inp.monthlyExpensesC * 3;
    const monthsToFund = Math.ceil(targetC / inp.monthlyNetSavingC);
    out.push({ id: "emergency_fund", annualSaving: 0, params: { months: monthsToFund, target: eur(targetC) } });
  }

  return out.sort((a, b) => b.annualSaving - a.annualSaving).slice(0, 4);
}

function sum(arr: number[]): number { return arr.reduce((s, n) => s + n, 0); }
function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}
