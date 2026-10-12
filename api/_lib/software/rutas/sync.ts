import { NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { decrypt, listApps, upsertPaymentFromMp } from "../apps";
import { backfillClientsFromPayments } from "../clients";
import { getSql } from "../sql";
import { RETRY_DAYS, retryPendingFees } from "../fee-retry";
import { collectMarketplacePayments, collectPreapprovals } from "../mp";
import {
  maybeNotifyCharge,
  notifyUnsentAcceptedCharges,
  syncAuthorizedPaymentsForApp,
  upsertSubscriptionChargeFromMp,
  upsertSubscriptionFromMp,
} from "../subscriptions";

export async function POST() {
  if (!(await requireSession())) return unauthorized();

  const apps = await listApps();
  let imported = 0;
  let skipped = 0;
  let searched = 0;
  let importedSubs = 0;
  let feeRecovered = 0;
  let feeChecked = 0;
  const errors: string[] = [];

  const end = new Date();
  const begin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const beginIso = begin.toISOString();
  const endIso = end.toISOString();

  for (const app of apps) {
    const token = decrypt(app.access_token);
    if (!token) {
      errors.push(`${app.name}: sin token`);
      continue;
    }

    const sql = getSql();
    const clients = await sql`
      SELECT collector_id FROM hub_clients
      WHERE app_id = ${app.id}
        AND collector_id IS NOT NULL
        AND collector_id <> ''
        AND collector_id NOT LIKE 'slug:%'
    `;
    const collectorIds = clients.map((c) => String(c.collector_id));

    try {
      const result = await collectMarketplacePayments(token, {
        begin: beginIso,
        end: endIso,
        collectorIds,
      });
      searched += result.searched;
      skipped += result.skipped;
      for (const p of result.payments) {
        await upsertPaymentFromMp(app.id, p, { accessToken: token });
        imported++;
      }
      for (const p of result.subscriptionPayments || []) {
        const saved = await upsertSubscriptionChargeFromMp(app.id, p, {
          accessToken: token,
        });
        if (saved.saved) {
          importedSubs++;
          await maybeNotifyCharge(app.id, saved, "sync");
        }
      }
      try {
        const pres = await collectPreapprovals(token);
        for (const pre of pres) {
          await upsertSubscriptionFromMp(app.id, pre, { accessToken: token });
        }
        const authSync = await syncAuthorizedPaymentsForApp(app.id, token);
        importedSubs += authSync.imported;
        await notifyUnsentAcceptedCharges(app.id);
      } catch (subErr) {
        errors.push(
          `${app.name} suscripciones: ${
            subErr instanceof Error ? subErr.message : "error"
          }`,
        );
      }

      // Reintenta fees pendientes de TODOS los clientes de esta app
      const retry = await retryPendingFees(app.id, token, { days: RETRY_DAYS });
      feeChecked += retry.checked;
      feeRecovered += retry.recovered;

      await sql`UPDATE hub_mp_apps SET last_sync_at = NOW(), updated_at = NOW() WHERE id = ${app.id}`;
      // Solo borrar fee=0 viejos; los recientes (pending_fee) se conservan para reintento
      await sql`
        DELETE FROM hub_payments
        WHERE app_id = ${app.id}
          AND (fee IS NULL OR fee <= 0)
          AND COALESCE(paid_at, created_at) < NOW() - (${RETRY_DAYS}::text || ' days')::interval
      `;
    } catch (e) {
      errors.push(
        `${app.name}: ${e instanceof Error ? e.message : "error de sync"}`,
      );
    }
  }

  const backfill = await backfillClientsFromPayments();
  await logActivity(
    "sync",
    `Actualizado desde Mercado Pago: ${imported} pagos nuevos con comisión · ${importedSubs} planes mensuales · ${feeRecovered} comisiones recuperadas · ${backfill.clientsTotal} clientes`,
    {
      imported,
      importedSubs,
      skipped,
      searched,
      feeChecked,
      feeRecovered,
      errors,
      clientsTotal: backfill.clientsTotal,
    },
  );

  return NextResponse.json({
    ok: true,
    imported,
    importedSubs,
    skipped,
    searched,
    feeChecked,
    feeRecovered,
    clientsTotal: backfill.clientsTotal,
    errors,
  });
}
