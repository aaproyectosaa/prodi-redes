import { getSql } from "./sql";
import { upsertPaymentFromMp } from "./apps";
import { extractFee, fetchPayment } from "./mp";

const PENDING_STATUS = "pending_fee";
const RETRY_DAYS = 14;

/**
 * Reconsulta en MP los pagos guardados sin fee (pending_fee / fee<=0 recientes)
 * y actualiza si ya liquidaron application_fee. Sirve para todos los clientes.
 */
export async function retryPendingFees(
  appId: string,
  accessToken: string,
  opts?: { days?: number; limit?: number },
) {
  const days = Math.min(Math.max(Number(opts?.days || RETRY_DAYS), 1), 60);
  const limit = Math.min(Math.max(Number(opts?.limit || 80), 1), 200);
  const sql = getSql();

  const pending = await sql`
    SELECT mp_payment_id::text AS id, fee::float8 AS fee, status
    FROM hub_payments
    WHERE app_id = ${appId}
      AND (
        status = ${PENDING_STATUS}
        OR (fee IS NULL OR fee <= 0)
      )
      AND COALESCE(paid_at, created_at) >= NOW() - (${days}::text || ' days')::interval
      AND mp_payment_id ~ '^[0-9]{6,}$'
    ORDER BY COALESCE(paid_at, created_at) DESC
    LIMIT ${limit}
  `;

  let checked = 0;
  let recovered = 0;
  let stillPending = 0;
  const recoveredIds: string[] = [];

  for (const row of pending) {
    const mpId = String(row.id || "").trim();
    if (!mpId) continue;
    checked++;

    const { ok, data } = await fetchPayment(accessToken, mpId);
    if (!ok || !data?.id) {
      stillPending++;
      continue;
    }

    const fee = extractFee(data);
    if (fee <= 0 || data.status !== "approved") {
      // Mantener pendiente para un próximo sync
      await upsertPaymentFromMp(appId, data, { accessToken });
      stillPending++;
      continue;
    }

    const beforeFee = Number(row.fee || 0);
    const saved = await upsertPaymentFromMp(appId, data, { accessToken });
    if (saved.fee > 0 && beforeFee <= 0) {
      recovered++;
      recoveredIds.push(mpId);
      if (saved.isNew || beforeFee <= 0) {
        try {
          const { notifyFeeOnce } = await import("./mail");
          await notifyFeeOnce(appId, {
            clientName: saved.clientName,
            mpPaymentId: saved.mpPaymentId,
            amount: saved.amount,
            fee: saved.fee,
            status: saved.status,
            description: saved.description,
            paidAt: saved.paidAt,
            source: "fee-retry",
          });
        } catch {
          // mail opcional
        }
      }
    } else {
      stillPending++;
    }
  }

  return { checked, recovered, stillPending, recoveredIds, days };
}

export { PENDING_STATUS, RETRY_DAYS };
