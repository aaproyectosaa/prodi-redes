import {
  addDoc,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
} from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { Profile, Project } from "@/integrations/firebase/types";
import { avisar } from "./avisos";
import { callApi } from "./api";
import { assertEditable, enModoVista } from "./vistaComo";
import type { Chat, Mensaje, TipoMensaje } from "./types";

export const CHATS = "chats";
const TEAM = ["admin", "productor", "editor", "pauta", "diseno", "administracion"];

const now = () => new Date().toISOString();
const mismo = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export const chatClienteId = (pid: string) => `cliente_${pid}`;
export const chatDirectoId = (a: string, b: string) => `dm_${[a, b].sort().join("_")}`;

/**
 * Mantiene los grupos al día (lo corre el super admin al abrir la app):
 * - "equipo": todo el equipo interno.
 * - "cliente_<id>": equipo asignado al cliente + usuarios del cliente + admins.
 */
export async function sincronizarChats(projects: Project[], profiles: Profile[], chats: Chat[]) {
  if (enModoVista()) return;
  const admins = profiles.filter((p) => p.role === "admin").map((p) => p.id);
  const equipo = profiles.filter((p) => TEAM.includes(p.role ?? "")).map((p) => p.id);
  const tareas: Promise<unknown>[] = [];

  const nombreDe = (id: string) => profiles.find((p) => p.id === id)?.nombre ?? "";
  const asegurar = (id: string, data: Omit<Chat, "id" | "ultimo" | "leido" | "created_at" | "nombres">) => {
    const actual = chats.find((c) => c.id === id);
    const nombres = Object.fromEntries(data.miembros.map((m) => [m, nombreDe(m)]));
    if (!actual) {
      tareas.push(setDoc(doc(db, CHATS, id), { ...data, nombres, ultimo: null, leido: {}, created_at: now() }));
    } else if (
      !mismo(actual.miembros, data.miembros) ||
      actual.nombre !== data.nombre ||
      JSON.stringify(actual.nombres ?? {}) !== JSON.stringify(nombres) ||
      (data.contactos && !mismo(actual.contactos ?? [], data.contactos))
    ) {
      tareas.push(
        updateDoc(doc(db, CHATS, id), { miembros: data.miembros, nombre: data.nombre, nombres, ...(data.contactos ? { contactos: data.contactos } : {}) })
      );
    }
  };

  asegurar("equipo", { tipo: "equipo", proyecto_id: null, nombre: "Equipo Prodi", miembros: equipo });
  for (const p of projects) {
    if (p.enabled === false) continue;
    const t = p.team_roles ?? {};
    // Contactos (solo chat) del cliente: están en su grupo; `contactos` deja que todos los vean marcados.
    const contactos = profiles.filter((x) => x.role === "contacto" && x.activo !== false && x.proyecto_id === p.id).map((x) => x.id).sort();
    const miembros = Array.from(
      new Set([...(t.productor ?? []), ...(t.editor ?? []), ...(t.pauta ?? []), ...(t.cliente ?? []), ...contactos, ...admins])
    );
    asegurar(chatClienteId(p.id), { tipo: "cliente", proyecto_id: p.id, nombre: p.nombre, miembros, contactos });
  }
  await Promise.allSettled(tareas);
}

/** Contactos (solo chat) que conoce este usuario: salen de los grupos de cada cliente (chat.contactos). */
export function contactosDe(chats: Chat[]): Set<string> {
  const s = new Set<string>();
  for (const c of chats) for (const id of c.contactos ?? []) s.add(id);
  return s;
}

/** Abre (o crea) la conversación privada entre dos personas. */
export async function abrirDirecto(a: string, b: string, nombres: Record<string, string> = {}): Promise<string> {
  assertEditable();
  const id = chatDirectoId(a, b);
  const ref = doc(db, CHATS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      tipo: "directo",
      proyecto_id: null,
      nombre: null,
      miembros: [a, b].sort(),
      nombres,
      ultimo: null,
      leido: {},
      created_at: now(),
    });
  }
  return id;
}

export async function enviarMensaje(
  chat: Chat,
  by: string,
  texto: string,
  opts: { tipo?: TipoMensaje; link?: string | null; reunion_id?: string | null; titulo?: string; remitente?: string } = {}
) {
  assertEditable();
  const at = now();
  const msg: Omit<Mensaje, "id"> = {
    texto: texto.trim(),
    by,
    at,
    tipo: opts.tipo ?? "texto",
    by_nombre: opts.remitente ?? "",
    link: opts.link ?? null,
    reunion_id: opts.reunion_id ?? null,
  };
  const ref = await addDoc(collection(db, CHATS, chat.id, "mensajes"), msg);
  await updateDoc(doc(db, CHATS, chat.id), {
    ultimo: { texto: msg.texto.slice(0, 140), by, at },
    [`leido.${by}`]: at,
  });
  void avisar({
    destinatarios: chat.miembros.filter((m) => m !== by),
    titulo: opts.titulo ?? (chat.tipo === "directo" ? opts.remitente ?? "Mensaje nuevo" : `${chat.nombre ?? "Chat"}`),
    cuerpo: chat.tipo === "directo" ? msg.texto.slice(0, 140) : `${opts.remitente ?? ""}: ${msg.texto.slice(0, 120)}`,
    link: `/chat?c=${chat.id}`,
    clave: `chat:${chat.id}`,
    proyectoId: chat.proyecto_id,
  });
  return ref.id;
}

// ---------------------------------------------------------------------------
// @prodi: el asistente (lo procesa el servidor: api/_lib/chat-asistente.ts)
// ---------------------------------------------------------------------------

export const PRODI_ID = "prodi";
export const mencionaProdi = (texto: string) => /(^|[\s(])@prodi\b/i.test(texto);

/** Después de guardar el mensaje: Prodi lo lee y contesta en el chat. */
export function pedirAProdi(chatId: string, mensajeId: string) {
  return callApi<{ ok: true }>("/api/ia/chat-asistente", { chat_id: chatId, mensaje_id: mensajeId });
}

export const AUDIO_MAX_SEG = 180;

export const duracionTexto = (seg: number) => `${Math.floor(seg / 60)}:${String(Math.round(seg % 60)).padStart(2, "0")}`;

function aBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("No se pudo leer el audio"));
    r.readAsDataURL(blob);
  });
}

/** Mensaje de voz: el audio va a una subcolección y el mensaje solo lo referencia. */
export async function enviarAudio(chat: Chat, by: string, blob: Blob, duracion: number, remitente: string) {
  assertEditable();
  if (duracion < 1) throw new Error("El audio es muy corto");
  const data = await aBase64(blob);
  if (data.length > 990_000) throw new Error("El audio es muy largo (máximo 3 minutos)");
  const mime = (blob.type || "audio/webm").split(";")[0];
  const at = now();
  const ref = doc(collection(db, CHATS, chat.id, "audios"));
  await setDoc(ref, { data, mime, by, at });
  const texto = `🎤 Mensaje de voz (${duracionTexto(duracion)})`;
  await addDoc(collection(db, CHATS, chat.id, "mensajes"), {
    texto,
    by,
    at,
    tipo: "audio",
    by_nombre: remitente,
    link: null,
    reunion_id: null,
    audio: { id: ref.id, mime, duracion: Math.round(duracion) },
  } satisfies Omit<Mensaje, "id">);
  await updateDoc(doc(db, CHATS, chat.id), {
    ultimo: { texto, by, at },
    [`leido.${by}`]: at,
  });
  void avisar({
    destinatarios: chat.miembros.filter((m) => m !== by),
    titulo: chat.tipo === "directo" ? remitente || "Mensaje nuevo" : `${chat.nombre ?? "Chat"}`,
    cuerpo: chat.tipo === "directo" ? texto : `${remitente}: ${texto}`,
    link: `/chat?c=${chat.id}`,
    clave: `chat:${chat.id}`,
    proyectoId: chat.proyecto_id,
  });
}

/** Baja el audio (una sola vez) y devuelve una URL para reproducirlo. */
const cacheAudios = new Map<string, string>();
export async function urlAudio(chatId: string, audioId: string): Promise<string> {
  const key = `${chatId}/${audioId}`;
  const hit = cacheAudios.get(key);
  if (hit) return hit;
  const snap = await getDoc(doc(db, CHATS, chatId, "audios", audioId));
  const d = snap.data() as { data?: string; mime?: string } | undefined;
  if (!d?.data) throw new Error("El audio ya no está disponible");
  const bytes = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: d.mime || "audio/webm" }));
  cacheAudios.set(key, url);
  return url;
}

export async function marcarLeido(chat: Chat, uid: string) {
  if (enModoVista() || !chat.ultimo) return;
  if ((chat.leido?.[uid] ?? "") >= chat.ultimo.at) return;
  await updateDoc(doc(db, CHATS, chat.id), { [`leido.${uid}`]: now() }).catch(() => undefined);
}

export function noLeido(chat: Chat, uid: string | undefined): boolean {
  if (!uid || !chat.ultimo || chat.ultimo.by === uid) return false;
  return (chat.leido?.[uid] ?? "") < chat.ultimo.at;
}

/** Nombre a mostrar de una conversación para este usuario. */
export function tituloChat(chat: Chat, uid: string | undefined, profiles: Profile[], role?: string): string {
  if (chat.tipo === "equipo") return "Equipo Prodi";
  if (chat.tipo === "cliente") return role === "cliente" || role === "contacto" ? `Prodi · ${chat.nombre ?? ""}` : chat.nombre ?? "Cliente";
  if (chat.tipo === "grupo") return chat.nombre ?? "Grupo";
  const otro = chat.miembros.find((m) => m !== uid) ?? "";
  return profiles.find((p) => p.id === otro)?.nombre ?? chat.nombres?.[otro] ?? "Conversación";
}

// ---------------------------------------------------------------------------
// Grupos armados por los usuarios (tipo "grupo")
// ---------------------------------------------------------------------------

export const esAdminDelGrupo = (chat: Chat, uid: string | undefined, role?: string) =>
  role === "admin" || (chat.tipo === "grupo" && !!uid && (chat.admins ?? []).includes(uid));

/** ¿Puede cambiar la foto? Grupos: sus admins; "equipo" y los de cada cliente: el super admin. */
export const puedeEditarChat = (chat: Chat, uid: string | undefined, role?: string) =>
  chat.tipo === "directo" ? false : esAdminDelGrupo(chat, uid, role);

const listaNombres = (ns: string[]) =>
  ns.length <= 1 ? ns.join("") : `${ns.slice(0, -1).join(", ")} y ${ns[ns.length - 1]}`;
const primerNombre = (n: string | undefined) => (n ?? "").trim().split(" ")[0] || "alguien";

type Lote = ReturnType<typeof writeBatch>;

/** Mensaje de sistema ("Lucas sumó a Ana") + último mensaje del chat, en el mismo lote. */
function sistema(lote: Lote, chatId: string, by: string, remitente: string, texto: string, at = now()) {
  lote.set(doc(collection(db, CHATS, chatId, "mensajes")), {
    texto,
    by,
    at,
    tipo: "sistema",
    by_nombre: remitente,
    link: null,
    reunion_id: null,
  } satisfies Omit<Mensaje, "id">);
  return { ultimo: { texto, by, at }, [`leido.${by}`]: at };
}

export interface DatosGrupo {
  nombre: string;
  foto?: string | null;
  emoji?: string | null;
  color?: string | null;
}

export async function crearGrupo(uid: string, remitente: string, datos: DatosGrupo, miembros: Record<string, string>): Promise<string> {
  assertEditable();
  const nombre = datos.nombre.trim().slice(0, 80);
  if (!nombre) throw new Error("Ponele un nombre al grupo");
  const ids = Array.from(new Set([uid, ...Object.keys(miembros)]));
  if (ids.length < 2) throw new Error("Elegí al menos una persona");
  const ref = doc(collection(db, CHATS));
  const at = now();
  const texto = `creó el grupo «${nombre}»`;
  const lote = writeBatch(db);
  lote.set(ref, {
    tipo: "grupo",
    proyecto_id: null,
    nombre,
    miembros: ids,
    admins: [uid],
    creado_por: uid,
    nombres: { ...miembros, [uid]: remitente },
    foto: datos.foto || null,
    emoji: datos.emoji || null,
    color: datos.color || null,
    ultimo: { texto, by: uid, at },
    leido: { [uid]: at },
    created_at: at,
  });
  sistema(lote, ref.id, uid, remitente, texto, at);
  await lote.commit();
  void avisar({
    destinatarios: ids.filter((m) => m !== uid),
    titulo: nombre,
    cuerpo: `${remitente} te sumó al grupo`,
    link: `/chat?c=${ref.id}`,
    clave: `chat:${ref.id}`,
  });
  return ref.id;
}

/** Nombre, foto, emoji o color (admins del grupo; en "equipo" y los de clientes, solo la foto y el super admin). */
export async function editarChat(chat: Chat, uid: string, remitente: string, cambios: Partial<DatosGrupo>) {
  assertEditable();
  const patch: Record<string, unknown> = {};
  if (cambios.nombre !== undefined && chat.tipo === "grupo") {
    const n = cambios.nombre.trim().slice(0, 80);
    if (!n) throw new Error("Ponele un nombre al grupo");
    if (n !== chat.nombre) patch.nombre = n;
  }
  if (cambios.foto !== undefined) patch.foto = cambios.foto || null;
  if (chat.tipo === "grupo") {
    if (cambios.emoji !== undefined) patch.emoji = cambios.emoji || null;
    if (cambios.color !== undefined) patch.color = cambios.color || null;
  }
  if (!Object.keys(patch).length) return;
  const lote = writeBatch(db);
  const texto = patch.nombre ? `cambió el nombre a «${patch.nombre}»` : patch.foto !== undefined ? (patch.foto ? "cambió la foto" : "sacó la foto") : "";
  const extra = texto ? sistema(lote, chat.id, uid, remitente, texto) : {};
  lote.update(doc(db, CHATS, chat.id), { ...patch, ...extra });
  await lote.commit();
}

/** Suma personas al grupo (admins del grupo o super admin). */
export async function sumarAlGrupo(chat: Chat, uid: string, remitente: string, nuevos: Record<string, string>) {
  assertEditable();
  const ids = Object.keys(nuevos).filter((id) => !chat.miembros.includes(id));
  if (!ids.length) return;
  const lote = writeBatch(db);
  const extra = sistema(lote, chat.id, uid, remitente, `sumó a ${listaNombres(ids.map((id) => primerNombre(nuevos[id])))}`);
  lote.update(doc(db, CHATS, chat.id), {
    miembros: [...chat.miembros, ...ids],
    nombres: { ...(chat.nombres ?? {}), ...nuevos },
    ...extra,
  });
  await lote.commit();
  void avisar({
    destinatarios: ids,
    titulo: chat.nombre ?? "Grupo",
    cuerpo: `${remitente} te sumó al grupo`,
    link: `/chat?c=${chat.id}`,
    clave: `chat:${chat.id}`,
  });
}

/** Saca a alguien del grupo (admins del grupo o super admin). */
export async function sacarDelGrupo(chat: Chat, uid: string, remitente: string, quien: string, nombreQuien: string) {
  assertEditable();
  const lote = writeBatch(db);
  const extra = sistema(lote, chat.id, uid, remitente, `sacó a ${primerNombre(nombreQuien)}`);
  lote.update(doc(db, CHATS, chat.id), {
    miembros: chat.miembros.filter((m) => m !== quien),
    admins: (chat.admins ?? []).filter((a) => a !== quien),
    ...extra,
  });
  await lote.commit();
}

/** Hace (o deja de hacer) admin del grupo a alguien. */
export async function cambiarAdmin(chat: Chat, quien: string, admin: boolean) {
  assertEditable();
  const actuales = chat.admins ?? [];
  const admins = admin ? Array.from(new Set([...actuales, quien])) : actuales.filter((a) => a !== quien);
  if (!admins.length) throw new Error("El grupo tiene que tener al menos un admin");
  await updateDoc(doc(db, CHATS, chat.id), { admins });
}

/** Salir del grupo. Si eras el último admin, queda como admin el que sigue en la lista. */
export async function salirDelGrupo(chat: Chat, uid: string, remitente: string) {
  assertEditable();
  const quedan = chat.miembros.filter((m) => m !== uid);
  let admins = (chat.admins ?? []).filter((a) => a !== uid && quedan.includes(a));
  if (!admins.length && quedan.length) admins = [quedan[0]];
  const lote = writeBatch(db);
  const extra = sistema(lote, chat.id, uid, remitente, "salió del grupo");
  lote.update(doc(db, CHATS, chat.id), { miembros: quedan, admins, ...extra });
  await lote.commit();
}

// ---------------------------------------------------------------------------
// Visto: sale de la última lectura de cada miembro (chat.leido), sin escribir nada por mensaje.
// ---------------------------------------------------------------------------

export interface Lectura {
  uid: string;
  at: string | null;
}

/** Quiénes (de los demás miembros) leyeron hasta este mensaje y cuándo. */
export function lecturasDe(chat: Chat, msgAt: string, uid: string): Lectura[] {
  return chat.miembros
    .filter((m) => m !== uid)
    .map((m) => {
      const l = chat.leido?.[m];
      return { uid: m, at: l && l >= msgAt ? l : null };
    });
}
