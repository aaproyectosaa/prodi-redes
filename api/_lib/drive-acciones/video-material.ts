// Material crudo que manda el cliente (videos que filma él, o extra si filman los dos).
//
// POST /api/drive/video-subida  { video_id, nombre, mime, size } → { subida, url, mime }
//   Igual que el chat: el servidor abre la subida a Drive con la cuenta de la app, en la misma carpeta donde
//   producción sube el crudo (Progreso/<cliente>/Videos - crudo/<mes>-01), y le da al navegador solo la URL
//   de ESE archivo. El cliente nunca recibe el acceso a Drive.
// POST /api/drive/video-archivo { video_id, subida } → { ok, archivos }
//   Al terminar: busca el archivo por la marca de la subida, revisa que sea de ese video y de esa persona,
//   lo comparte por link (como lo que sube el equipo) y lo suma a attachments_crudo con origen "cliente".
// POST /api/drive/video-listo   { video_id } → { ok, etapa }
//   "Listo, ya subí todo": si el video estaba esperando su material pasa a edición; avisa a producción y edición.
//
// Los videos los escribe solo el servidor para el cliente (reglas.ts no lo deja escribir `videos`).

import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, FieldValue, type Data } from "../db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError, type Caller } from "../http";
import { DriveConnectionError, getAppDriveAccessToken } from "../drive-connection";
import { ensureFolder, ROOT_FOLDER_NAME } from "../drive-server";
import { enviarAviso } from "../notify";
import { aceptaMaterialCliente } from "../pedidos";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
/** El cliente (o el equipo del cliente, para probar). Producción sube con su propio acceso desde MaterialSlot. */
const ROLES = ["admin", "productor", "editor", "cliente"];

/** Tope por archivo: la subida va directo a Drive en partes (no pasa por Vercel). */
export const MATERIAL_MAX_GB = 10;
/** Nada que se pueda ejecutar o abrir como página. */
const BLOQUEADOS = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|vbs|js|mjs|jar|sh|apk|app|dll|html?|xhtml|svg|hta)$/i;
const SUBIDA = /^[a-f0-9]{32}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Igual que sanitizeName de la app: así cae en la misma carpeta que el crudo del equipo. */
const nombreCarpeta = (s: string) =>
  s.replace(/[\\/]/g, "-").replace(/\s+/g, " ").trim().slice(0, 200) || "Sin nombre";

function fallo(res: VercelResponse, err: unknown) {
  if (err instanceof DriveConnectionError) {
    console.error("[material] drive", err.code, err.message);
    if (!res.headersSent) {
      res.status(503).json({ error: "Ahora no podemos recibir archivos (Drive no está disponible). Avisanos por el chat y lo resolvemos." });
    }
    return;
  }
  sendError(res, err);
}

/** El video, su cliente y que quien llama pueda mandarle material. */
async function videoParaMaterial(caller: Caller, videoId: unknown): Promise<{ id: string; v: Data; p: Data }> {
  if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) throw new HttpError(400, "Falta el video");
  const db = adminDb();
  const v = (await db.collection("videos").doc(videoId).get()).data();
  if (!v) throw new HttpError(404, "El video ya no existe");
  const pid = String(v.proyecto_id ?? "");
  await assertProjectAccess(caller, pid);
  const p = (await db.collection("projects").doc(pid).get()).data() ?? {};
  // El cliente tiene que ser cliente de ese proyecto (no alcanza con estar en otro rol).
  if (caller.role === "cliente" && !((p.team_roles?.cliente ?? []) as string[]).includes(caller.uid)) {
    throw new HttpError(403, "No tenés acceso a este video");
  }
  if (!aceptaMaterialCliente(v, p)) {
    throw new HttpError(409, "Este video ya no recibe material. Si querés sumar algo, escribinos por el chat.");
  }
  return { id: videoId, v, p };
}

export async function videoSubida(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ video_id?: string; nombre?: string; mime?: string; size?: number }>(req);
    const { id, v, p } = await videoParaMaterial(caller, b.video_id);
    const nombre = String(b.nombre ?? "").replace(/[\\/\r\n\t]+/g, " ").trim().slice(0, 150) || "material";
    const size = Number(b.size);
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, `“${nombre}” está vacío`);
    if (size > MATERIAL_MAX_GB * 1024 ** 3) {
      throw new HttpError(413, `“${nombre}” pesa ${(size / 1024 ** 3).toFixed(1)} GB. El máximo por archivo es ${MATERIAL_MAX_GB} GB.`);
    }
    if (BLOQUEADOS.test(nombre)) throw new HttpError(400, `“${nombre}”: ese tipo de archivo no se puede subir`);
    const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(b.mime ?? "")) ? String(b.mime).toLowerCase() : "application/octet-stream";

    const { accessToken } = await getAppDriveAccessToken();
    let parent = "root";
    // Misma carpeta que usa producción en MaterialSlot (driveUploadRunner): Progreso/<cliente>/Videos - crudo/<mes>-01.
    for (const parte of [ROOT_FOLDER_NAME, nombreCarpeta(String(p.nombre ?? "Cliente")), "Videos - crudo", `${v.mes}-01`]) {
      parent = await ensureFolder(parte, parent, accessToken);
    }
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
        appProperties: { prodi_video: id, prodi_by: caller.uid, prodi_subida: subida },
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

export async function videoArchivo(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ video_id?: string; subida?: string }>(req);
    const { id, v, p } = await videoParaMaterial(caller, b.video_id);
    const subida = String(b.subida ?? "");
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
    if (f.appProperties?.prodi_video !== id || f.appProperties?.prodi_by !== caller.uid) throw new HttpError(403, "Este archivo no es de este video");

    // Compartido por link, igual que lo que sube el equipo (así se ven las miniaturas en la galería).
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
      folder_path: [ROOT_FOLDER_NAME, nombreCarpeta(String(p.nombre ?? "Cliente")), "Videos - crudo", `${v.mes}-01`].join("/"),
      ...(f.thumbnailLink ? { thumbnail_link: f.thumbnailLink } : {}),
      ...(f.webContentLink ? { web_content_link: f.webContentLink } : {}),
      ...(caller.role === "cliente" ? { origen: "cliente" } : {}),
    };
    const db = adminDb();
    const ref = db.collection("videos").doc(id);
    // Si se confirma dos veces (reintento), no se duplica.
    const total = await db.runTransaction(async (tx) => {
      const actual = (await tx.get(ref)).data();
      if (!actual) throw new HttpError(404, "El video ya no existe");
      const crudo = (actual.attachments_crudo ?? []) as { drive_file_id?: string }[];
      if (crudo.some((a) => a.drive_file_id === f.id)) return crudo.length;
      tx.update(ref, { attachments_crudo: FieldValue.arrayUnion(adjunto), updated_at: new Date().toISOString() });
      return crudo.length + 1;
    });
    res.status(200).json({ ok: true, archivos: total });
  } catch (err) {
    fallo(res, err);
  }
}

export async function videoListo(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ video_id?: string }>(req);
    const { id } = await videoParaMaterial(caller, b.video_id);
    const db = adminDb();
    const ref = db.collection("videos").doc(id);
    const ahora = new Date().toISOString();

    const { v, paso, nuevos } = await db.runTransaction(async (tx) => {
      const v = (await tx.get(ref)).data();
      if (!v) throw new HttpError(404, "El video ya no existe");
      const crudo = (v.attachments_crudo ?? []) as { origen?: string; uploaded_by?: string; uploaded_at?: string }[];
      // Lo que mandó el cliente desde el último aviso (para no avisar dos veces lo mismo).
      const desde = String(v.material_cliente_avisado_at ?? "");
      const delCliente = crudo.filter((a) => a.origen === "cliente" || a.uploaded_by === caller.uid);
      const nuevos = delCliente.filter((a) => String(a.uploaded_at ?? "") > desde).length;
      if (!delCliente.length) throw new HttpError(409, "Primero subí al menos un archivo");
      const paso = v.etapa === "material_cliente";
      if (!paso && !nuevos) throw new HttpError(409, "Ya le avisamos al equipo. Si subís más archivos, avisá de nuevo.");
      const evento = {
        at: ahora,
        by: caller.uid,
        accion: paso ? "El cliente subió su material, pasa a edición" : "El cliente mandó material extra",
        nota: `${nuevos || delCliente.length} archivo${(nuevos || delCliente.length) === 1 ? "" : "s"}`,
      };
      tx.update(ref, {
        ...(paso ? { etapa: "edicion", etapa_desde: ahora } : {}),
        material_cliente_avisado_at: ahora,
        updated_at: ahora,
        historial: FieldValue.arrayUnion(evento),
      });
      return { v, paso, nuevos: nuevos || delCliente.length };
    });

    const p = (await db.collection("projects").doc(String(v.proyecto_id)).get()).data() ?? {};
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const uno = (uid: unknown, rol: string) => (typeof uid === "string" && uid ? [uid] : (team[rol] ?? []));
    await enviarAviso(
      {
        destinatarios: [...uno(v.productor_id, "productor"), ...uno(v.editor_id, "editor")].filter((x) => x !== caller.uid),
        titulo: paso ? "El cliente subió su material: a editar" : "El cliente mandó material extra",
        cuerpo: `${p.nombre ?? "Cliente"} · ${v.titulo} · ${nuevos} archivo${nuevos === 1 ? "" : "s"}`,
        link: `/videos?video=${id}`,
        clave: `material_cliente:${id}:${ahora}`,
        proyectoId: String(v.proyecto_id),
        videoId: id,
      },
      appUrl(req)
    );
    res.status(200).json({ ok: true, etapa: paso ? "edicion" : v.etapa });
  } catch (err) {
    fallo(res, err);
  }
}
