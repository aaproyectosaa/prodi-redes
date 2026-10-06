// Links de aprobación para el cliente: firmados, sin necesidad de entrar al sistema.
// Formato: base64url("v1.<videoId>.<vence_epoch>.<ronda>").<hmac>
// La ronda hace que un link viejo no sirva para aprobar una versión nueva del video.

import crypto from "crypto";
import { HttpError } from "./auth";

const DIAS = 30;

function secreto(): string {
  const s = process.env.APROBACION_SECRET || process.env.OAUTH_STATE_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!s) throw new Error("Falta APROBACION_SECRET en Vercel");
  return s;
}

const firmar = (data: string) =>
  crypto.createHmac("sha256", secreto()).update(`aprobacion:${data}`).digest("base64url").slice(0, 32);

export function crearTokenAprobacion(videoId: string, ronda: number, dias = DIAS): string {
  const vence = Math.floor(Date.now() / 1000) + dias * 86400;
  const data = Buffer.from(`v1.${videoId}.${vence}.${Number(ronda) || 0}`).toString("base64url");
  return `${data}.${firmar(data)}`;
}

/** Devuelve el video y la ronda si el token es válido; si no, tira 403/410. */
export function leerTokenAprobacion(token: string): { videoId: string; ronda: number } {
  const [data, sig] = String(token ?? "").split(".");
  if (!data || !sig) throw new HttpError(403, "Link inválido");
  const esperado = firmar(data);
  const a = Buffer.from(esperado);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, "Link inválido");
  const [v, videoId, vence, ronda] = Buffer.from(data, "base64url").toString().split(".");
  if (v !== "v1" || !videoId) throw new HttpError(403, "Link inválido");
  if (Number(vence) * 1000 < Date.now()) throw new HttpError(410, "Este link venció. Pedile uno nuevo al equipo de Prodi.");
  return { videoId, ronda: Number(ronda) || 0 };
}

export const linkAprobacion = (base: string, videoId: string, ronda: number) =>
  `${base}/aprobar/${crearTokenAprobacion(videoId, ronda)}`;
