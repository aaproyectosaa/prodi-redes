import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { getSql } from "../sql";
import { arDay } from "../money";

function parseDay(s: string | null | undefined, fallback: string) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  return s;
}

async function ensureTable() {
  const sql = getSql();
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
  await sql`
    CREATE INDEX IF NOT EXISTS hub_extra_payments_paid_at_idx
    ON hub_extra_payments (paid_at DESC)
  `;
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
      id, payer_name, amount::float8 AS amount, notes, paid_at, created_at
    FROM hub_extra_payments
    WHERE paid_at >= ${fromTs}::timestamptz
      AND paid_at <= ${toTs}::timestamptz
    ORDER BY paid_at DESC
  `;

  return NextResponse.json({ from, to, items });
}

export async function POST(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "create");
  const sql = getSql();
  await ensureTable();

  if (action === "create") {
    const payer = String(body.payer_name || "").trim();
    const amount = Math.round(Number(body.amount || 0));
    const notes = String(body.notes || "").trim();
    const day = parseDay(body.paid_at, arDay());
    if (!payer || amount <= 0) {
      return NextResponse.json(
        { error: "Empresa/persona y monto (> 0) son obligatorios" },
        { status: 400 },
      );
    }
    const paidAt = `${day}T12:00:00-03:00`;
    const rows = await sql`
      INSERT INTO hub_extra_payments (payer_name, amount, notes, paid_at)
      VALUES (${payer}, ${amount}, ${notes}, ${paidAt}::timestamptz)
      RETURNING id, payer_name, amount::float8 AS amount, notes, paid_at
    `;
    await logActivity(
      "extra",
      `Cobro extra: ${payer} · $${amount.toLocaleString("es-AR")}`,
      { extraId: rows[0]?.id, amount, paid_at: day },
    );
    return NextResponse.json({ ok: true, item: rows[0] });
  }

  if (action === "update") {
    const id = String(body.id || "");
    const payer = String(body.payer_name || "").trim();
    const amount = Math.round(Number(body.amount || 0));
    const notes = String(body.notes ?? "").trim();
    const day = parseDay(body.paid_at, "");
    if (!id || !payer || amount <= 0) {
      return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
    }
    if (day) {
      const paidAt = `${day}T12:00:00-03:00`;
      await sql`
        UPDATE hub_extra_payments SET
          payer_name = ${payer},
          amount = ${amount},
          notes = ${notes},
          paid_at = ${paidAt}::timestamptz
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE hub_extra_payments SET
          payer_name = ${payer},
          amount = ${amount},
          notes = ${notes}
        WHERE id = ${id}
      `;
    }
    await logActivity("extra", `Cobro extra editado: ${payer}`, { extraId: id, amount });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const prev = await sql`
      SELECT payer_name, amount::float8 AS amount
      FROM hub_extra_payments WHERE id = ${id}
    `;
    await sql`DELETE FROM hub_extra_payments WHERE id = ${id}`;
    if (prev[0]) {
      await logActivity(
        "extra",
        `Cobro extra anulado: ${prev[0].payer_name} · $${Number(prev[0].amount).toLocaleString("es-AR")}`,
        { extraId: id },
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}
