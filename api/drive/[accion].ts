// Google Drive: las rutas de antes en una sola función (el plan de Vercel permite 12).
// /api/drive/start-auth · oauth-callback · access-token · media-token · media · disconnect  (mismas URLs que antes)
// /api/drive/chat-subida · chat-archivo  (archivos del chat, ver _lib/drive-acciones/chat.ts)
// /api/drive/video-subida · video-archivo · video-listo  (material que manda el cliente, ver _lib/drive-acciones/video-material.ts)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import accessToken from "../_lib/drive-acciones/access-token";
import { chatArchivo, chatSubida } from "../_lib/drive-acciones/chat";
import disconnect from "../_lib/drive-acciones/disconnect";
import media from "../_lib/drive-acciones/media";
import mediaToken from "../_lib/drive-acciones/media-token";
import oauthCallback from "../_lib/drive-acciones/oauth-callback";
import startAuth from "../_lib/drive-acciones/start-auth";
import { videoArchivo, videoListo, videoSubida } from "../_lib/drive-acciones/video-material";

export const config = { maxDuration: 60 };

const ACCIONES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown> = {
  "access-token": accessToken,
  "chat-archivo": chatArchivo,
  "chat-subida": chatSubida,
  disconnect,
  media,
  "media-token": mediaToken,
  "oauth-callback": oauthCallback,
  "start-auth": startAuth,
  "video-archivo": videoArchivo,
  "video-listo": videoListo,
  "video-subida": videoSubida,
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
