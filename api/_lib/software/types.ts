export type WebhookStatus = "pending" | "ok" | "error";
export type ConnectionStatus = "pending" | "ok" | "error";

export type MpApp = {
  id: string;
  name: string;
  client_id: string;
  client_secret: string;
  public_key: string;
  access_token: string;
  webhook_secret: string;
  webhook_status: WebhookStatus;
  mp_user_id: string | null;
  mp_nickname: string | null;
  connection_status: ConnectionStatus;
  connection_error: string | null;
  last_webhook_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MpAppPublic = Omit<
  MpApp,
  "client_secret" | "access_token" | "webhook_secret"
> & {
  has_client_secret: boolean;
  has_access_token: boolean;
  has_webhook_secret: boolean;
  client_secret_masked: string;
  access_token_masked: string;
};

export type Payment = {
  id: string;
  app_id: string;
  app_name?: string;
  client_name?: string | null;
  client_id?: string | null;
  mp_payment_id: string;
  status: string;
  amount: number;
  fee: number;
  currency: string;
  collector_id: string | null;
  collector_name: string | null;
  payer_email: string | null;
  description: string | null;
  paid_at: string | null;
  created_at: string;
};

export type HubStatus = "pending" | "accepted" | "rejected";

export type Subscription = {
  id: string;
  app_id: string;
  app_name?: string;
  client_name?: string | null;
  client_id?: string | null;
  mp_preapproval_id: string;
  status: string;
  hub_status: HubStatus;
  reason: string | null;
  payer_email: string | null;
  collector_id: string | null;
  collector_name: string | null;
  amount: number;
  currency: string;
  frequency: number;
  frequency_type: string;
  next_payment_date: string | null;
  start_date: string | null;
  external_reference: string | null;
  created_at: string;
  updated_at: string;
  last_charge_status?: string | null;
  last_charge_paid_at?: string | null;
  last_charge_amount?: number | null;
  ever_paid?: boolean;
};

export type SubscriptionCharge = {
  id: string;
  app_id: string;
  app_name?: string;
  client_name?: string | null;
  client_id?: string | null;
  subscription_id: string | null;
  charge_uid: string;
  mp_payment_id: string | null;
  mp_authorized_payment_id: string | null;
  mp_preapproval_id: string | null;
  status: string;
  amount: number;
  currency: string;
  kind: string;
  collector_id: string | null;
  collector_name: string | null;
  payer_email: string | null;
  description: string | null;
  external_reference: string | null;
  paid_at: string | null;
  created_at: string;
  mp_fee_pct?: number | null;
  mp_net_amount?: number | null;
  mp_fee_manual?: boolean;
  net_amount?: number | null;
};

export type Partner = {
  id: string;
  name: string;
  pct: number;
  sort_order: number;
};

export type Settlement = {
  id: string;
  year_month: string;
  partner_id: string;
  partner_name?: string;
  amount_due: number;
  amount_paid: number;
  notes: string;
  marked_paid_at: string | null;
};
