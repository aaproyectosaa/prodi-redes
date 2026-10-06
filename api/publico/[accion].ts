// Aprobación del cliente sin entrar al sistema (link firmado que llega por WhatsApp).
// POST /api/publico/video      { t }                               → datos del video
// POST /api/publico/responder  { t, decision, nota?, rating? }     → aprueba o pide cambios
// GET  /api/publico/media?t=…&fileId=…                             → reproduce el video final
// POST /api/publico/link       { video_id }  (equipo)              → genera el link para mandar

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../_lib/db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError } from "../_lib/http";
import { leerTokenAprobacion, linkAprobacion } from "../_lib/aprobacion";
import { leerVideoPublico, responderCliente } from "../_lib/videos-server";
import { streamDriveFile } from "../_lib/drive-stream";

export const config = { maxDuration: 60 };

async function link(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor"]);
  const { video_id } = body<{ video_id?: string }>(req);
  if (!video_id) throw new HttpError(400, "Falta video_id");
  const v = (await adminDb().collection("videos").doc(video_id).get()).data();
  if (!v) throw new HttpError(404, "Video no encontrado");
  await assertProjectAccess(caller, v.proyecto_id);
  if (v.etapa !== "revision_cliente") throw new HttpError(409, "El video todavía no está para aprobar");
  return { url: linkAprobacion(appUrl(req), video_id, v.rondas ?? 0) };
}

async function responder(req: VercelRequest) {
  const b = body<{ t?: string; decision?: string; nota?: string; rating?: number }>(req);
  const { videoId, ronda } = leerTokenAprobacion(String(b.t ?? ""));
  const decision = b.decision === "aprobar" ? "aprobar" : b.decision === "cambios" ? "cambios" : null;
  if (!decision) throw new HttpError(400, "Respuesta inválida");
  const nota = String(b.nota ?? "").trim().slice(0, 2000) || null;
  if (decision === "cambios" && !nota) throw new HttpError(400, "Contanos qué querés cambiar");
  const rating = Number(b.rating) >= 1 && Number(b.rating) <= 5 ? Math.round(Number(b.rating)) : null;
  await responderCliente(videoId, ronda, decision, nota, rating, appUrl(req));
  return { ok: true };
}

async function media(req: VercelRequest, res: VercelResponse) {
  const { videoId, ronda } = leerTokenAprobacion(String(req.query.t ?? ""));
  const fileId = String(req.query.fileId ?? "");
  const v = await leerVideoPublico(videoId, ronda);
  const f = v.final.find((x) => x.drive_file_id === fileId);
  if (!f) throw new HttpError(403, "Archivo no disponible");
  // Solo videos e imágenes: nada que el navegador pueda ejecutar.
  if (!/^video\//.test(f.mime_type) && !/^image\/(png|jpeg|webp|gif)$/.test(f.mime_type)) {
    throw new HttpError(415, "Formato no disponible para ver online");
  }
  await streamDriveFile(req, res, fileId, f.mime_type);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const accion = String(req.query.accion ?? "");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (accion === "media" && req.method === "GET") return await media(req, res);
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    if (accion === "video") {
      const { videoId, ronda } = leerTokenAprobacion(String(body<{ t?: string }>(req).t ?? ""));
      res.status(200).json(await leerVideoPublico(videoId, ronda));
    }
    else if (accion === "responder") res.status(200).json(await responder(req));
    else if (accion === "link") res.status(200).json(await link(req));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    sendError(res, err);
  }
}
