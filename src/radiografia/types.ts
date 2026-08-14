// Mirrors the server's XRayResult (server/lib/xray/analyze.ts). Kept in sync by
// hand — the Radiografía is a public flow with no shared type package.

export interface XRayCategory {
  key: string;
  icon: string;
  label: string | null;   // custom (AI) label; null → resolve `key` via i18n
  total: number;
  monthlyAvg: number;
  annualized: number;
  pct: number;
  txnCount: number;
}

export interface HealthPillar {
  key: 'savings' | 'structure' | 'leaks' | 'commitments' | 'stability' | 'debtLoad';
  label: string;
  score: number;
  weight: number;
  caption: string;
}

export type DebtKind = 'credit_card' | 'installment' | 'bnpl' | 'payday_loan' | 'auto_loan' | 'other';

export interface HealthIndex {
  score: number;
  stage: 'building' | 'balancing' | 'growing' | 'solid';
  pillars: HealthPillar[];
  strongestKey: HealthPillar['key'];
}

export interface XRayOpportunity {
  id: string;
  annualSaving: number;
  params: Record<string, number>;
}

// Shared by ambiguous outflows (transfers/cash) and ambiguous inflows (cash
// deposits, self-transfers) — same shape either direction.
export interface AmbiguousItem {
  // All override keys this row stands for (an "assorted amounts" row covers
  // several); answering it applies to every one of them.
  keys: string[];
  detail: string | null;
  merchant: string;
  total: number;
  count: number;
  // Repeated exact amount (e.g. 4 × €150), or null for assorted amounts.
  amountEach: number | null;
  kind: 'transfer' | 'cash';
}

export type IncomeReason = 'taxRefund' | 'loanReceived' | 'refund' | 'cashDeposit' | 'selfTransfer';

export interface XRayResult {
  period: { from: string; to: string; months: number };
  summary: {
    totalIncome: number;
    totalExpenses: number;   // consumption only
    net: number;             // income − consumption
    savingsRate: number;
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
  wealth: {
    total: number;
    savings: number;
    giving: number;
    investment: number;
    items: { merchant: string; total: number; kind: 'savings' | 'giving' | 'investment' }[];
  };
  uncertain: {
    total: number;
    items: AmbiguousItem[];
  };
  // Inflows NOT counted in summary.totalIncome. `excluded` was dropped
  // automatically (tax refunds, loans received, card refunds — informational
  // only). `uncertain` needs the user's answer (income vs. not) and isn't
  // counted until they give it — same conservative default as outflow `uncertain`.
  income: {
    excluded: { total: number; items: { reason: IncomeReason; total: number; count: number }[] };
    uncertain: { total: number; items: AmbiguousItem[] };
  };
  internalTransfers: {
    count: number;
    total: number;
    items: { detail: string | null; total: number; count: number }[];
  };
  balances: {
    hasData: boolean;
    total: number;
    accounts: { fileIndex: number; balance: number }[];
    runwayMonths: number | null;
  };
  debts: {
    monthlyTotal: number;
    pctOfIncome: number;
    items: { merchant: string; kind: DebtKind; monthlyAmount: number }[];
    mortgage: { detected: boolean; monthlyAmount: number } | null;
  };
  topMerchants: { merchant: string; total: number; count: number }[];
  health: HealthIndex;
  archetype: ArchetypeResult;
  opportunities: XRayOpportunity[];
}

export type Archetype =
  | 'slave' | 'juggler' | 'builder' | 'sower' | 'braveGiver' | 'steward' | 'multiplier';

export interface ArchetypeResult {
  key: Archetype;
  /** False when the statement is too short to judge giving consistency. */
  givingAssessed: boolean;
  faithfulGiver: boolean;
  givingPctOfIncome: number;
}

export type MovementAnswer = 'consumption' | 'savings' | 'investment' | 'giving';
// The two things an ambiguous INFLOW can actually be.
export type IncomeAnswer = 'income' | 'notIncome';
// 'wealth' is a legacy value (meaning savings) kept so overrides stored by
// earlier sessions still resolve server-side.
export type Overrides = Record<string, MovementAnswer | IncomeAnswer | 'wealth'>;

export type XRayStep = 'landing' | 'manual' | 'processing' | 'classify' | 'results' | 'email';

/** An ambiguous movement group the user has to resolve before seeing the verdict. */
export type UncertainItem = XRayResult['uncertain']['items'][number];
