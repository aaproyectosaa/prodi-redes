import { NextRequest, NextResponse } from "../next-shim";
import { requireSession, unauthorized } from "../next-shim";
import { logActivity } from "../activity";
import { decrypt, encrypt, getAppById, toPublicApp } from "../apps";
import { getSql } from "../sql";
import { validateAccessToken, webhookUrl } from "../mp";
import type { MpApp } from "../types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const app = await getAppById(id);
  if (!app) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({
    app: toPublicApp(app),
    webhook_url: webhookUrl(app.id),
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const app = await getAppById(id);
  if (!app) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const name = body.name != null ? String(body.name).trim() : app.name;
  const clientId =
    body.client_id != null ? String(body.client_id).trim() : app.client_id;
  const publicKey =
    body.public_key != null ? String(body.public_key).trim() : app.public_key;

  let clientSecret = decrypt(app.client_secret);
  if (body.client_secret != null && String(body.client_secret).trim()) {
    clientSecret = String(body.client_secret).trim();
  }

  let accessToken = decrypt(app.access_token);
  if (body.access_token != null && String(body.access_token).trim()) {
    accessToken = String(body.access_token).trim();
  }

  let webhookSecret = decrypt(app.webhook_secret);
  if (body.webhook_secret != null && String(body.webhook_secret).trim()) {
    webhookSecret = String(body.webhook_secret).trim();
  }

  let connectionStatus = app.connection_status;
  let connectionError = app.connection_error;
  let mpUserId = app.mp_user_id;
  let mpNickname = app.mp_nickname;

  if (accessToken) {
    const v = await validateAccessToken(accessToken);
    if (v.ok) {
      connectionStatus = "ok";
      connectionError = null;
      mpUserId = v.userId;
      mpNickname = v.nickname;
    } else {
      connectionStatus = "error";
      connectionError = v.error;
    }
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE hub_mp_apps SET
      name = ${name},
      client_id = ${clientId},
      client_secret = ${encrypt(clientSecret)},
      public_key = ${publicKey},
      access_token = ${encrypt(accessToken)},
      webhook_secret = ${encrypt(webhookSecret)},
      connection_status = ${connectionStatus},
      connection_error = ${connectionError},
      mp_user_id = ${mpUserId},
      mp_nickname = ${mpNickname},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  await logActivity("app_save", `App actualizada: ${name}`, { appId: id });

  return NextResponse.json({
    app: toPublicApp(rows[0] as MpApp),
    webhook_url: webhookUrl(id),
  });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await ctx.params;
  const sql = getSql();
  await sql`DELETE FROM hub_mp_apps WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
