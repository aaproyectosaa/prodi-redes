// "Mi tiempo": cuánto trabaja el admin por día y en qué. Solo se mide a sí mismo (nadie más del equipo).
// Cada minuto con actividad queda anotado con de dónde vino (la app o Claude Code) y en qué estaba.
// Claude Code avisa con un hook (ver la página Mi tiempo) que manda un token personal, no la sesión.

import crypto from "crypto";
import { getPool } from "./db";
import { HttpError } from "./http";

const ZONA = "America/Argentina/Buenos_Aires";
/** Un hueco de hasta estos minutos entre dos señales cuenta como trabajado (leer, pensar, esperar a Claude). */
const HUECO = 5;

let tabla: Promise<unknown> | null = null;
function asegurarTablas() {
  tabla ??= getPool()
    .query(
      `create table if not exists mi_tiempo (uid text not null, minuto timestamptz not null, fuente text not null, que text, proyecto text,
         primary key (uid, minuto, fuente));
       create table if not exists mi_tiempo_token (hash text primary key, uid text not null, creado timestamptz not null default now());`
    )
    .catch((e) => {
      tabla = null;
      throw e;
    });
  return tabla;
}

export type Fuente = "app" | "claude";

/** Anota el minuto actual (uno por minuto y fuente; si ya estaba, actualiza en qué). */
export async function anotarMinuto(uid: string, fuente: Fuente, que: string | null, proyecto: string | null) {
  await asegurarTablas();
  await getPool().query(
    `insert into mi_tiempo (uid, minuto, fuente, que, proyecto) values ($1, date_trunc('minute', now()), $2, $3, $4)
     on conflict (uid, minuto, fuente) do update set que = coalesce(excluded.que, mi_tiempo.que), proyecto = coalesce(excluded.proyecto, mi_tiempo.proyecto)`,
    [uid, fuente, que?.slice(0, 140) || null, proyecto?.slice(0, 80) || null]
  );
}

/**
 * Minutos de antes (ej. lo que se trabajó con Claude Code antes de conectarlo, sacado de sus registros):
 * solo de los últimos 14 días y nunca del futuro. Si el minuto ya estaba, no se pisa.
 */
export async function anotarMinutosPasados(uid: string, fuente: Fuente, minutos: { at?: string; que?: string; proyecto?: string }[]): Promise<number> {
  await asegurarTablas();
  const desde = Date.now() - 14 * 86_400_000;
  const validos = minutos
    .map((m) => ({ t: Date.parse(String(m.at ?? "")), que: String(m.que ?? "").trim().slice(0, 140) || null, proyecto: String(m.proyecto ?? "").trim().slice(0, 80) || null }))
    .filter((m) => Number.isFinite(m.t) && m.t >= desde && m.t <= Date.now() + 60_000)
    .slice(0, 3000);
  let n = 0;
  for (const m of validos) {
    const r = await getPool().query(
      `insert into mi_tiempo (uid, minuto, fuente, que, proyecto) values ($1, date_trunc('minute', $2::timestamptz), $3, $4, $5) on conflict do nothing`,
      [uid, new Date(m.t).toISOString(), fuente, m.que, m.proyecto]
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/** Token nuevo para Claude Code (borra los anteriores). Se muestra una sola vez. */
export async function nuevoToken(uid: string): Promise<string> {
  await asegurarTablas();
  const token = `pt_${crypto.randomBytes(24).toString("base64url")}`;
  await getPool().query("delete from mi_tiempo_token where uid = $1", [uid]);
  await getPool().query("insert into mi_tiempo_token (hash, uid) values ($1, $2)", [hash(token), uid]);
  return token;
}

/** De quién es el token (o 401). */
export async function uidDelToken(token: string | undefined): Promise<string> {
  if (!token || !/^pt_[A-Za-z0-9_-]{20,}$/.test(token)) throw new HttpError(401, "Token inválido");
  await asegurarTablas();
  const r = await getPool().query("select uid from mi_tiempo_token where hash = $1", [hash(token)]);
  if (!r.rows[0]) throw new HttpError(401, "Token inválido");
  return String(r.rows[0].uid);
}

export async function tieneToken(uid: string): Promise<boolean> {
  await asegurarTablas();
  const r = await getPool().query("select 1 from mi_tiempo_token where uid = $1", [uid]);
  return !!r.rows[0];
}

export interface DiaTiempo {
  fecha: string;
  /** Minutos trabajados (app y Claude Code juntos, sin contar dos veces el mismo minuto). */
  total: number;
  app: number;
  claude: number;
  desde: string | null;
  hasta: string | null;
  /** En qué, de más a menos minutos. */
  en: { fuente: Fuente; que: string; minutos: number }[];
}

/** Los últimos `dias` días, del más nuevo al más viejo. */
export async function resumenTiempo(uid: string, dias: number): Promise<DiaTiempo[]> {
  await asegurarTablas();
  const r = await getPool().query(
    `select (minuto at time zone '${ZONA}') as local, fuente, que, proyecto
       from mi_tiempo where uid = $1 and minuto >= now() - make_interval(days => $2)
      order by minuto`,
    [uid, dias]
  );
  // Por día: los minutos con señal y los huecos cortos entre señales cuentan como trabajados.
  const porDia = new Map<string, { minutos: Map<Fuente, Map<number, string>> }>();
  for (const f of r.rows as { local: Date; fuente: Fuente; que: string | null; proyecto: string | null }[]) {
    const d = new Date(f.local);
    const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const min = d.getHours() * 60 + d.getMinutes();
    const dia = porDia.get(fecha) ?? { minutos: new Map() };
    porDia.set(fecha, dia);
    const m = dia.minutos.get(f.fuente) ?? new Map<number, string>();
    dia.minutos.set(f.fuente, m);
    const que = f.fuente === "claude" ? [f.proyecto, f.que].filter(Boolean).join(" · ") || "Claude Code" : f.que || "La app";
    m.set(min, que);
  }
  const salida: DiaTiempo[] = [];
  for (const [fecha, dia] of porDia) {
    const todos = new Set<number>();
    const cuenta: Record<Fuente, number> = { app: 0, claude: 0 };
    const en = new Map<string, { fuente: Fuente; que: string; minutos: number }>();
    for (const [fuente, mins] of dia.minutos) {
      const lista = [...mins.keys()].sort((a, b) => a - b);
      lista.forEach((min, i) => {
        const que = mins.get(min)!;
        // El minuto y el hueco hasta la próxima señal (si es corto), anotados a lo que se estaba haciendo.
        const sig = lista[i + 1];
        const hasta = sig !== undefined && sig - min <= HUECO ? sig : min + 1;
        for (let x = min; x < hasta; x++) {
          todos.add(x);
          cuenta[fuente]++;
          const k = `${fuente}|${que}`;
          const e = en.get(k) ?? { fuente, que, minutos: 0 };
          e.minutos++;
          en.set(k, e);
        }
      });
    }
    const orden = [...todos].sort((a, b) => a - b);
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    salida.push({
      fecha,
      total: todos.size,
      app: cuenta.app,
      claude: cuenta.claude,
      desde: orden.length ? hhmm(orden[0]) : null,
      hasta: orden.length ? hhmm(orden[orden.length - 1] + 1) : null,
      en: [...en.values()].sort((a, b) => b.minutos - a.minutos).slice(0, 12),
    });
  }
  return salida.sort((a, b) => b.fecha.localeCompare(a.fecha));
}
