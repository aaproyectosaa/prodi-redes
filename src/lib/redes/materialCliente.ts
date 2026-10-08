// Material crudo que manda el cliente para un video (lo filmó él, o es extra si filman los dos).
// Igual que los archivos del chat: el servidor abre la subida a Drive y le da a la página solo la URL de ESE archivo;
// la página sube directo en partes (subirASesion) y al terminar el servidor confirma el archivo y lo suma al crudo
// del video (api/_lib/drive-acciones/video-material.ts). Las subidas siguen aunque cierres la ficha del video.

import { useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { callApi } from "./api";
import { assertEditable } from "./vistaComo";
import { subirASesion } from "@/utils/drive/driveApi";
import { getFileKind, resolveMimeType } from "@/utils/drive/fileValidation";

export const MATERIAL_MAX_GB = 10;
const BLOQUEADOS = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|vbs|js|mjs|jar|sh|apk|app|dll|html?|xhtml|svg|hta)$/i;
/** Videos pesados: de a 2 a la vez para no ahogar la conexión del celular. */
const EN_PARALELO = 2;

export interface SubidaMaterial {
  id: string;
  videoId: string;
  nombre: string;
  size: number;
  mime: string;
  progreso: number;
  estado: "esperando" | "subiendo" | "error" | "listo";
  error?: string;
  file: File;
}

let subidas: SubidaMaterial[] = [];
const oyentes = new Set<() => void>();
const controles = new Map<string, AbortController>();

const emitir = () => oyentes.forEach((f) => f());
function cambiar(id: string, patch: Partial<SubidaMaterial>) {
  subidas = subidas.map((s) => (s.id === id ? { ...s, ...patch } : s));
  emitir();
}
function quitar(id: string) {
  subidas = subidas.filter((x) => x.id !== id);
  emitir();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!subidas.some((s) => s.estado === "subiendo" || s.estado === "esperando")) return;
    e.preventDefault();
    e.returnValue = "Hay material subiendo. Si cerrás la pestaña, se corta.";
  });
}

export function useSubidasMaterial(videoId: string): SubidaMaterial[] {
  const todas = useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => subidas
  );
  return useMemo(() => todas.filter((s) => s.videoId === videoId), [todas, videoId]);
}

const mimeDe = (f: File) => (getFileKind(f) !== "unknown" ? resolveMimeType(f) : f.type || "application/octet-stream");

export const pesoTexto = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** null si se puede subir; si no, el motivo. */
function validar(f: File): string | null {
  if (!f.size) return `“${f.name || "Archivo"}” está vacío`;
  if (f.size > MATERIAL_MAX_GB * 1024 ** 3) return `“${f.name}” pesa ${pesoTexto(f.size)}. El máximo por archivo es ${MATERIAL_MAX_GB} GB.`;
  if (BLOQUEADOS.test(f.name)) return `“${f.name}”: ese tipo de archivo no se puede subir`;
  return null;
}

export function subirMaterial(videoId: string, files: File[]) {
  assertEditable();
  for (const f of files) {
    const err = validar(f);
    if (err) {
      toast.error(err);
      continue;
    }
    subidas = [
      ...subidas,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        videoId,
        nombre: f.name || "material",
        size: f.size,
        mime: mimeDe(f),
        progreso: 0,
        estado: "esperando",
        file: f,
      },
    ];
  }
  emitir();
  arrancar();
}

/** Arranca las que esperan, de a EN_PARALELO. */
function arrancar() {
  let libres = EN_PARALELO - subidas.filter((s) => s.estado === "subiendo").length;
  for (const s of subidas) {
    if (libres <= 0) break;
    if (s.estado !== "esperando") continue;
    libres--;
    cambiar(s.id, { estado: "subiendo" });
    void correr(s);
  }
}

async function correr(s: SubidaMaterial) {
  const ctrl = new AbortController();
  controles.set(s.id, ctrl);
  try {
    const { subida, url } = await callApi<{ subida: string; url: string }>("/api/drive/video-subida", {
      video_id: s.videoId,
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
    try {
      await callApi("/api/drive/video-archivo", { video_id: s.videoId, subida });
    } catch (e) {
      throw errSubida ?? e;
    }
    cambiar(s.id, { estado: "listo", progreso: 100 });
    // El archivo ya aparece en la lista del video: la barra se va sola.
    setTimeout(() => quitar(s.id), 4000);
  } catch (e) {
    if (ctrl.signal.aborted) quitar(s.id);
    else cambiar(s.id, { estado: "error", error: e instanceof Error ? e.message : "No se pudo subir" });
  } finally {
    controles.delete(s.id);
    arrancar();
  }
}

export function cancelarSubidaMaterial(id: string) {
  const c = controles.get(id);
  if (c) c.abort();
  else quitar(id);
}

export function reintentarSubidaMaterial(id: string) {
  const s = subidas.find((x) => x.id === id);
  if (!s || s.estado !== "error") return;
  cambiar(id, { estado: "esperando", progreso: 0, error: undefined });
  arrancar();
}

/** "Listo, ya subí todo": pasa a edición (si esperaba el material) y le avisa al equipo. */
export function avisarMaterialListo(videoId: string) {
  assertEditable();
  return callApi<{ ok: boolean; etapa: string }>("/api/drive/video-listo", { video_id: videoId });
}
