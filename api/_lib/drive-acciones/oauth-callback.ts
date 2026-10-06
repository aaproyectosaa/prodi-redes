// GET /api/drive/oauth-callback
// Google redirects here after consent. We:
//   1. Validate the signed state and recover the user's uid
//   2. Exchange the code for tokens (gets us a refresh_token)
//   3. Fetch the user info to record email + sub
//   4. Ensure the "Progreso" root folder exists in their Drive
//   5. Persist the encrypted refresh_token + connection metadata in Firestore
//   6. Render a tiny HTML page that posts a message to the opener and closes
//
// No auth header here — Google calls this URL directly. The state HMAC is
// what authenticates the request.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../db";
import { encrypt } from "../crypto";
import {
  ensureRootFolder,
  exchangeCodeForTokens,
  fetchUserInfo,
  GoogleAuthError,
  getRedirectUri,
} from "../google";
import { verifyState } from "../state";

const ROOT_FOLDER_NAME = "Progreso";
const COLLECTION = "app_settings";
const DOC_ID = "drive_connection";

export const config = {
  maxDuration: 30,
};

const escaparHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function htmlResponse(opts: {
  ok: boolean;
  message: string;
  detail?: string;
}): string {
  const payload = JSON.stringify({
    type: "drive-oauth-result",
    ok: opts.ok,
    message: opts.message,
    detail: opts.detail ?? null,
  });
  const escaped = payload.replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${opts.ok ? "Conexión exitosa" : "Error de conexión"}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #1a1a1a; color: #eee;
         display: flex; align-items: center; justify-content: center;
         height: 100vh; margin: 0; text-align: center; }
  .card { max-width: 420px; padding: 32px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { font-size: 14px; opacity: 0.8; margin: 0; }
  .ok h1 { color: #4ade80; }
  .err h1 { color: #f87171; }
</style>
</head>
<body>
<div class="card ${opts.ok ? "ok" : "err"}">
  <h1>${escaparHtml(opts.message)}</h1>
  ${opts.detail ? `<p>${escaparHtml(opts.detail)}</p>` : ""}
  <p style="margin-top:16px;">Podés cerrar esta ventana.</p>
</div>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage(${escaped}, window.location.origin);
    }
  } catch (_) { /* ignore */ }
  setTimeout(function() { try { window.close(); } catch(_){} }, ${
    opts.ok ? 800 : 4000
  });
</script>
</body>
</html>`;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
  );

  const code = (req.query.code as string | undefined) ?? "";
  const state = (req.query.state as string | undefined) ?? "";
  const errorParam = req.query.error as string | undefined;

  if (errorParam) {
    res
      .status(400)
      .send(
        htmlResponse({
          ok: false,
          message: "Google rechazó la autorización",
          detail: errorParam,
        })
      );
    return;
  }

  if (!code || !state) {
    res.status(400).send(
      htmlResponse({
        ok: false,
        message: "Faltan parámetros",
        detail: "code o state ausente",
      })
    );
    return;
  }

  let uid: string;
  try {
    uid = verifyState(state).uid;
    // Solo un super admin puede cambiar la cuenta de Drive de la app.
    const prof = await adminDb().collection("profiles").doc(uid).get();
    if (prof.data()?.role !== "admin") throw new Error("Solo el super admin puede conectar Drive");
  } catch (err) {
    res
      .status(400)
      .send(
        htmlResponse({
          ok: false,
          message: "State inválido",
          detail: err instanceof Error ? err.message : "verify failed",
        })
      );
    return;
  }

  const redirectUri = getRedirectUri(req);

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refresh_token) {
      // This happens if the user previously authorized this app on the same
      // Google account and Google decided not to reissue a refresh_token.
      // The auth URL we build sets prompt=consent, which forces a fresh
      // refresh_token, so this branch should be rare.
      throw new GoogleAuthError(
        "Google no devolvió refresh_token. Revoca el acceso en https://myaccount.google.com/permissions y reintentá.",
        400
      );
    }

    const userInfo = await fetchUserInfo(tokens.access_token);
    const rootFolderId = await ensureRootFolder(
      ROOT_FOLDER_NAME,
      tokens.access_token
    );

    const encrypted = encrypt(tokens.refresh_token);
    const now = new Date().toISOString();

    const db = adminDb();
    await db
      .collection(COLLECTION)
      .doc(DOC_ID)
      .set(
        {
          project_id: "_global_",
          owner_uid: uid,
          email: userInfo.email,
          google_sub: userInfo.sub,
          root_folder_id: rootFolderId,
          status: "connected",
          connected_at: now,
          last_used_at: now,
          last_error: null,
          // Encrypted refresh token (server-only field).
          refresh_token_enc: encrypted,
          // Auth flow version, lets us migrate cleanly later.
          auth_version: 2,
        },
        { merge: true }
      );

    res.status(200).send(
      htmlResponse({
        ok: true,
        message: "Drive conectado",
        detail: userInfo.email,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado";
    res
      .status(500)
      .send(
        htmlResponse({
          ok: false,
          message: "No se pudo conectar Drive",
          detail: message,
        })
      );
  }
}
