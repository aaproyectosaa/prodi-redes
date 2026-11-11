// POST /api/drive/worker-token  (header x-worker-key)
// El puente de videos de Cloudflare (cloudflare/media) pide acá el token de Drive de la app, lo guarda mientras vale y
// pasa los videos y fotos sin que Vercel cobre la transferencia. La clave sale de AUTH_SECRET (no hay variable nueva).

import crypto from "crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAppDriveAccessToken } from "../drive-connection";

export function claveWorker(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("Falta AUTH_SECRET");
  return crypto.createHmac("sha256", s).update("prodi:media-worker:v1").digest("base64url");
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const dada = Buffer.from(String(req.headers["x-worker-key"] ?? ""));
  const buena = Buffer.from(claveWorker());
  if (dada.length !== buena.length || !crypto.timingSafeEqual(dada, buena)) {
    res.status(403).json({ error: "No autorizado" });
    return;
  }
  try {
    const { accessToken, expiresIn } = await getAppDriveAccessToken();
    res.status(200).json({ accessToken, expiresIn });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : "Drive no disponible" });
  }
}
