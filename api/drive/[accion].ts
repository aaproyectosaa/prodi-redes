// Google Drive: las rutas de antes en una sola función (el plan de Vercel permite 12).
// /api/drive/start-auth · oauth-callback · access-token · media-token · media · disconnect  (mismas URLs que antes)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import accessToken from "../_lib/drive-acciones/access-token";
import disconnect from "../_lib/drive-acciones/disconnect";
import media from "../_lib/drive-acciones/media";
import mediaToken from "../_lib/drive-acciones/media-token";
import oauthCallback from "../_lib/drive-acciones/oauth-callback";
import startAuth from "../_lib/drive-acciones/start-auth";

export const config = { maxDuration: 60 };

const ACCIONES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown> = {
  "access-token": accessToken,
  disconnect,
  media,
  "media-token": mediaToken,
  "oauth-callback": oauthCallback,
  "start-auth": startAuth,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const accion = String(req.query.accion ?? "");
  // Solo acciones propias (no "toString", "constructor", … del prototipo).
  if (!Object.hasOwn(ACCIONES, accion)) {
    res.status(404).json({ error: "Acción desconocida" });
    return;
  }
  await ACCIONES[accion](req, res);
}
