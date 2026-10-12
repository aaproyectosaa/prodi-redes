import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getAppById } from "../apps";
import { detectCollectors, listClients } from "../clients";
import { getSql } from "../sql";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const app = await getAppById(id);
  if (!app) return NextResponse.json({ error: "App no encontrada" }, { status: 404 });

  const clients = await listClients(id);
  const detected = await detectCollectors(id);
  return NextResponse.json({ clients, detected });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const app = await getAppById(id);
  if (!app) return NextResponse.json({ error: "App no encontrada" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "create");

  const sql = getSql();

  if (action === "detect_import") {
    // Import all unknown collectors as clients with a default name
    const detected = await detectCollectors(id);
    let imported = 0;
    for (const d of detected) {
      const name =
        String(body.names?.[d.collector_id] || "").trim() ||
        d.collector_name ||
        `Cliente ${d.collector_id}`;
      await sql`
        INSERT INTO hub_clients (app_id, name, collector_id)
        VALUES (${id}, ${name}, ${d.collector_id})
        ON CONFLICT (app_id, collector_id) DO NOTHING
      `;
      await sql`
        UPDATE hub_payments SET collector_name = ${name}, updated_at = NOW()
        WHERE app_id = ${id} AND collector_id = ${d.collector_id}
      `;
      imported++;
    }
    return NextResponse.json({ ok: true, imported, clients: await listClients(id) });
  }

  const name = String(body.name || "").trim();
  const collectorId = String(body.collector_id || "").trim();
  const notes = String(body.notes || "").trim();
  if (!name || !collectorId) {
    return NextResponse.json(
      { error: "Poné nombre y ID del vendedor (collector_id)" },
      { status: 400 },
    );
  }

  try {
    const rows = await sql`
      INSERT INTO hub_clients (app_id, name, collector_id, notes)
      VALUES (${id}, ${name}, ${collectorId}, ${notes})
      ON CONFLICT (app_id, collector_id) DO UPDATE SET
        name = EXCLUDED.name,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
    `;
    await sql`
      UPDATE hub_payments SET collector_name = ${name}, updated_at = NOW()
      WHERE app_id = ${id} AND collector_id = ${collectorId}
    `;
    return NextResponse.json({ client: rows[0] }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo guardar" },
      { status: 500 },
    );
  }
}
