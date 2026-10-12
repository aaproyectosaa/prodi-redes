import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getSql } from "../sql";
import { FEE_RELEASE_DAYS } from "../money";

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const appId = sp.get("appId") || "";
  const clientId = sp.get("clientId") || "";
  const collectorId = sp.get("collectorId") || "";
  const status = sp.get("status") || "";
  const q = sp.get("q") || "";
  const fromRaw = sp.get("from") || "";
  const toRaw = sp.get("to") || "";
  const fromDate = fromRaw ? `${fromRaw}T00:00:00-03:00` : null;
  const toDate = toRaw ? `${toRaw}T23:59:59.999-03:00` : null;
    const qLike = q ? `%${q}%` : null;
    const feeState = sp.get("feeState") || "";
    const unassigned = sp.get("unassigned") === "1" ? "1" : "";

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
      COALESCE(p.paid_at, p.created_at) AS fecha,
      a.name AS app,
      COALESCE(cl.name, p.collector_name, '') AS cliente,
      p.collector_id,
      p.description,
      p.payer_email,
      p.status,
      p.amount::float8 AS amount,
      p.fee::float8 AS fee,
      p.mp_payment_id
    FROM hub_payments p
    JOIN hub_mp_apps a ON a.id = p.app_id
    LEFT JOIN hub_clients cl
      ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
    WHERE
      (${appId} = '' OR p.app_id::text = ${appId})
      AND (${status} = '' OR p.status = ${status})
      AND (${status} <> '' OR p.fee > 0)
      AND (${filterCollector} = '' OR p.collector_id = ${filterCollector})
      AND (
        ${filterCollector} <> ''
        OR COALESCE(cl.blacklisted, FALSE) = FALSE
      )
      AND (
        ${fromDate}::timestamptz IS NULL
        OR COALESCE(p.paid_at, p.created_at) >= ${fromDate}::timestamptz
      )
      AND (
        ${toDate}::timestamptz IS NULL
        OR COALESCE(p.paid_at, p.created_at) <= ${toDate}::timestamptz
      )
      AND (
        ${qLike}::text IS NULL
        OR COALESCE(p.description, '') ILIKE ${qLike}
        OR COALESCE(p.payer_email, '') ILIKE ${qLike}
        OR COALESCE(p.mp_payment_id, '') ILIKE ${qLike}
        OR COALESCE(a.name, '') ILIKE ${qLike}
        OR COALESCE(cl.name, '') ILIKE ${qLike}
          OR COALESCE(p.collector_name, '') ILIKE ${qLike}
      )
      AND (
        ${feeState} = ''
        OR (${feeState} = 'with_fee' AND p.fee > 0)
        OR (
          ${feeState} = 'released'
          AND p.fee > 0
          AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
            <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - ${FEE_RELEASE_DAYS}::int
        )
        OR (
          ${feeState} = 'held'
          AND p.fee > 0
          AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
            > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - ${FEE_RELEASE_DAYS}::int
        )
      )
      AND (${unassigned} <> '1' OR cl.id IS NULL)
    ORDER BY COALESCE(p.paid_at, p.created_at) DESC
    LIMIT 10000
  `;

  const header = [
    "fecha",
    "app",
    "cliente",
    "collector_id",
    "descripcion",
    "email",
    "estado",
    "monto",
    "fee",
    "mp_payment_id",
  ];
  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.fecha,
        r.app,
        r.cliente,
        r.collector_id,
        r.description,
        r.payer_email,
        r.status,
        r.amount,
        r.fee,
        r.mp_payment_id,
      ]
        .map(csvEscape)
        .join(";"),
    );
  }

  const body = "\uFEFF" + lines.join("\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pagos.csv"`,
    },
  });
}
