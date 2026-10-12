import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getSql } from "../sql";
import { monthBounds, yearMonth } from "../money";

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const ym = req.nextUrl.searchParams.get("month") || yearMonth();
  const sql = getSql();

  const partners = await sql`
    SELECT id, name, pct::float8 AS pct, sort_order
    FROM hub_partners ORDER BY sort_order ASC
  `;

  const { from, to } = monthBounds(ym);
  const feeRow = await sql`
    SELECT COALESCE(SUM(p.fee) FILTER (WHERE p.status = 'approved' AND p.fee > 0), 0)::float8 AS fee
    FROM hub_payments p
    LEFT JOIN hub_clients cl
      ON cl.app_id = p.app_id AND cl.collector_id = p.collector_id
    WHERE COALESCE(p.paid_at, p.created_at) >= ${from.toISOString()}::timestamptz
      AND COALESCE(p.paid_at, p.created_at) <= ${to.toISOString()}::timestamptz
      AND COALESCE(cl.blacklisted, FALSE) = FALSE
  `;
  const totalFee = Number(feeRow[0]?.fee || 0);

  const existing = await sql`
    SELECT
      s.id, s.year_month, s.partner_id,
      s.amount_due::float8 AS amount_due,
      s.amount_paid::float8 AS amount_paid,
      s.notes, s.marked_paid_at,
      p.name AS partner_name, p.pct::float8 AS pct
    FROM hub_settlements s
    JOIN hub_partners p ON p.id = s.partner_id
    WHERE s.year_month = ${ym}
    ORDER BY p.sort_order ASC
  `;

  const byPartner = partners.map((p) => {
    const due = Math.round((totalFee * Number(p.pct)) / 100);
    const row = existing.find((e) => e.partner_id === p.id);
    return {
      partner_id: p.id as string,
      partner_name: p.name as string,
      pct: Number(p.pct),
      amount_due: row ? Number(row.amount_due) : due,
      amount_paid: row ? Number(row.amount_paid) : 0,
      notes: row ? String(row.notes || "") : "",
      marked_paid_at: row?.marked_paid_at || null,
      settlement_id: row?.id || null,
      suggested_due: due,
    };
  });

  const history = await sql`
    SELECT DISTINCT year_month FROM hub_settlements ORDER BY year_month DESC LIMIT 24
  `;

  return NextResponse.json({
    month: ym,
    totalFee,
    items: byPartner,
    months: history.map((h) => h.year_month),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = String(body.month || yearMonth());
  const partnerId = String(body.partner_id || "");
  const action = String(body.action || "save");
  const notes = String(body.notes || "");
  const amountDue = Number(body.amount_due ?? 0);
  const amountPaid = Number(body.amount_paid ?? 0);

  if (!partnerId) {
    return NextResponse.json({ error: "Falta socio" }, { status: 400 });
  }

  const sql = getSql();

  if (action === "mark_paid") {
    await sql`
      INSERT INTO hub_settlements (year_month, partner_id, amount_due, amount_paid, notes, marked_paid_at)
      VALUES (${ym}, ${partnerId}, ${amountDue}, ${amountDue}, ${notes}, NOW())
      ON CONFLICT (year_month, partner_id) DO UPDATE SET
        amount_due = EXCLUDED.amount_due,
        amount_paid = EXCLUDED.amount_due,
        notes = EXCLUDED.notes,
        marked_paid_at = NOW(),
        updated_at = NOW()
    `;
  } else if (action === "unmark") {
    await sql`
      INSERT INTO hub_settlements (year_month, partner_id, amount_due, amount_paid, notes, marked_paid_at)
      VALUES (${ym}, ${partnerId}, ${amountDue}, 0, ${notes}, NULL)
      ON CONFLICT (year_month, partner_id) DO UPDATE SET
        amount_paid = 0,
        marked_paid_at = NULL,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    `;
  } else {
    await sql`
      INSERT INTO hub_settlements (year_month, partner_id, amount_due, amount_paid, notes)
      VALUES (${ym}, ${partnerId}, ${amountDue}, ${amountPaid}, ${notes})
      ON CONFLICT (year_month, partner_id) DO UPDATE SET
        amount_due = EXCLUDED.amount_due,
        amount_paid = EXCLUDED.amount_paid,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    `;
  }

  return NextResponse.json({ ok: true });
}
