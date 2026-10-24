// CRM (beta): fotos y videos para mandarle a un contacto.
//
// POST /api/drive/crm-subida    { proyecto_id, nombre, mime, size } → { subida, url }
//   Abre una subida a Drive (Progreso/CRM/<cliente>) para ESE archivo, como el chat: el navegador sube directo.
// POST /api/drive/crm-archivo   { proyecto_id, subida, titulo? } → { id }
//   Terminada la subida: busca el archivo por su marca, revisa que sea de ese cliente y de esa persona y lo suma
//   a su galería (crm_galeria). Solo el servidor escribe la galería.
// POST /api/drive/crm-compartir { proyecto_id, file_id } → { url }
//   Link público para mandarle al contacto (/v/<token>). Solo de archivos de ese cliente: su galería, sus videos
//   terminados o sus piezas. El token es al azar y vive en crm_compartidos (nadie lo lee desde la app).
// POST /api/publico/archivo       { t } → qué es y de qué negocio (para la página /v/<token>)
// GET  /api/publico/archivo-media ?t=… → la foto o el video

import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, getPool } from "./db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError, type Caller } from "./http";
import { DriveConnectionError, getAppDriveAccessToken } from "./drive-connection";
import { ensureFolder, ROOT_FOLDER_NAME } from "./drive-server";
import { streamDriveFile } from "./drive-stream";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const ROLES = ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"];
export const GALERIA_MAX_MB = 200;
const SUBIDA = /^[a-f0-9]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,60}$/;
// Solo fotos y videos comunes: nada que el navegador pueda ejecutar.
const MEDIA = /^(video\/(mp4|quicktime|webm|x-m4v)|image\/(png|jpeg|webp|gif))$/;

function fallo(res: VercelResponse, err: unknown) {
  if (err instanceof DriveConnectionError) {
    console.error("[crm] drive", err.code, err.message);
    if (!res.headersSent) res.status(503).json({ error: "Drive no está disponible. Avisale a Prodi." });
    return;
  }
  sendError(res, err);
}

/** Tiene el CRM prendido y la persona trabaja con ese cliente (o es el cliente). */
async function clienteConCrm(caller: Caller, proyectoId: unknown) {
  if (typeof proyectoId !== "string" || !proyectoId) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, proyectoId);
  const p = (await adminDb().collection("projects").doc(proyectoId).get()).data();
  if (!p) throw new HttpError(404, "Cliente no encontrado");
  if (!p.crm_activo) throw new HttpError(403, "El CRM no está activo para este cliente");
  return p;
}

export async function crmSubida(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ proyecto_id?: string; nombre?: string; mime?: string; size?: number }>(req);
    const p = await clienteConCrm(caller, b.proyecto_id);
    const nombre = String(b.nombre ?? "").replace(/[\\/\r\n\t]+/g, " ").trim().slice(0, 150) || "archivo";
    const size = Number(b.size);
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "El archivo está vacío");
    if (size > GALERIA_MAX_MB * 1024 * 1024) throw new HttpError(413, `“${nombre}” pesa ${Math.round(size / 1024 / 1024)} MB. El máximo es ${GALERIA_MAX_MB} MB.`);
    const mime = String(b.mime ?? "").toLowerCase();
    if (!MEDIA.test(mime)) throw new HttpError(400, "Solo fotos (JPG, PNG, WEBP) o videos (MP4, MOV)");

    const { accessToken } = await getAppDriveAccessToken();
    let parent = "root";
    const carpeta = String(p.nombre ?? b.proyecto_id).replace(/[\\/]/g, "-").slice(0, 100);
    for (const parte of [ROOT_FOLDER_NAME, "CRM", carpeta]) parent = await ensureFolder(parte, parent, accessToken);
    const subida = crypto.randomBytes(16).toString("hex");
    const o = typeof req.headers.origin === "string" && /^https?:\/\/[^/\s]+$/.test(req.headers.origin) ? req.headers.origin : appUrl(req);
    const init = await fetch(`${UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(size),
        ...(o ? { Origin: o } : {}),
      },
      body: JSON.stringify({
        name: nombre,
        mimeType: mime,
        parents: [parent],
        appProperties: { prodi_crm: String(b.proyecto_id), prodi_by: caller.uid, prodi_subida: subida },
      }),
    });
    const url = init.headers.get("location");
    if (!init.ok || !url) throw new HttpError(502, `Drive no abrió la subida (${init.status})`);
    res.status(200).json({ subida, url, mime });
  } catch (err) {
    fallo(res, err);
  }
}

export async function crmArchivo(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ proyecto_id?: string; subida?: string; titulo?: string }>(req);
    await clienteConCrm(caller, b.proyecto_id);
    const subida = String(b.subida ?? "");
    if (!SUBIDA.test(subida)) throw new HttpError(400, "Subida inválida");
    const { accessToken } = await getAppDriveAccessToken();
    const q = `appProperties has { key='prodi_subida' and value='${subida}' } and trashed = false`;
    const r = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,appProperties)&pageSize=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new HttpError(502, `Drive respondió ${r.status}`);
    const f = ((await r.json()) as { files?: { id: string; name: string; mimeType: string; size?: string; appProperties?: Record<string, string> }[] }).files?.[0];
    if (!f) throw new HttpError(404, "El archivo no terminó de subir. Probá de nuevo.");
    if (f.appProperties?.prodi_crm !== b.proyecto_id || f.appProperties?.prodi_by !== caller.uid) throw new HttpError(403, "Este archivo no es de este cliente");
    const id = `g_${subida}`;
    await adminDb()
      .collection("crm_galeria")
      .doc(id)
      .set({
        proyecto_id: b.proyecto_id,
        titulo: String(b.titulo ?? "").trim().slice(0, 120) || f.name.replace(/\.[a-z0-9]+$/i, ""),
        archivo: { drive_file_id: f.id, name: f.name, mime_type: String(f.mimeType), size: Number(f.size ?? 0) },
        subido_por: caller.uid,
        creado_at: new Date().toISOString(),
      });
    res.status(200).json({ ok: true, id });
  } catch (err) {
    fallo(res, err);
  }
}

/** El archivo es de ese cliente: su galería, un video terminado o una pieza. Devuelve nombre y tipo. */
async function archivoDelCliente(proyectoId: string, fileId: string): Promise<{ nombre: string; mime: string } | null> {
  const ref = [{ drive_file_id: fileId }];
  const r = await getPool().query(
    `select coleccion, data from documentos
      where data->>'proyecto_id' = $1
        and ((coleccion = 'crm_galeria' and data->'archivo'->>'drive_file_id' = $2)
          or (coleccion in ('videos', 'piezas_ia') and (data @> $3::jsonb or data @> $4::jsonb)))
      limit 1`,
    [proyectoId, fileId, JSON.stringify({ attachments_finalizado: ref }), JSON.stringify({ versiones: ref })]
  );
  const row = r.rows[0] as { coleccion: string; data: Record<string, unknown> } | undefined;
  if (!row) return null;
  const d = row.data;
  if (row.coleccion === "crm_galeria") {
    const a = d.archivo as { name: string; mime_type: string };
    return { nombre: String(d.titulo ?? a.name), mime: a.mime_type };
  }
  const lista = [...((d.attachments_finalizado as { drive_file_id: string; name: string; mime_type: string }[]) ?? []), ...((d.versiones as { drive_file_id: string; name: string; mime_type: string }[]) ?? [])];
  const a = lista.find((x) => x.drive_file_id === fileId);
  return a ? { nombre: String(d.titulo ?? d.producto ?? a.name), mime: a.mime_type } : null;
}

export async function crmCompartir(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "no-store");
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ proyecto_id?: string; file_id?: string }>(req);
    await clienteConCrm(caller, b.proyecto_id);
    const fileId = String(b.file_id ?? "");
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new HttpError(400, "Archivo inválido");
    const a = await archivoDelCliente(String(b.proyecto_id), fileId);
    if (!a) throw new HttpError(403, "Ese archivo no es de este cliente");
    if (!MEDIA.test(a.mime)) throw new HttpError(415, "Solo se pueden mandar fotos y videos");
    // El mismo archivo usa siempre el mismo link.
    const ya = await getPool().query("select id from documentos where coleccion = 'crm_compartidos' and data->>'file_id' = $1 and data->>'proyecto_id' = $2 limit 1", [fileId, b.proyecto_id]);
    let token = (ya.rows[0] as { id: string } | undefined)?.id;
    if (!token) {
      token = crypto.randomBytes(18).toString("base64url");
      await adminDb().collection("crm_compartidos").doc(token).set({ proyecto_id: b.proyecto_id, file_id: fileId, nombre: a.nombre, mime: a.mime, por: caller.uid, creado_at: new Date().toISOString() });
    }
    res.status(200).json({ url: `${appUrl(req)}/v/${token}` });
  } catch (err) {
    fallo(res, err);
  }
}

async function compartido(t: unknown) {
  if (typeof t !== "string" || !TOKEN.test(t)) throw new HttpError(404, "Link no válido");
  const d = (await adminDb().collection("crm_compartidos").doc(t).get()).data();
  if (!d) throw new HttpError(404, "Este link ya no está disponible");
  return d as { proyecto_id: string; file_id: string; nombre: string; mime: string };
}

/** Para la página pública: qué es y de qué negocio (sin datos internos). */
export async function verCompartido(t: unknown) {
  const d = await compartido(t);
  const p = (await adminDb().collection("projects").doc(d.proyecto_id).get()).data() ?? {};
  return { nombre: d.nombre, tipo: d.mime.startsWith("video/") ? "video" : "foto", negocio: String(p.nombre ?? "") };
}

export async function mediaCompartido(req: VercelRequest, res: VercelResponse) {
  const d = await compartido(req.query.t);
  res.setHeader("Cache-Control", "public, max-age=3600");
  await streamDriveFile(req, res, d.file_id, d.mime);
}
