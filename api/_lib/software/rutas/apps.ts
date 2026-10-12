import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { encrypt, listApps, toPublicApp } from "../apps";
import { getSql } from "../sql";
import { validateAccessToken } from "../mp";

export async function GET() {
  if (!(await requireSession())) return unauthorized();
  const apps = await listApps();
  const sql = getSql();
  const counts = await sql`
    SELECT
      a.id::text AS app_id,
      (SELECT COUNT(*)::int FROM hub_clients c WHERE c.app_id = a.id AND c.blacklisted = FALSE) AS clients,
      (SELECT COUNT(*)::int FROM hub_payments p WHERE p.app_id = a.id AND p.status = 'approved' AND p.fee > 0) AS payments,
      (SELECT COUNT(*)::int FROM hub_subscriptions s WHERE s.app_id = a.id AND COALESCE(s.hub_status, 'accepted') = 'accepted' AND COALESCE(s.hidden, FALSE) = FALSE) AS subscriptions
    FROM hub_mp_apps a
  `.catch(() => []);
  const byId = new Map(
    (counts as Array<Record<string, unknown>>).map((row) => [
      String(row.app_id),
      {
        clients: Number(row.clients || 0),
        payments: Number(row.payments || 0),
        subscriptions: Number(row.subscriptions || 0),
      },
    ]),
  );
  return NextResponse.json({
    apps: apps.map((app) => ({
      ...toPublicApp(app),
      counts: byId.get(app.id) || { clients: 0, payments: 0, subscriptions: 0 },
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Poné un nombre" }, { status: 400 });
  }

  const clientId = String(body.client_id || "").trim();
  const clientSecret = String(body.client_secret || "").trim();
  const publicKey = String(body.public_key || "").trim();
  const accessToken = String(body.access_token || "").trim();
  const webhookSecret = String(body.webhook_secret || "").trim();

  if (!clientId || !clientSecret || !accessToken) {
    return NextResponse.json(
      { error: "Faltan Client ID, Client Secret o Access Token" },
      { status: 400 },
    );
  }

  const v = await validateAccessToken(accessToken);
  if (!v.ok) {
    return NextResponse.json(
      {
        error: `No se pudo conectar con Mercado Pago: ${v.error}`,
        connection_status: "error",
      },
      { status: 400 },
    );
  }

  const connectionStatus = "ok" as const;
  const connectionError = null;
  const mpUserId = v.userId;
  const mpNickname = v.nickname;

  const sql = getSql();
  const rows = await sql`
    INSERT INTO hub_mp_apps (
      name, client_id, client_secret, public_key, access_token, webhook_secret,
      connection_status, connection_error, mp_user_id, mp_nickname
    ) VALUES (
      ${name},
      ${clientId},
      ${encrypt(clientSecret)},
      ${publicKey},
      ${encrypt(accessToken)},
      ${encrypt(webhookSecret)},
      ${connectionStatus},
      ${connectionError},
      ${mpUserId},
      ${mpNickname}
    )
    RETURNING *
  `;

  await logActivity("app_save", `App creada: ${name}`, { appId: rows[0]?.id });

  return NextResponse.json(
    {
      app: toPublicApp(rows[0] as never),
      connection: {
        ok: true,
        userId: mpUserId,
        nickname: mpNickname,
        message: mpNickname
          ? `Conectado como @${mpNickname} (ID ${mpUserId})`
          : `Conectado · cuenta MP ID ${mpUserId}`,
      },
    },
    { status: 201 },
  );
}
