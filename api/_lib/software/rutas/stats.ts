import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getSql } from "../sql";
import {
  arDay,
  monthBounds,
  periodBounds,
  previousPeriodBounds,
  yearMonth,
  FEE_RELEASE_DAYS,
  type StatsPeriod,
} from "../money";

const PERIODS = new Set<StatsPeriod>(["today", "week", "month", "year", "all"]);

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const raw = (sp.get("period") || "month") as StatsPeriod;
  const period: StatsPeriod = PERIODS.has(raw) ? raw : "month";
  const month = sp.get("month") || yearMonth();
  const bounds = periodBounds(period, month);

  const fromIso = bounds.from ? `${bounds.from}T00:00:00-03:00` : null;
  const toIso = bounds.to ? `${bounds.to}T23:59:59.999-03:00` : null;

  const sql = getSql();

  const kpis = await sql`
    SELECT
      COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS approved_count,
      COUNT(*) FILTER (WHERE p.fee > 0)::int AS total_count,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS amount,
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee,
      COALESCE(SUM(p.fee) FILTER (
        WHERE p.status = 'approved' AND p.fee > 0
          AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
            <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
              - ${FEE_RELEASE_DAYS}::int
      ), 0)::float8 AS fee_released,
      COALESCE(SUM(p.fee) FILTER (
        WHERE p.status = 'approved' AND p.fee > 0
          AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
            > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
              - ${FEE_RELEASE_DAYS}::int
      ), 0)::float8 AS fee_held
    FROM hub_payments p
    LEFT JOIN hub_clients cl
      ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
    WHERE
      (${fromIso}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) >= ${fromIso}::timestamptz)
      AND (${toIso}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) <= ${toIso}::timestamptz)
      AND COALESCE(cl.blacklisted, FALSE) = FALSE
  `;

  const byClient = await sql`
    SELECT
      COALESCE(cl.id::text, 'unknown') AS id,
      COALESCE(cl.name, COALESCE(p.collector_name, 'Sin cliente')) AS name,
      p.collector_id,
      COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS count,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS amount,
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee
    FROM hub_payments p
    LEFT JOIN hub_clients cl
      ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
    WHERE
      (${fromIso}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) >= ${fromIso}::timestamptz)
      AND (${toIso}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) <= ${toIso}::timestamptz)
      AND COALESCE(cl.blacklisted, FALSE) = FALSE
    GROUP BY COALESCE(cl.id::text, 'unknown'), COALESCE(cl.name, COALESCE(p.collector_name, 'Sin cliente')), p.collector_id
    ORDER BY fee DESC, amount DESC
    LIMIT 12
  `;

  const bucket =
    period === "year" || period === "all"
      ? await sql`
          SELECT
            TO_CHAR(DATE_TRUNC('month', COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM') AS key,
            COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS count,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS amount,
            COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee
          FROM hub_payments p
          LEFT JOIN hub_clients cl
            ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
          WHERE
            (${fromIso}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) >= ${fromIso}::timestamptz)
            AND (${toIso}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) <= ${toIso}::timestamptz)
            AND COALESCE(cl.blacklisted, FALSE) = FALSE
          GROUP BY 1
          ORDER BY 1
        `
      : await sql`
          SELECT
            TO_CHAR(DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD') AS key,
            COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS count,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS amount,
            COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee
          FROM hub_payments p
          LEFT JOIN hub_clients cl
            ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
          WHERE
            (${fromIso}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) >= ${fromIso}::timestamptz)
            AND (${toIso}::timestamptz IS NULL OR COALESCE(p.paid_at, p.created_at) <= ${toIso}::timestamptz)
            AND COALESCE(cl.blacklisted, FALSE) = FALSE
          GROUP BY 1
          ORDER BY 1
        `;

  // Calendario siempre del mes seleccionado (para poder clickear días)
  const calMonth = period === "month" ? month : yearMonth();
  const mb = monthBounds(calMonth);
  const calFrom = mb.from.toISOString();
  const calTo = mb.to.toISOString();
  const daily = await sql`
    SELECT
      TO_CHAR(DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM-DD') AS day,
      COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS count,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS amount,
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee
    FROM hub_payments p
    LEFT JOIN hub_clients cl
      ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
    WHERE COALESCE(p.paid_at, p.created_at) >= ${calFrom}::timestamptz
      AND COALESCE(p.paid_at, p.created_at) <= ${calTo}::timestamptz
      AND COALESCE(cl.blacklisted, FALSE) = FALSE
    GROUP BY 1
    ORDER BY 1
  `;

  const prevBounds = previousPeriodBounds(period, month);
  const prevFrom = prevBounds ? `${prevBounds.from}T00:00:00-03:00` : null;
  const prevTo = prevBounds ? `${prevBounds.to}T23:59:59.999-03:00` : null;
  const prevRows = prevBounds
    ? await sql`
        SELECT
          COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS approved_count,
          COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS amount,
          COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee
        FROM hub_payments p
        LEFT JOIN hub_clients cl
          ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
        WHERE COALESCE(p.paid_at, p.created_at) >= ${prevFrom}::timestamptz
          AND COALESCE(p.paid_at, p.created_at) <= ${prevTo}::timestamptz
          AND COALESCE(cl.blacklisted, FALSE) = FALSE
      `
    : [];

  const appsCount = await sql`SELECT COUNT(*)::int AS n FROM hub_mp_apps`;

  return NextResponse.json({
    period,
    month: calMonth,
    from: bounds.from,
    to: bounds.to,
    label: bounds.label,
    today: arDay(),
    kpis: kpis[0] || {
      approved_count: 0,
      total_count: 0,
      amount: 0,
      fee: 0,
      fee_released: 0,
      fee_held: 0,
    },
    releaseDays: FEE_RELEASE_DAYS,
    byClient,
    series: bucket.map((r) => ({
      key: String(r.key),
      count: Number(r.count || 0),
      amount: Number(r.amount || 0),
      fee: Number(r.fee || 0),
    })),
    seriesKind: period === "year" || period === "all" ? "month" : "day",
    daily,
    appsCount: Number(appsCount[0]?.n || 0),
    prev: prevRows[0]
      ? {
          approved_count: Number(prevRows[0].approved_count || 0),
          amount: Number(prevRows[0].amount || 0),
          fee: Number(prevRows[0].fee || 0),
        }
      : null,
  });
}
