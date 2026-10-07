// Quién puede leer y escribir cada cosa desde la app (lo que antes hacía firestore.rules).
// Las funciones del servidor (/api/pagos, /api/ia, …) no pasan por acá: validan sus permisos aparte.
//
// Leer: se filtra documento por documento (lo que no podés ver, no te llega).
// Escribir: se mira el documento antes y después del cambio; si no está permitido, se rechaza todo el lote.

import type { PoolClient } from "pg";
import { clavesCambiadas, leerRuta, type Data } from "./docs";
import { leerDoc } from "./db";

export interface Contexto {
  uid: string;
  role: string;
  /** Clientes donde el usuario es "cliente" (se calcula una vez por pedido). */
  misClientes: Set<string>;
  /** Clientes asignados a productor / editor / pauta (en cualquier rol de team_roles). */
  misProyectos: Set<string>;
  /** Chats leídos en este pedido (para saber si es miembro). */
  chats: Map<string, Data | null>;
  /** Con quién comparte algún chat (se calcula la primera vez que hace falta). */
  companeros?: Set<string>;
  ex: Pick<PoolClient, "query">;
}

const TEAM = ["admin", "productor", "editor", "pauta", "diseno"];
const ACTIVOS = [...TEAM, "administracion", "cliente"];

const esAdmin = (c: Contexto) => c.role === "admin";
const esTeam = (c: Contexto) => TEAM.includes(c.role);
const esDiseno = (c: Contexto) => c.role === "diseno";
const esFinanzas = (c: Contexto) => c.role === "admin" || c.role === "administracion";

/** Roles del equipo que solo ven los clientes donde están asignados (como assertProjectAccess). */
const ASIGNADOS = ["productor", "editor", "pauta"];
/** ¿Trabaja en este cliente? Admin y diseño ven todos; el resto, solo si está en team_roles. */
const equipoDe = (c: Contexto, pid: unknown) =>
  esAdmin(c) || esDiseno(c) || (ASIGNADOS.includes(c.role) && typeof pid === "string" && c.misProyectos.has(pid));
/** Admin, o productor asignado a ese cliente. */
const produceEn = (c: Contexto, pid: unknown) => esAdmin(c) || (c.role === "productor" && equipoDe(c, pid));
/** Campos del WhatsApp (ya no se usa): nadie los escribe desde la app. */
const WHATSAPP = ["whatsapp_phone", "whatsapp_phone_verified", "whatsapp_enabled", "whatsapp_notifications"];
/** Evento de Google Calendar: lo escribe solo el servidor (api/_lib/calendario.ts). */
const CALENDARIO = ["google_event_id", "google_event_hash"];
/** ¿Pone o cambia alguno de estos campos? (borrarlos sí se puede: un set completo sin ellos no se rechaza). */
const escribeAlguna = (antes: Data | null, despues: Data | null, campos: string[]) =>
  !!despues && campos.some((k) => despues[k] !== undefined && JSON.stringify(despues[k]) !== JSON.stringify(antes?.[k]));
const activo = (c: Contexto) => ACTIVOS.includes(c.role);
const clienteDe = (c: Contexto, pid: unknown) => c.role === "cliente" && typeof pid === "string" && c.misClientes.has(pid);
const soloCambia = (antes: Data | null, despues: Data | null, permitidas: string[]) =>
  clavesCambiadas(antes, despues).every((k) => permitidas.includes(k));
const tocaAlguna = (antes: Data | null, despues: Data | null, prohibidas: string[]) =>
  clavesCambiadas(antes, despues).some((k) => prohibidas.includes(k));

async function miembroDelChat(c: Contexto, chatId: string): Promise<boolean> {
  if (!c.chats.has(chatId)) c.chats.set(chatId, await leerDoc(c.ex, "chats", chatId));
  const chat = c.chats.get(chatId);
  return Array.isArray(chat?.miembros) && chat!.miembros.includes(c.uid);
}

/** Personas que están en algún chat con el usuario (los clientes ven su foto y pueden sumarlas a un grupo). */
async function companeros(c: Contexto): Promise<Set<string>> {
  if (!c.companeros) {
    const r = await c.ex.query(
      "select distinct jsonb_array_elements_text(data->'miembros') as id from documentos where coleccion = 'chats' and jsonb_typeof(data->'miembros') = 'array' and data->'miembros' @> jsonb_build_array($1::text)",
      [c.uid]
    );
    c.companeros = new Set((r.rows as { id: string }[]).map((x) => x.id));
  }
  return c.companeros;
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const mismoSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));
const MAX_MIEMBROS_GRUPO = 80;
/** Foto chica (JPEG cuadrado que arma la app) guardada en el documento: perfil, avatares y chats. */
const fotoOk = (v: unknown, max = 90_000) =>
  v == null || v === "" || (typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(v) && v.length <= max);
/** Lo que se puede cambiar de la cara de un grupo (nombre, foto, emoji, color). */
const CARA = ["nombre", "foto", "emoji", "color"];

/** Forma de un grupo armado por los usuarios (chats con tipo "grupo"). */
function grupoValido(d: Data): boolean {
  const miembros = lista(d.miembros);
  const admins = lista(d.admins);
  return (
    d.tipo === "grupo" &&
    d.proyecto_id == null &&
    Array.isArray(d.miembros) &&
    miembros.length === d.miembros.length &&
    new Set(miembros).size === miembros.length &&
    miembros.length <= MAX_MIEMBROS_GRUPO &&
    admins.every((a) => miembros.includes(a)) &&
    typeof d.nombre === "string" &&
    d.nombre.trim().length > 0 &&
    d.nombre.length <= 80 &&
    fotoOk(d.foto) &&
    (d.emoji == null || (typeof d.emoji === "string" && d.emoji.length <= 16)) &&
    (d.color == null || (typeof d.color === "string" && /^#[0-9a-f]{6}$/i.test(d.color)))
  );
}

/**
 * ¿Puede sumar a estas personas a un grupo? Tienen que ser usuarios activos y:
 * - super admin: cualquiera;
 * - cliente: solo gente con la que ya comparte un chat;
 * - equipo: cualquiera del equipo, y usuarios de los clientes donde trabaja.
 */
async function puedenSumarse(c: Contexto, ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  if (ids.length > MAX_MIEMBROS_GRUPO) return false;
  const r = await c.ex.query(
    "select id, data->>'role' as role, data->>'activo' as activo from documentos where coleccion = 'profiles' and id = any($1::text[])",
    [ids]
  );
  const filas = r.rows as { id: string; role: string | null; activo: string | null }[];
  if (filas.length !== new Set(ids).size || filas.some((f) => !ACTIVOS.includes(f.role ?? "") || f.activo === "false")) return false;
  if (esAdmin(c)) return true;
  if (c.role === "cliente") {
    const comp = await companeros(c);
    return ids.every((id) => comp.has(id));
  }
  const clientes = filas.filter((f) => f.role === "cliente").map((f) => f.id);
  if (!clientes.length) return true;
  if (!esTeam(c)) return false;
  const p = await c.ex.query(
    "select id, data->'team_roles'->'cliente' as cl from documentos where coleccion = 'projects' and jsonb_typeof(data->'team_roles'->'cliente') = 'array' and (data->'team_roles'->'cliente') ?| $1::text[]",
    [clientes]
  );
  const permitidos = new Set<string>();
  for (const x of p.rows as { id: string; cl: unknown }[]) if (equipoDe(c, x.id)) lista(x.cl).forEach((u) => permitidos.add(u));
  return clientes.every((id) => permitidos.has(id));
}

/** "chats/abc/mensajes" → { base: "chats", padreId: "abc", sub: "mensajes" } */
export function partirColeccion(col: string): { base: string; padreId?: string; sub?: string } {
  const s = col.split("/");
  if (s.length === 1) return { base: s[0] };
  if (s.length === 3) return { base: s[0], padreId: s[1], sub: s[2] };
  return { base: "__invalida__" };
}

/** ¿Puede leer este documento? */
export async function puedeLeer(c: Contexto, col: string, id: string, d: Data | null): Promise<boolean> {
  const { base, padreId, sub } = partirColeccion(col);
  if (sub) {
    if (base === "chats" && (sub === "mensajes" || sub === "audios")) return esAdmin(c) || (await miembroDelChat(c, padreId!));
    return esAdmin(c);
  }
  // Documentos que no existen: se puede saber que no existen (así la app espera a que aparezcan).
  if (d === null) return activo(c) || id === c.uid;
  switch (base) {
    case "profiles":
      return esTeam(c) || esFinanzas(c) || c.uid === id;
    case "projects":
      return equipoDe(c, id) || esFinanzas(c) || (c.role === "cliente" && Array.isArray(d.team_roles?.cliente) && d.team_roles.cliente.includes(c.uid));
    case "videos":
      return equipoDe(c, d.proyecto_id) || esFinanzas(c) || clienteDe(c, d.proyecto_id);
    case "rodajes":
      return equipoDe(c, d.proyecto_id) || clienteDe(c, d.proyecto_id);
    case "piezas_ia":
      return equipoDe(c, d.proyecto_id) || esFinanzas(c) || clienteDe(c, d.proyecto_id);
    case "planes_mes":
      // El cliente lo ve recién cuando producción se lo mandó.
      return equipoDe(c, d.proyecto_id) || (clienteDe(c, d.proyecto_id) && d.estado !== "borrador");
    case "ia_memoria":
      // ia_memoria/{cliente}
      return produceEn(c, id) || esDiseno(c);
    case "cobros":
      return esFinanzas(c) || clienteDe(c, d.proyecto_id);
    case "facturas":
      return esFinanzas(c) || (clienteDe(c, d.proyecto_id) && ["pendiente", "cobrada"].includes(d.estado));
    case "equipo_pagos":
    case "equipo_liquidaciones":
    case "gastos":
    case "obligaciones":
      return esFinanzas(c);
    case "planes_redes":
    case "app_settings":
      // whatsapp_bot: configuración del bot de WhatsApp (eliminado), ya no se expone.
      if (base === "app_settings" && id === "whatsapp_bot") return false;
      return activo(c);
    case "informes":
      return esAdmin(c);
    case "chats":
      return esAdmin(c) || (Array.isArray(d.miembros) && d.miembros.includes(c.uid));
    case "reuniones":
      return (
        esAdmin(c) ||
        (esTeam(c) && Array.isArray(d.participantes) && d.participantes.includes(c.uid)) ||
        (d.proyecto_id != null && produceEn(c, d.proyecto_id)) ||
        (d.proyecto_id != null && clienteDe(c, d.proyecto_id))
      );
    case "avatares":
      // Foto de perfil: el equipo ve todas; el cliente, la de quienes comparten un chat con él.
      return esTeam(c) || esFinanzas(c) || id === c.uid || (c.role === "cliente" && (await companeros(c)).has(id));
    case "in_app_notifications":
      return d.recipient_user_id === c.uid;
    case "tareas":
      // Las ven quienes las tienen asignadas, quien las pidió y el admin.
      return esAdmin(c) || d.creada_por === c.uid || (Array.isArray(d.asignados) && d.asignados.includes(c.uid));
    case "prodi_pedidos": // pedidos a @prodi (límite por minuto): solo el servidor
    case "whatsapp_verifications": // código de verificación (hasheado): solo lo usa el servidor
    case "notification_queue":
    case "arca_tickets": // ticket de acceso a ARCA (token y firma): solo el servidor
      return false;
    default:
      // Lo del sistema anterior: solo el super admin.
      return esAdmin(c);
  }
}

/** ¿Puede hacer este cambio? (antes = null: lo crea; despues = null: lo borra). */
export async function puedeEscribir(c: Contexto, col: string, id: string, antes: Data | null, despues: Data | null): Promise<boolean> {
  const crea = antes === null;
  const borra = despues === null;
  const { base, padreId, sub } = partirColeccion(col);

  if (sub) {
    if (base !== "chats" || !(sub === "mensajes" || sub === "audios")) return false;
    // Archivos y respuestas de @prodi: solo los escribe el servidor (ni el admin desde la app).
    // Un mensaje con `archivo` le da acceso al archivo a todo el chat (api/_lib/media-token.ts).
    const delServidor = (d: Data | null) => !!d && (d.archivo != null || d.tipo === "archivo" || d.tipo === "bot" || d.by === "prodi");
    if (sub === "mensajes" && (delServidor(despues) || (delServidor(antes) && !(borra && esAdmin(c))))) return false;
    if (esAdmin(c)) return true;
    if (!crea || borra) return false;
    if (!(await miembroDelChat(c, padreId!)) || despues!.by !== c.uid) return false;
    if (sub === "audios") return typeof despues!.data === "string" && despues!.data.length < 1_000_000;
    return true;
  }

  switch (base) {
    case "profiles":
      if (borra) return esAdmin(c);
      // Los campos del WhatsApp (eliminado) no se escriben más.
      if (escribeAlguna(antes, despues, WHATSAPP)) return false;
      // La foto va chica (la app la recorta y comprime): así no pesa en cada lista de perfiles.
      if (escribeAlguna(antes, despues, ["profileImage"]) && !fotoOk(despues!.profileImage, 200_000)) return false;
      if (crea) return c.uid === id && despues!.role === "pending";
      return (
        esAdmin(c) ||
        (c.uid === id && !tocaAlguna(antes, despues, ["role", "dashboard_access", "project_permissions", "activo"]))
      );
    case "projects":
      if (crea || borra) return esAdmin(c);
      // contacto_emails: ahí se mandan boletas e informes, solo lo cambia el admin.
      return (
        esAdmin(c) ||
        (c.role === "productor" && equipoDe(c, id) && soloCambia(antes, despues, ["marca", "redes", "meta"])) ||
        (esFinanzas(c) && soloCambia(antes, despues, ["facturacion"]))
      );
    case "videos":
      // El cliente aprueba o pide cambios solo por /api/publico/video-cliente (el servidor valida etapa, ronda e historial).
      if (crea) return produceEn(c, despues!.proyecto_id);
      if (borra) return produceEn(c, antes!.proyecto_id);
      return equipoDe(c, antes!.proyecto_id) && equipoDe(c, despues!.proyecto_id);
    case "rodajes":
      return (crea || produceEn(c, antes!.proyecto_id)) && (borra || produceEn(c, despues!.proyecto_id));
    case "piezas_ia":
      // El cliente aprueba o pide cambios solo por /api/publico/pieza-cliente.
      if (crea) return produceEn(c, despues!.proyecto_id);
      if (borra) return esAdmin(c);
      return esDiseno(c) || (produceEn(c, antes!.proyecto_id) && produceEn(c, despues!.proyecto_id));
    case "planes_mes":
      if (crea || borra) return false;
      return produceEn(c, antes!.proyecto_id) && antes!.estado === "borrador" && soloCambia(antes, despues, ["ideas", "nota_equipo", "updated_at"]);
    case "facturas":
      // El CAE de ARCA lo escribe solo el servidor; una factura autorizada no se borra (se anula con nota de crédito).
      if (borra) return esFinanzas(c) && !antes!.arca?.cae;
      return !crea && esFinanzas(c) && !tocaAlguna(antes, despues, ["arca", "arca_en_curso_at", "arca_error"]);
    case "equipo_pagos":
    case "equipo_liquidaciones":
    case "gastos":
    case "obligaciones":
      return esFinanzas(c);
    case "planes_redes":
      return esAdmin(c);
    case "app_settings":
      return esAdmin(c) && id !== "drive_connection" && id !== "whatsapp_bot";
    case "avatares":
      // Solo la propia foto (o el super admin, que copia las que ya estaban en los perfiles).
      if (!(c.uid === id || esAdmin(c))) return false;
      if (borra) return true;
      return Object.keys(despues!).every((k) => k === "img" || k === "updated_at") && typeof despues!.img === "string" && fotoOk(despues!.img);
    case "chats": {
      if (borra) return esAdmin(c);
      if (crea) {
        if (esAdmin(c)) return true;
        if (!activo(c)) return false;
        if (despues!.tipo === "directo")
          return Array.isArray(despues!.miembros) && despues!.miembros.includes(c.uid) && despues!.miembros.length === 2;
        // Grupo nuevo: quien lo crea queda como único admin; solo con gente que puede sumar.
        if (despues!.tipo === "grupo") {
          const miembros = lista(despues!.miembros);
          return (
            grupoValido(despues!) &&
            despues!.creado_por === c.uid &&
            mismoSet(lista(despues!.admins), [c.uid]) &&
            miembros.includes(c.uid) &&
            (await puedenSumarse(c, miembros.filter((m) => m !== c.uid)))
          );
        }
        return false;
      }
      // Super admin: todo (también la foto de "equipo" y de los grupos de cada cliente).
      if (esAdmin(c)) return fotoOk(despues!.foto);
      const miembrosAntes = lista(antes!.miembros);
      if (!miembrosAntes.includes(c.uid)) return false;
      if (soloCambia(antes, despues, ["ultimo", "leido"])) return true;
      if (antes!.tipo !== "grupo" || despues!.tipo !== "grupo" || !grupoValido(despues!)) return false;
      if (lista(antes!.admins).includes(c.uid)) {
        // Admin del grupo: nombre, foto, miembros y admins.
        if (!soloCambia(antes, despues, [...CARA, "miembros", "admins", "nombres", "ultimo", "leido"])) return false;
        return puedenSumarse(c, lista(despues!.miembros).filter((m) => !miembrosAntes.includes(m)));
      }
      // Cualquier miembro puede salir del grupo (y nada más). Si se va el último admin, queda otro.
      if (!soloCambia(antes, despues, ["miembros", "admins", "nombres", "ultimo", "leido"])) return false;
      const quedan = miembrosAntes.filter((m) => m !== c.uid);
      if (!mismoSet(lista(despues!.miembros), quedan)) return false;
      const adminsQuedan = lista(antes!.admins).filter((a) => quedan.includes(a));
      const adminsDespues = lista(despues!.admins);
      return (
        mismoSet(adminsDespues, adminsQuedan) ||
        (adminsQuedan.length === 0 && adminsDespues.length <= 1 && adminsDespues.every((a) => quedan.includes(a)))
      );
    }
    case "reuniones":
      if (borra) return esAdmin(c);
      // El evento de Google Calendar lo guarda solo el servidor.
      if (escribeAlguna(antes, despues, CALENDARIO)) return false;
      if (crea)
        return (
          despues!.creada_por === c.uid &&
          (despues!.proyecto_id == null ? esTeam(c) : equipoDe(c, despues!.proyecto_id) || clienteDe(c, despues!.proyecto_id))
        );
      return (
        esAdmin(c) ||
        (esTeam(c) &&
          Array.isArray(antes!.participantes) &&
          antes!.participantes.includes(c.uid) &&
          !tocaAlguna(antes, despues, ["participantes", "proyecto_id", "creada_por"]))
      );
    case "tareas": {
      // Las crea el servidor (@prodi). Desde la app: marcarlas hechas (asignados o quien la pidió) y borrarlas (quien la pidió o el admin).
      if (crea) return false;
      const suya = esAdmin(c) || antes!.creada_por === c.uid;
      if (borra) return suya;
      const asignada = Array.isArray(antes!.asignados) && antes!.asignados.includes(c.uid);
      return (suya || asignada) && soloCambia(antes, despues, ["hecha", "hecha_at", "hecha_por"]);
    }
    case "in_app_notifications":
      if (crea) return false;
      if (borra) return antes!.recipient_user_id === c.uid;
      return antes!.recipient_user_id === c.uid && soloCambia(antes, despues, ["read", "read_at"]);
    default:
      // whatsapp_verifications, notification_queue (restos del WhatsApp), …: solo el servidor.
      return false;
  }
}

/** Arma el contexto del pedido: rol y clientes del usuario. */
export async function contexto(ex: Pick<PoolClient, "query">, uid: string, role: string): Promise<Contexto> {
  const misClientes = new Set<string>();
  const misProyectos = new Set<string>();
  if (role === "cliente") {
    const r = await ex.query(
      "select id from documentos where coleccion = 'projects' and data @> jsonb_build_object('team_roles', jsonb_build_object('cliente', jsonb_build_array($1::text)))",
      [uid]
    );
    r.rows.forEach((x: { id: string }) => misClientes.add(x.id));
  } else if (ASIGNADOS.includes(role)) {
    // En cualquier rol del cliente (igual que assertProjectAccess).
    const r = await ex.query(
      `select d.id from documentos d
        where d.coleccion = 'projects'
          and exists (
            select 1
              from jsonb_each(case when jsonb_typeof(d.data->'team_roles') = 'object' then d.data->'team_roles' else '{}'::jsonb end) t
             where jsonb_typeof(t.value) = 'array' and t.value @> jsonb_build_array($1::text)
          )`,
      [uid]
    );
    r.rows.forEach((x: { id: string }) => misProyectos.add(x.id));
  }
  return { uid, role, misClientes, misProyectos, chats: new Map(), ex };
}

/** Saca los campos que solo usa el servidor (tokens cifrados de Drive, etc.). */
export function paraLaApp(data: Data): Data {
  const out: Data = {};
  for (const [k, v] of Object.entries(data)) if (!k.endsWith("_enc")) out[k] = v;
  return out;
}

export { leerRuta };
