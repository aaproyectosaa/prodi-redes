// Wrapper sobre la Google Drive REST API v3
// Usado solo desde el dueño (con su access token).

import { resolveMimeType } from "./fileValidation";
import type { DriveAttachment } from "./types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

interface DriveErrorBody {
  error?: {
    code: number;
    message: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

export class DriveApiError extends Error {
  status: number;
  reason?: string;
  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

async function driveFetch(
  url: string,
  init: RequestInit,
  accessToken: string
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let reason: string | undefined;
    let message = `Drive API error ${res.status}`;
    try {
      const body = (await res.clone().json()) as DriveErrorBody;
      message = body.error?.message ?? message;
      reason = body.error?.errors?.[0]?.reason;
    } catch {
      // no-op
    }
    throw new DriveApiError(message, res.status, reason);
  }
  return res;
}

/**
 * Sanitiza un nombre de carpeta para Drive (no permite ciertos chars).
 */
export function sanitizeName(name: string): string {
  return name
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "Sin nombre";
}

/**
 * Busca una carpeta por nombre dentro de un parent. Devuelve folderId o null.
 */
export async function findFolder(
  name: string,
  parentId: string,
  accessToken: string
): Promise<string | null> {
  const safe = name.replace(/'/g, "\\'");
  const q = `name = '${safe}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
  const res = await driveFetch(url, { method: "GET" }, accessToken);
  const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  return data.files?.[0]?.id ?? null;
}

export async function createFolder(
  name: string,
  parentId: string | "root",
  accessToken: string
): Promise<string> {
  const url = `${DRIVE_API}/files?fields=id,name`;
  const res = await driveFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    },
    accessToken
  );
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function findOrCreateFolder(
  name: string,
  parentId: string | "root",
  accessToken: string
): Promise<string> {
  const sanitized = sanitizeName(name);
  // Para el root special, primero buscamos en 'root'
  const parent = parentId === "root" ? "root" : parentId;
  const existing = await findFolder(sanitized, parent, accessToken);
  if (existing) return existing;
  return createFolder(sanitized, parent, accessToken);
}

/**
 * Resuelve una ruta de carpetas: ['Progreso','ClienteX','Reel','2026-05-15']
 * Cada nivel se busca/crea bajo el anterior. Devuelve el id del último.
 */
export async function ensureFolderPath(
  parts: string[],
  accessToken: string,
  cache?: Map<string, string>
): Promise<string> {
  let parent: string | "root" = "root";
  let acc = "";
  for (const raw of parts) {
    const part = sanitizeName(raw);
    acc = acc ? `${acc}/${part}` : part;
    if (cache?.has(acc)) {
      parent = cache.get(acc)!;
      continue;
    }
    const id = await findOrCreateFolder(part, parent, accessToken);
    cache?.set(acc, id);
    parent = id;
  }
  return parent === "root" ? "root" : parent;
}

/**
 * Marca un archivo como público con link (anyone with link can read).
 */
export async function makeFilePublic(
  fileId: string,
  accessToken: string
): Promise<void> {
  const url = `${DRIVE_API}/files/${fileId}/permissions?fields=id`;
  await driveFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    },
    accessToken
  );
}

/**
 * Obtiene metadata útil del archivo (thumbnail, links).
 */
export async function getFileMetadata(
  fileId: string,
  accessToken: string
): Promise<{
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
}> {
  const fields =
    "id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink";
  const url = `${DRIVE_API}/files/${fileId}?fields=${encodeURIComponent(
    fields
  )}`;
  const res = await driveFetch(url, { method: "GET" }, accessToken);
  return res.json();
}

/** Descarga el contenido binario de un archivo de Drive (requiere token con acceso al archivo). */
export async function downloadDriveFileBlob(
  fileId: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<Blob> {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await driveFetch(url, { method: "GET", signal }, accessToken);
  return res.blob();
}

export async function deleteFile(
  fileId: string,
  accessToken: string
): Promise<void> {
  const url = `${DRIVE_API}/files/${fileId}`;
  await driveFetch(url, { method: "DELETE" }, accessToken);
}

type UploadedFileMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: string;
};

/** Busca el archivo más reciente con ese nombre dentro de la carpeta. */
async function findUploadedFileByName(
  name: string,
  folderId: string,
  accessToken: string
): Promise<UploadedFileMeta> {
  const safe = name.replace(/'/g, "\\'");
  const q = `name = '${safe}' and '${folderId}' in parents and trashed = false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,mimeType,size)&orderBy=createdTime%20desc&pageSize=1`;

  const res = await driveFetch(url, { method: "GET" }, accessToken);
  const data = (await res.json()) as {
    files?: UploadedFileMeta[];
  };
  const file = data.files?.[0];
  if (!file) {
    throw new DriveApiError(
      `Upload completado pero no se encontró ${name} en Drive`,
      0
    );
  }
  return file;
}

function parseDriveUploadResponse(
  responseText: string
): UploadedFileMeta | null {
  const trimmed = responseText.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as UploadedFileMeta;
}

const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

function putUploadChunk(params: {
  sessionUri: string;
  chunk: Blob;
  rangeStart: number;
  rangeEnd: number;
  totalSize: number;
  mime: string;
  signal?: AbortSignal;
  onChunkProgress?: (loaded: number) => void;
}): Promise<{ status: number; body: string; rangeEnd: number }> {
  const {
    sessionUri,
    chunk,
    rangeStart,
    rangeEnd,
    totalSize,
    mime,
    signal,
    onChunkProgress,
  } = params;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUri, true);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader(
      "Content-Range",
      `bytes ${rangeStart}-${rangeEnd}/${totalSize}`
    );

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onChunkProgress) {
        onChunkProgress(e.loaded);
      }
    };

    xhr.onload = () => {
      resolve({
        status: xhr.status,
        body: xhr.responseText,
        rangeEnd,
      });
    };

    xhr.onerror = () => reject(new DriveApiError("Error de red al subir", 0));
    xhr.onabort = () => reject(new DriveApiError("Upload cancelado", 0));

    if (signal) {
      const onAbort = () => xhr.abort();
      if (signal.aborted) xhr.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.send(chunk);
  });
}

/**
 * Sube un archivo usando upload resumable en chunks. Reporta progress.
 * Google Drive exige Content-Range; sin eso las imágenes chicas pueden pasar
 * pero los videos suelen fallar o devolver respuesta vacía.
 */
export async function uploadFileResumable(params: {
  file: File;
  folderId: string;
  accessToken: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<UploadedFileMeta> {
  const { file, folderId, accessToken, onProgress, signal } = params;
  const mime = resolveMimeType(file);
  const totalSize = file.size;

  const initRes = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,size`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        "X-Upload-Content-Length": String(totalSize),
      },
      body: JSON.stringify({
        name: file.name,
        mimeType: mime,
        parents: [folderId],
      }),
      signal,
    }
  );

  if (!initRes.ok) {
    let msg = `Init upload failed (${initRes.status})`;
    try {
      const body = (await initRes.json()) as DriveErrorBody;
      msg = body.error?.message ?? msg;
    } catch {
      // ignore
    }
    throw new DriveApiError(msg, initRes.status);
  }

  const sessionUri = initRes.headers.get("Location");
  if (!sessionUri) {
    throw new DriveApiError("Sesión de upload sin Location", 0);
  }

  let offset = 0;

  while (offset < totalSize) {
    const rangeEnd = Math.min(offset + UPLOAD_CHUNK_SIZE, totalSize) - 1;
    const chunk = file.slice(offset, rangeEnd + 1);

    const result = await putUploadChunk({
      sessionUri,
      chunk,
      rangeStart: offset,
      rangeEnd,
      totalSize,
      mime,
      signal,
      onChunkProgress: (loaded) => {
        if (onProgress) {
          onProgress(Math.round(((offset + loaded) / totalSize) * 100));
        }
      },
    });

    if (result.status === 308) {
      offset = result.rangeEnd + 1;
      continue;
    }

    if (result.status >= 200 && result.status < 300) {
      if (onProgress) onProgress(100);

      try {
        const parsed = parseDriveUploadResponse(result.body);
        if (parsed) return parsed;
      } catch (err) {
        throw new DriveApiError(
          err instanceof Error ? err.message : "Respuesta inválida de Drive",
          result.status
        );
      }

      return findUploadedFileByName(file.name, folderId, accessToken);
    }

    let msg = `Upload failed (${result.status})`;
    try {
      const body = JSON.parse(result.body) as DriveErrorBody;
      msg = body.error?.message ?? msg;
    } catch {
      // ignore
    }
    throw new DriveApiError(msg, result.status);
  }

  return findUploadedFileByName(file.name, folderId, accessToken);
}

/** Firestore no acepta campos con valor `undefined` dentro de arrayUnion. */
export function sanitizeDriveAttachment(
  attachment: DriveAttachment
): DriveAttachment {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attachment)) {
    if (value !== undefined) clean[key] = value;
  }
  return clean as unknown as DriveAttachment;
}

/**
 * Flujo completo: sube archivo a la carpeta y lo hace público con link.
 * Devuelve la metadata lista para guardar como DriveAttachment.
 */
export async function uploadAndShare(params: {
  file: File;
  folderId: string;
  folderPath: string;
  uploaderUid: string;
  accessToken: string;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<DriveAttachment> {
  const { file, folderId, folderPath, uploaderUid, accessToken } = params;

  const uploaded = await uploadFileResumable({
    file,
    folderId,
    accessToken,
    onProgress: params.onProgress,
    signal: params.signal,
  });

  // Hacer público (best-effort: si falla, igual queda subido)
  try {
    await makeFilePublic(uploaded.id, accessToken);
  } catch (err) {
    console.warn("No se pudo marcar el archivo como público:", err);
  }

  // Traer metadata completa con thumbnail/webViewLink
  const meta = await getFileMetadata(uploaded.id, accessToken);

  return sanitizeDriveAttachment({
    drive_file_id: meta.id,
    name: meta.name,
    mime_type: meta.mimeType,
    size: meta.size ? Number(meta.size) : file.size,
    thumbnail_link: meta.thumbnailLink,
    web_view_link:
      meta.webViewLink ?? `https://drive.google.com/file/d/${meta.id}/view`,
    web_content_link: meta.webContentLink,
    uploaded_at: new Date().toISOString(),
    uploaded_by: uploaderUid,
    folder_path: folderPath,
  });
}
