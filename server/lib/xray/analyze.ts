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
import { normalizeMerchant } from "../normalizeMerchant.js";
import { detectRecurringFrom, type RecurringInput } from "../recurring.js";
import { classifyLocal } from "./categories.js";
import { classifyMovement, type MovementType, type MovementKind } from "./wealth.js";
import { describeMovement } from "./transferDetail.js";
import { reconcile, type ReconInput } from "./reconcile.js";
import { computeHealthIndex, type HealthIndex } from "./healthIndex.js";
import type { SuggestedCategory } from "../ai/suggestCategories.js";

// A parsed transaction tagged with which uploaded file it came from (multi-account).
// A missing fileIndex is treated as 0, so the single-file path is unchanged.
export type TaggedTxn = ParsedTxn & { fileIndex?: number };

const ANT_MAX_TICKET_CENTS = 2000;   // ≤ €20 counts as a "small" charge
const ANT_MIN_COUNT = 3;             // repeated at least 3× over the window
const RECURRING_MIN_CENTS = 400;     // €4 — below this a stable charge is a leak, not a subscription

// User reclassification of a merchant's movement type (from the correction card).
export type Overrides = Record<string, "consumption" | "wealth">;

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
  // Detected savings + investment (money kept, not spent).
  wealth: {
    total: number;
    savings: number;
    investment: number;
    items: { merchant: string; total: number; kind: "savings" | "investment" }[];
  };
  // Ambiguous movements (transfers, cash) awaiting user confirmation.
  uncertain: {
    total: number;
    items: { key: string; detail: string | null; merchant: string; total: number; count: number; kind: "transfer" | "cash" }[];
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
  topMerchants: { merchant: string; total: number; count: number }[];
  health: HealthIndex;
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
  movementKey: string;      // grouping/override key: merchant, or "t:"/"c:" for uncertain
  detail: string | null;    // display detail for uncertain (name / "••1234")
  categoryKey: string;
  icon: string;
  label: string | null;
}

function aiLookup(ai?: SuggestedCategory[]): Map<string, { label: string; icon: string }> {
  const map = new Map<string, { label: string; icon: string }>();
  if (!ai) return map;
  for (const cat of ai) for (const m of cat.merchants) map.set(m, { label: cat.name, icon: cat.icon });
  return map;
}

export function analyze(txns: TaggedTxn[], aiCategories?: SuggestedCategory[], overrides: Overrides = {}): XRayResult {
  const ai = aiLookup(aiCategories);

  const prepared: PreparedTxn[] = txns
    .filter(t => t.amount !== 0)
    .map(t => {
      const merchant = normalizeMerchant(t.concept);
      const local = classifyLocal(merchant);
      const aiOv = ai.get(merchant);
      const kind = (t.amount < 0 ? "expense" : "income") as "expense" | "income";

      // Base movement type (outflows only), then the grouping/override key: for
      // uncertain movements it's a namespaced "t:"/"c:" key; otherwise the merchant.
      let mv = kind === "expense" ? classifyMovement(t.concept) : { type: "consumption" as MovementType, kind: null as MovementKind };
      let movementKey = merchant;
      let detail: string | null = null;
      if (kind === "expense" && mv.type === "uncertain") {
        const md = describeMovement(t.concept, mv.kind === "cash" ? "cash" : "transfer");
        movementKey = md.movementKey;
        detail = md.detail;
      }

      // Apply the user's reclassification (uncertain → keyed by movementKey;
      // consumption/wealth → keyed by merchant — the namespaces never collide).
      const ov = overrides[movementKey] ?? overrides[merchant];
      if (kind === "expense" && ov) {
        mv = ov === "wealth"
          ? { type: "wealth", kind: mv.kind === "investment" ? "investment" : "savings" }
          : { type: "consumption", kind: null };
      }

      return {
        merchant,
        concept: t.concept,
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

  const incomes = active.filter(p => p.kind === "income");
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

  // ---- Wealth (savings + investment) ----
  const wealthByMerchant = new Map<string, { cents: number; kind: "savings" | "investment" }>();
  for (const e of wealthTxns) {
    const kind = e.movementKind === "investment" ? "investment" : "savings";
    const cur = wealthByMerchant.get(e.merchant) ?? { cents: 0, kind };
    cur.cents += e.cents;
    wealthByMerchant.set(e.merchant, cur);
  }
  const wealthItems = [...wealthByMerchant.entries()]
    .map(([merchant, v]) => ({ merchant, total: eur(v.cents), kind: v.kind }))
    .sort((a, b) => b.total - a.total);
  const savingsC = sum(wealthTxns.filter(e => e.movementKind !== "investment").map(e => e.cents));
  const investmentC = sum(wealthTxns.filter(e => e.movementKind === "investment").map(e => e.cents));

  // ---- Uncertain (transfers + cash), grouped by the stable movementKey so a
  // no-name transfer is identifiable and each group toggles independently ----
  const uncByKey = new Map<string, { detail: string | null; merchant: string; cents: number; count: number; kind: "transfer" | "cash" }>();
  for (const e of uncertainTxns) {
    const kind = e.movementKind === "cash" ? "cash" : "transfer";
    const cur = uncByKey.get(e.movementKey) ?? { detail: e.detail, merchant: e.merchant, cents: 0, count: 0, kind };
    cur.cents += e.cents;
    cur.count += 1;
    uncByKey.set(e.movementKey, cur);
  }
  const uncertainItems = [...uncByKey.entries()]
    .map(([key, v]) => ({ key, detail: v.detail, merchant: v.merchant, total: eur(v.cents), count: v.count, kind: v.kind }))
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
      total: eur(savingsC + investmentC),
      savings: eur(savingsC),
      investment: eur(investmentC),
      items: wealthItems,
    },
    uncertain: {
      total: eur(sum(uncertainTxns.map(e => e.cents))),
      items: uncertainItems,
    },
    internalTransfers: {
      count: internalTxns.count,
      total: eur(internalTxns.totalCents),
      items: internalTxns.items,
    },
    balances,
    topMerchants,
    health,
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
