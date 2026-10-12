import { getSql } from "../sql";
import type { MpPreapproval } from "../mp";
import { parseHubStatus, num, text, type HubStatus } from "./contracts";
import { resolveClient } from "./client-resolution";
import { ensureSubscriptionTables } from "./schema";

export async function setIngestVisibility(opts: {
  hidden: boolean;
  mpPreapprovalId?: string | null;
  mpPaymentId?: string | null;
  externalReference?: string | null;
}) {
  await ensureSubscriptionTables();
  const sql = getSql();
  const hidden = Boolean(opts.hidden);
  const pre = text(opts.mpPreapprovalId);
  const pay = text(opts.mpPaymentId);
  const ref = text(opts.externalReference);
  if (!pre && !pay && !ref) return { ok: false as const };

  if (pre) {
    await sql`UPDATE hub_subscriptions SET hidden = ${hidden}, updated_at = NOW() WHERE mp_preapproval_id = ${pre}`;
    await sql`UPDATE hub_subscription_charges SET hidden = ${hidden} WHERE mp_preapproval_id = ${pre}`;
  }
  if (pay) {
    await sql`UPDATE hub_subscription_charges SET hidden = ${hidden} WHERE mp_payment_id = ${pay}`;
    const rows = await sql`
      SELECT mp_preapproval_id FROM hub_subscription_charges
      WHERE mp_payment_id = ${pay} LIMIT 1
    `;
    const linked = rows[0]?.mp_preapproval_id ? String(rows[0].mp_preapproval_id) : "";
    if (linked) {
      await sql`UPDATE hub_subscriptions SET hidden = ${hidden}, updated_at = NOW() WHERE mp_preapproval_id = ${linked}`;
    }
  }
  if (ref) {
    await sql`UPDATE hub_subscriptions SET hidden = ${hidden}, updated_at = NOW() WHERE external_reference = ${ref}`;
    await sql`UPDATE hub_subscription_charges SET hidden = ${hidden} WHERE external_reference = ${ref}`;
  }
  return { ok: true as const };
}

export async function setSubscriptionHubStatus(id: string, hubStatus: HubStatus) {
  await ensureSubscriptionTables();
  const sql = getSql();
  const rows = await sql`
    UPDATE hub_subscriptions
    SET hub_status = ${hubStatus}, updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING
      id, app_id, mp_preapproval_id, hub_status, status,
      collector_name, amount::float8 AS amount, reason
  `;
  return rows[0] || null;
}

export async function getSubscriptionHubStatus(opts: {
  appId: string;
  subscriptionId?: string | null;
  mpPreapprovalId?: string | null;
}) {
  await ensureSubscriptionTables();
  const sql = getSql();
  const subId = text(opts.subscriptionId);
  const pre = text(opts.mpPreapprovalId);
  if (subId) {
    const rows = await sql`
      SELECT hub_status FROM hub_subscriptions
      WHERE id = ${subId}::uuid
      LIMIT 1
    `;
    return parseHubStatus(rows[0]?.hub_status);
  }
  if (pre) {
    const rows = await sql`
      SELECT hub_status FROM hub_subscriptions
      WHERE app_id = ${opts.appId}::uuid AND mp_preapproval_id = ${pre}
      LIMIT 1
    `;
    return parseHubStatus(rows[0]?.hub_status);
  }
  return null;
}

export async function upsertSubscriptionFromMp(
  appId: string,
  pre: MpPreapproval,
  opts?: {
    preferredClientName?: string | null;
    accessToken?: string | null;
  },
) {
  await ensureSubscriptionTables();
  const sql = getSql();
  const mpId = text(pre.id);
  if (!mpId) return null;

  const recurring = pre.auto_recurring || {};
  const amount = num(recurring.transaction_amount);
  const currency = text(recurring.currency_id) || "ARS";
  const status = text(pre.status) || "unknown";
  const reason = text(pre.reason);
  const payerEmail = text(pre.payer_email);
  const collectorRaw =
    pre.collector_id != null ? String(pre.collector_id) : null;
  const client = await resolveClient(appId, {
    collectorId: collectorRaw,
    preferredName: opts?.preferredClientName,
    description: reason,
    accessToken: opts?.accessToken,
  });
  const summarized = pre.summarized ? JSON.stringify(pre.summarized) : null;
  const raw = JSON.stringify(pre);
  const nextDate =
    text(pre.next_payment_date) || text(pre.summarized?.last_charged_date);
  const startDate = text(recurring.start_date) || text(pre.date_created);

  const existing = await sql`
    SELECT id, hub_status FROM hub_subscriptions
    WHERE app_id = ${appId}::uuid AND mp_preapproval_id = ${mpId}
    LIMIT 1
  `;
  const isNew = !existing[0];

  await sql`
    INSERT INTO hub_subscriptions (
      app_id, mp_preapproval_id, status, reason, payer_email,
      collector_id, collector_name, amount, currency, frequency, frequency_type,
      next_payment_date, start_date, external_reference, summarized_json, raw_json,
      hub_status, updated_at
    ) VALUES (
      ${appId}::uuid, ${mpId}, ${status}, ${reason}, ${payerEmail},
      ${client.collectorId}, ${client.collectorName}, ${amount}, ${currency},
      ${num(recurring.frequency, 1)}, ${text(recurring.frequency_type) || "months"},
      ${nextDate}, ${startDate}, ${text(pre.external_reference)},
      ${summarized}::jsonb, ${raw}::jsonb, 'pending', NOW()
    )
    ON CONFLICT (app_id, mp_preapproval_id) DO UPDATE SET
      status = EXCLUDED.status,
      reason = COALESCE(EXCLUDED.reason, hub_subscriptions.reason),
      payer_email = COALESCE(EXCLUDED.payer_email, hub_subscriptions.payer_email),
      collector_id = COALESCE(EXCLUDED.collector_id, hub_subscriptions.collector_id),
      collector_name = COALESCE(EXCLUDED.collector_name, hub_subscriptions.collector_name),
      amount = CASE WHEN EXCLUDED.amount > 0 THEN EXCLUDED.amount ELSE hub_subscriptions.amount END,
      currency = EXCLUDED.currency,
      frequency = EXCLUDED.frequency,
      frequency_type = EXCLUDED.frequency_type,
      next_payment_date = COALESCE(EXCLUDED.next_payment_date, hub_subscriptions.next_payment_date),
      start_date = COALESCE(EXCLUDED.start_date, hub_subscriptions.start_date),
      external_reference = COALESCE(EXCLUDED.external_reference, hub_subscriptions.external_reference),
      summarized_json = COALESCE(EXCLUDED.summarized_json, hub_subscriptions.summarized_json),
      raw_json = EXCLUDED.raw_json,
      updated_at = NOW()
  `;

  const row = await sql`
    SELECT id, hub_status FROM hub_subscriptions
    WHERE app_id = ${appId}::uuid AND mp_preapproval_id = ${mpId}
    LIMIT 1
  `;
  const id = String(row[0]?.id || "");
  if (id) {
    await sql`
      UPDATE hub_subscription_charges
      SET subscription_id = ${id}::uuid
      WHERE app_id = ${appId}::uuid
        AND mp_preapproval_id = ${mpId}
        AND (subscription_id IS NULL OR subscription_id <> ${id}::uuid)
    `;
  }
  return {
    id,
    mpPreapprovalId: mpId,
    status,
    amount,
    clientName: client.collectorName,
    collectorId: client.collectorId,
    isNew,
    hubStatus: parseHubStatus(row[0]?.hub_status) || (isNew ? "pending" : "accepted"),
  };
}
