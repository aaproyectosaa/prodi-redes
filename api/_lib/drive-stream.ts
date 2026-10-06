// Lectura de archivos de Drive con la conexión de la app (para el reproductor y la IA).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { getAppDriveAccessToken } from "./drive-connection";

const FORWARD = new Set(["content-type", "content-length", "content-range", "accept-ranges"]);

/** Reenvía el archivo al navegador con soporte de Range (para <video>). */
export async function streamDriveFile(
  req: VercelRequest,
  res: VercelResponse,
  fileId: string,
  /** Si se indica, se responde con este tipo (no el que diga Drive). */
  mime?: string
): Promise<void> {
  const { accessToken } = await getAppDriveAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (typeof req.headers.range === "string") headers.Range = req.headers.range;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers });
  res.status(r.status);
  r.headers.forEach((value, key) => {
    if (FORWARD.has(key.toLowerCase()) && !(mime && key.toLowerCase() === "content-type")) res.setHeader(key, value);
  });
  if (mime) res.setHeader("Content-Type", mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  if (!r.ok || !r.body) {
    res.send(r.ok ? "" : await r.text());
    return;
  }
  await pipeline(Readable.fromWeb(r.body as import("stream/web").ReadableStream), res);
}

/** Descarga un archivo chico de Drive a memoria. */
export async function descargarDrive(fileId: string, maxBytes = 8 * 1024 * 1024): Promise<{ data: Buffer; mime: string }> {
  const { accessToken } = await getAppDriveAccessToken();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`Drive: no se pudo leer el archivo (${r.status})`);
  const data = Buffer.from(await r.arrayBuffer());
  if (data.length > maxBytes) throw new Error("Drive: el archivo es demasiado grande");
  return { data, mime: (r.headers.get("content-type") ?? "image/png").split(";")[0] };
}
