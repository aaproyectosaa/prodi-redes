import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getSql } from "../sql";
import { ensureSubscriptionTables } from "../subscriptions";
import { subscriptionPlanName } from "../subscription-label";

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  await ensureSubscriptionTables();
  const sp = req.nextUrl.searchParams;
  const appId = sp.get("appId") || "";
  const clientId = sp.get("clientId") || "";
  const collectorId = sp.get("collectorId") || "";
  const status = sp.get("status") || "";
  const kind = sp.get("kind") || "";
  const q = sp.get("q") || "";
  const fromRaw = sp.get("from") || "";
  const toRaw = sp.get("to") || "";
  const fromDate = fromRaw ? `${fromRaw}T00:00:00-03:00` : null;
  const toDate = toRaw ? `${toRaw}T23:59:59.999-03:00` : null;
  const qLike = q ? `%${q}%` : null;

  const sql = getSql();

  let filterCollector = collectorId;
  if (clientId) {
    const c = await sql`
      SELECT collector_id FROM hub_clients WHERE id = ${clientId} LIMIT 1
    `;
    filterCollector = String(c[0]?.collector_id || filterCollector || "");
  }

  const rows = await sql`
    SELECT
      COALESCE(c.paid_at, c.created_at) AS fecha,
      a.name AS app,
      COALESCE(cl.name, c.collector_name, '') AS cliente,
      c.collector_id,
      c.description,
      c.kind,
      c.status,
      c.amount::float8 AS amount,
      COALESCE(c.mp_fee_pct, 0)::float8 AS mp_fee_pct,
      c.mp_net_amount::float8 AS mp_net_amount,
      COALESCE(c.mp_fee_manual, FALSE) AS mp_fee_manual,
      CASE
        WHEN c.mp_net_amount IS NOT NULL THEN c.mp_net_amount
        ELSE ROUND((c.amount * (1 - COALESCE(c.mp_fee_pct, 0) / 100.0))::numeric, 2)
      END::float8 AS net_amount,
      c.mp_payment_id,
      c.mp_preapproval_id,
      c.mp_authorized_payment_id,
      c.external_reference,
      c.payer_email
    FROM hub_subscription_charges c
    JOIN hub_mp_apps a ON a.id = c.app_id
    LEFT JOIN hub_clients cl
      ON cl.app_id = c.app_id AND cl.collector_id = c.collector_id
    LEFT JOIN hub_subscriptions hs ON hs.id = c.subscription_id
    WHERE
      (${appId} = '' OR c.app_id::text = ${appId})
      AND (${status} = '' OR c.status = ${status})
      AND (${kind} = '' OR c.kind = ${kind})
      AND (${filterCollector} = '' OR c.collector_id = ${filterCollector})
      AND (
        ${filterCollector} <> ''
        OR COALESCE(cl.blacklisted, FALSE) = FALSE
      )
      AND COALESCE(c.hidden, FALSE) = FALSE
      AND (
        CASE
          WHEN c.mp_preapproval_id IS NOT NULL AND c.mp_preapproval_id <> '' THEN
            COALESCE(hs.hub_status, 'pending')
          ELSE
            COALESCE(hs.hub_status, 'accepted')
        END
      ) = 'accepted'
      AND (
        ${fromDate}::timestamptz IS NULL
        OR COALESCE(c.paid_at, c.created_at) >= ${fromDate}::timestamptz
      )
      AND (
        ${toDate}::timestamptz IS NULL
        OR COALESCE(c.paid_at, c.created_at) <= ${toDate}::timestamptz
      )
      AND (
        ${qLike}::text IS NULL
        OR COALESCE(c.description, '') ILIKE ${qLike}
        OR COALESCE(c.payer_email, '') ILIKE ${qLike}
        OR COALESCE(c.mp_payment_id, '') ILIKE ${qLike}
        OR COALESCE(c.mp_preapproval_id, '') ILIKE ${qLike}
        OR COALESCE(a.name, '') ILIKE ${qLike}
        OR COALESCE(cl.name, '') ILIKE ${qLike}
        OR COALESCE(c.collector_name, '') ILIKE ${qLike}
      )
    ORDER BY COALESCE(c.paid_at, c.created_at) DESC
    LIMIT 10000
  `;

  const header = [
    "fecha",
    "app",
    "cliente",
    "collector_id",
    "descripcion",
    "tipo",
    "estado",
    "monto",
    "comision_mp_pct",
    "neto",
    "comision_manual",
    "mp_payment_id",
    "mp_preapproval_id",
    "mp_authorized_payment_id",
    "external_reference",
    "payer_email",
  ];
  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.fecha,
        r.app,
        subscriptionPlanName({
          description: r.description != null ? String(r.description) : null,
          clientName: r.cliente != null ? String(r.cliente) : null,
        }),
        r.collector_id,
        r.description,
        r.kind,
        r.status,
        r.amount,
        r.mp_fee_pct,
        r.net_amount,
        r.mp_fee_manual ? "si" : "no",
        r.mp_payment_id,
        r.mp_preapproval_id,
        r.mp_authorized_payment_id,
        r.external_reference,
        r.payer_email,
      ]
        .map(csvEscape)
        .join(";"),
    );
  }

  const body = "\uFEFF" + lines.join("\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="suscripciones.csv"`,
    },
  });
}
