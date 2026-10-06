// Avisos push estándar (Web Push con claves VAPID): funcionan en Android, compu y en iPhone
// con la app instalada. Las suscripciones de cada navegador están en `push_suscripciones`.

import webpush from "web-push";
import { getPool } from "./db";

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

export async function guardarSuscripcion(uid: string, s: Suscripcion) {
  if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) throw new Error("Suscripción inválida");
  await getPool().query(
    `insert into push_suscripciones (endpoint, uid, datos) values ($1, $2, $3::jsonb)
     on conflict (endpoint) do update set uid = excluded.uid, datos = excluded.datos`,
    [s.endpoint, uid, JSON.stringify({ endpoint: s.endpoint, keys: s.keys })]
  );
}

export async function borrarSuscripciones(uid: string, endpoint?: string) {
  if (endpoint) await getPool().query("delete from push_suscripciones where uid = $1 and endpoint = $2", [uid, endpoint]);
  else await getPool().query("delete from push_suscripciones where uid = $1", [uid]);
}

/** Manda el aviso a todos los dispositivos del usuario. Borra las suscripciones que ya no existen. */
export async function enviarPush(uid: string, aviso: { title: string; body: string; url: string; tag?: string }): Promise<number> {
  if (!configurar()) return 0;
  const r = await getPool().query("select endpoint, datos from push_suscripciones where uid = $1", [uid]);
  let enviados = 0;
  await Promise.all(
    r.rows.map(async (row: { endpoint: string; datos: Suscripcion }) => {
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
