import {
  addDoc,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { Profile, Project } from "@/integrations/firebase/types";
import { avisar } from "./avisos";
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
      JSON.stringify(actual.nombres ?? {}) !== JSON.stringify(nombres)
    ) {
      tareas.push(updateDoc(doc(db, CHATS, id), { miembros: data.miembros, nombre: data.nombre, nombres }));
    }
  };

  asegurar("equipo", { tipo: "equipo", proyecto_id: null, nombre: "Equipo Prodi", miembros: equipo });
  for (const p of projects) {
    if (p.enabled === false) continue;
    const t = p.team_roles ?? {};
    const miembros = Array.from(
      new Set([...(t.productor ?? []), ...(t.editor ?? []), ...(t.pauta ?? []), ...(t.cliente ?? []), ...admins])
    );
    asegurar(chatClienteId(p.id), { tipo: "cliente", proyecto_id: p.id, nombre: p.nombre, miembros });
  }
  await Promise.allSettled(tareas);
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
  await addDoc(collection(db, CHATS, chat.id, "mensajes"), msg);
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
  if (chat.tipo === "cliente") return role === "cliente" ? `Prodi · ${chat.nombre ?? ""}` : chat.nombre ?? "Cliente";
  const otro = chat.miembros.find((m) => m !== uid) ?? "";
  return profiles.find((p) => p.id === otro)?.nombre ?? chat.nombres?.[otro] ?? "Conversación";
}
