// POST /api/drive/media-token  { fileId, descarga? }  (con la sesión en el header)
// Devuelve la URL para reproducir ese archivo, con un permiso de 1 hora solo para él.
// Con descarga: true, la URL para bajarlo directo de Drive (videos de cualquier tamaño y fotos, sin pasar por el servidor).
// Se da solo si el archivo es de un cliente al que la persona tiene acceso.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { body, HttpError, requireCaller, sendError } from "../http";
import { crearTokenMedia, fileIdValido, puedeVerArchivo } from "../media-token";
import { getAppDriveAccessToken } from "../drive-connection";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** Que el archivo se pueda bajar con el link (lo mismo que se hace al subir). false si Drive no lo permite. */
async function abrirConLink(fileId: string): Promise<boolean> {
  const { accessToken } = await getAppDriveAccessToken();
  const r = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  await r.body?.cancel().catch(() => undefined);
  return r.ok;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "administracion", "programador", "cliente"]);
    const { fileId, descarga } = body<{ fileId?: string; descarga?: boolean }>(req);
    if (!fileIdValido(fileId)) throw new HttpError(400, "fileId required");
    if (!(await puedeVerArchivo(caller, fileId))) throw new HttpError(403, "No tenés acceso a este archivo");
    if (descarga) {
      if (!(await abrirConLink(fileId))) throw new HttpError(409, "Drive no deja bajar este archivo con el link (puede ser de otra cuenta).");
      res.status(200).json({ url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t` });
      return;
    }
    const { token, vence } = crearTokenMedia(fileId);
    res.status(200).json({
      url: `/api/drive/media?fileId=${encodeURIComponent(fileId)}&token=${encodeURIComponent(token)}`,
      expires_at: vence,
    });
  } catch (err) {
    sendError(res, err);
  }
}
