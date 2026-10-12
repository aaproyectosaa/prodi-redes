import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { backfillClientsFromPayments, listAllClients } from "../clients";
import { getSql } from "../sql";

export async function GET(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();

  try {
    const backfill = req.nextUrl.searchParams.get("backfill") === "1";
    const list = req.nextUrl.searchParams.get("list") || "active";

    let paymentsLinked = 0;
    let clientsTotal = 0;
    if (backfill) {
      const result = await backfillClientsFromPayments();
      paymentsLinked = result.paymentsLinked;
      clientsTotal = result.clientsTotal;
    }

    const blacklisted =
      list === "blacklisted" ? true : list === "active" ? false : undefined;
    const q = req.nextUrl.searchParams.get("q") || "";
    const appId = req.nextUrl.searchParams.get("appId") || "";
    const from = req.nextUrl.searchParams.get("from") || "";
    const to = req.nextUrl.searchParams.get("to") || "";

    const clients = await listAllClients({
      ...(blacklisted === undefined ? {} : { blacklisted }),
      q,
      appId,
      from: from || null,
      to: to || null,
    });

    const sql = getSql();
    const countRows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE blacklisted = FALSE)::int AS active,
        COUNT(*) FILTER (WHERE blacklisted = TRUE)::int AS blacklisted
      FROM hub_clients
    `;

    return NextResponse.json({
      clients,
      paymentsLinked,
      clientsTotal: clientsTotal || clients.length,
      counts: countRows[0] || { active: 0, blacklisted: 0 },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Error al cargar clientes",
        clients: [],
        counts: { active: 0, blacklisted: 0 },
      },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "");
    if (!id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const sql = getSql();
    const existing = await sql`SELECT * FROM hub_clients WHERE id = ${id} LIMIT 1`;
    if (!existing[0]) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const name =
      body.name != null ? String(body.name).trim() : String(existing[0].name);
    const notes =
      body.notes != null ? String(body.notes) : String(existing[0].notes || "");
    const blacklisted =
      body.blacklisted != null
        ? Boolean(body.blacklisted)
        : Boolean(existing[0].blacklisted);

    if (!name) {
      return NextResponse.json({ error: "Falta nombre" }, { status: 400 });
    }

    const rows = await sql`
      UPDATE hub_clients SET
        name = ${name},
        notes = ${notes},
        blacklisted = ${blacklisted},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    await sql`
      UPDATE hub_payments SET collector_name = ${name}, updated_at = NOW()
      WHERE app_id = ${rows[0].app_id} AND collector_id = ${rows[0].collector_id}
    `;

    const prevName = String(existing[0].name);
    const prevBlack = Boolean(existing[0].blacklisted);
    if (blacklisted !== prevBlack) {
      await logActivity(
        blacklisted ? "client_blacklist" : "client_restore",
        blacklisted
          ? `Lista negra: ${name}`
          : `Restaurado: ${name}`,
        { clientId: id },
      );
    } else if (name !== prevName) {
      await logActivity("client_rename", `Renombrado: ${prevName} → ${name}`, {
        clientId: id,
      });
    }

    return NextResponse.json({ client: rows[0] });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al guardar" },
      { status: 500 },
    );
  }
}
