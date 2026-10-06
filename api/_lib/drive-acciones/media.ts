// GET /api/drive/media?fileId=...&token=...
// Proxy autenticado hacia Drive con soporte Range para reproducción en <video>.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { HttpError } from "../auth";
import { requireCaller } from "../http";
import {
  DriveConnectionError,
  getAppDriveAccessToken,
} from "../drive-connection";

export const config = {
  maxDuration: 60,
};

const FORWARD_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
]);

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fileId = req.query.fileId;
  if (typeof fileId !== "string" || !fileId) {
    res.status(400).json({ error: "fileId required" });
    return;
  }

  try {
    await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "cliente"]);
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

    res.status(driveRes.status);
    driveRes.headers.forEach((value, key) => {
      if (FORWARD_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (!driveRes.ok) {
      const text = await driveRes.text();
      res.send(text);
      return;
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
