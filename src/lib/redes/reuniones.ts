import { addDoc, collection, doc, updateDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { Project } from "@/integrations/firebase/types";
import { avisar } from "./avisos";
import { callApi } from "@/lib/redes/api";
import { enviarMensaje } from "./chat";
import { assertEditable } from "./vistaComo";
import { fechaHora } from "./format";
import type { Chat, Minuta, Reunion } from "./types";

export const REUNIONES = "reuniones";

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 24) || "Reunion";

/** Link de videollamada gratis (Jitsi Meet). La sala se crea al entrar. */
export function linkVideollamada(titulo: string, base = "https://meet.jit.si") {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base.replace(/\/$/, "")}/Prodi-${slug(titulo)}-${rand}`;
}

export interface NuevaReunion {
  titulo: string;
  proyecto: Project | null;
  fecha: string; // ISO
  participantes: string[];
  chat: Chat | null;
  jitsiBase?: string;
}

export async function crearReunion(data: NuevaReunion, by: string, remitente: string): Promise<{ id: string; link: string }> {
  assertEditable();
  const link = linkVideollamada(data.titulo, data.jitsiBase);
  const r: Omit<Reunion, "id"> = {
    titulo: data.titulo.trim() || "Reunión",
    proyecto_id: data.proyecto?.id ?? null,
    chat_id: data.chat?.id ?? null,
    fecha: data.fecha,
    link,
    participantes: Array.from(new Set([...data.participantes, by])),
    creada_por: by,
    estado: "programada",
    attachments_crudo: [],
    notas: null,
    minuta: null,
    created_at: new Date().toISOString(),
  };
  const ref = await addDoc(collection(db, REUNIONES), r);
  const ahora = Math.abs(new Date(data.fecha).getTime() - Date.now()) < 10 * 60_000;
  if (data.chat) {
    await enviarMensaje(
      data.chat,
      by,
      ahora ? `Videollamada: ${r.titulo}` : `Reunión agendada: ${r.titulo} · ${fechaHora(data.fecha)}`,
      { tipo: "llamada", link, reunion_id: ref.id, remitente, titulo: ahora ? `${remitente} te invita a una videollamada` : undefined }
    );
  } else {
    void avisar({
      destinatarios: r.participantes.filter((p) => p !== by),
      titulo: ahora ? `${remitente} te invita a una videollamada` : "Reunión agendada",
      cuerpo: `${r.titulo} · ${fechaHora(data.fecha)}`,
      link: `/reuniones?r=${ref.id}`,
      clave: `reunion:${ref.id}`,
      proyectoId: r.proyecto_id,
    });
  }
  return { id: ref.id, link };
}

export async function actualizarReunion(id: string, patch: Partial<Omit<Reunion, "id">>) {
  assertEditable();
  await updateDoc(doc(db, REUNIONES, id), patch as Record<string, unknown>);
}

/** La IA arma la minuta desde la grabación (o desde las notas si no hay audio). */
export async function generarMinuta(reunionId: string, usar: "audio" | "notas") {
  return callApi<{ ok: true }>("/api/ia/minuta", { reunion_id: reunionId, usar });
}

export async function compartirMinuta(r: Reunion, chat: Chat, by: string, remitente: string) {
  if (!r.minuta) return;
  const texto = [
    `Minuta: ${r.titulo}`,
    r.minuta.resumen,
    r.minuta.acuerdos.length ? `Acuerdos:\n${r.minuta.acuerdos.map((a) => `• ${a}`).join("\n")}` : "",
    r.minuta.tareas.length
      ? `Tareas:\n${r.minuta.tareas.map((t) => `• ${t.tarea}${t.responsable ? ` (${t.responsable})` : ""}${t.fecha ? ` · ${t.fecha}` : ""}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  await enviarMensaje(chat, by, texto, { tipo: "minuta", reunion_id: r.id, remitente });
}

export const minutaVacia = (): Minuta => ({
  resumen: "",
  temas: [],
  acuerdos: [],
  tareas: [],
  generado_at: new Date().toISOString(),
  fuente: "manual",
});
