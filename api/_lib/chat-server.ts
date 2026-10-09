// Chat desde el servidor: lo que la app no puede escribir sola (archivos y mensajes de Prodi, el asistente).

import { adminDb, type Data } from "./db";
import { HttpError } from "./http";
import { enviarAviso } from "./notify";

/** El asistente escribe con este `by` (no es un usuario: nadie puede escribir en su nombre). */
export const PRODI_ID = "prodi";
export const PRODI_NOMBRE = "Prodi";

const CHAT_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** El chat, si quien pide es miembro (si no, 403). */
export async function chatDeMiembro(chatId: unknown, uid: string): Promise<Data & { miembros: string[] }> {
  if (typeof chatId !== "string" || !CHAT_ID.test(chatId)) throw new HttpError(400, "Chat inválido");
  const chat = (await adminDb().collection("chats").doc(chatId).get()).data();
  if (!chat || !Array.isArray(chat.miembros) || !chat.miembros.includes(uid)) throw new HttpError(403, "No sos parte de este chat");
  return chat as Data & { miembros: string[] };
}

/** Guarda el mensaje y actualiza el "último mensaje" del chat. Con `id`, no se duplica (devuelve false si ya estaba). */
export async function publicarEnChat(chatId: string, msg: Data, id?: string): Promise<{ id: string; nuevo: boolean }> {
  const db = adminDb();
  const ref = db.collection(`chats/${chatId}/mensajes`).doc(id);
  if (id && (await ref.get()).exists) return { id: ref.id, nuevo: false };
  await ref.create(msg);
  const patch: Data = { ultimo: { texto: String(msg.texto ?? "").slice(0, 140), by: msg.by, at: msg.at } };
  if (msg.by !== PRODI_ID) patch[`leido.${msg.by}`] = msg.at;
  await db.collection("chats").doc(chatId).update(patch);
  return { id: ref.id, nuevo: true };
}

/** Mensaje del asistente. */
export async function mensajeProdi(
  chatId: string,
  texto: string,
  extra: { link?: string | null; link_texto?: string | null; responde_a?: { id: string; by: string; by_nombre: string; texto: string } | null; reunion_id?: string | null; tarea_id?: string | null } = {}
) {
  return publicarEnChat(chatId, {
    texto: texto.slice(0, 1500),
    by: PRODI_ID,
    by_nombre: PRODI_NOMBRE,
    at: new Date().toISOString(),
    tipo: "bot",
    link: extra.link ?? null,
    link_texto: extra.link_texto ?? null,
    reunion_id: extra.reunion_id ?? null,
    tarea_id: extra.tarea_id ?? null,
    responde_a: extra.responde_a ?? null,
  });
}

/** Aviso de mensaje nuevo a los demás miembros (igual que los mensajes de texto). */
export async function avisarMensaje(chatId: string, chat: Data, by: string, nombre: string, texto: string, baseUrl: string) {
  const miembros = (chat.miembros as string[]).filter((m) => m !== by);
  if (!miembros.length) return;
  await enviarAviso(
    {
      destinatarios: miembros,
      titulo: chat.tipo === "directo" ? nombre || "Mensaje nuevo" : String(chat.nombre ?? "Chat").slice(0, 120),
      cuerpo: chat.tipo === "directo" ? texto.slice(0, 140) : `${nombre}: ${texto.slice(0, 120)}`,
      link: `/chat?c=${chatId}`,
      clave: `chat:${chatId}`,
      proyectoId: (chat.proyecto_id as string | null) ?? null,
    },
    baseUrl
  ).catch((err) => console.warn("[chat] aviso falló", err));
}
