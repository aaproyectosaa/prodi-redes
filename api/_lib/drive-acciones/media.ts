// GET /api/drive/media?fileId=...&token=<permiso de /api/drive/media-token>
// Proxy hacia Drive con soporte Range para reproducción en <video>.
// El token no es la sesión: es un permiso firmado, de 1 hora y solo para ese archivo.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { HttpError } from "../auth";
import {
  DriveConnectionError,
  getAppDriveAccessToken,
} from "../drive-connection";
import { fileIdValido, validarTokenMedia } from "../media-token";

export const config = {
  maxDuration: 60,
};

const FORWARD_HEADERS = new Set([
  "content-length",
  "content-range",
  "accept-ranges",
]);

// Solo videos e imágenes comunes (sin SVG): nada que el navegador pueda ejecutar.
const TIPO_SEGURO = /^(video\/[a-z0-9.+-]+|image\/(png|jpeg|webp|gif|avif))$/;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fileId = req.query.fileId;
  if (!fileIdValido(fileId)) {
    res.status(400).json({ error: "fileId required" });
    return;
  }

  // Aunque falle, la respuesta nunca se interpreta como página.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("Cache-Control", "private, no-store");

  try {
    validarTokenMedia(req.query.token, fileId);
    const { accessToken } = await getAppDriveAccessToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    const range = req.headers.range;
    if (typeof range === "string") {
      headers.Range = range;
    }

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers }
    );

    if (!driveRes.ok) {
      await driveRes.body?.cancel().catch(() => undefined);
      res.status(driveRes.status).json({ error: `Drive respondió ${driveRes.status}` });
      return;
    }

    res.status(driveRes.status);
    driveRes.headers.forEach((value, key) => {
      if (FORWARD_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    const tipo = (driveRes.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (TIPO_SEGURO.test(tipo)) {
      res.setHeader("Content-Type", tipo);
    } else {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
    }

    if (!driveRes.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(
      driveRes.body as import("stream/web").ReadableStream
    );
    await pipeline(nodeStream, res);
  } catch (err) {
    if (err instanceof DriveConnectionError) {
      if (!res.headersSent) {
        res.status(err.status).json({ error: err.code });
      }
      return;
    }
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Internal error";
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
}
