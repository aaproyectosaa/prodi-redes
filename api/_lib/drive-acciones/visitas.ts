// Visitas de los vendedores de un cliente (DS Ingeniería: los vendedores que visitan fábricas y filman ahí).
// El vendedor carga la visita (título, fábrica, ubicación, descripción) y sube videos y fotos desde el celular.
// Todo queda en Drive (Progreso/<cliente>/Visitas vendedores/<fecha - fábrica - título>) y en la colección
// `visitas_vendedores`. Producción las ve y, cuando quiere, arma un video con el material de una visita.
//
// POST /api/drive/visita-crear   { titulo, fabrica, ubicacion?, lat?, lng?, descripcion?, autoriza } → { id }
// POST /api/drive/visita-editar  { visita_id, …los mismos campos } → { ok }
// POST /api/drive/visita-borrar  { visita_id } → { ok }   (el vendedor, solo si todavía no subió nada; el equipo, siempre)
// POST /api/drive/visita-subida  { visita_id, nombre, mime, size } → { subida, url, mime }
// POST /api/drive/visita-archivo { visita_id, subida } → { ok, archivos }
// POST /api/drive/visita-video   { visita_id } → { video_id }   (producción: crea el video con el material, a edición)
// POST /api/drive/visitas-activar { proyecto_id, activo } → { ok }  (super admin: prende el módulo en ese cliente)
//
// Las visitas las escribe solo el servidor (reglas.ts no deja escribir `visitas_vendedores` desde la app).

import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, FieldValue, type Data } from "../db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError, tieneRol, type Caller } from "../http";
import { DriveConnectionError, getAppDriveAccessToken } from "../drive-connection";
import { ensureFolder, ROOT_FOLDER_NAME } from "../drive-server";
import { enviarAviso } from "../notify";
import { entregaSugerida, hoyAR, mesAR } from "../fecha";
import { videoDesdePedido } from "../pedidos";

export const VISITAS = "visitas_vendedores";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const MAX_GB = 10;
/** Solo videos y fotos (lo que sale de la cámara del celular). */
const MIME_OK = /^(video|image)\//i;
const SUBIDA = /^[a-f0-9]{32}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,120}$/;
const CARPETA = "Visitas vendedores";

const nombreCarpeta = (s: string) =>
  s.replace(/[\\/]/g, "-").replace(/\s+/g, " ").trim().slice(0, 200) || "Sin nombre";
const texto = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const textoLargo = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function fallo(res: VercelResponse, err: unknown) {
  if (err instanceof DriveConnectionError) {
    console.error("[visitas] drive", err.code, err.message);
    if (!res.headersSent) res.status(503).json({ error: "Ahora no podemos recibir archivos (Drive no está disponible). Probá de nuevo en un rato." });
    return;
  }
  sendError(res, err);
}

function soloPost(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") return true;
  res.status(405).json({ error: "Method not allowed" });
  return false;
}

/** El cliente del vendedor (está atado a uno solo: profile.proyecto_id). */
async function clienteDelVendedor(caller: Caller): Promise<string> {
  const p = (await adminDb().collection("profiles").doc(caller.uid).get()).data() ?? {};
  const pid = typeof p.proyecto_id === "string" ? p.proyecto_id : "";
  if (!pid) throw new HttpError(403, "Tu usuario no está asociado a ninguna empresa");
  return pid;
}

/** ¿Es del equipo de Prodi que trabaja ese cliente (o el super admin)? */
async function esEquipo(caller: Caller, pid: string): Promise<boolean> {
  if (!["admin", "productor", "editor"].some((r) => tieneRol(caller, r))) return false;
  try {
    await assertProjectAccess(caller, pid);
    return true;
  } catch {
    return false;
  }
}

/** La visita y si quien llama la puede tocar: el vendedor que la cargó o el equipo de ese cliente. */
async function visitaPara(caller: Caller, visitaId: unknown, { soloEquipo = false } = {}) {
  if (typeof visitaId !== "string" || !DOC_ID.test(visitaId)) throw new HttpError(400, "Falta la visita");
  const ref = adminDb().collection(VISITAS).doc(visitaId);
  const v = (await ref.get()).data();
  if (!v) throw new HttpError(404, "La visita ya no existe");
  const pid = String(v.proyecto_id ?? "");
  const equipo = await esEquipo(caller, pid);
  const autor = caller.role === "vendedor" && v.vendedor_id === caller.uid && (await clienteDelVendedor(caller)) === pid;
  if (soloEquipo ? !equipo : !equipo && !autor) throw new HttpError(403, "No podés tocar esta visita");
  return { ref, v, pid, equipo, autor };
}

/** Los datos que carga el vendedor (los mismos al crear y al editar). */
function datosVisita(b: Record<string, unknown>) {
  const titulo = texto(b.titulo, 120);
  const fabrica = texto(b.fabrica, 120);
  if (titulo.length < 3) throw new HttpError(400, "Poné un título para la visita");
  if (fabrica.length < 2) throw new HttpError(400, "Poné el nombre de la fábrica");
  // Sin ubicación del celular llegan null: no es (0, 0).
  const lat = typeof b.lat === "number" ? b.lat : NaN;
  const lng = typeof b.lng === "number" ? b.lng : NaN;
  const coords = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : null;
  return {
    titulo,
    fabrica,
    ubicacion: texto(b.ubicacion, 200) || null,
    coords,
    descripcion: textoLargo(b.descripcion, 3000) || null,
    autoriza_publicar: b.autoriza === true,
  };
}

export async function visitaCrear(req: VercelRequest, res: VercelResponse) {
  if (!soloPost(req, res)) return;
  try {
    const caller = await requireCaller(req, ["vendedor", "admin"]);
    const b = body<Record<string, unknown>>(req);
    // El vendedor, en su empresa; el super admin (para probar), en el cliente que diga.
    const pid = caller.role === "vendedor" ? await clienteDelVendedor(caller) : texto(b.proyecto_id, 120);
    if (!pid) throw new HttpError(400, "Falta el cliente");
    const db = adminDb();
    const p = (await db.collection("projects").doc(pid).get()).data();
    if (!p) throw new HttpError(404, "Cliente no encontrado");
    if (p.visitas_activo !== true) throw new HttpError(409, "Las visitas no están activadas para esta empresa");
    const datos = datosVisita(b);
    const fecha = hoyAR();
    const ahora = new Date().toISOString();
    const ref = db.collection(VISITAS).doc();
    await ref.set({
      proyecto_id: pid,
      ...datos,
      fecha,
      // La carpeta queda fija desde el principio (si después cambia el título, el material sigue en el mismo lugar).
      carpeta: nombreCarpeta(`${fecha} - ${datos.fabrica} - ${datos.titulo}`).slice(0, 150),
      vendedor_id: caller.uid,
      vendedor_nombre: caller.nombre || "Vendedor",
      archivos: [],
      video_id: null,
      avisado_at: null,
      created_at: ahora,
      updated_at: ahora,
    });
    res.status(200).json({ ok: true, id: ref.id });
  } catch (err) {
    fallo(res, err);
  }
}

export async function visitaEditar(req: VercelRequest, res: VercelResponse) {
  if (!soloPost(req, res)) return;
  try {
    const caller = await requireCaller(req, ["vendedor", "admin", "productor", "editor"]);
    const b = body<Record<string, unknown>>(req);
    const { ref } = await visitaPara(caller, b.visita_id);
    await ref.update({ ...datosVisita(b), updated_at: new Date().toISOString() });
    res.status(200).json({ ok: true });
  } catch (err) {
    fallo(res, err);
  }
}

export async function visitaBorrar(req: VercelRequest, res: VercelResponse) {
  if (!soloPost(req, res)) return;
  try {
    const caller = await requireCaller(req, ["vendedor", "admin", "productor"]);
    const b = body<Record<string, unknown>>(req);
    const { ref, v, equipo } = await visitaPara(caller, b.visita_id);
    // El vendedor borra solo una visita vacía (una que cargó de más); con material, se la pide al equipo.
    if (!equipo && ((v.archivos as unknown[]) ?? []).length > 0) throw new HttpError(409, "Esta visita ya tiene material. Pedile a Prodi que la saque.");
    await ref.delete();
    res.status(200).json({ ok: true });
  } catch (err) {
    fallo(res, err);
  }
}

export async function visitaSubida(req: VercelRequest, res: VercelResponse) {
  if (!soloPost(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const caller = await requireCaller(req, ["vendedor", "admin", "productor", "editor"]);
    const b = body<{ visita_id?: string; nombre?: string; mime?: string; size?: number }>(req);
    const { v, pid } = await visitaPara(caller, b.visita_id);
    const nombre = String(b.nombre ?? "").replace(/[\\/\r\n\t]+/g, " ").trim().slice(0, 150) || "material";
    const size = Number(b.size);
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, `“${nombre}” está vacío`);
    if (size > MAX_GB * 1024 ** 3) throw new HttpError(413, `“${nombre}” pesa ${(size / 1024 ** 3).toFixed(1)} GB. El máximo por archivo es ${MAX_GB} GB.`);
    const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(b.mime ?? "")) ? String(b.mime).toLowerCase() : "";
    if (!MIME_OK.test(mime)) throw new HttpError(400, `“${nombre}”: solo se pueden subir videos y fotos`);

    const p = (await adminDb().collection("projects").doc(pid).get()).data() ?? {};
    const { accessToken } = await getAppDriveAccessToken();
    let parent = "root";
    for (const parte of [ROOT_FOLDER_NAME, nombreCarpeta(String(p.nombre ?? "Cliente")), CARPETA, String(v.carpeta || "Visita")]) {
      parent = await ensureFolder(parte, parent, accessToken);
    }
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
        appProperties: { prodi_visita: String(b.visita_id), prodi_by: caller.uid, prodi_subida: subida },
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

export async function visitaArchivo(req: VercelRequest, res: VercelResponse) {
  if (!soloPost(req, res)) return;
  try {
    const caller = await requireCaller(req, ["vendedor", "admin", "productor", "editor"]);
    const b = body<{ visita_id?: string; subida?: string }>(req);
    const { ref, v, pid } = await visitaPara(caller, b.visita_id);
    const subida = String(b.subida ?? "");
    if (!SUBIDA.test(subida)) throw new HttpError(400, "Subida inválida");

    const { accessToken } = await getAppDriveAccessToken();
    const q = `appProperties has { key='prodi_subida' and value='${subida}' } and trashed = false`;
    const campos = "files(id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,appProperties)";
    const r = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${campos}&pageSize=1`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw new HttpError(502, `Drive respondió ${r.status}`);
    const f = ((await r.json()) as { files?: ArchivoDrive[] }).files?.[0];
    if (!f) throw new HttpError(404, "El archivo no terminó de subir. Probá de nuevo.");
    if (f.appProperties?.prodi_visita !== b.visita_id || f.appProperties?.prodi_by !== caller.uid) throw new HttpError(403, "Este archivo no es de esta visita");

    // Compartido por link, igual que el resto del material (así se ven las miniaturas).
    await fetch(`${DRIVE_API}/files/${f.id}/permissions?fields=id`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    }).catch(() => undefined);

    const p = (await adminDb().collection("projects").doc(pid).get()).data() ?? {};
    const adjunto: Data = {
      drive_file_id: f.id,
      name: f.name,
      mime_type: String(f.mimeType || "application/octet-stream"),
      size: Number(f.size ?? 0),
      web_view_link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
      uploaded_at: new Date().toISOString(),
      uploaded_by: caller.uid,
      folder_path: [ROOT_FOLDER_NAME, nombreCarpeta(String(p.nombre ?? "Cliente")), CARPETA, String(v.carpeta || "Visita")].join("/"),
      origen: "vendedor",
      ...(f.thumbnailLink ? { thumbnail_link: f.thumbnailLink } : {}),
      ...(f.webContentLink ? { web_content_link: f.webContentLink } : {}),
    };
    const db = adminDb();
    // Si se confirma dos veces (reintento), no se duplica. El primer archivo de la visita le avisa a producción.
    const { total, avisar } = await db.runTransaction(async (tx) => {
      const actual = (await tx.get(ref)).data();
      if (!actual) throw new HttpError(404, "La visita ya no existe");
      const lista = (actual.archivos ?? []) as { drive_file_id?: string }[];
      if (lista.some((a) => a.drive_file_id === f.id)) return { total: lista.length, avisar: false };
      const ahora = new Date().toISOString();
      const avisar = !actual.avisado_at;
      tx.update(ref, { archivos: FieldValue.arrayUnion(adjunto), updated_at: ahora, ...(avisar ? { avisado_at: ahora } : {}) });
      return { total: lista.length + 1, avisar };
    });

    if (avisar) {
      const team = (p.team_roles ?? {}) as Record<string, string[]>;
      await enviarAviso(
        {
          destinatarios: (team.productor ?? []).filter((x) => x !== caller.uid),
          titulo: `Visita nueva de ${String(v.vendedor_nombre ?? "un vendedor").split(" ")[0]}`,
          cuerpo: `${p.nombre ?? "Cliente"} · ${v.fabrica} · ${v.titulo}`,
          link: `/visitas?visita=${ref.id}`,
          clave: `visita:${ref.id}`,
          proyectoId: pid,
        },
        appUrl(req)
      ).catch((e) => console.warn("[visitas] aviso", ref.id, e));
    }
    res.status(200).json({ ok: true, archivos: total });
  } catch (err) {
    fallo(res, err);
  }
}

/** Producción arma un video con el material de la visita: queda con el crudo cargado y pasa a edición. */
export async function visitaVideo(req: VercelRequest, res: VercelResponse) {
  if (!soloPost(req, res)) return;
  try {
    const caller = await requireCaller(req, ["admin", "productor"]);
    const b = body<{ visita_id?: string }>(req);
    const { ref, pid } = await visitaPara(caller, b.visita_id, { soloEquipo: true });
    const db = adminDb();
    const p = (await db.collection("projects").doc(pid).get()).data() ?? {};
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const videoId = await db.runTransaction(async (tx) => {
      const v = (await tx.get(ref)).data();
      if (!v) throw new HttpError(404, "La visita ya no existe");
      if (v.video_id) throw new HttpError(409, "Ya se armó un video con esta visita");
      const archivos = (v.archivos ?? []) as Data[];
      if (!archivos.length) throw new HttpError(409, "La visita todavía no tiene material");
      const vRef = db.collection("videos").doc();
      const idea = [
        `Visita a ${v.fabrica}${v.ubicacion ? ` (${v.ubicacion})` : ""}, cargada por ${v.vendedor_nombre} el ${String(v.fecha).split("-").reverse().join("/")}.`,
        v.descripcion ? `\n${v.descripcion}` : "",
        v.autoriza_publicar ? "" : "\n⚠️ El vendedor no marcó que la fábrica autoriza publicar: confirmalo antes de subirlo.",
      ].join("");
      const doc = videoDesdePedido(pid, team, mesAR(), { titulo: String(v.titulo), idea, objetivo: null, pedido_por: caller.uid }, `Video de la visita de ${v.vendedor_nombre} a ${v.fabrica}`);
      const ahora = new Date().toISOString();
      tx.set(vRef, {
        ...doc,
        pedido_cliente: false,
        // Con el material de la visita no hay nada que filmar: va directo a edición.
        etapa: "edicion",
        entrega_edicion: entregaSugerida(null),
        attachments_crudo: archivos,
        visita_id: ref.id,
      });
      tx.update(ref, { video_id: vRef.id, video_por: caller.uid, video_at: ahora, updated_at: ahora });
      return vRef.id;
    });
    const editores = team.editor ?? [];
    if (editores.length) {
      await enviarAviso(
        {
          destinatarios: editores.filter((x) => x !== caller.uid),
          titulo: "Video nuevo para editar",
          cuerpo: `${p.nombre ?? "Cliente"} · visita de un vendedor, con el material ya cargado`,
          link: `/videos?video=${videoId}`,
          clave: `visita_video:${videoId}`,
          proyectoId: pid,
          videoId,
        },
        appUrl(req)
      ).catch((e) => console.warn("[visitas] aviso edición", videoId, e));
    }
    res.status(200).json({ ok: true, video_id: videoId });
  } catch (err) {
    fallo(res, err);
  }
}

/** El super admin prende o apaga las visitas de vendedores en un cliente. */
export async function visitasActivar(req: VercelRequest, res: VercelResponse) {
  if (!soloPost(req, res)) return;
  try {
    await requireCaller(req, ["admin"]);
    const b = body<{ proyecto_id?: string; activo?: boolean }>(req);
    const pid = texto(b.proyecto_id, 120);
    if (!pid) throw new HttpError(400, "Falta el cliente");
    const ref = adminDb().collection("projects").doc(pid);
    if (!(await ref.get()).exists) throw new HttpError(404, "Cliente no encontrado");
    await ref.update({ visitas_activo: b.activo === true });
    res.status(200).json({ ok: true });
  } catch (err) {
    fallo(res, err);
  }
}
