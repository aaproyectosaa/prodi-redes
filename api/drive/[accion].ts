// Google Drive: las 5 rutas de antes en una sola función (el plan de Vercel permite 12).
// /api/drive/start-auth · oauth-callback · access-token · media · disconnect  (mismas URLs que antes)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import accessToken from "../_lib/drive-acciones/access-token";
import disconnect from "../_lib/drive-acciones/disconnect";
import media from "../_lib/drive-acciones/media";
import oauthCallback from "../_lib/drive-acciones/oauth-callback";
import startAuth from "../_lib/drive-acciones/start-auth";

export const config = { maxDuration: 60 };

const ACCIONES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown> = {
  "access-token": accessToken,
  disconnect,
  media,
  "oauth-callback": oauthCallback,
  "start-auth": startAuth,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const fn = ACCIONES[String(req.query.accion ?? "")];
  if (!fn) {
    res.status(404).json({ error: "Acción desconocida" });
    return;
  }
  await fn(req, res);
}
