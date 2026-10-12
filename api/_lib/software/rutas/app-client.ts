import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getSql } from "../sql";

type Ctx = { params: Promise<{ id: string; clientId: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id, clientId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const sql = getSql();

  const existing = await sql`
    SELECT * FROM hub_clients WHERE id = ${clientId} AND app_id = ${id} LIMIT 1
  `;
  if (!existing[0]) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  const name =
    body.name != null ? String(body.name).trim() : String(existing[0].name);
  const notes =
    body.notes != null ? String(body.notes).trim() : String(existing[0].notes || "");
  const active =
    body.active != null ? Boolean(body.active) : Boolean(existing[0].active);
  const collectorId =
    body.collector_id != null
      ? String(body.collector_id).trim()
      : String(existing[0].collector_id);

  if (!name || !collectorId) {
    return NextResponse.json({ error: "Nombre e ID requeridos" }, { status: 400 });
  }

  const rows = await sql`
    UPDATE hub_clients SET
      name = ${name},
      notes = ${notes},
      active = ${active},
      collector_id = ${collectorId},
      updated_at = NOW()
    WHERE id = ${clientId} AND app_id = ${id}
    RETURNING *
  `;

  await sql`
    UPDATE hub_payments SET collector_name = ${name}, updated_at = NOW()
    WHERE app_id = ${id} AND collector_id = ${collectorId}
  `;

  return NextResponse.json({ client: rows[0] });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id, clientId } = await ctx.params;
  const sql = getSql();
  await sql`DELETE FROM hub_clients WHERE id = ${clientId} AND app_id = ${id}`;
  return NextResponse.json({ ok: true });
}
