import type { PayoutSource } from "@/software/lib/payout-source";

export type Partner = { id: string; name: string; pct: number };
export type Source = PayoutSource;
export type Item = {
  partner_id: string;
  partner_name: string;
  pct: number;
  share: number;
  paid: number;
  pending: number;
  source: Source;
};
export type ExtraPayment = {
  id: string;
  payer_name: string;
  amount: number;
  notes: string;
  paid_at: string;
};
export type Payout = {
  id: string;
  partner_name: string;
  amount: number;
  period_from: string;
  period_to: string;
  notes: string;
  paid_at: string;
  source?: string;
};
export type BreakdownRow = {
  client_id: string | null;
  client_name: string;
  fee: number;
  count: number;
  custom: boolean;
  source?: Source | "mp";
  shares: Array<{ partner_id: string; partner_name: string; pct: number; share: number }>;
};

export type Caja = {
  partner_id: string | null;
  partner_name: string | null;
  period: { transferred: number; expenses: number; saldo: number };
  allTime: { transferred: number; expenses: number; saldo: number };
  expensesByCategory: Array<{ category: string; amount: number; count: number }>;
  expensesByPartner: Array<{
    partner_id: string | null;
    partner_name: string;
    amount: number;
  }>;
  expenseCount: number;
};
