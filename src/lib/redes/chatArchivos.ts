// Archivos en el chat (fotos, videos, PDF, documentos).
// El servidor abre la subida a Drive y le da a la página solo la URL de ESE archivo (también a los clientes,
// que no tienen acceso a Drive); la página sube directo en partes (subirASesion, igual que el material de los videos)
// y al terminar el servidor confirma el archivo y escribe el mensaje (api/_lib/drive-acciones/chat.ts).
// Las subidas siguen aunque cambies de conversación (viven acá, fuera de la pantalla).

import { useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { callApi } from "./api";
import { assertEditable } from "./vistaComo";
import { subirASesion } from "@/utils/drive/driveApi";
import { getFileKind, resolveMimeType } from "@/utils/drive/fileValidation";

export const CHAT_MAX_MB = 200;
const BLOQUEADOS = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|vbs|js|mjs|jar|sh|apk|app|dll|html?|xhtml|svg|hta)$/i;

export interface SubidaChat {
  id: string;
  chatId: string;
  nombre: string;
  size: number;
  mime: string;
  progreso: number;
  estado: "subiendo" | "error" | "listo";
  error?: string;
  /** Vista previa local de las fotos mientras suben. */
  previa?: string;
  leyenda?: string;
  /** Va como documento (archivo original para bajar), aunque sea una foto. */
  documento?: boolean;
  /** Id del mensaje que escribió el servidor (para sacar la burbuja cuando aparece). */
  mensajeId?: string;
  file: File;
}

let subidas: SubidaChat[] = [];
const oyentes = new Set<() => void>();
const controles = new Map<string, AbortController>();

const emitir = () => oyentes.forEach((f) => f());
function cambiar(id: string, patch: Partial<SubidaChat>) {
  subidas = subidas.map((s) => (s.id === id ? { ...s, ...patch } : s));
  emitir();
}
function quitar(id: string) {
  const s = subidas.find((x) => x.id === id);
  if (s?.previa) URL.revokeObjectURL(s.previa);
  subidas = subidas.filter((x) => x.id !== id);
  emitir();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!subidas.some((s) => s.estado === "subiendo")) return;
    e.preventDefault();
    e.returnValue = "Hay archivos subiendo al chat. Si cerrás la pestaña, se cortan.";
  });
}

export function useSubidasChat(chatId: string): SubidaChat[] {
  const todas = useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => subidas
  );
  return useMemo(() => todas.filter((s) => s.chatId === chatId), [todas, chatId]);
}

const mimeDe = (f: File) => (getFileKind(f) !== "unknown" ? resolveMimeType(f) : f.type || "application/octet-stream");

/** null si se puede mandar; si no, el motivo. */
export function validarArchivoChat(f: File): string | null {
  if (!f.size) return `“${f.name || "Archivo"}” está vacío`;
  if (f.size > CHAT_MAX_MB * 1024 * 1024) return `“${f.name}” pesa ${Math.round(f.size / 1024 / 1024)} MB. El máximo en el chat es ${CHAT_MAX_MB} MB.`;
  if (BLOQUEADOS.test(f.name)) return `“${f.name}”: ese tipo de archivo no se puede mandar por el chat`;
  return null;
}

export function subirArchivosChat(chatId: string, files: File[], leyenda?: string, documento = false) {
  assertEditable();
  files.slice(0, 10).forEach((f, i) => {
    const err = validarArchivoChat(f);
    if (err) {
      toast.error(err);
      return;
    }
    const mime = mimeDe(f);
    const s: SubidaChat = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      nombre: f.name || "archivo",
      size: f.size,
      mime,
      progreso: 0,
      estado: "subiendo",
      previa: mime.startsWith("image/") && !documento ? URL.createObjectURL(f) : undefined,
      documento: documento || undefined,
      // La leyenda va con el primero.
      leyenda: i === 0 ? leyenda?.trim() || undefined : undefined,
      file: f,
    };
    subidas = [...subidas, s];
    emitir();
    void correr(s);
  });
  if (files.length > 10) toast.message("Se mandan de a 10 archivos por vez");
}

async function correr(s: SubidaChat) {
  const ctrl = new AbortController();
  controles.set(s.id, ctrl);
  try {
    const { subida, url } = await callApi<{ subida: string; url: string }>("/api/drive/chat-subida", {
      chat_id: s.chatId,
      nombre: s.nombre,
      mime: s.mime,
      size: s.size,
    });
    let errSubida: unknown = null;
    try {
      await subirASesion({
        sessionUri: url,
        file: s.file,
        mime: s.mime,
        signal: ctrl.signal,
        onProgress: (p) => cambiar(s.id, { progreso: Math.min(99, p) }),
      });
    } catch (e) {
      if (ctrl.signal.aborted) throw e;
      // A veces el navegador no deja leer la última respuesta de Drive aunque el archivo subió: se confirma igual.
      errSubida = e;
    }
    let r: { id: string };
    try {
      r = await callApi<{ id: string }>("/api/drive/chat-archivo", { chat_id: s.chatId, subida, texto: s.leyenda ?? "", documento: !!s.documento });
    } catch (e) {
      throw errSubida ?? e;
    }
    cambiar(s.id, { estado: "listo", progreso: 100, mensajeId: r.id });
    // Si el mensaje tarda en aparecer, la burbuja se va sola igual.
    setTimeout(() => quitar(s.id), 60_000);
  } catch (e) {
    if (ctrl.signal.aborted) {
      quitar(s.id);
      return;
    }
    cambiar(s.id, { estado: "error", error: e instanceof Error ? e.message : "No se pudo subir" });
  } finally {
    controles.delete(s.id);
  }
}

export function cancelarSubida(id: string) {
  const c = controles.get(id);
  if (c) c.abort();
  else quitar(id);
}

export function reintentarSubida(id: string) {
  const s = subidas.find((x) => x.id === id);
  if (!s || s.estado !== "error") return;
  cambiar(id, { estado: "subiendo", progreso: 0, error: undefined });
  void correr({ ...s, estado: "subiendo", progreso: 0 });
}

/** Saca las burbujas cuyo mensaje ya está en la conversación. */
export function limpiarSubidasListas(idsEnChat: Set<string>) {
  subidas.filter((s) => s.estado === "listo" && s.mensajeId && idsEnChat.has(s.mensajeId)).forEach((s) => quitar(s.id));
}
