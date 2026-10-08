// Avisos push estándar (Web Push con claves VAPID): funcionan en Android, compu y en iPhone
// con la app instalada. Las suscripciones de cada navegador están en `push_suscripciones`.

//
// Dos apps: Prodi (el sistema) y Prodi Chat. Con Prodi Chat en su propia dirección (VITE_CHAT_URL), cada
// suscripción sabe de qué app es (`datos.app`) y los avisos del chat van solo a Prodi Chat y el resto
// solo a Prodi, para que no se mezclen. Sin VITE_CHAT_URL, todo va a todos los dispositivos, como antes.

import webpush from "web-push";
import { getPool } from "./db";

export type AppPush = "chat" | "sistema";

/** Dirección propia de Prodi Chat (ej. https://prodi-chat.vercel.app), o "" si comparte la del sistema. */
export const chatUrl = () => (process.env.VITE_CHAT_URL || "").trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");

/** ¿Este aviso es del chat? (los avisos de mensajes llevan a /chat?c=…). */
export const esAvisoDeChat = (link: string) => /^\/chat(\?|$|\/)/.test(link);

let listo: boolean | null = null;
function configurar(): boolean {
  if (listo !== null) return listo;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn("[push] Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY: no se mandan avisos push");
    return (listo = false);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hola@somosprodi.com", pub, priv);
  return (listo = true);
}

export interface Suscripcion {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function guardarSuscripcion(uid: string, s: Suscripcion, app: AppPush = "sistema") {
  if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) throw new Error("Suscripción inválida");
  await getPool().query(
    `insert into push_suscripciones (endpoint, uid, datos) values ($1, $2, $3::jsonb)
     on conflict (endpoint) do update set uid = excluded.uid, datos = excluded.datos`,
    [s.endpoint, uid, JSON.stringify({ endpoint: s.endpoint, keys: s.keys, app: app === "chat" ? "chat" : "sistema" })]
  );
}

export async function borrarSuscripciones(uid: string, endpoint?: string) {
  if (endpoint) await getPool().query("delete from push_suscripciones where uid = $1 and endpoint = $2", [uid, endpoint]);
  else await getPool().query("delete from push_suscripciones where uid = $1", [uid]);
}

/** Prueba: manda un aviso a cada dispositivo del usuario y devuelve qué pasó con cada uno. */
export async function probarPush(uid: string): Promise<{ configurado: boolean; dispositivos: { equipo: string; ok: boolean; estado?: number; error?: string }[] }> {
  if (!configurar()) return { configurado: false, dispositivos: [] };
  const r = await getPool().query("select endpoint, datos from push_suscripciones where uid = $1", [uid]);
  const equipo = (endpoint: string) =>
    /push.apple.com/.test(endpoint) ? "iPhone / Mac (Apple)" : /fcm.googleapis/.test(endpoint) ? "Chrome / Android" : /mozilla/.test(endpoint) ? "Firefox" : /notify.windows/.test(endpoint) ? "Edge (Windows)" : "otro";
  const dispositivos = await Promise.all(
    r.rows.map(async (row: { endpoint: string; datos: Suscripcion }) => {
      try {
        await webpush.sendNotification(row.datos, JSON.stringify({ title: "Prueba de Prodi", body: "Si ves esto, los avisos llegan a este dispositivo.", url: "/notificaciones", tag: "prueba" }), { TTL: 600 });
        return { equipo: equipo(row.endpoint), ok: true };
      } catch (err) {
        const estado = (err as { statusCode?: number }).statusCode;
        if (estado === 404 || estado === 410) await getPool().query("delete from push_suscripciones where endpoint = $1", [row.endpoint]);
        return { equipo: equipo(row.endpoint), ok: false, estado, error: String((err as { body?: string }).body || (err as Error).message).slice(0, 200) };
      }
    })
  );
  return { configurado: true, dispositivos };
}

/**
 * Manda el aviso a los dispositivos del usuario: con Prodi Chat aparte, solo a los de la app `canal`
 * (las suscripciones viejas, sin app, son del sistema). Borra las suscripciones que ya no existen.
 */
export async function enviarPush(uid: string, aviso: { title: string; body: string; url: string; tag?: string }, canal: AppPush = "sistema"): Promise<number> {
  if (!configurar()) return 0;
  const r = await getPool().query("select endpoint, datos from push_suscripciones where uid = $1", [uid]);
  const separadas = !!chatUrl();
  const filas = (r.rows as { endpoint: string; datos: Suscripcion & { app?: AppPush } }[]).filter(
    (row) => !separadas || (row.datos.app === "chat" ? "chat" : "sistema") === canal
  );
  let enviados = 0;
  await Promise.all(
    filas.map(async (row) => {
      try {
        await webpush.sendNotification(row.datos, JSON.stringify(aviso), { TTL: 24 * 3600 });
        enviados++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await getPool().query("delete from push_suscripciones where endpoint = $1", [row.endpoint]);
        else console.warn("[push] no se pudo mandar", status, (err as Error).message);
      }
    })
  );
  return enviados;
}
