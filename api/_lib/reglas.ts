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
  /** Chats leídos en este pedido (para saber si es miembro). */
  chats: Map<string, Data | null>;
  ex: Pick<PoolClient, "query">;
}

const TEAM = ["admin", "productor", "editor", "pauta", "diseno"];
const ACTIVOS = [...TEAM, "administracion", "cliente"];

const esAdmin = (c: Contexto) => c.role === "admin";
const esTeam = (c: Contexto) => TEAM.includes(c.role);
const esDiseno = (c: Contexto) => c.role === "diseno";
const esFinanzas = (c: Contexto) => c.role === "admin" || c.role === "administracion";
const produce = (c: Contexto) => c.role === "admin" || c.role === "productor";
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
      return esTeam(c) || esFinanzas(c) || (c.role === "cliente" && Array.isArray(d.team_roles?.cliente) && d.team_roles.cliente.includes(c.uid));
    case "videos":
      return esTeam(c) || esFinanzas(c) || clienteDe(c, d.proyecto_id);
    case "rodajes":
      return esTeam(c) || clienteDe(c, d.proyecto_id);
    case "piezas_ia":
      return esTeam(c) || esFinanzas(c) || clienteDe(c, d.proyecto_id);
    case "planes_mes":
      // El cliente lo ve recién cuando producción se lo mandó.
      return esTeam(c) || (clienteDe(c, d.proyecto_id) && d.estado !== "borrador");
    case "ia_memoria":
      return produce(c) || esDiseno(c);
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
      return activo(c);
    case "informes":
      return esAdmin(c);
    case "chats":
      return esAdmin(c) || (Array.isArray(d.miembros) && d.miembros.includes(c.uid));
    case "reuniones":
      return (
        esAdmin(c) ||
        (esTeam(c) && Array.isArray(d.participantes) && d.participantes.includes(c.uid)) ||
        (esTeam(c) && d.proyecto_id != null && produce(c)) ||
        (d.proyecto_id != null && clienteDe(c, d.proyecto_id))
      );
    case "in_app_notifications":
      return d.recipient_user_id === c.uid;
    case "whatsapp_verifications":
      return c.uid === id;
    case "notification_queue":
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
    if (esAdmin(c)) return true;
    if (!crea || borra) return false;
    if (!(await miembroDelChat(c, padreId!)) || despues!.by !== c.uid) return false;
    if (sub === "audios") return typeof despues!.data === "string" && despues!.data.length < 1_000_000;
    return true;
  }

  switch (base) {
    case "profiles":
      if (borra) return esAdmin(c);
      if (crea) return c.uid === id && despues!.role === "pending";
      return esAdmin(c) || (c.uid === id && !tocaAlguna(antes, despues, ["role", "dashboard_access", "project_permissions", "activo"]));
    case "projects":
      if (crea || borra) return esAdmin(c);
      return (
        esAdmin(c) ||
        (c.role === "productor" && soloCambia(antes, despues, ["marca", "redes", "contacto_emails", "meta"])) ||
        (esFinanzas(c) && soloCambia(antes, despues, ["facturacion"]))
      );
    case "videos":
      if (crea || borra) return produce(c);
      return (
        esTeam(c) ||
        (clienteDe(c, antes!.proyecto_id) &&
          antes!.etapa === "revision_cliente" &&
          ["para_publicar", "edicion"].includes(despues!.etapa) &&
          soloCambia(antes, despues, ["etapa", "etapa_desde", "updated_at", "historial", "feedback_cliente", "feedback_marcas", "rondas", "cliente_rating"]))
      );
    case "rodajes":
      return produce(c);
    case "piezas_ia":
      if (crea) return produce(c);
      if (borra) return esAdmin(c);
      return (
        produce(c) ||
        esDiseno(c) ||
        (clienteDe(c, antes!.proyecto_id) &&
          antes!.estado === "para_aprobar" &&
          ["entregada", "en_proceso"].includes(despues!.estado) &&
          soloCambia(antes, despues, ["estado", "version_aprobada_id", "feedback_cliente", "rondas", "updated_at", "historial"]))
      );
    case "planes_mes":
      if (crea || borra) return false;
      return produce(c) && antes!.estado === "borrador" && soloCambia(antes, despues, ["ideas", "nota_equipo", "updated_at"]);
    case "facturas":
      return !crea && esFinanzas(c);
    case "equipo_pagos":
    case "equipo_liquidaciones":
    case "gastos":
    case "obligaciones":
      return esFinanzas(c);
    case "planes_redes":
      return esAdmin(c);
    case "app_settings":
      return esAdmin(c) && id !== "drive_connection";
    case "chats":
      if (borra) return esAdmin(c);
      if (crea)
        return (
          esAdmin(c) ||
          (activo(c) && despues!.tipo === "directo" && Array.isArray(despues!.miembros) && despues!.miembros.includes(c.uid) && despues!.miembros.length === 2)
        );
      return esAdmin(c) || (Array.isArray(antes!.miembros) && antes!.miembros.includes(c.uid) && soloCambia(antes, despues, ["ultimo", "leido"]));
    case "reuniones":
      if (borra) return esAdmin(c);
      if (crea)
        return despues!.creada_por === c.uid && (esTeam(c) || (despues!.proyecto_id != null && clienteDe(c, despues!.proyecto_id)));
      return (
        esAdmin(c) ||
        (esTeam(c) &&
          Array.isArray(antes!.participantes) &&
          antes!.participantes.includes(c.uid) &&
          !tocaAlguna(antes, despues, ["participantes", "proyecto_id", "creada_por"]))
      );
    case "in_app_notifications":
      if (crea) return false;
      if (borra) return antes!.recipient_user_id === c.uid;
      return antes!.recipient_user_id === c.uid && soloCambia(antes, despues, ["read", "read_at"]);
    case "whatsapp_verifications":
      return c.uid === id;
    default:
      return false;
  }
}

/** Arma el contexto del pedido: rol y clientes del usuario. */
export async function contexto(ex: Pick<PoolClient, "query">, uid: string, role: string): Promise<Contexto> {
  const misClientes = new Set<string>();
  if (role === "cliente") {
    const r = await ex.query(
      "select id from documentos where coleccion = 'projects' and data @> jsonb_build_object('team_roles', jsonb_build_object('cliente', jsonb_build_array($1::text)))",
      [uid]
    );
    r.rows.forEach((x: { id: string }) => misClientes.add(x.id));
  }
  return { uid, role, misClientes, chats: new Map(), ex };
}

/** Saca los campos que solo usa el servidor (tokens cifrados de Drive, etc.). */
export function paraLaApp(data: Data): Data {
  const out: Data = {};
  for (const [k, v] of Object.entries(data)) if (!k.endsWith("_enc")) out[k] = v;
  return out;
}

export { leerRuta };
