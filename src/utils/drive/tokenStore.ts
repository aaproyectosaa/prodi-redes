// Cache global en memoria del access token de Drive.
// El backend (Vercel function) emite los access tokens a partir del
// refresh_token guardado. Acá sólo cacheamos para no pegarle a la red en
// cada upload dentro de la misma hora.

import { fetchAccessToken } from "./auth";

interface TokenEntry {
  access_token: string;
  expires_at: number; // epoch ms
  email: string;
}

let cached: TokenEntry | null = null;
let inflight: Promise<string> | null = null;

const SAFETY_WINDOW_MS = 60 * 1000; // refrescamos 1 min antes de expirar

export function getCachedToken(): string | null {
  if (!cached) return null;
  if (Date.now() + SAFETY_WINDOW_MS >= cached.expires_at) {
    cached = null;
    return null;
  }
  return cached.access_token;
}

export function clearToken() {
  cached = null;
}

/**
 * Devuelve un access token válido. Si no hay cache, le pide uno al backend.
 * El parámetro `ownerEmail` se ignora (queda por compat con el código previo);
 * el backend resuelve siempre el dueño global.
 */
export async function ensureAccessToken(
  _ownerEmail?: string
): Promise<string> {
  void _ownerEmail;
  const c = getCachedToken();
  if (c) return c;

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetchAccessToken();
      cached = {
        access_token: res.access_token,
        expires_at: Date.now() + res.expires_in * 1000,
        email: res.email,
      };
      return res.access_token;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
