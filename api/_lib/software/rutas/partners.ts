import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { getSql } from "../sql";

export async function GET() {
  if (!(await requireSession())) return unauthorized();
  const sql = getSql();

  await sql`
    ALTER TABLE hub_partners
    ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE
  `.catch(() => undefined);

  const partners = await sql`
    SELECT id, name, pct::float8 AS pct, sort_order, is_cash
    FROM hub_partners
    ORDER BY sort_order ASC, name ASC
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

  const clients = await sql`
    SELECT id, name
    FROM hub_clients
    WHERE blacklisted = FALSE
    ORDER BY name ASC
  `;

  const clientSplits = clients.map((c) => {
    const id = String(c.id);
    const custom = customByClient[id];
    return {
      client_id: id,
      client_name: c.name as string,
      custom: Boolean(custom),
      pcts: partners.map((p) => {
        const pid = String(p.id);
        return {
          partner_id: pid,
          partner_name: p.name as string,
          pct: custom ? Number(custom[pid] ?? 0) : Number(p.pct),
        };
      }),
    };
  });

  return NextResponse.json({ partners, clientSplits });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const partners = Array.isArray(body.partners) ? body.partners : [];
  if (!partners.length) {
    return NextResponse.json({ error: "Sin socios" }, { status: 400 });
  }

  const sql = getSql();
  await sql`
    ALTER TABLE hub_partners
    ADD COLUMN IF NOT EXISTS is_cash BOOLEAN NOT NULL DEFAULT FALSE
  `.catch(() => undefined);
  const caja = partners.find((p: { is_cash?: boolean }) => Boolean(p.is_cash));
  const cajaId = caja ? String(caja.id) : null;
  for (const p of partners) {
    const id = String(p.id);
    const name = String(p.name || "").trim();
    const pct = Number(p.pct || 0);
    if (!id || !name) continue;
    await sql`
      UPDATE hub_partners SET
        name = ${name},
        pct = ${pct},
        is_cash = ${id === cajaId},
        updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  await logActivity("partner_update", "Reparto actualizado: nombres y % general");
  const rows = await sql`
    SELECT id, name, pct::float8 AS pct, sort_order, is_cash
    FROM hub_partners
    ORDER BY sort_order ASC, name ASC
  `;
  return NextResponse.json({ partners: rows });
}

export async function POST(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const pct = Number(body.pct ?? 0);
  if (!name) {
    return NextResponse.json({ error: "Poné un nombre" }, { status: 400 });
  }

  const sql = getSql();
  const max = await sql`SELECT COALESCE(MAX(sort_order), 0)::int AS n FROM hub_partners`;
  const sort = Number(max[0]?.n || 0) + 1;
  const rows = await sql`
    INSERT INTO hub_partners (name, pct, sort_order)
    VALUES (${name}, ${pct}, ${sort})
    RETURNING id, name, pct::float8 AS pct, sort_order
  `;
  await logActivity("partner_update", `Persona agregada al reparto: ${name}`);
  return NextResponse.json({ partner: rows[0] }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const sql = getSql();
  const count = await sql`SELECT COUNT(*)::int AS n FROM hub_partners`;
  if (Number(count[0]?.n || 0) <= 1) {
    return NextResponse.json(
      { error: "Tiene que quedar al menos un socio" },
      { status: 400 },
    );
  }

  const prev = await sql`SELECT name FROM hub_partners WHERE id = ${id}`;
  const moves = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM hub_payouts WHERE partner_id = ${id}) AS payouts,
      (SELECT COUNT(*)::int FROM hub_settlements WHERE partner_id = ${id}) AS settlements
  `;
  if (Number(moves[0]?.payouts || 0) > 0 || Number(moves[0]?.settlements || 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Este socio tiene transferencias o liquidaciones. No se elimina para no perder el historial.",
      },
      { status: 400 },
    );
  }
  await sql`DELETE FROM hub_client_partner_pct WHERE partner_id = ${id}`;
  await sql`DELETE FROM hub_partners WHERE id = ${id}`;
  await logActivity("partner_update", `Persona sacada del reparto: ${prev[0]?.name || id}`);
  return NextResponse.json({ ok: true });
}
