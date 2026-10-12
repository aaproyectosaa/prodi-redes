import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { getSql } from "../sql";
import { addDays, arDay, FEE_RELEASE_DAYS } from "../money";
import { parsePayoutSource, sourceShortLabel, type PayoutSource } from "../payout-source";
import { ensureSubscriptionTables } from "../subscriptions";

function parseDay(s: string | null, fallback: string) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  return s;
}

type Source = PayoutSource;

function emptyShareMap(partners: Array<Record<string, unknown>>) {
  const m: Record<string, number> = {};
  for (const p of partners) m[String(p.id)] = 0;
  return m;
}

function releasedUntilDay() {
  return addDays(arDay(), -FEE_RELEASE_DAYS);
}

function applyFeeClientRows(
  feeByClient: Array<Record<string, unknown>>,
  partners: Array<Record<string, unknown>>,
  customByClient: Record<string, Record<string, number>>,
  feeShareByPartner: Record<string, number>,
  breakdown: Array<{
    client_id: string | null;
    client_name: string;
    fee: number;
    count: number;
    custom: boolean;
    source: Source;
    shares: Array<{ partner_id: string; partner_name: string; pct: number; share: number }>;
  }>,
) {
  let totalFee = 0;
  let paymentsCount = 0;
  for (const row of feeByClient) {
    const fee = Number(row.fee || 0);
    const count = Number(row.count || 0);
    if (fee <= 0) continue;
    totalFee += fee;
    paymentsCount += count;
    const cid = row.client_id != null ? String(row.client_id) : null;
    const custom = cid ? Boolean(customByClient[cid]) : false;
    const shares = partners.map((p) => {
      const pid = String(p.id);
      const pct =
        cid && customByClient[cid]
          ? Number(customByClient[cid][pid] ?? 0)
          : Number(p.pct);
      const share = (fee * pct) / 100;
      feeShareByPartner[pid] = (feeShareByPartner[pid] || 0) + share;
      return {
        partner_id: pid,
        partner_name: p.name as string,
        pct,
        share: Math.round(share),
      };
    });
    breakdown.push({
      client_id: cid,
      client_name: String(row.client_name),
      fee,
      count,
      custom,
      source: "fee",
      shares,
    });
  }
  return { totalFee, paymentsCount };
}

async function partnerFeeReleasedPending(
  sql: ReturnType<typeof getSql>,
  partnerId: string,
  from: string,
  to: string,
) {
  const fromTs = `${from}T00:00:00-03:00`;
  const toTs = `${to}T23:59:59.999-03:00`;
  const releasedUntil = releasedUntilDay();
  const partners = await sql`
    SELECT id, name, pct::float8 AS pct, sort_order
    FROM hub_partners ORDER BY sort_order ASC
  `;
  const customPctRows = await sql`
    SELECT client_id, partner_id, pct::float8 AS pct
    FROM hub_client_partner_pct
  `;
  const customByClient: Record<string, Record<string, number>> = {};
  for (const row of customPctRows) {
    const cid = String(row.client_id);
    if (!customByClient[cid]) customByClient[cid] = {};
    customByClient[cid][String(row.partner_id)] = Number(row.pct || 0);
  }
  const feeByClient = await sql`
    SELECT
      cl.id AS client_id,
      COALESCE(cl.name, COALESCE(p.collector_name, 'Sin cliente')) AS client_name,
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee,
      COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS count
    FROM hub_payments p
    LEFT JOIN hub_clients cl
      ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
    WHERE COALESCE(p.paid_at, p.created_at) >= ${fromTs}::timestamptz
      AND COALESCE(p.paid_at, p.created_at) <= ${toTs}::timestamptz
      AND COALESCE(cl.blacklisted, FALSE) = FALSE
      AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
        <= ${releasedUntil}::date
    GROUP BY cl.id, COALESCE(cl.name, COALESCE(p.collector_name, 'Sin cliente'))
  `;
  const feeShareByPartner = emptyShareMap(partners as Array<Record<string, unknown>>);
  applyFeeClientRows(
    feeByClient as Array<Record<string, unknown>>,
    partners as Array<Record<string, unknown>>,
    customByClient,
    feeShareByPartner,
    [],
  );
  const paidRows = await sql`
    SELECT COALESCE(SUM(pay.amount), 0)::float8 AS paid
    FROM hub_payouts pay
    WHERE pay.partner_id = ${partnerId}::uuid
      AND COALESCE(NULLIF(pay.source, ''), 'fee') = 'fee'
      AND pay.period_from <= ${to}::date
      AND pay.period_to >= ${from}::date
  `;
  const share = Math.round(feeShareByPartner[partnerId] || 0);
  const paid = Math.round(Number(paidRows[0]?.paid || 0));
  return Math.max(0, share - paid);
}

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const today = arDay();
  const from = parseDay(sp.get("from"), `${today.slice(0, 4)}-01-01`);
  const to = parseDay(sp.get("to"), today);

  const sql = getSql();
  const fromTs = `${from}T00:00:00-03:00`;
  const toTs = `${to}T23:59:59.999-03:00`;
  const releasedUntil = releasedUntilDay();

  await sql`
    ALTER TABLE hub_payouts
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'fee'
  `.catch(() => undefined);

  await sql`
    ALTER TABLE hub_partners
    ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE
  `.catch(() => undefined);

  const partners = await sql`
    SELECT id, name, pct::float8 AS pct, sort_order, is_cash
    FROM hub_partners ORDER BY sort_order ASC
  `;

  const feeByClient = await sql`
    SELECT
      cl.id AS client_id,
      COALESCE(cl.name, COALESCE(p.collector_name, 'Sin cliente')) AS client_name,
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee,
      COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS count
    FROM hub_payments p
    LEFT JOIN hub_clients cl
      ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
    WHERE COALESCE(p.paid_at, p.created_at) >= ${fromTs}::timestamptz
      AND COALESCE(p.paid_at, p.created_at) <= ${toTs}::timestamptz
      AND COALESCE(cl.blacklisted, FALSE) = FALSE
      AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
        <= ${releasedUntil}::date
    GROUP BY cl.id, COALESCE(cl.name, COALESCE(p.collector_name, 'Sin cliente'))
    ORDER BY fee DESC
  `;

  const feeHeldRow = await sql`
    SELECT
      COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee,
      COUNT(*) FILTER (WHERE p.status = 'approved' AND p.fee > 0)::int AS count
    FROM hub_payments p
    LEFT JOIN hub_clients cl
      ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
    WHERE COALESCE(p.paid_at, p.created_at) >= ${fromTs}::timestamptz
      AND COALESCE(p.paid_at, p.created_at) <= ${toTs}::timestamptz
      AND COALESCE(cl.blacklisted, FALSE) = FALSE
      AND DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')
        > ${releasedUntil}::date
  `;
  const totalFeeHeld = Number(feeHeldRow[0]?.fee || 0);
  const heldCount = Number(feeHeldRow[0]?.count || 0);

  const customPctRows = await sql`
    SELECT client_id, partner_id, pct::float8 AS pct
    FROM hub_client_partner_pct
  `;
  const customByClient: Record<string, Record<string, number>> = {};
  for (const row of customPctRows) {
    const cid = String(row.client_id);
    if (!customByClient[cid]) customByClient[cid] = {};
    customByClient[cid][String(row.partner_id)] = Number(row.pct || 0);
  }

  const allClients = await sql`
    SELECT id, name, app_id
    FROM hub_clients
    WHERE blacklisted = FALSE
    ORDER BY name ASC
  `;

  const clientSplits = allClients.map((c) => {
    const id = String(c.id);
    const custom = customByClient[id];
    const pcts = partners.map((p) => {
      const pid = String(p.id);
      return {
        partner_id: pid,
        partner_name: p.name as string,
        pct: custom ? Number(custom[pid] ?? 0) : Number(p.pct),
      };
    });
    return {
      client_id: id,
      client_name: c.name as string,
      custom: Boolean(custom),
      pcts,
    };
  });

  const feeShareByPartner = emptyShareMap(partners);
  const maintShareByPartner = emptyShareMap(partners);
  const extraShareByPartner = emptyShareMap(partners);
  const subShareByPartner = emptyShareMap(partners);

  let totalFee = 0;
  let paymentsCount = 0;
  let totalMaintenance = 0;
  let maintenanceCount = 0;
  let totalExtra = 0;
  let extraCount = 0;
  let totalSubscription = 0;
  let subscriptionCount = 0;

  const breakdown: Array<{
    client_id: string | null;
    client_name: string;
    fee: number;
    count: number;
    custom: boolean;
    source: Source;
    shares: Array<{ partner_id: string; partner_name: string; pct: number; share: number }>;
  }> = [];

  const feeAgg = applyFeeClientRows(
    feeByClient as Array<Record<string, unknown>>,
    partners as Array<Record<string, unknown>>,
    customByClient,
    feeShareByPartner,
    breakdown,
  );
  totalFee = feeAgg.totalFee;
  paymentsCount = feeAgg.paymentsCount;

  try {
    const maint = await sql`
      SELECT
        c.id AS client_id,
        c.name AS client_name,
        COALESCE(SUM(p.amount), 0)::float8 AS fee,
        COUNT(*)::int AS count
      FROM hub_maintenance_payments p
      JOIN hub_maintenance_clients c ON c.id = p.client_id
      WHERE p.paid_at >= ${fromTs}::timestamptz
        AND p.paid_at <= ${toTs}::timestamptz
      GROUP BY c.id, c.name
      ORDER BY fee DESC
    `;
    for (const row of maint) {
      const fee = Number(row.fee || 0);
      const count = Number(row.count || 0);
      if (fee <= 0) continue;
      totalMaintenance += fee;
      maintenanceCount += count;
      const shares = partners.map((p) => {
        const pid = String(p.id);
        const pct = Number(p.pct);
        const share = (fee * pct) / 100;
        maintShareByPartner[pid] = (maintShareByPartner[pid] || 0) + share;
        return {
          partner_id: pid,
          partner_name: p.name as string,
          pct,
          share: Math.round(share),
        };
      });
      breakdown.push({
        client_id: String(row.client_id),
        client_name: String(row.client_name),
        fee,
        count,
        custom: false,
        source: "maintenance",
        shares,
      });
    }
  } catch {
    /* tabla puede no existir aún */
  }

  let extraPayments: Array<{
    id: string;
    payer_name: string;
    amount: number;
    notes: string;
    paid_at: string;
  }> = [];
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS hub_extra_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payer_name TEXT NOT NULL,
        amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    extraPayments = (await sql`
      SELECT
        id, payer_name, amount::float8 AS amount, notes, paid_at
      FROM hub_extra_payments
      WHERE paid_at >= ${fromTs}::timestamptz
        AND paid_at <= ${toTs}::timestamptz
      ORDER BY paid_at DESC
    `) as typeof extraPayments;

    for (const row of extraPayments) {
      const fee = Number(row.amount || 0);
      if (fee <= 0) continue;
      totalExtra += fee;
      extraCount += 1;
      const shares = partners.map((p) => {
        const pid = String(p.id);
        const pct = Number(p.pct);
        const share = (fee * pct) / 100;
        extraShareByPartner[pid] = (extraShareByPartner[pid] || 0) + share;
        return {
          partner_id: pid,
          partner_name: p.name as string,
          pct,
          share: Math.round(share),
        };
      });
      breakdown.push({
        client_id: String(row.id),
        client_name: String(row.payer_name),
        fee,
        count: 1,
        custom: false,
        source: "extra",
        shares,
      });
    }
  } catch {
    extraPayments = [];
  }

  try {
    await ensureSubscriptionTables();
    const subs = await sql`
      SELECT
        cl.id AS client_id,
        COALESCE(cl.name, COALESCE(c.collector_name, 'Sin cliente')) AS client_name,
        COALESCE(SUM(
          CASE
            WHEN c.mp_net_amount IS NOT NULL THEN c.mp_net_amount
            ELSE ROUND((c.amount * (1 - COALESCE(c.mp_fee_pct, 0) / 100.0))::numeric, 2)
          END
        ) FILTER (WHERE c.status = 'approved' AND c.amount > 0), 0)::float8 AS fee,
        COUNT(*) FILTER (WHERE c.status = 'approved' AND c.amount > 0)::int AS count
      FROM hub_subscription_charges c
      LEFT JOIN hub_clients cl
        ON cl.app_id = c.app_id AND cl.collector_id = c.collector_id
      LEFT JOIN hub_subscriptions hs ON hs.id = c.subscription_id
      WHERE COALESCE(c.paid_at, c.created_at) >= ${fromTs}::timestamptz
        AND COALESCE(c.paid_at, c.created_at) <= ${toTs}::timestamptz
        AND COALESCE(cl.blacklisted, FALSE) = FALSE
        AND COALESCE(c.hidden, FALSE) = FALSE
        AND (
          CASE
            WHEN c.mp_preapproval_id IS NOT NULL AND c.mp_preapproval_id <> '' THEN
              COALESCE(hs.hub_status, 'pending')
            ELSE
              COALESCE(hs.hub_status, 'accepted')
          END
        ) = 'accepted'
      GROUP BY cl.id, COALESCE(cl.name, COALESCE(c.collector_name, 'Sin cliente'))
      ORDER BY fee DESC
    `;
    for (const row of subs) {
      const fee = Number(row.fee || 0);
      const count = Number(row.count || 0);
      if (fee <= 0) continue;
      totalSubscription += fee;
      subscriptionCount += count;
      const cid = row.client_id != null ? String(row.client_id) : null;
      const custom = cid ? Boolean(customByClient[cid]) : false;
      const shares = partners.map((p) => {
        const pid = String(p.id);
        const pct =
          cid && customByClient[cid]
            ? Number(customByClient[cid][pid] ?? 0)
            : Number(p.pct);
        const share = (fee * pct) / 100;
        subShareByPartner[pid] = (subShareByPartner[pid] || 0) + share;
        return {
          partner_id: pid,
          partner_name: p.name as string,
          pct,
          share: Math.round(share),
        };
      });
      breakdown.push({
        client_id: cid,
        client_name: String(row.client_name),
        fee,
        count,
        custom,
        source: "subscription",
        shares,
      });
    }
  } catch {
    /* tabla puede no existir aún */
  }

  const payouts = await sql`
    SELECT
      pay.id, pay.partner_id, pay.amount::float8 AS amount,
      pay.period_from, pay.period_to, pay.notes, pay.paid_at,
      COALESCE(NULLIF(pay.source, ''), 'fee') AS source,
      pr.name AS partner_name
    FROM hub_payouts pay
    JOIN hub_partners pr ON pr.id = pay.partner_id
    WHERE pay.period_from <= ${to}::date
      AND pay.period_to >= ${from}::date
    ORDER BY pay.paid_at DESC
  `;

  const paidFeeByPartner = emptyShareMap(partners);
  const paidMaintByPartner = emptyShareMap(partners);
  const paidExtraByPartner = emptyShareMap(partners);
  const paidSubByPartner = emptyShareMap(partners);
  for (const p of payouts) {
    const id = String(p.partner_id);
    const src = parsePayoutSource(p.source);
    const amt = Number(p.amount || 0);
    if (src === "maintenance") {
      paidMaintByPartner[id] = (paidMaintByPartner[id] || 0) + amt;
    } else if (src === "extra") {
      paidExtraByPartner[id] = (paidExtraByPartner[id] || 0) + amt;
    } else if (src === "subscription") {
      paidSubByPartner[id] = (paidSubByPartner[id] || 0) + amt;
    } else {
      paidFeeByPartner[id] = (paidFeeByPartner[id] || 0) + amt;
    }
  }

  const feeItems = partners.map((p) => {
    const id = String(p.id);
    const share = Math.round(feeShareByPartner[id] || 0);
    const paid = Math.round(paidFeeByPartner[id] || 0);
    return {
      partner_id: id,
      partner_name: p.name as string,
      pct: Number(p.pct),
      share,
      paid,
      pending: Math.max(0, share - paid),
      source: "fee" as const,
    };
  });

  const maintenanceItems = partners.map((p) => {
    const id = String(p.id);
    const share = Math.round(maintShareByPartner[id] || 0);
    const paid = Math.round(paidMaintByPartner[id] || 0);
    return {
      partner_id: id,
      partner_name: p.name as string,
      pct: Number(p.pct),
      share,
      paid,
      pending: Math.max(0, share - paid),
      source: "maintenance" as const,
    };
  });

  const extraItems = partners.map((p) => {
    const id = String(p.id);
    const share = Math.round(extraShareByPartner[id] || 0);
    const paid = Math.round(paidExtraByPartner[id] || 0);
    return {
      partner_id: id,
      partner_name: p.name as string,
      pct: Number(p.pct),
      share,
      paid,
      pending: Math.max(0, share - paid),
      source: "extra" as const,
    };
  });

  const subscriptionItems = partners.map((p) => {
    const id = String(p.id);
    const share = Math.round(subShareByPartner[id] || 0);
    const paid = Math.round(paidSubByPartner[id] || 0);
    return {
      partner_id: id,
      partner_name: p.name as string,
      pct: Number(p.pct),
      share,
      paid,
      pending: Math.max(0, share - paid),
      source: "subscription" as const,
    };
  });

  const cajaPartner = (partners as Array<Record<string, unknown>>).find(
    (p) => Boolean(p.is_cash),
  );
  const cajaId = cajaPartner ? String(cajaPartner.id) : null;
  const cajaName = cajaPartner ? String(cajaPartner.name) : null;

  let caja = {
    partner_id: cajaId as string | null,
    partner_name: cajaName as string | null,
    period: { transferred: 0, expenses: 0, saldo: 0 },
    allTime: { transferred: 0, expenses: 0, saldo: 0 },
    expensesByCategory: [] as Array<{ category: string; amount: number; count: number }>,
    expensesByPartner: [] as Array<{
      partner_id: string | null;
      partner_name: string;
      amount: number;
    }>,
    expenseCount: 0,
  };
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS hub_expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        description TEXT NOT NULL,
        amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'otros',
        partner_id UUID REFERENCES hub_partners(id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '',
        paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    const transferredPeriodRow = await sql`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM hub_payouts
      WHERE period_from <= ${to}::date AND period_to >= ${from}::date
        AND (${cajaId}::uuid IS NULL OR partner_id = ${cajaId}::uuid)
    `;
    const transferredAllRow = await sql`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM hub_payouts
      WHERE COALESCE(paid_at, created_at) <= ${toTs}::timestamptz
        AND (${cajaId}::uuid IS NULL OR partner_id = ${cajaId}::uuid)
    `;
    const expPeriodRow = await sql`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total, COUNT(*)::int AS count
      FROM hub_expenses
      WHERE paid_at >= ${fromTs}::timestamptz
        AND paid_at <= ${toTs}::timestamptz
    `;
    const expAllRow = await sql`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM hub_expenses
      WHERE paid_at <= ${toTs}::timestamptz
    `;
    const byCategory = await sql`
      SELECT
        category,
        COALESCE(SUM(amount), 0)::float8 AS amount,
        COUNT(*)::int AS count
      FROM hub_expenses
      WHERE paid_at >= ${fromTs}::timestamptz
        AND paid_at <= ${toTs}::timestamptz
      GROUP BY category
      ORDER BY amount DESC
    `;
    const byPartner = await sql`
      SELECT
        e.partner_id,
        COALESCE(pr.name, 'Caja común') AS partner_name,
        COALESCE(SUM(e.amount), 0)::float8 AS amount
      FROM hub_expenses e
      LEFT JOIN hub_partners pr ON pr.id = e.partner_id
      WHERE e.paid_at >= ${fromTs}::timestamptz
        AND e.paid_at <= ${toTs}::timestamptz
      GROUP BY e.partner_id, COALESCE(pr.name, 'Caja común')
      ORDER BY amount DESC
    `;
    const transferredPeriod = Math.round(Number(transferredPeriodRow[0]?.total || 0));
    const transferredAll = Math.round(Number(transferredAllRow[0]?.total || 0));
    const expensesPeriod = Math.round(Number(expPeriodRow[0]?.total || 0));
    const expensesAll = Math.round(Number(expAllRow[0]?.total || 0));
    caja = {
      partner_id: cajaId,
      partner_name: cajaName,
      period: {
        transferred: transferredPeriod,
        expenses: expensesPeriod,
        saldo: transferredPeriod - expensesPeriod,
      },
      allTime: {
        transferred: transferredAll,
        expenses: expensesAll,
        saldo: transferredAll - expensesAll,
      },
      expensesByCategory: byCategory as typeof caja.expensesByCategory,
      expensesByPartner: byPartner as typeof caja.expensesByPartner,
      expenseCount: Number(expPeriodRow[0]?.count || 0),
    };
  } catch {
    /* tabla puede no existir aún */
  }

  return NextResponse.json({
    from,
    to,
    releasedUntil,
    releaseDays: FEE_RELEASE_DAYS,
    caja,
    totalFee,
    paymentsCount,
    totalFeeHeld,
    heldCount,
    totalMaintenance,
    maintenanceCount,
    totalExtra,
    extraCount,
    totalSubscription,
    subscriptionCount,
    feeItems,
    maintenanceItems,
    extraItems,
    subscriptionItems,
    extraPayments,
    // compat
    items: feeItems,
    payouts,
    partners,
    clientSplits,
    breakdown,
    byPartnerTotals: partners.map((p) => {
      const id = String(p.id);
      const bags = [feeItems, maintenanceItems, extraItems, subscriptionItems];
      const share = bags.reduce(
        (a, list) => a + (list.find((i) => i.partner_id === id)?.share || 0),
        0,
      );
      const paid = bags.reduce(
        (a, list) => a + (list.find((i) => i.partner_id === id)?.paid || 0),
        0,
      );
      const pending = bags.reduce(
        (a, list) => a + (list.find((i) => i.partner_id === id)?.pending || 0),
        0,
      );
      return {
        partner_id: id,
        partner_name: p.name as string,
        share,
        paid,
        pending,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "pay");
  const sql = getSql();

  await sql`
    ALTER TABLE hub_payouts
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'fee'
  `.catch(() => undefined);

  if (action === "pay") {
    const partnerId = String(body.partner_id || "");
    const from = String(body.from || "");
    const to = String(body.to || "");
    const amount = Math.round(Number(body.amount || 0));
    const notes = String(body.notes || "");
    const source = parsePayoutSource(body.source);
    if (!partnerId || !from || !to || amount <= 0) {
      return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
    }

    if (source === "fee") {
      const pending = await partnerFeeReleasedPending(sql, partnerId, from, to);
      if (amount > pending) {
        return NextResponse.json(
          {
            error: `Solo se puede transferir fee ya liberado (${FEE_RELEASE_DAYS} días). Pendiente: $${pending.toLocaleString("es-AR")}`,
          },
          { status: 400 },
        );
      }
    }
    const rows = await sql`
      INSERT INTO hub_payouts (partner_id, amount, period_from, period_to, notes, source)
      VALUES (${partnerId}, ${amount}, ${from}::date, ${to}::date, ${notes}, ${source})
      RETURNING id
    `;
    const partner = await sql`SELECT name FROM hub_partners WHERE id = ${partnerId}`;
    const label = sourceShortLabel(source);
    await logActivity(
      "payout",
      `Transferencia ${label}: ${partner[0]?.name || "socio"} · $${amount.toLocaleString("es-AR")}`,
      { partnerId, amount, from, to, payoutId: rows[0]?.id, source },
    );
    return NextResponse.json({ ok: true, id: rows[0]?.id });
  }

  if (action === "undo") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const prev = await sql`
      SELECT pay.amount::float8 AS amount, pr.name AS partner_name
      FROM hub_payouts pay
      JOIN hub_partners pr ON pr.id = pay.partner_id
      WHERE pay.id = ${id}
    `;
    await sql`DELETE FROM hub_payouts WHERE id = ${id}`;
    if (prev[0]) {
      await logActivity(
        "payout_undo",
        `Transferencia anulada: ${prev[0].partner_name} · $${Number(prev[0].amount).toLocaleString("es-AR")}`,
        { payoutId: id },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "set_source") {
    const id = String(body.id || "");
    const source = parsePayoutSource(body.source);
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const prev = await sql`
      SELECT pay.amount::float8 AS amount, pr.name AS partner_name,
             COALESCE(NULLIF(pay.source, ''), 'fee') AS source
      FROM hub_payouts pay
      JOIN hub_partners pr ON pr.id = pay.partner_id
      WHERE pay.id = ${id}
    `;
    if (!prev[0]) {
      return NextResponse.json({ error: "Transferencia no encontrada" }, { status: 404 });
    }
    await sql`
      UPDATE hub_payouts SET source = ${source}
      WHERE id = ${id}
    `;
    await logActivity(
      "payout",
      `Tipo transferencia: ${prev[0].partner_name} · $${Number(prev[0].amount).toLocaleString("es-AR")} → ${sourceShortLabel(source)}`,
      { payoutId: id, source, from: prev[0].source },
    );
    return NextResponse.json({ ok: true, source });
  }

  if (action === "save_partners") {
    const partners = Array.isArray(body.partners) ? body.partners : [];
    for (const p of partners) {
      await sql`
        UPDATE hub_partners SET
          name = ${String(p.name || "").trim()},
          pct = ${Number(p.pct || 0)},
          updated_at = NOW()
        WHERE id = ${String(p.id)}
      `;
    }
    await logActivity("partner_update", "Reparto actualizado: nombres y % general");
    return NextResponse.json({ ok: true });
  }

  if (action === "save_client_pct") {
    const clientId = String(body.client_id || "");
    if (!clientId) {
      return NextResponse.json({ error: "Falta cliente" }, { status: 400 });
    }

    if (body.use_default === true) {
      await sql`DELETE FROM hub_client_partner_pct WHERE client_id = ${clientId}`;
      const c = await sql`SELECT name FROM hub_clients WHERE id = ${clientId}`;
      await logActivity(
        "client_pct",
        `% default restaurado: ${c[0]?.name || "cliente"}`,
        { clientId },
      );
      return NextResponse.json({ ok: true });
    }

    const pcts = Array.isArray(body.pcts) ? body.pcts : [];
    await sql`DELETE FROM hub_client_partner_pct WHERE client_id = ${clientId}`;
    for (const row of pcts) {
      const partnerId = String(row.partner_id || "");
      const pct = Number(row.pct || 0);
      if (!partnerId) continue;
      await sql`
        INSERT INTO hub_client_partner_pct (client_id, partner_id, pct)
        VALUES (${clientId}, ${partnerId}, ${pct})
      `;
    }
    const c = await sql`SELECT name FROM hub_clients WHERE id = ${clientId}`;
    await logActivity(
      "client_pct",
      `% por cliente guardado: ${c[0]?.name || "cliente"}`,
      { clientId, pcts },
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}
