import { NextResponse, type NextRequest } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { getAppById } from "../apps";
import { getSql } from "../sql";
import { RETRY_DAYS } from "../fee-retry";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Borra pagos sin fee de marketplace, pero solo los viejos.
 * Los recientes (pending_fee) se conservan para que el sync los reintente.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const app = await getAppById(id);
  if (!app) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const sql = getSql();
  const del = await sql`
    DELETE FROM hub_payments
    WHERE app_id = ${id}
      AND (fee IS NULL OR fee <= 0)
      AND COALESCE(paid_at, created_at) < NOW() - (${RETRY_DAYS}::text || ' days')::interval
    RETURNING id
  `;

  return NextResponse.json({
    ok: true,
    deleted: del.length,
    kept_recent_days: RETRY_DAYS,
  });
}
