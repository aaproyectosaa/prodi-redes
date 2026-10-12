import { decrypt } from "../crypto";
import { getAppById } from "../apps";
import { getSql } from "../sql";
import { chargeNetAmount, clampMpFeePct } from "../money";
import { detectMpCommission, fetchPayment, type MpPayment } from "../mp";
import {
  chargeUid,
  inferChargeKind,
  num,
  text,
  UUID_RE,
  type ChargeInput,
} from "./contracts";
import { isGenericProdiPlanLabel } from "../subscription-label";
import { resolveClient } from "./client-resolution";
import { ensureSubscriptionTables } from "./schema";

export async function upsertSubscriptionCharge(
  appId: string,
  input: ChargeInput,
  opts?: {
    preferredClientName?: string | null;
    accessToken?: string | null;
  },
) {
  await ensureSubscriptionTables();
  const uid = chargeUid({
    mpPaymentId: input.mpPaymentId,
    mpAuthorizedPaymentId: input.mpAuthorizedPaymentId,
  });
  if (!uid) return { saved: false as const, reason: "sin id de cobro" };

  const sql = getSql();
  const amount = num(input.amount);
  const status = text(input.status) || "unknown";
  const kind = inferChargeKind(input.externalReference, input.kind, null);
  const client = await resolveClient(appId, {
    collectorId: input.collectorId,
    preferredName: opts?.preferredClientName || input.collectorName,
    description: input.description,
    accessToken: opts?.accessToken,
  });
  let subscriptionId: string | null = null;
  const preId = text(input.mpPreapprovalId);
  if (preId) {
    const sub = await sql`
      SELECT id FROM hub_subscriptions
      WHERE app_id = ${appId}::uuid AND mp_preapproval_id = ${preId}
      LIMIT 1
    `;
    subscriptionId = sub[0]?.id ? String(sub[0].id) : null;
  }

  const payId = text(input.mpPaymentId);
  const authId = text(input.mpAuthorizedPaymentId);
  const existing = payId
    ? await sql`
        SELECT id, status, amount::float8 AS amount, notified_at,
          COALESCE(mp_fee_manual, FALSE) AS mp_fee_manual
        FROM hub_subscription_charges
        WHERE app_id = ${appId}::uuid
          AND (charge_uid = ${uid} OR mp_payment_id = ${payId})
        LIMIT 1
      `
    : await sql`
        SELECT id, status, amount::float8 AS amount, notified_at,
          COALESCE(mp_fee_manual, FALSE) AS mp_fee_manual
        FROM hub_subscription_charges
        WHERE app_id = ${appId}::uuid
          AND (charge_uid = ${uid} OR mp_authorized_payment_id = ${authId})
        LIMIT 1
      `;
  const isNew = !existing[0];
  const previousStatus = String(existing[0]?.status || "");
  const raw = input.raw != null ? JSON.stringify(input.raw) : null;
  const detected = detectMpCommission(input.raw, amount);
  const autoPct = detected ? detected.pct : null;
  const autoNet = detected ? detected.net : null;
  const namedByClient = Boolean(String(opts?.preferredClientName || "").trim());
  const hideGeneric = !namedByClient && isGenericProdiPlanLabel(input.description);

  if (existing[0]) {
    await sql`
      UPDATE hub_subscription_charges SET
        subscription_id = COALESCE(${subscriptionId}::uuid, subscription_id),
        mp_payment_id = COALESCE(${text(input.mpPaymentId)}, mp_payment_id),
        mp_authorized_payment_id = COALESCE(${text(input.mpAuthorizedPaymentId)}, mp_authorized_payment_id),
        mp_preapproval_id = COALESCE(${preId}, mp_preapproval_id),
        status = ${status},
        amount = CASE WHEN ${amount} > 0 THEN ${amount} ELSE amount END,
        currency = COALESCE(${text(input.currency)}, currency),
        kind = ${kind},
        collector_id = COALESCE(${client.collectorId}, collector_id),
        collector_name = COALESCE(${client.collectorName}, collector_name),
        payer_email = COALESCE(${text(input.payerEmail)}, payer_email),
        description = COALESCE(${text(input.description)}, description),
        external_reference = COALESCE(${text(input.externalReference)}, external_reference),
        paid_at = COALESCE(${text(input.paidAt)}, paid_at),
        raw_json = COALESCE(${raw}::jsonb, raw_json),
        mp_fee_pct = CASE
          WHEN mp_fee_manual OR ${autoPct}::numeric IS NULL THEN mp_fee_pct
          ELSE ${autoPct}::numeric
        END,
        mp_net_amount = CASE
          WHEN mp_fee_manual OR ${autoNet}::numeric IS NULL THEN mp_net_amount
          ELSE ${autoNet}::numeric
        END,
        hidden = CASE
          WHEN ${namedByClient} THEN FALSE
          WHEN ${hideGeneric} THEN TRUE
          ELSE hidden
        END,
        updated_at = NOW()
      WHERE id = ${String(existing[0].id)}::uuid
    `;
  } else {
    await sql`
      INSERT INTO hub_subscription_charges (
        app_id, subscription_id, charge_uid, mp_payment_id, mp_authorized_payment_id,
        mp_preapproval_id, status, amount, currency, kind, collector_id, collector_name,
        payer_email, description, external_reference, paid_at, raw_json,
        mp_fee_pct, mp_net_amount, mp_fee_manual, hidden, updated_at
      ) VALUES (
        ${appId}::uuid, ${subscriptionId}::uuid, ${uid}, ${text(input.mpPaymentId)},
        ${text(input.mpAuthorizedPaymentId)}, ${preId}, ${status}, ${amount},
        ${text(input.currency) || "ARS"}, ${kind}, ${client.collectorId}, ${client.collectorName},
        ${text(input.payerEmail)}, ${text(input.description)}, ${text(input.externalReference)},
        ${text(input.paidAt)}, ${raw}::jsonb,
        ${autoPct ?? 0}, ${autoNet}, FALSE, ${hideGeneric}, NOW()
      )
      ON CONFLICT (app_id, charge_uid) DO UPDATE SET
        status = EXCLUDED.status,
        amount = CASE WHEN EXCLUDED.amount > 0 THEN EXCLUDED.amount ELSE hub_subscription_charges.amount END,
        collector_id = COALESCE(EXCLUDED.collector_id, hub_subscription_charges.collector_id),
        collector_name = COALESCE(EXCLUDED.collector_name, hub_subscription_charges.collector_name),
        payer_email = COALESCE(EXCLUDED.payer_email, hub_subscription_charges.payer_email),
        description = COALESCE(EXCLUDED.description, hub_subscription_charges.description),
        paid_at = COALESCE(EXCLUDED.paid_at, hub_subscription_charges.paid_at),
        raw_json = COALESCE(EXCLUDED.raw_json, hub_subscription_charges.raw_json),
        mp_fee_pct = CASE
          WHEN hub_subscription_charges.mp_fee_manual THEN hub_subscription_charges.mp_fee_pct
          WHEN ${autoPct}::numeric IS NULL THEN hub_subscription_charges.mp_fee_pct
          ELSE EXCLUDED.mp_fee_pct
        END,
        mp_net_amount = CASE
          WHEN hub_subscription_charges.mp_fee_manual THEN hub_subscription_charges.mp_net_amount
          WHEN ${autoNet}::numeric IS NULL THEN hub_subscription_charges.mp_net_amount
          ELSE EXCLUDED.mp_net_amount
        END,
        hidden = CASE
          WHEN ${namedByClient} THEN FALSE
          WHEN ${hideGeneric} THEN TRUE
          ELSE hub_subscription_charges.hidden
        END,
        updated_at = NOW()
    `;
  }

  const approvedNow = status === "approved" && amount > 0;
  const newlyApproved = approvedNow && (isNew || previousStatus !== "approved");
  return {
    saved: true as const,
    isNew,
    newlyApproved,
    chargeUid: uid,
    mpPaymentId: text(input.mpPaymentId),
    mpPreapprovalId: text(input.mpPreapprovalId),
    amount,
    status,
    kind,
    description: text(input.description),
    paidAt: text(input.paidAt),
    clientName: client.collectorName,
    collectorId: client.collectorId,
  };
}

export async function setChargesMpFeePct(ids: string[], pct: number) {
  await ensureSubscriptionTables();
  const sql = getSql();
  const feePct = clampMpFeePct(pct);
  const uniq = [
    ...new Set(ids.map((id) => String(id || "").trim()).filter((id) => UUID_RE.test(id))),
  ];
  const updated: Array<{ id: string; amount: number; mp_fee_pct: number; mp_net_amount: number }> = [];
  for (const id of uniq) {
    const rows = await sql`
      SELECT amount::float8 AS amount FROM hub_subscription_charges
      WHERE id = ${id}::uuid LIMIT 1
    `;
    if (!rows[0]) continue;
    const amount = Number(rows[0].amount || 0);
    const net = chargeNetAmount(amount, feePct);
    const saved = await sql`
      UPDATE hub_subscription_charges
      SET mp_fee_pct = ${feePct}, mp_net_amount = ${net}, mp_fee_manual = TRUE, updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING id, amount::float8 AS amount, mp_fee_pct::float8 AS mp_fee_pct,
        mp_net_amount::float8 AS mp_net_amount
    `;
    if (saved[0]) updated.push({
      id: String(saved[0].id),
      amount: Number(saved[0].amount || 0),
      mp_fee_pct: Number(saved[0].mp_fee_pct || 0),
      mp_net_amount: Number(saved[0].mp_net_amount || 0),
    });
  }
  return updated;
}

export async function setChargeMpNetAmount(id: string, netRaw: number) {
  await ensureSubscriptionTables();
  const sql = getSql();
  if (!UUID_RE.test(id)) return null;
  const rows = await sql`
    SELECT amount::float8 AS amount FROM hub_subscription_charges
    WHERE id = ${id}::uuid LIMIT 1
  `;
  if (!rows[0]) return null;
  const amount = Number(rows[0].amount || 0);
  const net = Math.round(
    Math.min(Math.max(Number(netRaw) || 0, 0), amount > 0 ? amount : Number(netRaw) || 0) * 100,
  ) / 100;
  const pct = amount > 0 ? clampMpFeePct((1 - net / amount) * 100) : 0;
  const saved = await sql`
    UPDATE hub_subscription_charges
    SET mp_fee_pct = ${pct}, mp_net_amount = ${net}, mp_fee_manual = TRUE, updated_at = NOW()
    WHERE id = ${id}::uuid
    RETURNING id, amount::float8 AS amount, mp_fee_pct::float8 AS mp_fee_pct,
      mp_net_amount::float8 AS mp_net_amount
  `;
  return saved[0] ? {
    id: String(saved[0].id), amount: Number(saved[0].amount || 0),
    mp_fee_pct: Number(saved[0].mp_fee_pct || 0), mp_net_amount: Number(saved[0].mp_net_amount || 0),
  } : null;
}

export async function resetChargeMpFeeAuto(id: string) {
  await ensureSubscriptionTables();
  const sql = getSql();
  if (!UUID_RE.test(id)) return { ok: false as const, reason: "id inválido" };
  const rows = await sql`
    SELECT amount::float8 AS amount, raw_json, app_id, mp_payment_id
    FROM hub_subscription_charges WHERE id = ${id}::uuid LIMIT 1
  `;
  if (!rows[0]) return { ok: false as const, reason: "no encontrado" };
  const amount = Number(rows[0].amount || 0);
  let raw: unknown = rows[0].raw_json;
  let detected = detectMpCommission(raw, amount);
  const payId = rows[0].mp_payment_id ? String(rows[0].mp_payment_id) : "";
  if (!detected && payId && /^\d+$/.test(payId)) {
    try {
      const app = await getAppById(String(rows[0].app_id));
      const token = app ? decrypt(app.access_token) : "";
      if (token) {
        const detail = await fetchPayment(token, payId);
        if (detail.ok && detail.data?.id) {
          raw = detail.data;
          detected = detectMpCommission(raw, amount);
        }
      }
    } catch (e) {
      console.warn("[subscriptions] detect mp fee", e);
    }
  }
  const pct = detected ? detected.pct : 0;
  const net = detected ? detected.net : null;
  const rawJson = raw != null ? JSON.stringify(raw) : null;
  await sql`
    UPDATE hub_subscription_charges
    SET mp_fee_pct = ${pct}, mp_net_amount = ${net}, mp_fee_manual = FALSE,
      raw_json = COALESCE(${rawJson}::jsonb, raw_json), updated_at = NOW()
    WHERE id = ${id}::uuid
  `;
  return { ok: true as const, detected: Boolean(detected), mp_fee_pct: pct, mp_net_amount: net };
}

export async function upsertSubscriptionChargeFromMp(
  appId: string,
  payment: MpPayment,
  opts?: {
    preferredClientName?: string | null;
    accessToken?: string | null;
    kind?: string | null;
    mpPreapprovalId?: string | null;
    mpAuthorizedPaymentId?: string | null;
  },
) {
  const meta = payment.metadata || {};
  const preFromMeta = opts?.mpPreapprovalId || text(meta.preapproval_id) || text(meta.subscription_id);
  const collectorRaw = payment.collector_id != null ? String(payment.collector_id) : payment.collector?.id != null ? String(payment.collector.id) : null;
  return upsertSubscriptionCharge(appId, {
    mpPaymentId: String(payment.id), mpAuthorizedPaymentId: opts?.mpAuthorizedPaymentId,
    mpPreapprovalId: preFromMeta, status: payment.status || "unknown",
    amount: num(payment.transaction_amount), currency: payment.currency_id || "ARS",
    kind: inferChargeKind(payment.external_reference, opts?.kind, payment.operation_type),
    collectorId: collectorRaw, payerEmail: payment.payer?.email || null,
    description: payment.description || null, externalReference: payment.external_reference || null,
    paidAt: payment.date_approved || payment.date_created || null, raw: payment,
  }, { preferredClientName: opts?.preferredClientName, accessToken: opts?.accessToken });
}
