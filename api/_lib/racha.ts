// Racha de respuestas: cuánto tarda Prodi en contestarle a sus clientes en los chats.
//
// Es un indicador de calidad del servicio al cliente, no de las personas: no mide horas ni horarios de nadie
// (el equipo brinda un servicio, no son empleados), no resta ni descuenta y no afecta lo que cobra cada uno.
// El "horario de atención a clientes de Prodi" (lun a vie 9 a 20, sáb 9 a 12) solo sirve para no contar el
// tiempo que pasa fuera de ese horario: lo que un cliente escribe a las 23 cuenta desde las 9 del día siguiente.
//
// - Caso: un cliente escribe (uno o varios mensajes seguidos) hasta que alguien del equipo contesta.
// - A tiempo: contestado dentro de 1 hora de atención.
// - Día cumplido: todos los casos de ese día a tiempo. Racha: días de atención seguidos cumplidos
//   (el domingo y los días sin mensajes de clientes no suman ni cortan). 1 comodín por semana.
// - Le toca a quien lleva la cuenta (la productora del cliente); si contesta otro a tiempo, les suma a los dos.

import { getPool } from "./db";

const HORA_AR = -3; // Argentina, sin horario de verano
const LIMITE_MIN = 60;
const DIAS = 90;
const EQUIPO = ["admin", "productor", "editor", "pauta", "diseno", "administracion"];

/** Horario de atención (hora de Argentina) para cada día de la semana: 0 = domingo. */
const ATENCION: Record<number, [number, number] | null> = { 0: null, 1: [9, 20], 2: [9, 20], 3: [9, 20], 4: [9, 20], 5: [9, 20], 6: [9, 12] };

const local = (ms: number) => new Date(ms + HORA_AR * 3600_000);
const fechaLocal = (ms: number) => local(ms).toISOString().slice(0, 10);
/** Apertura y cierre (en ms reales) del día local que contiene `ms`, o null si ese día no hay atención. */
function ventana(ms: number): [number, number] | null {
  const d = local(ms);
  const h = ATENCION[d.getUTCDay()];
  if (!h) return null;
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - HORA_AR * 3600_000;
  return [base + h[0] * 3600_000, base + h[1] * 3600_000];
}
const inicioDiaSiguiente = (ms: number) => {
  const d = local(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - HORA_AR * 3600_000;
};

/** El primer momento de atención desde `ms` (si ya está abierto, el mismo). */
function primerMomento(ms: number): number {
  let t = ms;
  for (let i = 0; i < 10; i++) {
    const v = ventana(t);
    if (v && t < v[1]) return Math.max(t, v[0]);
    t = inicioDiaSiguiente(t);
  }
  return t;
}

/** `ms` + tantos minutos de atención. */
function sumarAtencion(ms: number, minutos: number): number {
  let t = primerMomento(ms);
  let falta = minutos * 60_000;
  for (let i = 0; i < 20; i++) {
    const v = ventana(t)!;
    if (t + falta <= v[1]) return t + falta;
    falta -= v[1] - t;
    t = primerMomento(inicioDiaSiguiente(t));
  }
  return t;
}

/** Minutos de atención entre dos momentos (para el promedio). */
function minutosAtencion(desde: number, hasta: number): number {
  if (hasta <= desde) return 0;
  let total = 0;
  let t = desde;
  for (let i = 0; i < 40 && t < hasta; i++) {
    const v = ventana(t);
    if (v) total += Math.max(0, Math.min(hasta, v[1]) - Math.max(t, v[0]));
    t = inicioDiaSiguiente(t);
  }
  return Math.round(total / 60_000);
}

/** Un "ok", un pulgar o un emoji solo no cuentan como respuesta. */
function esRespuesta(texto: string, conAdjunto: boolean): boolean {
  if (conAdjunto) return true;
  const letras = texto.replace(/[^\p{L}\p{N}]/gu, "");
  return letras.length >= 2 && !/^(ok|oki|okey|okis)$/i.test(letras);
}

/** Lunes de la semana (local) de una fecha YYYY-MM-DD: para el comodín semanal. */
function semanaDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

type Dia = { ok: number; falla: number };
interface Acum {
  dias: Map<string, Dia>;
  tiempos: number[];
  casos30: number;
  aTiempo30: number;
}

export interface RachaPersona {
  uid: string;
  nombre: string;
  racha: number;
  mejor: number;
  /** Promedio de minutos de atención que tardó en contestar (últimos 30 días). */
  promedio: number | null;
  /** % de casos a tiempo (últimos 30 días). */
  aTiempo: number | null;
  casos: number;
  /** Los últimos 6 días de atención: "ok", "falla" o "sin" (sin mensajes de clientes). */
  ultimos: { fecha: string; estado: "ok" | "falla" | "sin" }[];
  comodinUsado: boolean;
}

function calcular(uid: string, nombre: string, a: Acum, hoyMs: number): RachaPersona {
  // Días de atención (lun a sáb) del más nuevo al más viejo.
  const fechas: string[] = [];
  for (let i = 0; i < DIAS; i++) {
    const ms = hoyMs - i * 86_400_000;
    if (ventana(ms)) fechas.push(fechaLocal(ms));
  }
  // Racha actual, hacia atrás.
  let racha = 0;
  const usados = new Set<string>();
  for (const f of fechas) {
    const d = a.dias.get(f);
    if (!d) continue;
    if (!d.falla) racha++;
    else if (!usados.has(semanaDe(f))) usados.add(semanaDe(f));
    else break;
  }
  // Mejor racha del período, hacia adelante con la misma regla.
  let mejor = 0;
  let corriendo = 0;
  const usados2 = new Set<string>();
  for (const f of [...fechas].reverse()) {
    const d = a.dias.get(f);
    if (!d) continue;
    if (!d.falla) corriendo++;
    else if (!usados2.has(semanaDe(f))) usados2.add(semanaDe(f));
    else corriendo = 0;
    mejor = Math.max(mejor, corriendo);
  }
  const ultimos = fechas.slice(0, 6).reverse().map((f) => {
    const d = a.dias.get(f);
    return { fecha: f, estado: (!d ? "sin" : d.falla ? "falla" : "ok") as "ok" | "falla" | "sin" };
  });
  return {
    uid,
    nombre,
    racha,
    mejor: Math.max(mejor, racha),
    promedio: a.tiempos.length ? Math.round(a.tiempos.reduce((x, y) => x + y, 0) / a.tiempos.length) : null,
    aTiempo: a.casos30 ? Math.round((a.aTiempo30 / a.casos30) * 100) : null,
    casos: a.casos30,
    ultimos,
    comodinUsado: usados.has(semanaDe(fechaLocal(hoyMs))),
  };
}

export interface RachaCliente {
  id: string;
  nombre: string;
  promedio: number | null;
  aTiempo: number | null;
  casos: number;
}

/** Racha de cada persona del equipo y cómo se le contesta a cada cliente (últimos 90 días de chats). */
export async function rachasDeRespuesta(): Promise<{ personas: RachaPersona[]; clientes: RachaCliente[] }> {
  const pool = getPool();
  const ahora = Date.now();
  const desde = new Date(ahora - DIAS * 86_400_000).toISOString();
  const hace30 = ahora - 30 * 86_400_000;

  const [perfiles, proyectos, mensajes] = await Promise.all([
    pool.query("select id, data->>'role' as role, data->'roles_extra' as extra, data->>'nombre' as nombre, data->>'activo' as activo from documentos where coleccion = 'profiles'"),
    pool.query("select id, data->>'nombre' as nombre, data->'team_roles'->'productor' as productor, data->>'cuenta_propia' as propia, data->>'enabled' as enabled from documentos where coleccion = 'projects'"),
    pool.query(
      `select coleccion, data->>'by' as by, data->>'at' as at, data->>'tipo' as tipo, left(coalesce(data->>'texto', ''), 60) as texto,
              (data ? 'audio' and data->'audio' <> 'null'::jsonb) or (data ? 'archivo' and data->'archivo' <> 'null'::jsonb) as adjunto
         from documentos
        where coleccion like 'chats/cliente\\_%/mensajes' and data->>'at' >= $1
        order by coleccion, data->>'at'`,
      [desde]
    ),
  ]);

  const rol = new Map<string, string>();
  const nombres = new Map<string, string>();
  const activos = new Set<string>();
  for (const p of perfiles.rows as { id: string; role: string | null; extra: unknown; nombre: string | null; activo: string | null }[]) {
    rol.set(p.id, p.role ?? "");
    nombres.set(p.id, p.nombre ?? "");
    if (p.activo !== "false") activos.add(p.id);
  }
  const esEquipo = (id: string) => EQUIPO.includes(rol.get(id) ?? "");
  const esCliente = (id: string) => rol.get(id) === "cliente" || rol.get(id) === "contacto";

  const dueno = new Map<string, string | null>();
  const nombreCliente = new Map<string, string>();
  for (const p of proyectos.rows as { id: string; nombre: string | null; productor: unknown; propia: string | null; enabled: string | null }[]) {
    if (p.propia === "true" || p.enabled === "false") continue;
    const ids = Array.isArray(p.productor) ? (p.productor as string[]) : [];
    dueno.set(p.id, ids.find((id) => activos.has(id)) ?? null);
    nombreCliente.set(p.id, p.nombre ?? "");
  }

  const acum = new Map<string, Acum>();
  const de = (uid: string) => {
    let a = acum.get(uid);
    if (!a) acum.set(uid, (a = { dias: new Map(), tiempos: [], casos30: 0, aTiempo30: 0 }));
    return a;
  };
  const porCliente = new Map<string, { tiempos: number[]; casos: number; aTiempo: number }>();

  const anotar = (pid: string, inicio: number, resp: number | null, by: string | null) => {
    const limite = sumarAtencion(inicio, LIMITE_MIN);
    if (resp == null && ahora < limite) return; // todavía está a tiempo
    const aTiempo = resp != null && resp <= limite;
    const fecha = fechaLocal(primerMomento(inicio));
    const owner = dueno.get(pid) ?? null;
    // A quién le cuenta: a quien lleva la cuenta (siempre) y a quien contestó a tiempo.
    const quienes = new Set<string>();
    if (owner) quienes.add(owner);
    if (aTiempo && by && esEquipo(by)) quienes.add(by);
    for (const uid of quienes) {
      const a = de(uid);
      const d = a.dias.get(fecha) ?? { ok: 0, falla: 0 };
      if (aTiempo) d.ok++;
      else d.falla++;
      a.dias.set(fecha, d);
      if (inicio >= hace30) {
        a.casos30++;
        if (aTiempo) a.aTiempo30++;
      }
    }
    const minutos = resp != null ? minutosAtencion(primerMomento(inicio), resp) : null;
    if (by && minutos != null && inicio >= hace30 && esEquipo(by)) de(by).tiempos.push(minutos);
    if (inicio >= hace30) {
      const c = porCliente.get(pid) ?? { tiempos: [], casos: 0, aTiempo: 0 };
      c.casos++;
      if (aTiempo) c.aTiempo++;
      if (minutos != null) c.tiempos.push(minutos);
      porCliente.set(pid, c);
    }
  };

  // Recorre cada chat de cliente en orden: un caso va del primer mensaje del cliente a la respuesta del equipo.
  let chatActual = "";
  let pid = "";
  let pendiente: number | null = null;
  const cerrarChat = () => {
    if (pendiente != null && dueno.has(pid)) anotar(pid, pendiente, null, null);
    pendiente = null;
  };
  for (const m of mensajes.rows as { coleccion: string; by: string | null; at: string | null; tipo: string | null; texto: string; adjunto: boolean | null }[]) {
    if (m.coleccion !== chatActual) {
      cerrarChat();
      chatActual = m.coleccion;
      pid = m.coleccion.slice("chats/cliente_".length, -"/mensajes".length);
    }
    if (!dueno.has(pid) || !m.by || !m.at || m.tipo === "sistema" || m.by === "prodi") continue;
    const at = new Date(m.at).getTime();
    if (esCliente(m.by)) {
      if (pendiente == null) pendiente = at;
    } else if (esEquipo(m.by) && pendiente != null && esRespuesta(m.texto, !!m.adjunto)) {
      anotar(pid, pendiente, at, m.by);
      pendiente = null;
    }
  }
  cerrarChat();

  const personas = [...acum.entries()]
    .filter(([uid]) => esEquipo(uid) && activos.has(uid))
    .map(([uid, a]) => calcular(uid, nombres.get(uid) ?? "", a, ahora))
    .sort((x, y) => y.racha - x.racha || (x.promedio ?? 1e9) - (y.promedio ?? 1e9));
  const clientes = [...porCliente.entries()]
    .map(([id, c]) => ({
      id,
      nombre: nombreCliente.get(id) ?? "",
      promedio: c.tiempos.length ? Math.round(c.tiempos.reduce((x, y) => x + y, 0) / c.tiempos.length) : null,
      aTiempo: c.casos ? Math.round((c.aTiempo / c.casos) * 100) : null,
      casos: c.casos,
    }))
    .sort((x, y) => (x.aTiempo ?? 101) - (y.aTiempo ?? 101));
  return { personas, clientes };
}

/** Lo de una persona (vacío si todavía no tuvo casos). */
export function rachaVacia(uid: string, nombre: string): RachaPersona {
  return calcular(uid, nombre, { dias: new Map(), tiempos: [], casos30: 0, aTiempo30: 0 }, Date.now());
}
