// Datos para la app (reemplaza al acceso directo a Firestore desde el navegador).
//
// POST /api/db/consultar { consultas: [ { ruta } | { coleccion, filtros, orden, limite } ] }
// POST /api/db/escribir  { ops: [ { tipo: "set"|"update"|"create"|"delete", ruta, data?, merge? } ] }  (todo o nada)
// POST /api/db/cambios   { desde, escribiendo? }  → qué colecciones cambiaron desde la última vez (para refrescar en vivo)
//                                                  y, con el chat abierto, quién está escribiendo
// POST /api/db/escribiendo { chatId, estado: "escribiendo" | "grabando" | null }
// POST /api/db/voz         { chatId, accion: "entrar" | "latido" | "salir" }  (chat de voz de los grupos)
// POST /api/db/senal       { chatId, para, tipo: "oferta" | "respuesta" | "chau", data }  (para conectar la llamada)
// POST /api/db/senales     {}  → las señales que me mandaron (se entregan una vez)
// POST /api/db/sin-leer    {}  → cuántos mensajes sin leer tiene cada chat mío { conteos: { chatId: n } }
//
// Cada documento pasa por las reglas de acceso de api/_lib/reglas.ts.

import { createHmac } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { aplicarEscritura, ejecutarConsulta, enTransaccion, getPool, leerDoc, partirRuta, type Consulta, type OpEscritura } from "../_lib/db";
import { claveProhibida } from "../_lib/docs";
import { contexto, paraLaApp, partirColeccion, puedeEscribir, puedeLeer } from "../_lib/reglas";
import { appUrl, body, HttpError, olvidarPerfil, requireCaller, sendError } from "../_lib/http";
import { sincronizarCalendario } from "../_lib/calendario";
import { publicarEnChat } from "../_lib/chat-server";
import { waitUntil } from "@vercel/functions";
import { armarMinutaDeLlamada } from "../_lib/minuta-llamada";
import { recordatoriosRevisionInterna } from "../_lib/diario";
import type { Data } from "../_lib/db";

/** Colecciones con fecha que van a Google Calendar (se ponen al día después de guardar). */
const CON_CALENDARIO = new Set(["reuniones", "tareas"]);

// La minuta de una llamada se arma después de responder (IA + PDF + Drive): hasta 60 s.
export const config = { maxDuration: 60 };

const MAX_CONSULTAS = 40;
const MAX_OPS = 450;

interface PedidoConsulta {
  ruta?: string;
  coleccion?: string;
  filtros?: { campo: string; op: string; valor: unknown }[];
  orden?: { campo: string; dir: "asc" | "desc" }[];
  limite?: number | null;
  /** Marca de la última vez: devuelve solo lo cambiado (ver consultar). */
  desde?: number | null;
}

const COLECCION_OK = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)?$/;
const ID_OK = /^[^/\s]{1,200}$/;

/** Rechaza claves como "__proto__" en cualquier nivel (también dentro de rutas "a.b.c"). */
function validarClaves(v: unknown, prof = 0): void {
  if (prof > 50) throw new HttpError(400, "Datos demasiado anidados");
  if (Array.isArray(v)) return v.forEach((x) => validarClaves(x, prof + 1));
  if (!v || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v)) {
    if (k.split(".").some(claveProhibida)) throw new HttpError(400, "Clave no permitida");
    validarClaves(x, prof + 1);
  }
}

function validarColeccion(col: unknown): string {
  if (typeof col !== "string" || !COLECCION_OK.test(col)) throw new HttpError(400, "Colección inválida");
  return col;
}

async function consultar(req: VercelRequest) {
  const caller = await requireCaller(req);
  const { consultas } = body<{ consultas?: PedidoConsulta[] }>(req);
  if (!Array.isArray(consultas) || consultas.length > MAX_CONSULTAS) throw new HttpError(400, "Consultas inválidas");
  const pool = getPool();
  const ctx = await contexto(pool, caller.uid, caller.role, caller.roles);
  // Marca de este momento, tomada antes de consultar: lo que cambie mientras tanto se vuelve a mandar la próxima vez.
  // Con 3 s de margen (lo que se estaba guardando): lo más nuevo se manda dos veces antes que perderlo.
  const marca = Number((await pool.query("select coalesce(max(rev), 0)::bigint as rev from documentos where actualizado < now() - interval '3 seconds'")).rows[0].rev);
  const resultados = await Promise.all(
    consultas.map(async (q) => {
      try {
        if (q.ruta) {
          const { coleccion, id } = partirRuta(q.ruta);
          validarColeccion(coleccion);
          const data = await leerDoc(pool, coleccion, id);
          if (!(await puedeLeer(ctx, coleccion, id, data))) return { error: "permission-denied" };
          return { doc: data ? { id, data: paraLaApp(data) } : null };
        }
        const coleccion = validarColeccion(q.coleccion);
        // Con `desde` (la marca de la última vez) y sin límite: solo lo que cambió. La pantalla ya tiene el
        // resto guardado; así no se vuelve a bajar la colección entera por cada cambio (tráfico de la base).
        const desde = !q.limite && typeof q.desde === "number" && Number.isFinite(q.desde) && q.desde > 0 ? Math.floor(q.desde) : null;
        const c: Consulta = {
          coleccion,
          filtros: (q.filtros ?? []).map((f) => ({ campo: String(f.campo), op: f.op as Consulta["filtros"][number]["op"], valor: f.valor })),
          orden: (q.orden ?? []).map((o) => ({ campo: String(o.campo), dir: o.dir === "desc" ? "desc" : "asc" })),
          limite: q.limite ?? null,
          desdeRev: desde,
        };
        const filas = await ejecutarConsulta(pool, c);
        const visibles = [];
        for (const f of filas) if (await puedeLeer(ctx, coleccion, f.id, f.data)) visibles.push({ id: f.id, data: paraLaApp(f.data) });
        if (desde === null) return { docs: visibles, rev: marca };
        // Los que cambiaron pero ya no entran (otro filtro, sin permiso) y los borrados: la pantalla los saca.
        const [cambiados, borrados] = await Promise.all([
          pool.query("select id from documentos where coleccion = $1 and rev > $2", [coleccion, desde]),
          pool.query("select id from borrados where coleccion = $1 and rev > $2", [coleccion, desde]),
        ]);
        const quedan = new Set(visibles.map((v) => v.id));
        // Un usuario pendiente (sin rol todavía) no recibe ids de nada que no pueda ver.
        const conRol = caller.role !== "pending" && !!caller.role;
        const quitar = conRol ? [...cambiados.rows, ...borrados.rows].map((x: { id: string }) => x.id).filter((id) => !quedan.has(id)) : [];
        return { docs: visibles, quitar, parcial: true, rev: marca };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Error" };
      }
    })
  );
  return { resultados };
}

interface PedidoOp {
  tipo: OpEscritura["tipo"];
  ruta: string;
  data?: Record<string, unknown>;
  merge?: boolean;
}

async function escribir(req: VercelRequest) {
  const caller = await requireCaller(req);
  const { ops } = body<{ ops?: PedidoOp[] }>(req);
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) throw new HttpError(400, "Escrituras inválidas");
  const calendario = new Map<string, { coleccion: "reuniones" | "tareas"; id: string; antes: Data | null }>();
  await enTransaccion(async (cli) => {
    const ctx = await contexto(cli, caller.uid, caller.role, caller.roles);
    for (const o of ops) {
      if (!["set", "update", "create", "delete"].includes(o.tipo)) throw new HttpError(400, "Escritura inválida");
      const { coleccion, id } = partirRuta(String(o.ruta));
      validarColeccion(coleccion);
      if (!ID_OK.test(id)) throw new HttpError(400, "Id inválido");
      const data = o.tipo === "delete" ? {} : o.data;
      if (o.tipo !== "delete" && (!data || typeof data !== "object" || Array.isArray(data))) throw new HttpError(400, "Datos inválidos");
      validarClaves(data);
      const op = { tipo: o.tipo, coleccion, id, data: data ?? {}, merge: !!o.merge } as OpEscritura;
      await aplicarEscritura(cli, op, async (antes, despues) => {
        if (!(await puedeEscribir(ctx, coleccion, id, antes, despues))) {
          throw new HttpError(403, `No tenés permiso para ${despues ? (antes ? "modificar" : "crear") : "borrar"} esto (${partirColeccion(coleccion).base})`);
        }
        if (coleccion === "profiles") olvidarPerfil(id);
        const clave = `${coleccion}/${id}`;
        if (CON_CALENDARIO.has(coleccion) && !calendario.has(clave)) calendario.set(clave, { coleccion: coleccion as "reuniones" | "tareas", id, antes });
      });
    }
  });
  // Google Calendar: después de guardar (si falla, solo queda en el log; si no cambió nada que importe, no llama a Google).
  if (calendario.size) {
    const base = appUrl(req);
    await Promise.all([...calendario.values()].slice(0, 10).map((x) => sincronizarCalendario(x.coleccion, x.id, base, x.antes)));
  }
  return { ok: true };
}

// Varias pestañas preguntan lo mismo casi al mismo tiempo: la respuesta para una misma marca se reusa 2 s
// en esta instancia (no dice nada privado: solo qué colecciones cambiaron).
const CAMBIOS_TTL = 2_000;
const respuestas = new Map<string, { r: Promise<{ rev: number; colecciones: string[] }>; hasta: number }>();

/** Qué colecciones cambiaron. `rev` es la marca para la próxima vez (con margen por si algo se estaba guardando). */
async function cambios(req: VercelRequest) {
  const quien = await requireCaller(req);
  // Sin rol todavía: no hay nada en vivo que mirar.
  if (quien.role === "pending" || !quien.role) return { rev: 0, colecciones: [] as string[] };
  const { desde, escribiendo: conEscribiendo } = body<{ desde?: number | null; escribiendo?: boolean }>(req);
  const clave = desde == null || !Number.isFinite(Number(desde)) ? "inicio" : String(Number(desde));
  // Con el chat abierto, también quién está escribiendo (es de cada persona: no va en la respuesta compartida).
  waitUntil(cerrarLlamadasTerminadas().catch(() => undefined));
  // Videos en revisión interna sin aprobar: avisos seguidos a producción (a lo sumo una revisión cada 10 min).
  if (Date.now() - ultimaRevisionInterna > 10 * 60_000) {
    ultimaRevisionInterna = Date.now();
    waitUntil(recordatoriosRevisionInterna(appUrl()).catch((e) => console.warn("[revision interna]", e)));
  }
  const escriben = conEscribiendo ? quienesEscriben(quien.uid).catch(() => []) : null;
  const enVoz = conEscribiendo ? quienesEnVoz(quien.uid).catch(() => []) : null;
  const c = respuestas.get(clave);
  let r: Promise<{ rev: number; colecciones: string[] }>;
  if (c && c.hasta > Date.now()) r = c.r;
  else {
    if (respuestas.size > 200) respuestas.clear();
    r = calcularCambios(clave === "inicio" ? null : Number(desde));
    respuestas.set(clave, { r, hasta: Date.now() + CAMBIOS_TTL });
    r.catch(() => respuestas.delete(clave));
  }
  return escriben ? { ...(await r), escribiendo: await escriben, voz: await enVoz } : r;
}

async function calcularCambios(desde: number | null) {
  const pool = getPool();
  if (desde == null) {
    const r = await pool.query(
      "select greatest((select coalesce(max(rev), 0) from documentos where actualizado < now() - interval '3 seconds'), (select coalesce(max(rev), 0) from borrados where borrado < now() - interval '3 seconds'))::bigint as rev"
    );
    return { rev: Number(r.rows[0].rev), colecciones: [] as string[] };
  }
  const r = await pool.query(
    `with c as (
       select coleccion, rev, actualizado as t from documentos where rev > $1
       union all
       select coleccion, rev, borrado as t from borrados where rev > $1
     )
     select coleccion, max(rev) as rev, bool_and(t < now() - interval '3 seconds') as viejo from c group by coleccion`,
    [Number(desde)]
  );
  // La marca avanza solo hasta lo que ya está seguro (más de 3 s): lo reciente se vuelve a avisar una vez.
  let rev = Number(desde);
  const cols = new Set<string>();
  for (const row of r.rows as { coleccion: string; rev: string; viejo: boolean }[]) {
    const p = partirColeccion(row.coleccion);
    cols.add(p.sub ? `${p.base}/*/${p.sub}` : p.base);
    if (row.viejo) rev = Math.max(rev, Number(row.rev));
  }
  if (r.rows.length && (r.rows as { viejo: boolean }[]).every((x) => x.viejo)) rev = Math.max(rev, ...r.rows.map((x: { rev: string }) => Number(x.rev)));
  return { rev, colecciones: [...cols] };
}

// ---------------------------------------------------------------------------
// "Escribiendo…" / "grabando audio…" en el chat (como WhatsApp). Es efímero: una fila por persona y chat que
// vence sola a los pocos segundos. Viaja en la misma consulta de cambios (no suma pedidos).
// ---------------------------------------------------------------------------

const VIGENCIA_ESCRIBIENDO_S = 7;
let tablaEscribiendo: Promise<unknown> | null = null;
function asegurarTablaEscribiendo() {
  tablaEscribiendo ??= getPool()
    .query(
      "create table if not exists chat_escribiendo (chat_id text not null, uid text not null, nombre text not null default '', estado text not null default 'escribiendo', hasta timestamptz not null, primary key (chat_id, uid))"
    )
    .catch((e) => {
      tablaEscribiendo = null;
      throw e;
    });
  return tablaEscribiendo;
}

/** Avisa que está escribiendo o grabando en un chat donde es miembro (o deja de hacerlo, con estado null). */
async function escribiendo(req: VercelRequest) {
  const caller = await requireCaller(req);
  const { chatId, estado } = body<{ chatId?: string; estado?: "escribiendo" | "grabando" | null }>(req);
  if (typeof chatId !== "string" || !ID_OK.test(chatId)) throw new HttpError(400, "Chat inválido");
  await asegurarTablaEscribiendo();
  const pool = getPool();
  if (estado !== "escribiendo" && estado !== "grabando") {
    await pool.query("delete from chat_escribiendo where chat_id = $1 and uid = $2", [chatId, caller.uid]);
    return { ok: true };
  }
  const r = await pool.query("select 1 from documentos where coleccion = 'chats' and id = $1 and data->'miembros' @> jsonb_build_array($2::text)", [
    chatId,
    caller.uid,
  ]);
  if (!r.rowCount) throw new HttpError(403, "No sos parte de este chat");
  await pool.query(
    `insert into chat_escribiendo (chat_id, uid, nombre, estado, hasta) values ($1, $2, $3, $4, now() + make_interval(secs => $5))
     on conflict (chat_id, uid) do update set nombre = excluded.nombre, estado = excluded.estado, hasta = excluded.hasta`,
    [chatId, caller.uid, caller.nombre ?? "", estado, VIGENCIA_ESCRIBIENDO_S]
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Chat de voz de los grupos (como WhatsApp): una sala de audio fija por chat (Jitsi, en otra pestaña) y quién
// está adentro. Cada uno avisa cada 30 s que sigue; si cierra Prodi, a los 90 s deja de figurar.
// ---------------------------------------------------------------------------

const VIGENCIA_VOZ_S = 90;
let tablaVoz: Promise<unknown> | null = null;
function asegurarTablaVoz() {
  tablaVoz ??= getPool()
    .query(
      "create table if not exists chat_voz (chat_id text not null, uid text not null, nombre text not null default '', desde timestamptz not null default now(), hasta timestamptz not null, primary key (chat_id, uid))"
    )
    .catch((e) => {
      tablaVoz = null;
      throw e;
    });
  return tablaVoz;
}

// Registro de la llamada: quién la abrió, desde cuándo y quiénes pasaron. Cuando no queda nadie, se deja en el
// chat "hizo una llamada de voz de 12 min con Ariel y Agustín 📞" (una sola vez: la fila se borra al publicarla).
let tablaLlamadas: Promise<unknown> | null = null;
function asegurarTablaLlamadas() {
  tablaLlamadas ??= getPool()
    .query(
      "create table if not exists chat_llamadas (chat_id text primary key, inicio timestamptz not null default now(), por text not null, por_nombre text not null default '', participantes jsonb not null default '[]')"
    )
    .catch((e) => {
      tablaLlamadas = null;
      throw e;
    });
  return tablaLlamadas;
}

async function anotarEnLlamada(chatId: string, uid: string, nombre: string) {
  await asegurarTablaLlamadas();
  const quien = JSON.stringify([{ uid, nombre }]);
  await getPool().query(
    `insert into chat_llamadas (chat_id, por, por_nombre, participantes) values ($1, $2, $3, $4::jsonb)
     on conflict (chat_id) do update set participantes = case
       when chat_llamadas.participantes @> jsonb_build_array(jsonb_build_object('uid', $2::text)) then chat_llamadas.participantes
       else chat_llamadas.participantes || $4::jsonb end`,
    [chatId, uid, nombre, quien]
  );
}

let ultimoCierre = 0;
let ultimaRevisionInterna = 0;
/** Las llamadas donde ya no queda nadie (colgaron o cerraron la app): se registran en su chat. */
async function cerrarLlamadasTerminadas(forzar = false): Promise<{ chat_id: string; inicio: string }[]> {
  if (!forzar && Date.now() - ultimoCierre < 10_000) return [];
  ultimoCierre = Date.now();
  await Promise.all([asegurarTablaLlamadas(), asegurarTablaVoz()]);
  const r = await getPool().query(
    `delete from chat_llamadas l
      where not exists (select 1 from chat_voz v where v.chat_id = l.chat_id and v.hasta > now())
      returning l.chat_id, l.inicio, l.por, l.por_nombre, l.participantes,
        coalesce((select max(v.hasta) - make_interval(secs => $1) from chat_voz v where v.chat_id = l.chat_id), now()) as fin`,
    [VIGENCIA_VOZ_S - 30]
  );
  for (const x of r.rows as { chat_id: string; inicio: string; por: string; por_nombre: string; participantes: { uid: string; nombre: string }[]; fin: string }[]) {
    const ms = Math.max(0, new Date(x.fin).getTime() - new Date(x.inicio).getTime());
    const min = Math.round(ms / 60_000);
    const duracion = min < 1 ? "de menos de un minuto" : `de ${min} min`;
    const otros = x.participantes.filter((p) => p.uid !== x.por).map((p) => (p.nombre || "alguien").split(" ")[0]);
    const con = otros.length ? ` con ${otros.length > 1 ? `${otros.slice(0, -1).join(", ")} y ${otros[otros.length - 1]}` : otros[0]}` : " (no entró nadie más)";
    await publicarEnChat(
      x.chat_id,
      { texto: `hizo una llamada de voz ${duracion}${con} 📞`, by: x.por, by_nombre: x.por_nombre, at: new Date().toISOString(), tipo: "sistema" },
      `llamada_${new Date(x.inicio).getTime()}`
    ).catch((e) => console.warn("[voz] registro", e));
    // La minuta (PDF) se arma en el servidor, aunque todos hayan cerrado la app.
    const inicio = new Date(x.inicio).toISOString();
    waitUntil(armarMinutaDeLlamada(x.chat_id, inicio, appUrl(), Math.max(1, min)).catch((e) => console.warn("[voz] minuta", e)));
  }
  return (r.rows as { chat_id: string; inicio: string }[]).map((x) => ({ chat_id: x.chat_id, inicio: new Date(x.inicio).toISOString() }));
}

/** Nombre de la sala: fijo para cada chat pero imposible de adivinar sin la clave del servidor. */
function salaDeVoz(chatId: string): string {
  const clave = process.env.TOKEN_ENCRYPTION_KEY || process.env.CRON_SECRET;
  if (!clave) throw new HttpError(500, "Falta configurar la clave del servidor para el chat de voz");
  return `Prodi-voz-${createHmac("sha256", clave).update(`voz:${chatId}`).digest("hex").slice(0, 20)}`;
}

async function voz(req: VercelRequest) {
  const caller = await requireCaller(req);
  const { chatId, accion } = body<{ chatId?: string; accion?: "entrar" | "latido" | "salir" }>(req);
  if (typeof chatId !== "string" || !ID_OK.test(chatId)) throw new HttpError(400, "Chat inválido");
  await asegurarTablaVoz();
  const pool = getPool();
  if (accion === "salir") {
    await pool.query("delete from chat_voz where chat_id = $1 and uid = $2", [chatId, caller.uid]);
    const cerradas = await cerrarLlamadasTerminadas(true).catch((e) => {
      console.warn("[voz] cierre", e);
      return [];
    });
    // Era el último: la app pide la minuta de esta llamada.
    const esta = cerradas.find((c) => c.chat_id === chatId);
    return { ok: true, cerrada: esta ? { inicio: esta.inicio } : null };
  }
  const r = await pool.query("select data->>'tipo' as tipo from documentos where coleccion = 'chats' and id = $1 and data->'miembros' @> jsonb_build_array($2::text)", [
    chatId,
    caller.uid,
  ]);
  if (!r.rowCount) throw new HttpError(403, "No sos parte de este chat");
  if (r.rows[0].tipo === "prodi") throw new HttpError(400, "El chat con Prodi no tiene chat de voz");
  await pool.query(
    `insert into chat_voz (chat_id, uid, nombre, hasta) values ($1, $2, $3, now() + make_interval(secs => $4))
     on conflict (chat_id, uid) do update set nombre = excluded.nombre, hasta = excluded.hasta,
       desde = case when chat_voz.hasta < now() then now() else chat_voz.desde end`,
    [chatId, caller.uid, caller.nombre ?? "", VIGENCIA_VOZ_S]
  );
  if (accion !== "entrar") return { ok: true };
  // Si había una llamada vieja sin registrar en este chat (todos se fueron sin colgar), se registra antes.
  await cerrarLlamadasTerminadas(true).catch(() => undefined);
  await anotarEnLlamada(chatId, caller.uid, caller.nombre ?? "");
  const llamada = await pool.query("select inicio from chat_llamadas where chat_id = $1", [chatId]);
  const inicio = llamada.rows[0]?.inicio ? new Date(llamada.rows[0].inicio).toISOString() : null;
  // Quiénes ya estaban adentro: el que entra los llama a cada uno.
  const adentro = await pool.query("select uid, nombre from chat_voz where chat_id = $1 and uid <> $2 and hasta > now() order by desde", [chatId, caller.uid]);
  return { ok: true, sala: salaDeVoz(chatId), adentro: adentro.rows as { uid: string; nombre: string }[], inicio };
}

// Señales de la llamada (WebRTC): para que dos celulares se conecten directo, Prodi les pasa "la presentación"
// (oferta / respuesta). El audio no pasa por Prodi. Las señales se leen una vez y se borran; vencen al minuto.
let tablaSenales: Promise<unknown> | null = null;
function asegurarTablaSenales() {
  tablaSenales ??= getPool()
    .query(
      "create table if not exists chat_senales (id bigserial primary key, chat_id text not null, de text not null, de_nombre text not null default '', para text not null, tipo text not null, data jsonb not null default '{}', creado timestamptz not null default now())"
    )
    .then(() => getPool().query("create index if not exists chat_senales_para on chat_senales (para)"))
    .catch((e) => {
      tablaSenales = null;
      throw e;
    });
  return tablaSenales;
}

async function senal(req: VercelRequest) {
  const caller = await requireCaller(req);
  const { chatId, para, tipo, data } = body<{ chatId?: string; para?: string; tipo?: string; data?: unknown }>(req);
  if (typeof chatId !== "string" || !ID_OK.test(chatId) || typeof para !== "string" || !ID_OK.test(para)) throw new HttpError(400, "Señal inválida");
  if (!["oferta", "respuesta", "chau"].includes(String(tipo))) throw new HttpError(400, "Señal inválida");
  const texto = JSON.stringify(data ?? {});
  if (texto.length > 60_000) throw new HttpError(400, "Señal demasiado grande");
  // Los dos tienen que ser del chat.
  const r = await getPool().query(
    "select 1 from documentos where coleccion = 'chats' and id = $1 and data->'miembros' @> jsonb_build_array($2::text) and data->'miembros' @> jsonb_build_array($3::text)",
    [chatId, caller.uid, para]
  );
  if (!r.rowCount) throw new HttpError(403, "No son parte de este chat");
  await asegurarTablaSenales();
  await getPool().query("insert into chat_senales (chat_id, de, de_nombre, para, tipo, data) values ($1, $2, $3, $4, $5, $6::jsonb)", [
    chatId,
    caller.uid,
    caller.nombre ?? "",
    para,
    tipo,
    texto,
  ]);
  return { ok: true };
}

/** Las señales que me mandaron (se entregan una vez). */
async function senales(req: VercelRequest) {
  const caller = await requireCaller(req);
  await asegurarTablaSenales();
  const pool = getPool();
  await pool.query("delete from chat_senales where creado < now() - interval '60 seconds'");
  const r = await pool.query("delete from chat_senales where para = $1 returning chat_id, de, de_nombre, tipo, data, id", [caller.uid]);
  return { senales: (r.rows as { id: string }[]).sort((a, b) => Number(a.id) - Number(b.id)) };
}

/** Quién está en el chat de voz de los chats de esta persona (incluida ella). */
async function quienesEnVoz(uid: string) {
  await asegurarTablaVoz();
  await cerrarLlamadasTerminadas().catch(() => undefined);
  const r = await getPool().query(
    `select v.chat_id, v.uid, v.nombre from chat_voz v
       join documentos d on d.coleccion = 'chats' and d.id = v.chat_id
      where v.hasta > now() and d.data->'miembros' @> jsonb_build_array($1::text)
      order by v.desde
      limit 200`,
    [uid]
  );
  return r.rows as { chat_id: string; uid: string; nombre: string }[];
}

/** Quién está escribiendo ahora en los chats de esta persona (sin contarla a ella). */
async function quienesEscriben(uid: string) {
  await asegurarTablaEscribiendo();
  const r = await getPool().query(
    `select e.chat_id, e.uid, e.nombre, e.estado from chat_escribiendo e
       join documentos d on d.coleccion = 'chats' and d.id = e.chat_id
      where e.hasta > now() and e.uid <> $1 and d.data->'miembros' @> jsonb_build_array($1::text)
      limit 100`,
    [uid]
  );
  return r.rows as { chat_id: string; uid: string; nombre: string; estado: string }[];
}

/**
 * Mensajes sin leer de cada chat del usuario (para la lista de chats, como WhatsApp). Una sola consulta para todos:
 * por cada chat con algo nuevo, cuenta los mensajes de otros (sin los avisos del sistema) desde su última lectura.
 */
async function sinLeer(req: VercelRequest) {
  const caller = await requireCaller(req);
  if (caller.role === "pending" || !caller.role) return { conteos: {} };
  const pool = getPool();
  const uid = caller.uid;
  const r = await pool.query(
    "select id, data->'ultimo' as ultimo, data->'leido'->>$1 as leido from documentos where coleccion = 'chats' and data->'miembros' @> jsonb_build_array($1::text)",
    [uid]
  );
  const pendientes = (r.rows as { id: string; ultimo: { by?: string; at?: string } | null; leido: string | null }[])
    .filter((c) => c.ultimo?.at && c.ultimo.by !== uid && (c.leido ?? "") < c.ultimo.at)
    .slice(0, 300);
  if (!pendientes.length) return { conteos: {} };
  const q = await pool.query(
    `select v.col, count(d.id)::int as n
       from unnest($1::text[], $2::text[]) as v(col, desde)
       left join documentos d
         on d.coleccion = v.col
        and d.data->>'at' > v.desde
        and coalesce(d.data->>'by', '') <> $3
        and coalesce(d.data->>'tipo', 'texto') <> 'sistema'
      group by v.col`,
    [pendientes.map((c) => `chats/${c.id}/mensajes`), pendientes.map((c) => c.leido ?? ""), uid]
  );
  const conteos: Record<string, number> = {};
  for (const row of q.rows as { col: string; n: number }[]) conteos[row.col.split("/")[1]] = Math.max(1, Math.min(999, row.n));
  return { conteos };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const accion = String(req.query.accion ?? "");
    if (accion === "consultar") res.status(200).json(await consultar(req));
    else if (accion === "escribir") res.status(200).json(await escribir(req));
    else if (accion === "cambios") res.status(200).json(await cambios(req));
    else if (accion === "escribiendo") res.status(200).json(await escribiendo(req));
    else if (accion === "voz") res.status(200).json(await voz(req));
    else if (accion === "senal") res.status(200).json(await senal(req));
    else if (accion === "senales") res.status(200).json(await senales(req));
    else if (accion === "sin-leer") res.status(200).json(await sinLeer(req));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    const status = (err as { code?: number }).code;
    if (status === 5 || status === 6) res.status(409).json({ error: (err as Error).message });
    else sendError(res, err);
  }
}
