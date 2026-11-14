// Avisos de la app nativa (Prodi Chat de App Store y Google Play) por Firebase Cloud Messaging (FCM v1).
// FCM los entrega en Android y, en iPhone, por APNs (la clave .p8 de Apple se carga en la consola de Firebase).
//
// Credencial: FIREBASE_SERVICE_ACCOUNT = el JSON de la cuenta de servicio de Firebase (tal cual o en base64).
// Sin esa variable no se mandan avisos nativos (los Web Push siguen igual).

import { createSign } from "node:crypto";

interface Cuenta {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cuenta: Cuenta | null | undefined;
function leerCuenta(): Cuenta | null {
  if (cuenta !== undefined) return cuenta;
  const crudo = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim().replace(/^'|'$/g, "");
  if (!crudo) return (cuenta = null);
  try {
    const texto = crudo.startsWith("{") ? crudo : Buffer.from(crudo, "base64").toString("utf8");
    const c = JSON.parse(texto) as Cuenta;
    if (!c.project_id || !c.client_email || !c.private_key) throw new Error("faltan campos");
    c.private_key = c.private_key.replace(/\\n/g, "\n");
    return (cuenta = c);
  } catch (err) {
    console.warn("[fcm] FIREBASE_SERVICE_ACCOUNT inválida:", (err as Error).message);
    return (cuenta = null);
  }
}

export const fcmConfigurado = () => !!leerCuenta();

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

let acceso: { token: string; vence: number } | null = null;
async function tokenDeAcceso(c: Cuenta): Promise<string> {
  if (acceso && acceso.vence > Date.now() + 60_000) return acceso.token;
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const datos = b64url(
    JSON.stringify({
      iss: c.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: ahora,
      exp: ahora + 3600,
    })
  );
  const firma = createSign("RSA-SHA256").update(`${cabecera}.${datos}`).sign(c.private_key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cabecera}.${datos}.${b64url(firma)}` }),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google no dio acceso a FCM: ${j.error_description ?? r.status}`);
  acceso = { token: j.access_token, vence: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return acceso.token;
}

export interface AvisoNativo {
  title: string;
  body: string;
  /** Ruta dentro de la app (ej. /chat?c=…): se abre al tocar el aviso. */
  url: string;
  tag?: string;
}

/** Resultado de un envío. `borrar`: el token ya no existe (app desinstalada, sesión cerrada): sacarlo. */
export interface ResultadoFcm {
  ok: boolean;
  estado?: number;
  borrar?: boolean;
  error?: string;
}

export async function enviarFcm(token: string, aviso: AvisoNativo): Promise<ResultadoFcm> {
  const c = leerCuenta();
  if (!c) return { ok: false, estado: 0, borrar: false, error: "Falta FIREBASE_SERVICE_ACCOUNT" };
  const tag = (aviso.tag || "").slice(0, 60) || undefined;
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await tokenDeAcceso(c)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: aviso.title.slice(0, 120), body: aviso.body.slice(0, 400) },
        data: { url: aviso.url, ...(tag ? { tag } : {}) },
        android: {
          priority: "HIGH",
          ttl: "86400s",
          // Mismo tag = el aviso nuevo de ese chat reemplaza al anterior (no se apilan).
          notification: { channel_id: "avisos", ...(tag ? { tag } : {}), default_sound: true },
        },
        apns: {
          headers: { "apns-priority": "10", ...(tag ? { "apns-collapse-id": tag.slice(0, 64) } : {}) },
          payload: { aps: { sound: "default", ...(tag ? { "thread-id": tag } : {}) } },
        },
      },
    }),
  });
  if (r.ok) return { ok: true };
  const texto = await r.text().catch(() => "");
  // 404 UNREGISTERED / 400 INVALID_ARGUMENT del token: ese celular ya no está.
  const borrar = r.status === 404 || (r.status === 400 && /registration token|UNREGISTERED|INVALID_ARGUMENT/i.test(texto) && /token/i.test(texto));
  return { ok: false, estado: r.status, borrar, error: texto.slice(0, 200) };
}
