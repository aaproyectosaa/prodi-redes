// Avisos push estándar (Web Push con claves VAPID): funcionan en Android, compu y en iPhone
// con la app instalada. Las suscripciones de cada navegador están en `push_suscripciones`.

//
// Dos apps: Prodi (el sistema) y Prodi Chat (en su dirección o en /chat-app). Cada suscripción sabe de qué app es
// (`datos.app`): los avisos del chat van solo a Prodi Chat y el resto solo a Prodi, para que no lleguen dos veces.
// Si la persona no tiene la app de ese tipo, le llegan igual a la otra (nunca se quedan sin aviso).

import webpush from "web-push";
import { getPool } from "./db";
import { esHorarioDescanso, leerDescanso, ROLES_CON_DESCANSO } from "./descanso";

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
export async function enviarPush(
  uid: string,
  aviso: { title: string; body: string; url: string; tag?: string },
  canal: AppPush = "sistema",
  opciones: { forzar?: boolean } = {}
): Promise<number> {
  if (!configurar()) return 0;
  // Horario de descanso del equipo: no suena; queda para el resumen de la mañana (el aviso igual está en Avisos).
  if (!opciones.forzar && (await descansando(uid))) {
    await retener(uid, aviso.title).catch((err) => console.warn("[push] no se pudo guardar para la mañana", err));
    return 0;
  }
  const r = await getPool().query("select endpoint, datos from push_suscripciones where uid = $1", [uid]);
  const todas = r.rows as { endpoint: string; datos: Suscripcion & { app?: AppPush } }[];
  // Las suscripciones viejas (sin app) son del sistema.
  const delCanal = todas.filter((row) => (row.datos.app === "chat" ? "chat" : "sistema") === canal);
  // Si no tiene la app de ese canal (ej. no instaló Prodi Chat, o un contacto que solo usa Prodi Chat), a todas.
  const filas = delCanal.length ? delCanal : todas;
  let enviados = 0;
  await Promise.all(
    filas.map(async (row) => {
      try {
        // En Prodi Chat dentro del mismo sitio, el aviso del chat abre /chat-app (si no, se abría el sistema).
        const enChatApp = row.datos.app === "chat" && !chatUrl();
        const url = enChatApp ? aviso.url.replace(/^(https?:\/\/[^/]+)?\/chat(?=[?#/]|$)/,(_m, o: string | undefined) => `${o ?? ""}/chat-app`) : aviso.url;
        await webpush.sendNotification(row.datos, JSON.stringify({ ...aviso, url }), { TTL: 24 * 3600 });
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

// ---------------------------------------------------------------------------
// Horario de descanso (ver descanso.ts)
// ---------------------------------------------------------------------------

let cacheDescanso: { d: ReturnType<typeof leerDescanso>; hasta: number } | null = null;
const cacheRoles = new Map<string, { roles: string[]; hasta: number }>();

async function configDescanso() {
  if (cacheDescanso && cacheDescanso.hasta > Date.now()) return cacheDescanso.d;
  const r = await getPool().query("select data from documentos where coleccion = 'app_settings' and id = 'redes'");
  const d = leerDescanso(r.rows[0]?.data);
  cacheDescanso = { d, hasta: Date.now() + 5 * 60_000 };
  return d;
}

async function rolesDe(uid: string): Promise<string[]> {
  const c = cacheRoles.get(uid);
  if (c && c.hasta > Date.now()) return c.roles;
  const r = await getPool().query("select data->>'role' as role, data->'roles_extra' as extra from documentos where coleccion = 'profiles' and id = $1", [uid]);
  const fila = r.rows[0] as { role: string | null; extra: unknown } | undefined;
  const roles = [fila?.role ?? "", ...(Array.isArray(fila?.extra) ? (fila!.extra as string[]) : [])];
  if (cacheRoles.size > 500) cacheRoles.clear();
  cacheRoles.set(uid, { roles, hasta: Date.now() + 5 * 60_000 });
  return roles;
}

/** ¿A esta persona hay que dejarla descansar ahora? (equipo, en su horario de descanso; nunca el super admin). */
export async function descansando(uid: string): Promise<boolean> {
  try {
    const d = await configDescanso();
    if (!esHorarioDescanso(d)) return false;
    const roles = await rolesDe(uid);
    if (roles.includes("admin") || roles.includes("cliente") || roles.includes("contacto")) return false;
    return roles.some((r) => ROLES_CON_DESCANSO.includes(r));
  } catch {
    return false;
  }
}

let tablaRetenidos: Promise<unknown> | null = null;
function asegurarRetenidos() {
  tablaRetenidos ??= getPool()
    .query("create table if not exists push_retenidos (uid text primary key, n int not null default 0, ultimo text not null default '', desde timestamptz not null default now())")
    .catch((err) => {
      tablaRetenidos = null;
      throw err;
    });
  return tablaRetenidos;
}

async function retener(uid: string, titulo: string) {
  await asegurarRetenidos();
  await getPool().query(
    "insert into push_retenidos (uid, n, ultimo) values ($1, 1, $2) on conflict (uid) do update set n = push_retenidos.n + 1, ultimo = $2",
    [uid, String(titulo ?? "").slice(0, 120)]
  );
}

/** A la mañana (cron diario de las 8): un solo aviso con lo que llegó mientras descansaban. */
export async function enviarRetenidos(baseUrl: string): Promise<number> {
  await asegurarRetenidos();
  const d = await configDescanso();
  // Domingo (o si el cron corre todavía en horario de descanso): se guarda para el próximo día hábil.
  if (esHorarioDescanso(d)) return 0;
  const r = await getPool().query("delete from push_retenidos returning uid, n, ultimo");
  let enviados = 0;
  for (const fila of r.rows as { uid: string; n: number; ultimo: string }[]) {
    const cuerpo = fila.n === 1 ? fila.ultimo : `${fila.n} avisos nuevos. El último: ${fila.ultimo}`;
    enviados += await enviarPush(
      fila.uid,
      { title: "Buen día ☀️ Mientras descansabas…", body: cuerpo, url: `${baseUrl}/notificaciones`, tag: "resumen-manana" },
      "sistema",
      { forzar: true }
    );
  }
  return enviados;
}
