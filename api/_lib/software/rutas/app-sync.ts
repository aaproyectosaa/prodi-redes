import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { decrypt, getAppById, upsertPaymentFromMp } from "../apps";
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

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const app = await getAppById(id);
  if (!app) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const token = decrypt(app.access_token);
  if (!token) {
    return NextResponse.json(
      { error: "Falta Access Token para sincronizar" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const days = Math.min(Number(body.days || 30), 90);
  const purgeOthers = body.purgeOthers !== false;

  const end = new Date();
  const begin = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const beginIso = begin.toISOString();
  const endIso = end.toISOString();

  const sql = getSql();
  const clients = await sql`
    SELECT collector_id FROM hub_clients
    WHERE app_id = ${id}
      AND collector_id IS NOT NULL
      AND collector_id <> ''
      AND collector_id NOT LIKE 'slug:%'
  `;
  const collectorIds = clients.map((c) => String(c.collector_id));

  const { payments, subscriptionPayments, skipped, searched, uniqueIds } =
    await collectMarketplacePayments(token, {
      begin: beginIso,
      end: endIso,
      collectorIds,
    });

  let imported = 0;
  for (const p of payments) {
    await upsertPaymentFromMp(id, p, { accessToken: token });
    imported++;
  }

  let importedSubs = 0;
  for (const p of subscriptionPayments || []) {
    const saved = await upsertSubscriptionChargeFromMp(id, p, {
      accessToken: token,
    });
    if (saved.saved) {
      importedSubs++;
      await maybeNotifyCharge(id, saved, "sync");
    }
  }
  try {
    const pres = await collectPreapprovals(token);
    for (const pre of pres) {
      await upsertSubscriptionFromMp(id, pre, { accessToken: token });
    }
    const authSync = await syncAuthorizedPaymentsForApp(id, token);
    importedSubs += authSync.imported;
    await notifyUnsentAcceptedCharges(id);
  } catch (e) {
    console.warn("[sync] suscripciones", e);
  }

  const retry = await retryPendingFees(id, token, {
    days: Math.min(days, RETRY_DAYS),
  });

  let purged = 0;
  if (purgeOthers) {
    const del = await sql`
      DELETE FROM hub_payments
      WHERE app_id = ${id}
        AND (fee IS NULL OR fee <= 0)
        AND COALESCE(paid_at, created_at) < NOW() - (${RETRY_DAYS}::text || ' days')::interval
      RETURNING id
    `;
    purged = del.length;
  }

  await sql`UPDATE hub_mp_apps SET last_sync_at = NOW(), updated_at = NOW() WHERE id = ${id}`;

  const { backfillClientsFromPayments } = await import("../clients");
  const backfill = await backfillClientsFromPayments();

  await logActivity(
    "sync",
    `Sync ${app.name}: ${imported} pagos · ${importedSubs} suscripciones · ${retry.recovered} fees recuperados · ${backfill.clientsTotal} clientes`,
    {
      appId: id,
      imported,
      importedSubs,
      skipped,
      purged,
      searched,
      uniqueIds,
      collectors: collectorIds.length,
      feeChecked: retry.checked,
      feeRecovered: retry.recovered,
      clientsTotal: backfill.clientsTotal,
    },
  );

  return NextResponse.json({
    ok: true,
    imported,
    importedSubs,
    skipped,
    purged,
    searched,
    uniqueIds,
    collectors: collectorIds.length,
    feeChecked: retry.checked,
    feeRecovered: retry.recovered,
    clientsTotal: backfill.clientsTotal,
    paymentsLinked: backfill.paymentsLinked,
    days,
  });
}
