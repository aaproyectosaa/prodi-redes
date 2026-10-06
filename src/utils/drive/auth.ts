// Cliente de la API de Drive expuesta por Vercel.
// El backend guarda el refresh_token y emite access tokens frescos.
// Antes la app usaba implicit flow + silent refresh por navegador, lo que
// se caía cada vez que el dueño cambiaba de navegador o sesión Google.

import { auth } from "@/integrations/firebase/client";

export interface AccessTokenResponse {
  access_token: string;
  expires_in: number;
  email: string;
}

export class DriveAuthError extends Error {
  code:
    | "no_connection"
    | "needs_reconnect"
    | "refresh_revoked"
    | "not_connected"
    | "popup_blocked"
    | "popup_closed"
    | "unauthorized"
    | "unknown";
  status: number;

  constructor(
    message: string,
    code: DriveAuthError["code"] = "unknown",
    status = 0
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function getIdToken(): Promise<string> {
  const u = auth.currentUser;
  if (!u) {
    throw new DriveAuthError(
      "Necesitás estar logueado",
      "unauthorized",
      401
    );
  }
  return u.getIdToken();
}

async function api<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const idToken = await getIdToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // empty body
  }

  if (!res.ok) {
    const errCode =
      (body && typeof body === "object" && "error" in body
        ? (body as { error: string }).error
        : "unknown") || "unknown";
    const message =
      typeof errCode === "string" ? errCode : "Error desconocido";
    const known: DriveAuthError["code"][] = [
      "no_connection",
      "needs_reconnect",
      "refresh_revoked",
      "not_connected",
    ];
    const code = (known as string[]).includes(errCode)
      ? (errCode as DriveAuthError["code"])
      : "unknown";
    throw new DriveAuthError(message, code, res.status);
  }

  return body as T;
}

/**
 * Inicia el flujo OAuth: pide al backend la URL firmada y abre un popup.
 * Resuelve cuando el callback postea el resultado o el popup se cierra.
 */
export async function startOAuthFlow(): Promise<{ email: string }> {
  const { authUrl } = await api<{ authUrl: string }>(
    "/api/drive/start-auth",
    { method: "POST" }
  );

  return new Promise((resolve, reject) => {
    const popup = window.open(
      authUrl,
      "drive-oauth",
      "width=520,height=640,menubar=no,toolbar=no,location=no,status=no"
    );

    if (!popup) {
      reject(
        new DriveAuthError(
          "El navegador bloqueó el popup. Habilitalo y reintentá.",
          "popup_blocked"
        )
      );
      return;
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(checkClosed);
    };

    const onMessage = (e: MessageEvent) => {
      const data = e.data as
        | {
            type?: string;
            ok?: boolean;
            message?: string;
            detail?: string | null;
          }
        | undefined;
      if (!data || data.type !== "drive-oauth-result") return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      if (data.ok) {
        resolve({ email: data.detail ?? "" });
      } else {
        reject(
          new DriveAuthError(
            data.detail ?? data.message ?? "Auth falló",
            "unknown"
          )
        );
      }
    };

    const checkClosed = window.setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        reject(
          new DriveAuthError(
            "Cancelaste la conexión",
            "popup_closed"
          )
        );
      }
    }, 500);

    window.addEventListener("message", onMessage);
  });
}

/**
 * Pide al backend un access token válido.
 * Cualquier usuario logueado puede llamar; el backend valida ID token de
 * Firebase y resuelve usando el refresh_token del dueño.
 */
export async function fetchAccessToken(): Promise<AccessTokenResponse> {
  return api<AccessTokenResponse>("/api/drive/access-token", {
    method: "POST",
  });
}

/**
 * Sólo el dueño puede desconectar (el backend valida).
 */
export async function disconnectDrive(): Promise<void> {
  await api<{ ok: true }>("/api/drive/disconnect", { method: "POST" });
}
