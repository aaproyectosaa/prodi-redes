// Tablas de Prodi Software (las mismas que tenía MP Socios, con el prefijo hub_). Solo crea y agrega: nunca borra.
// Lo corre el script de migración (scripts/software-migrar.ts) y se puede volver a correr sin problema.

import type { Sql } from "./sql";

export async function crearEsquemaSoftware(sql: Sql): Promise<void> {
  // gen_random_uuid() ya viene en Postgres 13+; la extensión es solo por las dudas (la base local no la tiene).
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.catch(() => undefined);

  await sql`
    CREATE TABLE IF NOT EXISTS hub_mp_apps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      client_id TEXT NOT NULL DEFAULT '',
      client_secret TEXT NOT NULL DEFAULT '',
      public_key TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      webhook_secret TEXT NOT NULL DEFAULT '',
      webhook_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (webhook_status IN ('pending', 'ok', 'error')),
      mp_user_id TEXT,
      mp_nickname TEXT,
      connection_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (connection_status IN ('pending', 'ok', 'error')),
      connection_error TEXT,
      last_webhook_at TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES hub_mp_apps(id) ON DELETE CASCADE,
      mp_payment_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      fee NUMERIC(14, 2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'ARS',
      collector_id TEXT,
      collector_name TEXT,
      payer_email TEXT,
      description TEXT,
      paid_at TIMESTAMPTZ,
      raw_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (app_id, mp_payment_id)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS hub_payments_paid_at_idx ON hub_payments (paid_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_payments_status_idx ON hub_payments (status)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_payments_app_id_idx ON hub_payments (app_id)`;
  await sql`
    ALTER TABLE hub_payments
    ADD COLUMN IF NOT EXISTS fee_notified_at TIMESTAMPTZ
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      pct NUMERIC(6, 2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE hub_partners
    ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_settlements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      year_month TEXT NOT NULL,
      partner_id UUID NOT NULL REFERENCES hub_partners(id) ON DELETE CASCADE,
      amount_due NUMERIC(14, 2) NOT NULL DEFAULT 0,
      amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      marked_paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (year_month, partner_id)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS hub_settlements_month_idx ON hub_settlements (year_month DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      app_id UUID NOT NULL REFERENCES hub_mp_apps(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      collector_id TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (app_id, collector_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_clients_app_id_idx ON hub_clients (app_id)`;

  await sql`
    ALTER TABLE hub_clients
    ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN NOT NULL DEFAULT FALSE
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_clients_blacklisted_idx ON hub_clients (blacklisted)`;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES hub_partners(id) ON DELETE CASCADE,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      period_from DATE NOT NULL,
      period_to DATE NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_payouts_partner_idx ON hub_payouts (partner_id)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_payouts_period_idx ON hub_payouts (period_from, period_to)`;
  await sql`
    ALTER TABLE hub_payouts
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'fee'
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_payouts_source_idx ON hub_payouts (source)`;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_activity (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_activity_created_idx ON hub_activity (created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_client_partner_pct (
      client_id UUID NOT NULL REFERENCES hub_clients(id) ON DELETE CASCADE,
      partner_id UUID NOT NULL REFERENCES hub_partners(id) ON DELETE CASCADE,
      pct NUMERIC(6, 2) NOT NULL DEFAULT 0,
      PRIMARY KEY (client_id, partner_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_client_partner_pct_partner_idx ON hub_client_partner_pct (partner_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_maintenance_clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      monthly_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_maintenance_clients_active_idx ON hub_maintenance_clients (active)`;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_maintenance_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES hub_maintenance_clients(id) ON DELETE CASCADE,
      year_month TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, year_month)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_maintenance_payments_month_idx ON hub_maintenance_payments (year_month DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_maintenance_payments_paid_at_idx ON hub_maintenance_payments (paid_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_extra_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payer_name TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_extra_payments_paid_at_idx ON hub_extra_payments (paid_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS hub_expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      description TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'otros',
      partner_id UUID REFERENCES hub_partners(id) ON DELETE SET NULL,
      notes TEXT NOT NULL DEFAULT '',
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS hub_expenses_paid_at_idx ON hub_expenses (paid_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_expenses_category_idx ON hub_expenses (category)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_expenses_partner_idx ON hub_expenses (partner_id)`;

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
  await sql`CREATE INDEX IF NOT EXISTS hub_subscriptions_app_idx ON hub_subscriptions (app_id)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_subscriptions_status_idx ON hub_subscriptions (status)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_subscriptions_collector_idx ON hub_subscriptions (collector_id)`;
  await sql`ALTER TABLE hub_subscriptions ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE hub_subscriptions ADD COLUMN IF NOT EXISTS hub_status TEXT`;
  await sql`
    UPDATE hub_subscriptions
    SET hub_status = 'accepted'
    WHERE hub_status IS NULL OR hub_status = ''
  `;
  await sql`ALTER TABLE hub_subscriptions ALTER COLUMN hub_status SET DEFAULT 'pending'`;
  await sql`ALTER TABLE hub_subscriptions ALTER COLUMN hub_status SET NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS hub_subscriptions_hub_status_idx ON hub_subscriptions (hub_status)`;

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
  await sql`CREATE INDEX IF NOT EXISTS hub_sub_charges_paid_at_idx ON hub_subscription_charges (paid_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_sub_charges_app_idx ON hub_subscription_charges (app_id)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_sub_charges_status_idx ON hub_subscription_charges (status)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_sub_charges_collector_idx ON hub_subscription_charges (collector_id)`;
  await sql`CREATE INDEX IF NOT EXISTS hub_sub_charges_payment_idx ON hub_subscription_charges (app_id, mp_payment_id)`;
  await sql`ALTER TABLE hub_subscription_charges ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE hub_subscription_charges ADD COLUMN IF NOT EXISTS mp_fee_pct NUMERIC(10, 6) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE hub_subscription_charges ADD COLUMN IF NOT EXISTS mp_net_amount NUMERIC(14, 2)`;
  await sql`ALTER TABLE hub_subscription_charges ADD COLUMN IF NOT EXISTS mp_fee_manual BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`
    UPDATE hub_subscription_charges c
    SET subscription_id = s.id
    FROM hub_subscriptions s
    WHERE c.subscription_id IS NULL
      AND c.app_id = s.app_id
      AND c.mp_preapproval_id IS NOT NULL
      AND c.mp_preapproval_id = s.mp_preapproval_id
  `;
  // Prodi: cada integrante del reparto se une a su usuario (programación ve lo suyo).
  await sql`ALTER TABLE hub_partners ADD COLUMN IF NOT EXISTS prodi_uid TEXT`;
}
