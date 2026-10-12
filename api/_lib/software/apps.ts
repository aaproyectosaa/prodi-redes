import { getSql } from "./sql";
import { decrypt, encrypt, maskSecret } from "./crypto";
import { extractFee, type MpPayment } from "./mp";
import type { MpApp, MpAppPublic } from "./types";

export function toPublicApp(row: MpApp): MpAppPublic {
  const secret = decrypt(row.client_secret);
  const token = decrypt(row.access_token);
  return {
    id: row.id,
    name: row.name,
    client_id: row.client_id,
    public_key: row.public_key,
    webhook_status: row.webhook_status,
    mp_user_id: row.mp_user_id,
    mp_nickname: row.mp_nickname,
    connection_status: row.connection_status,
    connection_error: row.connection_error,
    last_webhook_at: row.last_webhook_at,
    last_sync_at: row.last_sync_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_client_secret: !!secret,
    has_access_token: !!token,
    has_webhook_secret: !!decrypt(row.webhook_secret),
    client_secret_masked: maskSecret(secret),
    access_token_masked: maskSecret(token),
  };
}

export async function getAppById(id: string) {
  const sql = getSql();
  const rows = await sql`SELECT * FROM hub_mp_apps WHERE id = ${id} LIMIT 1`;
  return (rows[0] as MpApp) || null;
}

export async function listApps() {
  const sql = getSql();
  const rows = await sql`SELECT * FROM hub_mp_apps ORDER BY created_at DESC`;
  return rows as MpApp[];
}

export async function upsertPaymentFromMp(
  appId: string,
  payment: MpPayment,
  opts?: {
    preferredClientName?: string | null;
    accessToken?: string | null;
  },
) {
  const sql = getSql();
  const mpId = String(payment.id);
  const amount = Number(payment.transaction_amount || 0);
  const fee = extractFee(payment);
  // Si MP todavía no liquidó application_fee, lo guardamos pendiente para reintentar.
  const rawStatus = payment.status || "unknown";
  const status =
    fee <= 0 && rawStatus === "approved" ? "pending_fee" : rawStatus;
  const currency = payment.currency_id || "ARS";
  const paidAt = payment.date_approved || payment.date_created || null;
  const payerEmail = payment.payer?.email || null;
  const description = payment.description || null;
  const raw = JSON.stringify(payment);

  const existing = await sql`
    SELECT id, fee::float8 AS fee FROM hub_payments
    WHERE app_id = ${appId} AND mp_payment_id = ${mpId}
    LIMIT 1
  `;
  const isNew = !existing[0];
  const previousFee = Number(existing[0]?.fee || 0);

  const {
    clientRefFromMpPayment,
    ensureClient,
    matchClientByDescription,
    sellerNameFromDescription,
    slugClientKey,
    isPosLikeLabel,
  } = await import("./clients");

  const preferredRaw = String(opts?.preferredClientName || "").trim() || null;
  const preferred =
    preferredRaw && !isPosLikeLabel(preferredRaw) ? preferredRaw : null;

  const ref = clientRefFromMpPayment(payment, preferred);
  let clientKey: string | null = null;
  let collectorName: string | null = null;

  if (ref) {
    clientKey = ref.key;
    let suggested = ref.suggestedName;
    if (
      opts?.accessToken &&
      (/^cliente\s+\d+$/i.test(suggested) || !suggested)
    ) {
      const { fetchCollectorDisplayName } = await import("./mp");
      const nick = await fetchCollectorDisplayName(opts.accessToken, ref.key);
      if (nick) suggested = nick;
    }
    if (preferred) suggested = preferred;
    collectorName = await ensureClient(appId, ref.key, suggested);
  } else {
    const byName = await matchClientByDescription(
      appId,
      preferred ? `Producto de ${preferred}` : description,
    );
    if (byName) {
      clientKey = byName.key;
      collectorName = preferred || byName.name;
      if (preferred) await ensureClient(appId, byName.key, preferred);
    } else {
      const collectorRaw =
        payment.collector_id != null
          ? String(payment.collector_id)
          : payment.collector &&
              typeof payment.collector === "object" &&
              (payment.collector as { id?: unknown }).id != null
            ? String((payment.collector as { id: string | number }).id)
            : null;

      if (collectorRaw && !collectorRaw.startsWith("slug:")) {
        clientKey = collectorRaw;
        let suggested =
          preferred ||
          sellerNameFromDescription(description) ||
          `Cliente ${collectorRaw}`;
        if (opts?.accessToken && /^cliente\s+\d+$/i.test(suggested)) {
          const { fetchCollectorDisplayName } = await import("./mp");
          const nick = await fetchCollectorDisplayName(
            opts.accessToken,
            collectorRaw,
          );
          if (nick) suggested = nick;
        }
        collectorName = await ensureClient(appId, clientKey, suggested);
      } else {
        // Sin collector_id: usar nombre de página (slug estable por tienda)
        const pageName =
          preferred || sellerNameFromDescription(description) || null;
        if (pageName) {
          const slug = slugClientKey(pageName);
          if (slug) {
            clientKey = slug;
            collectorName = await ensureClient(appId, slug, pageName);
          }
        }
      }
    }
  }

  await sql`
    INSERT INTO hub_payments (
      app_id, mp_payment_id, status, amount, fee, currency,
      collector_id, collector_name, payer_email, description, paid_at, raw_json, updated_at
    ) VALUES (
      ${appId}, ${mpId}, ${status}, ${amount}, ${fee}, ${currency},
      ${clientKey}, ${collectorName}, ${payerEmail}, ${description}, ${paidAt}, ${raw}::jsonb, NOW()
    )
    ON CONFLICT (app_id, mp_payment_id) DO UPDATE SET
      status = EXCLUDED.status,
      amount = EXCLUDED.amount,
      fee = EXCLUDED.fee,
      currency = EXCLUDED.currency,
      collector_id = COALESCE(EXCLUDED.collector_id, hub_payments.collector_id),
      collector_name = COALESCE(EXCLUDED.collector_name, hub_payments.collector_name),
      payer_email = EXCLUDED.payer_email,
      description = EXCLUDED.description,
      paid_at = EXCLUDED.paid_at,
      raw_json = EXCLUDED.raw_json,
      updated_at = NOW()
  `;

  return {
    isNew,
    feeRecovered: !isNew && previousFee <= 0 && fee > 0,
    mpPaymentId: mpId,
    amount,
    fee,
    status,
    description,
    paidAt,
    clientName: collectorName,
    collectorId: clientKey,
  };
}

export { encrypt, decrypt };
