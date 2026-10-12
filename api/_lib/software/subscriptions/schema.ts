import { getSql } from "../sql";

let ensured = false;

export async function ensureSubscriptionTables() {
  if (ensured) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS hub_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES hub_mp_apps(id) ON DELETE CASCADE,
      mp_preapproval_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      reason TEXT,
      payer_email TEXT,
      collector_id TEXT,
      collector_name TEXT,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'ARS',
      frequency INT NOT NULL DEFAULT 1,
      frequency_type TEXT NOT NULL DEFAULT 'months',
      next_payment_date TIMESTAMPTZ,
      start_date TIMESTAMPTZ,
      external_reference TEXT,
      summarized_json JSONB,
      raw_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (app_id, mp_preapproval_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS hub_subscription_charges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES hub_mp_apps(id) ON DELETE CASCADE,
      subscription_id UUID REFERENCES hub_subscriptions(id) ON DELETE SET NULL,
      charge_uid TEXT NOT NULL,
      mp_payment_id TEXT,
      mp_authorized_payment_id TEXT,
      mp_preapproval_id TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'ARS',
      kind TEXT NOT NULL DEFAULT 'recurring',
      collector_id TEXT,
      collector_name TEXT,
      payer_email TEXT,
      description TEXT,
      external_reference TEXT,
      paid_at TIMESTAMPTZ,
      notified_at TIMESTAMPTZ,
      raw_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (app_id, charge_uid)
    )
  `;
  await sql`ALTER TABLE hub_subscriptions ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE hub_subscription_charges ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`CREATE INDEX IF NOT EXISTS hub_subscriptions_hidden_idx ON hub_subscriptions (hidden)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_subscription_charges_hidden_idx ON hub_subscription_charges (hidden)`;
  await sql`ALTER TABLE hub_subscriptions ADD COLUMN IF NOT EXISTS hub_status TEXT`;
  await sql`
    UPDATE hub_subscriptions
    SET hub_status = 'accepted'
    WHERE hub_status IS NULL OR hub_status = ''
  `;
  await sql`ALTER TABLE hub_subscriptions ALTER COLUMN hub_status SET DEFAULT 'pending'`;
  await sql`ALTER TABLE hub_subscriptions ALTER COLUMN hub_status SET NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS hub_subscriptions_hub_status_idx ON hub_subscriptions (hub_status)`;
  await sql`ALTER TABLE hub_subscription_charges ADD COLUMN IF NOT EXISTS mp_fee_pct NUMERIC(10, 6) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE hub_subscription_charges ADD COLUMN IF NOT EXISTS mp_net_amount NUMERIC(14, 2)`;
  await sql`ALTER TABLE hub_subscription_charges ADD COLUMN IF NOT EXISTS mp_fee_manual BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`
    UPDATE hub_subscription_charges
    SET
      mp_net_amount = ROUND((raw_json#>>'{transaction_details,net_received_amount}')::numeric, 2),
      mp_fee_pct = ROUND(
        (
          1 - (raw_json#>>'{transaction_details,net_received_amount}')::numeric
            / NULLIF(amount, 0)
        ) * 100
      , 6)
    WHERE COALESCE(mp_fee_manual, FALSE) = FALSE
      AND mp_net_amount IS NULL
      AND amount > 0
      AND raw_json#>>'{transaction_details,net_received_amount}' IS NOT NULL
      AND (raw_json#>>'{transaction_details,net_received_amount}')::numeric >= 0
      AND (raw_json#>>'{transaction_details,net_received_amount}')::numeric <= amount
  `;
  await sql`
    UPDATE hub_subscription_charges c
    SET
      mp_net_amount = ROUND(c.amount - s.mp_fee, 2),
      mp_fee_pct = ROUND((s.mp_fee / NULLIF(c.amount, 0)) * 100, 6)
    FROM (
      SELECT
        id,
        COALESCE((
          SELECT SUM((elem->>'amount')::numeric)
          FROM jsonb_array_elements(raw_json->'fee_details') elem
          WHERE LOWER(COALESCE(elem->>'fee_payer', 'collector')) <> 'payer'
            AND LOWER(COALESCE(elem->>'type', '')) IN (
              'mercadopago_fee', 'financing_fee', 'coupon_fee', 'ml_fee'
            )
        ), 0) AS mp_fee
      FROM hub_subscription_charges
      WHERE jsonb_typeof(raw_json->'fee_details') = 'array'
    ) s
    WHERE c.id = s.id
      AND COALESCE(c.mp_fee_manual, FALSE) = FALSE
      AND c.mp_net_amount IS NULL
      AND c.amount > 0
      AND s.mp_fee > 0
      AND s.mp_fee <= c.amount
  `;
  await sql`
    UPDATE hub_subscription_charges c
    SET subscription_id = s.id
    FROM hub_subscriptions s
    WHERE c.subscription_id IS NULL
      AND c.app_id = s.app_id
      AND c.mp_preapproval_id IS NOT NULL
      AND c.mp_preapproval_id = s.mp_preapproval_id
  `;
  ensured = true;
}
