import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { getSql } from "../sql";
import { arDay, money } from "../money";
import { parseExpenseCategory } from "../expense-category";

function parseDay(s: string | null | undefined, fallback: string) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  return s;
}

async function ensureTable() {
  const sql = getSql();
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
  await sql`
    CREATE INDEX IF NOT EXISTS hub_expenses_paid_at_idx
    ON hub_expenses (paid_at DESC)
  `;
  await sql`
    ALTER TABLE hub_partners
    ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE
  `.catch(() => undefined);
}

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const sql = getSql();
  await ensureTable();
  const today = arDay();
  const from = parseDay(req.nextUrl.searchParams.get("from"), `${today.slice(0, 4)}-01-01`);
  const to = parseDay(req.nextUrl.searchParams.get("to"), today);
  const fromTs = `${from}T00:00:00-03:00`;
  const toTs = `${to}T23:59:59.999-03:00`;

  const items = await sql`
    SELECT
      e.id, e.description, e.amount::float8 AS amount, e.category,
      e.partner_id, pr.name AS partner_name,
      e.notes, e.paid_at, e.created_at
    FROM hub_expenses e
    LEFT JOIN hub_partners pr ON pr.id = e.partner_id
    WHERE e.paid_at >= ${fromTs}::timestamptz
      AND e.paid_at <= ${toTs}::timestamptz
    ORDER BY e.paid_at DESC
  `;

  const totalRow = await sql`
    SELECT COALESCE(SUM(amount), 0)::float8 AS total, COUNT(*)::int AS count
    FROM hub_expenses
    WHERE paid_at >= ${fromTs}::timestamptz
      AND paid_at <= ${toTs}::timestamptz
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

  const partners = await sql`
    SELECT id, name, pct::float8 AS pct, sort_order, is_cash
    FROM hub_partners
    ORDER BY sort_order ASC, name ASC
  `;

  const cajaPartner = partners.find((p) => p.is_cash);
  let caja: {
    partner_id: string | null;
    partner_name: string | null;
    transferred: number;
  } = { partner_id: null, partner_name: null, transferred: 0 };
  if (cajaPartner) {
    const row = await sql`
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM hub_payouts
      WHERE period_from <= ${to}::date AND period_to >= ${from}::date
        AND partner_id = ${String(cajaPartner.id)}::uuid
    `;
    caja = {
      partner_id: String(cajaPartner.id),
      partner_name: String(cajaPartner.name),
      transferred: Math.round(Number(row[0]?.total || 0)),
    };
  }

  return NextResponse.json({
    from,
    to,
    items,
    partners,
    caja,
    totals: {
      total: Number(totalRow[0]?.total || 0),
      count: Number(totalRow[0]?.count || 0),
      byCategory,
      byPartner,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "create");
  const sql = getSql();
  await ensureTable();

  if (action === "create") {
    const description = String(body.description || "").trim();
    const amount = Math.round(Number(body.amount || 0));
    const category = parseExpenseCategory(body.category);
    const partnerId = String(body.partner_id || "").trim() || null;
    const notes = String(body.notes || "").trim();
    const day = parseDay(body.paid_at, arDay());
    if (!description || amount <= 0) {
      return NextResponse.json(
        { error: "Descripción y monto (> 0) son obligatorios" },
        { status: 400 },
      );
    }
    const paidAt = `${day}T12:00:00-03:00`;
    const rows = await sql`
      INSERT INTO hub_expenses (description, amount, category, partner_id, notes, paid_at)
      VALUES (${description}, ${amount}, ${category}, ${partnerId}, ${notes}, ${paidAt}::timestamptz)
      RETURNING id, description, amount::float8 AS amount, category, partner_id, notes, paid_at
    `;
    await logActivity(
      "expense",
      `Gasto: ${description} · $${amount.toLocaleString("es-AR")}`,
      { expenseId: rows[0]?.id, amount, category, partnerId, paid_at: day },
    );
    return NextResponse.json({ ok: true, item: rows[0] });
  }

  if (action === "update") {
    const id = String(body.id || "");
    const description = String(body.description || "").trim();
    const amount = Math.round(Number(body.amount || 0));
    const category = parseExpenseCategory(body.category);
    const partnerId = String(body.partner_id || "").trim() || null;
    const notes = String(body.notes ?? "").trim();
    const day = parseDay(body.paid_at, "");
    if (!id || !description || amount <= 0) {
      return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
    }
    if (day) {
      const paidAt = `${day}T12:00:00-03:00`;
      await sql`
        UPDATE hub_expenses SET
          description = ${description},
          amount = ${amount},
          category = ${category},
          partner_id = ${partnerId},
          notes = ${notes},
          paid_at = ${paidAt}::timestamptz
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE hub_expenses SET
          description = ${description},
          amount = ${amount},
          category = ${category},
          partner_id = ${partnerId},
          notes = ${notes}
        WHERE id = ${id}
      `;
    }
    await logActivity("expense", `Gasto editado: ${description}`, {
      expenseId: id,
      amount,
      category,
      partnerId,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const prev = await sql`
      SELECT description, amount::float8 AS amount
      FROM hub_expenses WHERE id = ${id}
    `;
    await sql`DELETE FROM hub_expenses WHERE id = ${id}`;
    if (prev[0]) {
      await logActivity(
        "expense",
        `Gasto anulado: ${prev[0].description} · ${money(Number(prev[0].amount))}`,
        { expenseId: id },
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}
