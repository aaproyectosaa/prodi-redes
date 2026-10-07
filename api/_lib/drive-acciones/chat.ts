// Archivos en el chat (fotos, videos, PDF, documentos).
//
// POST /api/drive/chat-subida  { chat_id, nombre, mime, size } → { subida, url }
//   El servidor abre una subida a Drive (Progreso/Chat/<chat>) con la cuenta de la app y le da al navegador
//   solo esa URL: sirve para subir ESE archivo y nada más (el cliente nunca recibe el acceso a Drive).
// POST /api/drive/chat-archivo { chat_id, subida, texto? } → { id }
//   Cuando terminó de subir: el servidor busca el archivo por la marca de la subida, revisa que sea de
//   ese chat y de esa persona, y recién ahí escribe el mensaje. Solo los mensajes que escribe el servidor
//   pueden tener `archivo`: así /api/drive/media-token sabe que los miembros del chat lo pueden ver.

import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { appUrl, body, HttpError, requireCaller, sendError } from "../http";
import { DriveConnectionError, getAppDriveAccessToken } from "../drive-connection";
import { ensureFolder, ROOT_FOLDER_NAME } from "../drive-server";
import { avisarMensaje, chatDeMiembro, publicarEnChat } from "../chat-server";
import type { Data } from "../db";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const ROLES = ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"];

/** Tope por archivo (la subida va directo a Drive, no pasa por Vercel). */
export const CHAT_MAX_MB = 200;
/** Nada que se pueda ejecutar o abrir como página. */
const BLOQUEADOS = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|vbs|js|mjs|jar|sh|apk|app|dll|html?|xhtml|svg|hta)$/i;
const SUBIDA = /^[a-f0-9]{32}$/;

function carpetaDelChat(chatId: string, chat: Data): string {
  if (chat.tipo === "equipo") return "Equipo Prodi";
  if (chat.tipo === "cliente") return String(chat.nombre ?? chatId).replace(/[\\/]/g, "-").slice(0, 100);
  if (chat.tipo === "grupo") return `Grupos/${chatId}`;
  return `Privados/${chatId}`;
}

function fallo(res: VercelResponse, err: unknown) {
  if (err instanceof DriveConnectionError) {
    // La causa exacta, para que el admin sepa qué hacer.
    const causa: Record<string, string> = {
      no_connection: "Drive no está conectado: el admin lo conecta en Ajustes.",
      not_connected: "Drive está desconectado: el admin lo reconecta en Ajustes.",
      needs_reconnect: "Hay que reconectar Drive en Ajustes.",
      refresh_revoked: "Google revocó el acceso a Drive: el admin lo reconecta en Ajustes.",
      decrypt_failed: "No se pudo leer la conexión de Drive (revisar TOKEN_ENCRYPTION_KEY en Vercel o reconectar Drive en Ajustes).",
    };
    console.error("[chat] drive", err.code, err.message);
    if (!res.headersSent) res.status(503).json({ error: causa[err.code] ?? "Drive no está disponible. Avisale al admin." });
    return;
  }
  sendError(res, err);
}

export async function chatSubida(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ chat_id?: string; nombre?: string; mime?: string; size?: number }>(req);
    const chat = await chatDeMiembro(b.chat_id, caller.uid);
    const chatId = String(b.chat_id);
    const nombre = String(b.nombre ?? "").replace(/[\\/\r\n\t]+/g, " ").trim().slice(0, 150) || "archivo";
    const size = Number(b.size);
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "El archivo está vacío");
    if (size > CHAT_MAX_MB * 1024 * 1024) {
      throw new HttpError(413, `“${nombre}” pesa ${Math.round(size / 1024 / 1024)} MB. El máximo en el chat es ${CHAT_MAX_MB} MB.`);
    }
    if (BLOQUEADOS.test(nombre)) throw new HttpError(400, "Ese tipo de archivo no se puede mandar por el chat");
    const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(b.mime ?? "")) ? String(b.mime).toLowerCase() : "application/octet-stream";

    const { accessToken } = await getAppDriveAccessToken();
    let parent = "root";
    for (const parte of [ROOT_FOLDER_NAME, "Chat", ...carpetaDelChat(chatId, chat).split("/")]) {
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
        appProperties: { prodi_chat: chatId, prodi_by: caller.uid, prodi_subida: subida },
      }),
    });
    const url = init.headers.get("location");
    if (!init.ok || !url) throw new HttpError(502, `Drive no abrió la subida (${init.status})`);
    res.status(200).json({ subida, url, mime });
  } catch (err) {
    fallo(res, err);
  }
}

export async function chatArchivo(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const caller = await requireCaller(req, ROLES);
    const b = body<{ chat_id?: string; subida?: string; texto?: string }>(req);
    const chat = await chatDeMiembro(b.chat_id, caller.uid);
    const chatId = String(b.chat_id);
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
    if (f.appProperties?.prodi_chat !== chatId || f.appProperties?.prodi_by !== caller.uid) throw new HttpError(403, "Este archivo no es de este chat");

    const mime = String(f.mimeType || "application/octet-stream");
    const tipo = mime.startsWith("image/") ? "📷 Foto" : mime.startsWith("video/") ? "🎬 Video" : `📎 ${f.name}`;
    const texto = String(b.texto ?? "").trim().slice(0, 2000);
    const at = new Date().toISOString();
    const resumen = texto ? `${tipo} · ${texto}` : tipo;
    const { id, nuevo } = await publicarEnChat(
      chatId,
      {
        texto: resumen,
        leyenda: texto || null,
        by: caller.uid,
        by_nombre: caller.nombre ?? "",
        at,
        tipo: "archivo",
        link: null,
        reunion_id: null,
        archivo: { drive_file_id: f.id, name: f.name, mime_type: mime, size: Number(f.size ?? 0) },
      },
      `f_${subida}`
    );
    if (nuevo) await avisarMensaje(chatId, chat, caller.uid, caller.nombre ?? "", resumen, appUrl(req));
    res.status(200).json({ ok: true, id });
  } catch (err) {
    fallo(res, err);
  }
}
