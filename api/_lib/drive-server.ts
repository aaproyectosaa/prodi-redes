// Subida de archivos a Drive desde el servidor (piezas generadas con IA).

import { getAppDriveAccessToken } from "./drive-connection";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
export const ROOT_FOLDER_NAME = "Progreso";

export async function ensureFolder(name: string, parent: string, token: string): Promise<string> {
  const safe = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `name = '${safe}' and '${parent}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const r = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Drive: búsqueda de carpeta falló (${r.status})`);
  const found = (await r.json()) as { files?: { id: string }[] };
  if (found.files?.[0]?.id) return found.files[0].id;
  const c = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  });
  if (!c.ok) throw new Error(`Drive: no se pudo crear la carpeta (${c.status})`);
  return ((await c.json()) as { id: string }).id;
}

export interface ServerUploadResult {
  drive_file_id: string;
  name: string;
  mime_type: string;
  web_view_link: string;
  thumbnail_link?: string | null;
}

/** Sube un buffer a Progreso/<cliente>/<subcarpeta> y lo comparte por link. */
export async function uploadBufferToDrive(params: {
  path: string[];
  name: string;
  mime: string;
  data: Buffer;
}): Promise<ServerUploadResult> {
  const { accessToken: token } = await getAppDriveAccessToken();
  let parent = "root";
  for (const part of [ROOT_FOLDER_NAME, ...params.path]) {
    parent = await ensureFolder(part, parent, token);
  }

  const boundary = `prodi${Date.now()}`;
  const meta = JSON.stringify({ name: params.name, mimeType: params.mime, parents: [parent] });
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${params.mime}\r\n\r\n`),
    params.data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const up = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,thumbnailLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipart,
    }
  );
  if (!up.ok) throw new Error(`Drive: no se pudo subir el archivo (${up.status})`);
  const file = (await up.json()) as { id: string; name: string; mimeType: string; webViewLink?: string; thumbnailLink?: string };

  await fetch(`${DRIVE_API}/files/${file.id}/permissions?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  }).catch(() => undefined);

  return {
    drive_file_id: file.id,
    name: file.name,
    mime_type: file.mimeType,
    web_view_link: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
    thumbnail_link: file.thumbnailLink ?? null,
  };
}
