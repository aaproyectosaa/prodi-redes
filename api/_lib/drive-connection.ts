// Resuelve un access token de Google Drive usando la conexión global de la app.

import { adminDb } from "./db";
import { decrypt, encrypt } from "./crypto";
import {
  GoogleAuthError,
  refreshAccessToken,
  type GoogleTokens,
} from "./google";

const COLLECTION = "app_settings";
const DOC_ID = "drive_connection";

interface StoredConnection {
  status: "connected" | "revoked" | "disconnected";
  email: string;
  refresh_token_enc?: {
    ciphertext: string;
    iv: string;
    authTag: string;
    algorithm: "aes-256-gcm";
  };
}

export class DriveConnectionError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

type TokenDrive = { accessToken: string; email: string; expiresIn: number };
// El token sirve ~1 hora: se reusa mientras le queden más de 5 minutos, y si varios archivos lo piden a la vez
// (una pieza con logos y fotos) esperan el mismo pedido. Antes cada descarga leía la base, pedía token a Google
// y escribía la base: con 8 archivos juntos la base se quedaba sin conexiones.
let tokenCache: { t: TokenDrive; vence: number } | null = null;
let tokenEnCurso: Promise<TokenDrive> | null = null;

export async function getAppDriveAccessToken(): Promise<TokenDrive> {
  if (tokenCache && tokenCache.vence > Date.now()) return tokenCache.t;
  if (tokenEnCurso) return tokenEnCurso;
  tokenEnCurso = pedirTokenDrive()
    .then((t) => {
      tokenCache = { t, vence: Date.now() + Math.max(0, t.expiresIn - 300) * 1000 };
      return t;
    })
    .finally(() => {
      tokenEnCurso = null;
    });
  return tokenEnCurso;
}

/** Al desconectar o reconectar Drive: que no se use el token guardado. */
export function olvidarTokenDrive() {
  tokenCache = null;
}

async function pedirTokenDrive(): Promise<TokenDrive> {
  const ref = adminDb().collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new DriveConnectionError(404, "no_connection");
  }

  const data = snap.data() as StoredConnection;

  if (data.status !== "connected") {
    throw new DriveConnectionError(409, "not_connected");
  }
  if (!data.refresh_token_enc) {
    throw new DriveConnectionError(409, "needs_reconnect");
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(data.refresh_token_enc);
  } catch (err) {
    throw new DriveConnectionError(
      500,
      "decrypt_failed",
      String(err)
    );
  }

  let tokens: GoogleTokens;
  try {
    tokens = await refreshAccessToken(refreshToken);
  } catch (err) {
    const isAuthErr =
      err instanceof GoogleAuthError &&
      (err.code === "invalid_grant" ||
        err.code === "invalid_token" ||
        err.status === 400 ||
        err.status === 401);
    if (isAuthErr) {
      await ref.update({
        status: "revoked",
        last_error:
          err instanceof Error ? err.message : "refresh_token invalid",
        last_used_at: new Date().toISOString(),
      });
      throw new DriveConnectionError(401, "refresh_revoked");
    }
    throw err;
  }

  const updates: Record<string, unknown> = {
    last_used_at: new Date().toISOString(),
  };
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    updates.refresh_token_enc = encrypt(tokens.refresh_token);
  }
  ref.update(updates).catch((err) => {
    console.warn("post-response Firestore update failed", err);
  });

  return {
    accessToken: tokens.access_token,
    email: data.email,
    expiresIn: tokens.expires_in,
  };
}
