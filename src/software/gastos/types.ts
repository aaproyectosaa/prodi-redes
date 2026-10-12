export type Expense = {
  id: string;
  description: string;
  amount: number;
  category: string;
  partner_id: string | null;
  partner_name: string | null;
  notes: string;
  paid_at: string;
  created_at?: string;
};

export type ExpenseTotals = {
  total: number;
  count: number;
  byCategory: Array<{ category: string; amount: number; count: number }>;
  byPartner: Array<{ partner_id: string | null; partner_name: string; amount: number }>;
};

export type GastoPartner = { id: string; name: string; pct: number; is_cash?: boolean };
