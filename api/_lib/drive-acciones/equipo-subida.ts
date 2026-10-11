// Archivos que sube el equipo (crudo y final de los videos, diseños y material de las piezas, grabaciones de reuniones).
//
// POST /api/drive/equipo-subida  { coleccion, doc_id, tipo, fecha, nombre, mime, size } → { subida, url, mime }
//   El servidor abre la subida a Drive con la cuenta de la app (Progreso/<cliente>/<tipo>/<fecha>) y le da al
//   navegador solo la URL de ESE archivo: el acceso a Drive de la agencia nunca llega al navegador.
// POST /api/drive/equipo-archivo { subida } → { adjunto }
//   Al terminar: busca el archivo por la marca de la subida, revisa que lo haya subido esa persona, lo comparte por
//   link (para las miniaturas) y devuelve el adjunto. La app lo suma al video / pieza / reunión como siempre.

import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, type Data } from "../db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError, type Caller } from "../http";
import { DriveConnectionError, getAppDriveAccessToken } from "../drive-connection";
import { ensureFolder, ROOT_FOLDER_NAME } from "../drive-server";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
/** Los mismos que antes podían subir con el acceso de la app. */
const ROLES = ["admin", "productor", "editor", "pauta", "diseno"];
const COLECCIONES = ["videos", "piezas_ia", "reuniones"];
const MAX_GB = 10;
/** Nada que se pueda ejecutar o abrir como página. */
const BLOQUEADOS = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|vbs|js|mjs|jar|sh|apk|app|dll|html?|xhtml|svg|hta)$/i;
const SUBIDA = /^[a-f0-9]{32}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,120}$/;

/** Igual que sanitizeName de la app: así cae en la misma carpeta de siempre. */
const nombreCarpeta = (s: string) =>
  s.replace(/[\\/]/g, "-").replace(/\s+/g, " ").trim().slice(0, 200) || "Sin nombre";

function fallo(res: VercelResponse, err: unknown) {
  if (err instanceof DriveConnectionError) {
    console.error("[equipo-subida] drive", err.code, err.message);
    if (!res.headersSent) res.status(503).json({ error: "Drive no está disponible ahora. Pedile al admin que revise la conexión en Ajustes." });
    return;
  }
  sendError(res, err);
}

/** El documento destino y que quien sube trabaje ahí. Devuelve el nombre del cliente para la carpeta. */
async function destino(caller: Caller, coleccion: unknown, docId: unknown): Promise<{ coleccion: string; id: string; cliente: string }> {
  if (typeof coleccion !== "string" || !COLECCIONES.includes(coleccion)) throw new HttpError(400, "Destino inválido");
  if (typeof docId !== "string" || !DOC_ID.test(docId)) throw new HttpError(400, "Falta el documento");
  const db = adminDb();
  const d = (await db.collection(coleccion).doc(docId).get()).data();
  if (!d) throw new HttpError(404, "Ya no existe");
  const pid = typeof d.proyecto_id === "string" && d.proyecto_id ? d.proyecto_id : null;
  if (coleccion === "reuniones") {
    // Reunión: la graba quien participa (o el admin); si es de un cliente, también su equipo.
    const participa = Array.isArray(d.participantes) && d.participantes.includes(caller.uid);
    if (!participa && caller.role !== "admin") {
      if (!pid) throw new HttpError(403, "No participás de esta reunión");
      await assertProjectAccess(caller, pid);
    }
  } else {
    if (!pid) throw new HttpError(400, "Sin cliente");
    await assertProjectAccess(caller, pid);
  }
  const cliente = pid ? String((await db.collection("projects").doc(pid).get()).data()?.nombre ?? "Cliente") : "Interno";
  return { coleccion, id: docId, cliente };
}

export async function equipoSubida(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ coleccion?: string; doc_id?: string; tipo?: string; fecha?: string; nombre?: string; mime?: string; size?: number }>(req);
    const { coleccion, id, cliente } = await destino(caller, b.coleccion, b.doc_id);
    const nombre = String(b.nombre ?? "").replace(/[\\/\r\n\t]+/g, " ").trim().slice(0, 150) || "archivo";
    const size = Number(b.size);
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, `“${nombre}” está vacío`);
    if (size > MAX_GB * 1024 ** 3) throw new HttpError(413, `“${nombre}” pesa ${(size / 1024 ** 3).toFixed(1)} GB. El máximo por archivo es ${MAX_GB} GB.`);
    if (BLOQUEADOS.test(nombre)) throw new HttpError(400, `“${nombre}”: ese tipo de archivo no se puede subir`);
    const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(b.mime ?? "")) ? String(b.mime).toLowerCase() : "application/octet-stream";
    const tipo = nombreCarpeta(String(b.tipo ?? "Sin Tipo").slice(0, 60));
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha ?? "")) ? String(b.fecha) : new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const carpeta = [ROOT_FOLDER_NAME, nombreCarpeta(cliente), tipo, fecha];

    const { accessToken } = await getAppDriveAccessToken();
    let parent = "root";
    for (const parte of carpeta) parent = await ensureFolder(parte, parent, accessToken);
    const subida = crypto.randomBytes(16).toString("hex");
    // Con el Origin del navegador, Google deja que la página suba a esta sesión (CORS).
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
        appProperties: { prodi_doc: `${coleccion}/${id}`, prodi_by: caller.uid, prodi_subida: subida, prodi_carpeta: carpeta.join("/").slice(0, 90) },
      }),
    });
    const url = init.headers.get("location");
    if (!init.ok || !url) throw new HttpError(502, `Drive no abrió la subida (${init.status})`);
    res.status(200).json({ subida, url, mime });
  } catch (err) {
    fallo(res, err);
  }
}

interface ArchivoDrive {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  appProperties?: Record<string, string>;
}

export async function equipoArchivo(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const caller = await requireCaller(req, ROLES);
    const subida = String(body<{ subida?: string }>(req).subida ?? "");
    if (!SUBIDA.test(subida)) throw new HttpError(400, "Subida inválida");
    const { accessToken } = await getAppDriveAccessToken();
    const q = `appProperties has { key='prodi_subida' and value='${subida}' } and trashed = false`;
    const campos = "files(id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,appProperties)";
    const r = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${campos}&pageSize=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new HttpError(502, `Drive respondió ${r.status}`);
    const f = ((await r.json()) as { files?: ArchivoDrive[] }).files?.[0];
    if (!f) throw new HttpError(404, "El archivo no terminó de subir. Probá de nuevo.");
    if (f.appProperties?.prodi_by !== caller.uid) throw new HttpError(403, "Este archivo no lo subiste vos");

    // Compartido por link, como siempre (así se ven las miniaturas en la galería).
    await fetch(`${DRIVE_API}/files/${f.id}/permissions?fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    }).catch(() => undefined);

    const adjunto: Data = {
      drive_file_id: f.id,
      name: f.name,
      mime_type: String(f.mimeType || "application/octet-stream"),
      size: Number(f.size ?? 0),
      web_view_link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
      uploaded_at: new Date().toISOString(),
      uploaded_by: caller.uid,
      folder_path: f.appProperties?.prodi_carpeta ?? "",
      ...(f.thumbnailLink ? { thumbnail_link: f.thumbnailLink } : {}),
      ...(f.webContentLink ? { web_content_link: f.webContentLink } : {}),
    };
    res.status(200).json({ adjunto });
  } catch (err) {
    fallo(res, err);
  }
}
