// Aprobación del cliente sin entrar al sistema (link firmado que le llega en el aviso).
// POST /api/publico/video      { t }                               → datos del video
// POST /api/publico/responder  { t, decision, nota?, rating? }     → aprueba o pide cambios
// GET  /api/publico/media?t=…&fileId=…                             → reproduce el video final
// POST /api/publico/link       { video_id }  (equipo)              → genera el link para mandar
// Desde la app (con usuario; el cliente ya no puede escribir estos cambios por /api/db):
// POST /api/publico/video-cliente  { video_id, decision, nota?, rating?, marcas?, comentario? }
// POST /api/publico/pieza-cliente  { pieza_id, decision, nota? }
// Catálogo del CRM (api/_lib/catalogo.ts; negocio = "prodi" o el id del cliente):
// POST catalogo { negocio } · catalogo-conectar { negocio, url } · catalogo-producto { negocio, producto }
// POST catalogo-borrar { negocio, id } · catalogo-links { negocio, ids, contacto: { col, id } }
// GET  /api/publico/ir?t=…   → link de un producto mandado: avisa en la ficha y lleva a la tienda

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../_lib/db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError } from "../_lib/http";
import { leerTokenAprobacion, linkAprobacion } from "../_lib/aprobacion";
import { leerVideoPublico, responderCliente } from "../_lib/videos-server";
import { streamDriveFile } from "../_lib/drive-stream";
import { responderPiezaApp, responderVideoApp, type PedidoPieza, type PedidoVideo } from "../_lib/aprobar-cliente";
import { aceptarPresupuesto, verPresupuesto } from "../_lib/presupuestos";
import { abrirLink, borrarProducto, conectarCatalogo, guardarProducto, linksParaMandar, permitirNegocio, verCatalogo } from "../_lib/catalogo";

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

/** Catálogo de productos del CRM (el de Prodi o el de un cliente). */
async function catalogo(req: VercelRequest, accion: string) {
  const caller = await requireCaller(req);
  const b = body<{ negocio?: string; url?: string; auto?: boolean; producto?: unknown; id?: string; ids?: string[]; contacto?: { col?: string; id?: string } }>(req);
  const negocio = String(b.negocio ?? "");
  await permitirNegocio(caller, negocio);
  if (accion === "catalogo") return verCatalogo(negocio);
  if (accion === "catalogo-conectar") return conectarCatalogo(caller, negocio, String(b.url ?? ""), { auto: b.auto === true, base: appUrl(req) });
  if (accion === "catalogo-producto") return guardarProducto(negocio, b.producto);
  if (accion === "catalogo-borrar") return borrarProducto(negocio, String(b.id ?? ""));
  if (accion === "catalogo-links") {
    const col = b.contacto?.col === "crm_contactos" ? "crm_contactos" : b.contacto?.col === "leads_web" ? "leads_web" : null;
    const id = String(b.contacto?.id ?? "");
    if (!col || !id) throw new HttpError(400, "Falta el contacto");
    // El contacto tiene que ser del mismo negocio.
    const c = (await adminDb().collection(col).doc(id).get()).data();
    if (!c || (col === "leads_web" ? negocio !== "prodi" : c.proyecto_id !== negocio)) throw new HttpError(403, "Ese contacto no es de este negocio");
    return { productos: await linksParaMandar(appUrl(req), negocio, Array.isArray(b.ids) ? b.ids.map(String) : [], { col, id }) };
  }
  throw new HttpError(404, "Acción desconocida");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const accion = String(req.query.accion ?? "");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (accion === "media" && req.method === "GET") return await media(req, res);
    if (accion === "ir" && req.method === "GET") {
      res.redirect(302, await abrirLink(String(req.query.t ?? "")));
      return;
    }
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
    // Presupuesto por link: verlo y aceptarlo (crea el usuario y la ficha del cliente).
    else if (accion === "presupuesto") res.status(200).json(await verPresupuesto(String(body<{ t?: string }>(req).t ?? ""), body<{ equipo?: boolean }>(req).equipo === true));
    else if (accion === "presupuesto-aceptar") res.status(200).json(await aceptarPresupuesto(body(req), appUrl(req)));
    else if (accion === "video-cliente") {
      const caller = await requireCaller(req, ["admin", "productor", "cliente"]);
      res.status(200).json(await responderVideoApp(caller, body<PedidoVideo>(req), appUrl(req)));
    } else if (accion === "pieza-cliente") {
      const caller = await requireCaller(req, ["admin", "productor", "cliente"]);
      res.status(200).json(await responderPiezaApp(caller, body<PedidoPieza>(req), appUrl(req)));
    }
    else if (accion.startsWith("catalogo")) res.status(200).json(await catalogo(req, accion));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    sendError(res, err);
  }
}
