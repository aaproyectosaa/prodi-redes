import { getSql } from "../sql";
import { subscriptionPlanName } from "../subscription-label";
import { getSubscriptionHubStatus } from "./plans";
import { ensureSubscriptionTables } from "./schema";
import type { upsertSubscriptionCharge } from "./charges";

export async function maybeNotifyCharge(
  appId: string,
  result: Awaited<ReturnType<typeof upsertSubscriptionCharge>>,
  source: string,
) {
  if (!result.saved || !result.newlyApproved || !result.chargeUid) return;
  const hubStatus = await getSubscriptionHubStatus({
    appId,
    mpPreapprovalId: result.mpPreapprovalId,
  });
  // Misma regla que la tabla de cobros: sin plan, entra; si el plan no está aceptado, no.
  if (hubStatus && hubStatus !== "accepted") return;
  const { notifySubscriptionOnce } = await import("../mail");
  await notifySubscriptionOnce(appId, result.chargeUid, {
    clientName: subscriptionPlanName({
      description: result.description,
      clientName: result.clientName,
    }),
    mpPaymentId: result.mpPaymentId,
    mpPreapprovalId: result.mpPreapprovalId,
    amount: result.amount,
    status: result.status,
    description: result.description,
    kind: result.kind,
    paidAt: result.paidAt,
    source,
  });
}

type UnsentChargeRow = {
  app_id: unknown;
  charge_uid: unknown;
  mp_payment_id: unknown;
  mp_preapproval_id: unknown;
  amount: unknown;
  status: unknown;
  description: unknown;
  kind: unknown;
  paid_at: unknown;
  collector_name: unknown;
  client_name: unknown;
};

async function sendUnsentChargeRows(rows: UnsentChargeRow[], source: string) {
  const { notifySubscriptionOnce } = await import("../mail");
  let sent = 0;
  for (const row of rows) {
    const uid = String(row.charge_uid || "");
    const appId = String(row.app_id || "");
    if (!uid || !appId) continue;
    const result = await notifySubscriptionOnce(appId, uid, {
      clientName: subscriptionPlanName({
        description: row.description != null ? String(row.description) : null,
        clientName: row.client_name != null ? String(row.client_name) : null,
        collectorName: row.collector_name != null ? String(row.collector_name) : null,
      }),
      mpPaymentId: row.mp_payment_id != null ? String(row.mp_payment_id) : null,
      mpPreapprovalId: row.mp_preapproval_id != null ? String(row.mp_preapproval_id) : null,
      amount: Number(row.amount || 0),
      status: row.status != null ? String(row.status) : null,
      description: row.description != null ? String(row.description) : null,
      kind: row.kind != null ? String(row.kind) : null,
      paidAt: row.paid_at != null ? String(row.paid_at) : null,
      source,
    });
    if (result.sent) sent += 1;
  }
  return sent;
}

export async function notifyUnsentChargesForSubscription(
  appId: string,
  subscriptionId: string,
  source = "accept",
) {
  await ensureSubscriptionTables();
  const sql = getSql();
  const rows = await sql`
    SELECT
      c.app_id, c.charge_uid, c.mp_payment_id, c.mp_preapproval_id,
      c.amount::float8 AS amount, c.status, c.description, c.kind, c.paid_at,
      c.collector_name, cl.name AS client_name
    FROM hub_subscription_charges c
    LEFT JOIN hub_clients cl ON cl.app_id = c.app_id AND cl.collector_id = c.collector_id
    WHERE c.app_id = ${appId}::uuid
      AND c.subscription_id = ${subscriptionId}::uuid
      AND c.status = 'approved'
      AND c.amount > 0
      AND c.notified_at IS NULL
      AND COALESCE(c.hidden, FALSE) = FALSE
  `;
  return sendUnsentChargeRows(rows as UnsentChargeRow[], source);
}

export async function notifyUnsentAcceptedCharges(appId?: string) {
  await ensureSubscriptionTables();
  const sql = getSql();
  const app = String(appId || "");
  const rows = await sql`
    SELECT
      c.app_id, c.charge_uid, c.mp_payment_id, c.mp_preapproval_id,
      c.amount::float8 AS amount, c.status, c.description, c.kind, c.paid_at,
      c.collector_name, cl.name AS client_name
    FROM hub_subscription_charges c
    LEFT JOIN hub_subscriptions hs ON hs.id = c.subscription_id
    LEFT JOIN hub_clients cl ON cl.app_id = c.app_id AND cl.collector_id = c.collector_id
    WHERE c.status = 'approved'
      AND c.amount > 0
      AND c.notified_at IS NULL
      AND COALESCE(c.hidden, FALSE) = FALSE
      AND (${app} = '' OR c.app_id::text = ${app})
      AND (
        CASE
          WHEN c.mp_preapproval_id IS NOT NULL AND c.mp_preapproval_id <> '' THEN COALESCE(hs.hub_status, 'pending')
          ELSE COALESCE(hs.hub_status, 'accepted')
        END
      ) = 'accepted'
  `;
  return sendUnsentChargeRows(rows as UnsentChargeRow[], "backfill");
}
