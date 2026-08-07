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
  key: 'savings' | 'structure' | 'leaks' | 'commitments' | 'stability';
  label: string;
  score: number;
  weight: number;
  caption: string;
}

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
    items: { key: string; detail: string | null; merchant: string; total: number; count: number; kind: 'transfer' | 'cash' }[];
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
  topMerchants: { merchant: string; total: number; count: number }[];
  health: HealthIndex;
  opportunities: XRayOpportunity[];
}

export type Overrides = Record<string, 'consumption' | 'wealth'>;

export type XRayStep = 'landing' | 'processing' | 'results' | 'email';
