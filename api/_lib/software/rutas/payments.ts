import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getSql } from "../sql";
import { FEE_RELEASE_DAYS } from "../money";

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();

  try {
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
    const sort = sp.get("sort") === "fee" || sp.get("sort") === "amount" ? sp.get("sort") : "date";
    const limit = Math.min(Math.max(Number(sp.get("limit") || 50), 1), 100);
    const page = Math.max(Number(sp.get("page") || 1), 1);
    const offset = (page - 1) * limit;

    const sql = getSql();

    // Resolve client → collector_id if filtering by client
    let filterCollector = collectorId;
    if (clientId) {
      const c = await sql`
        SELECT collector_id FROM hub_clients WHERE id = ${clientId} LIMIT 1
      `;
      filterCollector = String(c[0]?.collector_id || filterCollector || "");
    }

    const rows = await sql`
      SELECT
        p.id, p.app_id, p.mp_payment_id, p.status,
        p.amount::float8 AS amount, p.fee::float8 AS fee, p.currency,
        p.collector_id, p.collector_name, p.payer_email, p.description,
        p.paid_at, p.created_at,
        a.name AS app_name,
        cl.name AS client_name,
        cl.id AS client_id
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
      ORDER BY
        CASE WHEN ${sort} = 'fee' THEN p.fee END DESC NULLS LAST,
        CASE WHEN ${sort} = 'amount' THEN p.amount END DESC NULLS LAST,
        COALESCE(p.paid_at, p.created_at) DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totals = await sql`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(p.amount), 0)::float8 AS amount,
        COALESCE(SUM(p.fee), 0)::float8 AS fee,
        COALESCE(SUM(p.fee) FILTER (
          WHERE p.fee > 0
            AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
              <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - ${FEE_RELEASE_DAYS}::int
        ), 0)::float8 AS fee_released,
        COALESCE(SUM(p.fee) FILTER (
          WHERE p.fee > 0
            AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
              > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - ${FEE_RELEASE_DAYS}::int
        ), 0)::float8 AS fee_held
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
    `;

    const totalCount = Number(totals[0]?.count || 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return NextResponse.json({
      payments: rows,
      totals: totals[0] || { count: 0, amount: 0, fee: 0 },
      page,
      limit,
      totalPages,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Error al cargar pagos",
        payments: [],
        totals: { count: 0, amount: 0, fee: 0 },
      },
      { status: 500 },
    );
  }
}
