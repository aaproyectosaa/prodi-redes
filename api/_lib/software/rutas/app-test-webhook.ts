import { NextResponse, type NextRequest } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getAppById } from "../apps";
import { getSql } from "../sql";
import { webhookUrl } from "../mp";

type Ctx = { params: Promise<{ id: string }> };

/** Marca el endpoint como listo para recibir; el OK real llega cuando MP pega al webhook. */
export async function POST(_req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const app = await getAppById(id);
  if (!app) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const url = webhookUrl(id);
  const sql = getSql();

  // Self-ping so local/prod can verify the route is reachable
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-test": "1" },
      body: JSON.stringify({ action: "test", type: "test", data: { id: "test" } }),
    });
    if (res.ok) {
      await sql`
        UPDATE hub_mp_apps SET
          webhook_status = 'ok',
          last_webhook_at = NOW(),
          updated_at = NOW()
        WHERE id = ${id}
      `;
      return NextResponse.json({
        ok: true,
        webhook_url: url,
        message: "Webhook respondió OK. Pegá esta URL en Mercado Pago Developers → Webhooks.",
      });
    }
    await sql`
      UPDATE hub_mp_apps SET webhook_status = 'error', updated_at = NOW() WHERE id = ${id}
    `;
    return NextResponse.json(
      {
        ok: false,
        webhook_url: url,
        error: `El endpoint respondió ${res.status}. Revisá APP_URL.`,
      },
      { status: 502 },
    );
  } catch (e) {
    await sql`
      UPDATE hub_mp_apps SET webhook_status = 'error', updated_at = NOW() WHERE id = ${id}
    `;
    return NextResponse.json(
      {
        ok: false,
        webhook_url: url,
        error: e instanceof Error ? e.message : "No se pudo probar el webhook",
      },
      { status: 502 },
    );
  }
}
