import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { getSql } from "../sql";
import { monthBounds, yearMonth } from "../money";

function parseYm(raw: string | null | undefined, fallback: string) {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return fallback;
}

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const sql = getSql();
  const month = parseYm(req.nextUrl.searchParams.get("month"), yearMonth());
  const list = req.nextUrl.searchParams.get("list") === "archived" ? "archived" : "active";
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const qLike = q ? `%${q}%` : null;

  // Ensure tables exist (idempotent for prod without migrate script)
  await sql`
    CREATE TABLE IF NOT EXISTS hub_maintenance_clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      monthly_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS hub_maintenance_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES hub_maintenance_clients(id) ON DELETE CASCADE,
      year_month TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, year_month)
    )
  `;

  const clientsRaw = await sql`
    SELECT
      c.id, c.name, c.monthly_amount::float8 AS monthly_amount,
      c.notes, c.active, c.created_at, c.updated_at,
      p.id AS payment_id,
      p.amount::float8 AS paid_amount,
      p.paid_at,
      p.notes AS payment_notes
    FROM hub_maintenance_clients c
    LEFT JOIN hub_maintenance_payments p
      ON p.client_id = c.id AND p.year_month = ${month}
    WHERE
      ((${list} = 'archived' AND c.active = FALSE) OR (${list} <> 'archived' AND c.active = TRUE))
      AND (${qLike}::text IS NULL OR c.name ILIKE ${qLike} OR COALESCE(c.notes, '') ILIKE ${qLike})
    ORDER BY c.name ASC
  `;

  const allPays = await sql`
    SELECT
      p.client_id::text AS client_id,
      p.year_month,
      p.amount::float8 AS amount,
      p.paid_at
    FROM hub_maintenance_payments p
    JOIN hub_maintenance_clients c ON c.id = p.client_id
    WHERE c.active = TRUE
    ORDER BY p.year_month ASC
  `;
  const paidByClient: Record<string, string[]> = {};
  for (const row of allPays) {
    const cid = String(row.client_id);
    if (!paidByClient[cid]) paidByClient[cid] = [];
    paidByClient[cid].push(String(row.year_month));
  }
  const clients = clientsRaw.map((c) => {
    const paidMonths = paidByClient[String(c.id)] || [];
    const future = paidMonths.filter((ym) => ym > month);
    return {
      ...c,
      paid_months: paidMonths,
      prepaid_until: future.length ? future[future.length - 1] : null,
    };
  });

  const mb = monthBounds(month);
  const collectedRows = await sql`
    SELECT COALESCE(SUM(p.amount), 0)::float8 AS total, COUNT(*)::int AS count
    FROM hub_maintenance_payments p
    WHERE p.paid_at >= ${mb.from.toISOString()}::timestamptz
      AND p.paid_at <= ${mb.to.toISOString()}::timestamptz
  `;
  const collected_in_month = Number(collectedRows[0]?.total || 0);
  const collected_count = Number(collectedRows[0]?.count || 0);

  const recent = await sql`
    SELECT
      p.id, p.year_month, p.amount::float8 AS amount, p.paid_at, p.notes,
      c.id AS client_id, c.name AS client_name
    FROM hub_maintenance_payments p
    JOIN hub_maintenance_clients c ON c.id = p.client_id
    ORDER BY p.paid_at DESC
    LIMIT 120
  `;

  const partners = await sql`
    SELECT id, name, pct::float8 AS pct, sort_order
    FROM hub_partners
    ORDER BY sort_order ASC, name ASC
  `;

  return NextResponse.json({
    month,
    clients,
    recent,
    partners,
    collected_in_month,
    collected_count,
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "create");
  const sql = getSql();

  if (action === "create") {
    const name = String(body.name || "").trim();
    const monthly = Math.round(Number(body.monthly_amount || 0));
    const notes = String(body.notes || "").trim();
    if (!name || monthly <= 0) {
      return NextResponse.json(
        { error: "Nombre y monto mensual (> 0) son obligatorios" },
        { status: 400 },
      );
    }
    const rows = await sql`
      INSERT INTO hub_maintenance_clients (name, monthly_amount, notes)
      VALUES (${name}, ${monthly}, ${notes})
      RETURNING id, name, monthly_amount::float8 AS monthly_amount
    `;
    await logActivity("maintenance", `Mantenimiento: alta ${name} · $${monthly}/mes`, {
      clientId: rows[0]?.id,
      monthly,
    });
    return NextResponse.json({ ok: true, client: rows[0] });
  }

  if (action === "update") {
    const id = String(body.id || "");
    const name = String(body.name || "").trim();
    const monthly = Math.round(Number(body.monthly_amount || 0));
    const notes = String(body.notes ?? "").trim();
    if (!id || !name || monthly <= 0) {
      return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
    }
    await sql`
      UPDATE hub_maintenance_clients SET
        name = ${name},
        monthly_amount = ${monthly},
        notes = ${notes},
        updated_at = NOW()
      WHERE id = ${id}
    `;
    await logActivity("maintenance", `Mantenimiento: editó ${name}`, { clientId: id, monthly });
    return NextResponse.json({ ok: true });
  }

  if (action === "deactivate") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const prev = await sql`SELECT name FROM hub_maintenance_clients WHERE id = ${id}`;
    await sql`
      UPDATE hub_maintenance_clients SET active = FALSE, updated_at = NOW()
      WHERE id = ${id}
    `;
    await logActivity("maintenance", `Mantenimiento: archivó ${prev[0]?.name || id}`, {
      clientId: id,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "reactivate") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const prev = await sql`SELECT name FROM hub_maintenance_clients WHERE id = ${id}`;
    await sql`
      UPDATE hub_maintenance_clients SET active = TRUE, updated_at = NOW()
      WHERE id = ${id}
    `;
    await logActivity("maintenance", `Mantenimiento: restauró ${prev[0]?.name || id}`, {
      clientId: id,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "mark_paid") {
    const id = String(body.id || body.client_id || "");
    if (!id) return NextResponse.json({ error: "Falta cliente" }, { status: 400 });

    const client = await sql`
      SELECT id, name, monthly_amount::float8 AS monthly_amount
      FROM hub_maintenance_clients
      WHERE id = ${id} AND active = TRUE
      LIMIT 1
    `;
    if (!client[0]) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const rawMonths = Array.isArray(body.year_months)
      ? body.year_months
      : [body.year_month];
    const months = [
      ...new Set(
        rawMonths
          .map((m: unknown) => parseYm(String(m || ""), ""))
          .filter((m: string) => /^\d{4}-\d{2}$/.test(m)),
      ),
    ].sort() as string[];
    if (!months.length) {
      months.push(yearMonth());
    }
    if (months.length > 24) {
      return NextResponse.json({ error: "Máximo 24 meses" }, { status: 400 });
    }

    const amount =
      body.amount != null && Number(body.amount) > 0
        ? Math.round(Number(body.amount))
        : Math.round(Number(client[0].monthly_amount));
    const notes =
      String(body.notes || "").trim() ||
      (months.length > 1 ? "Adelantado" : "");

    const created: string[] = [];
    const skipped: string[] = [];
    for (const ym of months) {
      const exists = await sql`
        SELECT id FROM hub_maintenance_payments
        WHERE client_id = ${id} AND year_month = ${ym}
        LIMIT 1
      `;
      if (exists[0]) {
        skipped.push(ym);
        continue;
      }
      await sql`
        INSERT INTO hub_maintenance_payments (client_id, year_month, amount, notes)
        VALUES (${id}, ${ym}, ${amount}, ${notes})
      `;
      created.push(ym);
    }

    if (!created.length) {
      return NextResponse.json(
        { error: "Esos meses ya estaban cobrados" },
        { status: 400 },
      );
    }

    const total = amount * created.length;
    await logActivity(
      "maintenance",
      created.length > 1
        ? `Mantenimiento adelantado: ${client[0].name} · ${created[0]}→${created[created.length - 1]} · ${created.length} meses · $${total.toLocaleString("es-AR")}`
        : `Mantenimiento cobrado: ${client[0].name} · ${created[0]} · $${amount.toLocaleString("es-AR")}`,
      { clientId: id, months: created, skipped, amount, total },
    );
    return NextResponse.json({
      ok: true,
      months: created,
      skipped,
      amount,
      total,
    });
  }

  if (action === "unmark_paid") {
    const id = String(body.id || body.client_id || "");
    const month = parseYm(body.year_month, yearMonth());
    if (!id) return NextResponse.json({ error: "Falta cliente" }, { status: 400 });
    const prev = await sql`
      SELECT p.amount::float8 AS amount, c.name
      FROM hub_maintenance_payments p
      JOIN hub_maintenance_clients c ON c.id = p.client_id
      WHERE p.client_id = ${id} AND p.year_month = ${month}
    `;
    await sql`
      DELETE FROM hub_maintenance_payments
      WHERE client_id = ${id} AND year_month = ${month}
    `;
    if (prev[0]) {
      await logActivity(
        "maintenance",
        `Mantenimiento anulado: ${prev[0].name} · ${month}`,
        { clientId: id, year_month: month },
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}
