// POST /api/drive/media-token  { fileId }  (con la sesión en el header)
// Devuelve la URL para reproducir ese archivo, con un permiso de 1 hora solo para él.
// Se da solo si el archivo es de un cliente al que la persona tiene acceso.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { body, HttpError, requireCaller, sendError } from "../http";
import { crearTokenMedia, fileIdValido, puedeVerArchivo } from "../media-token";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"]);
    const { fileId } = body<{ fileId?: string }>(req);
    if (!fileIdValido(fileId)) throw new HttpError(400, "fileId required");
    if (!(await puedeVerArchivo(caller, fileId))) throw new HttpError(403, "No tenés acceso a este archivo");
    const { token, vence } = crearTokenMedia(fileId);
    res.status(200).json({
      url: `/api/drive/media?fileId=${encodeURIComponent(fileId)}&token=${encodeURIComponent(token)}`,
      expires_at: vence,
    });
  } catch (err) {
    sendError(res, err);
  }
}
