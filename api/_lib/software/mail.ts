import { getSql } from "./sql";
import { enviarMail } from "../informe";
import { adminDb } from "../db";
import { money } from "./money";

export type FeeMailPayload = {
  clientName: string | null;
  mpPaymentId: string;
  amount: number;
  fee: number;
  status?: string | null;
  description?: string | null;
  posCode?: string | null;
  paidAt?: string | null;
  source?: string;
};

function smtpConfigured() {
  return !!process.env.RESEND_API_KEY?.trim();
}

/** Destinatarios de los avisos (fees y suscripciones): el admin y administración (o SOFTWARE_AVISOS_MAIL, separados por coma). */
async function notifyRecipients(): Promise<string[]> {
  const env = (process.env.SOFTWARE_AVISOS_MAIL ?? "").split(/[,;]/).map((e) => e.trim()).filter((e) => e.includes("@"));
  if (env.length) return env;
  const perfiles = await adminDb().collection("profiles").where("role", "in", ["admin", "administracion"]).get();
  return [...new Set(perfiles.docs.filter((d) => d.data().activo !== false).map((d) => String(d.data().email ?? "")).filter((e) => e.includes("@")))];
}

function formatPaidAt(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
    });
  } catch {
    return iso;
  }
}

let ensuredNotifiedCol = false;
async function ensureFeeNotifiedColumn() {
  if (ensuredNotifiedCol) return;
  const sql = getSql();
  await sql`
    ALTER TABLE hub_payments
    ADD COLUMN IF NOT EXISTS fee_notified_at TIMESTAMPTZ
  `.catch(() => undefined);
  ensuredNotifiedCol = true;
}

/**
 * Reserva el aviso de este pago. Solo un caller gana (ingest vs webhook vs sync).
 */
export async function claimFeeNotification(
  appId: string,
  mpPaymentId: string,
) {
  await ensureFeeNotifiedColumn();
  const sql = getSql();
  const rows = await sql`
    UPDATE hub_payments
    SET fee_notified_at = NOW()
    WHERE app_id = ${appId}::uuid
      AND mp_payment_id = ${mpPaymentId}
      AND fee > 0
      AND fee_notified_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

/** Aviso de fee nuevo, una sola vez por pago (aunque lleguen ingest + webhook + sync). */
export async function notifyFeeOnce(
  appId: string,
  payload: FeeMailPayload,
) {
  if (!payload.mpPaymentId || !(payload.fee > 0)) {
    return { sent: false as const, reason: "sin fee" };
  }
  const claimed = await claimFeeNotification(appId, payload.mpPaymentId);
  if (!claimed) {
    return { sent: false as const, reason: "ya notificado" };
  }
  return sendFeeNotification(payload);
}

/** Aviso de fee nuevo. No lanza: falla en log y sigue el cobro. */
export async function sendFeeNotification(payload: FeeMailPayload) {
  if (!smtpConfigured()) {
    console.warn("mail: falta RESEND_API_KEY — aviso omitido");
    return { sent: false as const, reason: "sin smtp" };
  }

  const to = await notifyRecipients();
  const client = payload.clientName || "Sin cliente";
  const subject = `Fee ${money(payload.fee)} · ${client}`;

  const lines = [
    `Nuevo fee acreditado en Prodi Software`,
    ``,
    `Cliente: ${client}`,
    `Monto venta: ${money(payload.amount)}`,
    `Fee: ${money(payload.fee)}`,
    `Pago MP: ${payload.mpPaymentId}`,
    `Estado: ${payload.status || "—"}`,
    `Descripción: ${payload.description || "—"}`,
    `Código POS: ${payload.posCode || "—"}`,
    `Fecha: ${formatPaidAt(payload.paidAt)}`,
    `Origen: ${payload.source || "—"}`,
  ];

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">Nuevo fee acreditado</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Cliente</td><td><strong>${escapeHtml(client)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Monto venta</td><td>${escapeHtml(money(payload.amount))}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Fee</td><td><strong>${escapeHtml(money(payload.fee))}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Pago MP</td><td>${escapeHtml(payload.mpPaymentId)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Estado</td><td>${escapeHtml(payload.status || "—")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Descripción</td><td>${escapeHtml(payload.description || "—")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Código POS</td><td>${escapeHtml(payload.posCode || "—")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Fecha</td><td>${escapeHtml(formatPaidAt(payload.paidAt))}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Origen</td><td>${escapeHtml(payload.source || "—")}</td></tr>
      </table>
    </div>
  `;

  try {
    await enviarMail(to, subject, html);
    return { sent: true as const };
  } catch (e) {
    console.error("mail: error enviando aviso", e);
    return {
      sent: false as const,
      reason: e instanceof Error ? e.message : "error smtp",
    };
  }
}

export type SubscriptionMailPayload = {
  clientName: string | null;
  mpPaymentId?: string | null;
  mpPreapprovalId?: string | null;
  amount: number;
  status?: string | null;
  description?: string | null;
  kind?: string | null;
  paidAt?: string | null;
  source?: string;
};

let ensuredSubNotifiedCol = false;
async function ensureSubscriptionNotifiedColumn() {
  if (ensuredSubNotifiedCol) return;
  const sql = getSql();
  await sql`
    ALTER TABLE hub_subscription_charges
    ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ
  `.catch(() => undefined);
  ensuredSubNotifiedCol = true;
}

export async function claimSubscriptionNotification(
  appId: string,
  chargeUid: string,
) {
  await ensureSubscriptionNotifiedColumn();
  const sql = getSql();
  const rows = await sql`
    UPDATE hub_subscription_charges
    SET notified_at = NOW()
    WHERE app_id = ${appId}::uuid
      AND charge_uid = ${chargeUid}
      AND amount > 0
      AND status = 'approved'
      AND notified_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function notifySubscriptionOnce(
  appId: string,
  chargeUid: string,
  payload: SubscriptionMailPayload,
) {
  if (!(payload.amount > 0)) {
    return { sent: false as const, reason: "sin monto" };
  }
  const claimed = await claimSubscriptionNotification(appId, chargeUid);
  if (!claimed) {
    return { sent: false as const, reason: "ya notificado" };
  }
  return sendSubscriptionNotification(payload);
}

export async function sendSubscriptionNotification(
  payload: SubscriptionMailPayload,
) {
  if (!smtpConfigured()) {
    console.warn("mail: falta RESEND_API_KEY — aviso omitido");
    return { sent: false as const, reason: "sin smtp" };
  }

  const to = await notifyRecipients();
  const client = payload.clientName || "Sin cliente";
  const kind =
    payload.kind === "checkout"
      ? "alta"
      : payload.kind === "authorized"
        ? "autorización"
        : "cuota";
  const subject = `Suscripción pagada ${money(payload.amount)} · ${client}`;

  const lines = [
    `Suscripción pagada en Prodi Software`,
    ``,
    `Cliente: ${client}`,
    `Monto: ${money(payload.amount)}`,
    `Tipo: ${kind}`,
    `Pago MP: ${payload.mpPaymentId || "—"}`,
    `Preapproval: ${payload.mpPreapprovalId || "—"}`,
    `Estado: ${payload.status || "—"}`,
    `Descripción: ${payload.description || "—"}`,
    `Fecha: ${formatPaidAt(payload.paidAt)}`,
    `Origen: ${payload.source || "—"}`,
  ];

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">Suscripción pagada</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Cliente</td><td><strong>${escapeHtml(client)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Monto</td><td><strong>${escapeHtml(money(payload.amount))}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Tipo</td><td>${escapeHtml(kind)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Pago MP</td><td>${escapeHtml(payload.mpPaymentId || "—")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Preapproval</td><td>${escapeHtml(payload.mpPreapprovalId || "—")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Estado</td><td>${escapeHtml(payload.status || "—")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Descripción</td><td>${escapeHtml(payload.description || "—")}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Fecha</td><td>${escapeHtml(formatPaidAt(payload.paidAt))}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Origen</td><td>${escapeHtml(payload.source || "—")}</td></tr>
      </table>
    </div>
  `;

  try {
    await enviarMail(to, subject, html);
    return { sent: true as const };
  } catch (e) {
    console.error("mail: error enviando aviso de suscripción", e);
    return {
      sent: false as const,
      reason: e instanceof Error ? e.message : "error smtp",
    };
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
