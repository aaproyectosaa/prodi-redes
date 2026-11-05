// Visitas de los vendedores de un cliente (DS Ingeniería: visitan fábricas y filman ahí con el celular).
// El vendedor carga la visita y sube videos y fotos; producción los ve y arma el video cuando quiere.
// Las visitas las escribe solo el servidor (api/_lib/drive-acciones/visitas.ts). La subida es igual que el material
// del cliente: el servidor abre la subida a Drive y la página sube directo, en partes.
//
// En las fábricas suele no haber señal: lo que no se pudo subir queda en la cola y se vuelve a intentar solo cuando
// vuelve la conexión (y cada un rato), sin que el vendedor tenga que hacer nada. Si cierra la página, se pierde la cola
// (el archivo sigue en su celular): por eso se avisa antes de cerrar.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { collection, getDocs, onSnapshot, query, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { callApi } from "./api";
import { assertEditable } from "./vistaComo";
import { subirASesion } from "@/utils/drive/driveApi";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";

export const VISITAS = "visitas_vendedores";
const MAX_GB = 10;
/** Videos pesados: de a 2 a la vez para no ahogar la conexión del celular. */
const EN_PARALELO = 2;
/** Sin señal: se vuelve a probar cada este rato (y apenas vuelve la conexión). */
const REINTENTO_MS = 30_000;

export interface Visita {
  id: string;
  proyecto_id: string;
  titulo: string;
  fabrica: string;
  ubicacion: string | null;
  coords: { lat: number; lng: number } | null;
  descripcion: string | null;
  autoriza_publicar: boolean;
  /** YYYY-MM-DD (AR) del día en que se cargó. */
  fecha: string;
  vendedor_id: string;
  vendedor_nombre: string;
  archivos: (DriveAttachmentRef & { origen?: string })[];
  video_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatosVisita {
  titulo: string;
  fabrica: string;
  ubicacion: string;
  lat?: number | null;
  lng?: number | null;
  descripcion: string;
  autoriza: boolean;
}

/** Algo cambió en una visita desde esta pantalla (se creó, se subió un archivo): las listas se ponen al día ya. */
const EVENTO = "prodi-visitas";
const avisarCambio = () => typeof window !== "undefined" && window.dispatchEvent(new Event(EVENTO));

const ordenar = (docs: { id: string; data: () => Record<string, unknown> }[]) =>
  docs
    .map((d) => ({ id: d.id, ...d.data() }) as Visita)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.created_at.localeCompare(a.created_at));

/**
 * Las visitas de uno o varios clientes, en vivo (las más nuevas primero). Lo que cambia el servidor llega solo en unos
 * segundos; lo que se hizo desde esta pantalla se trae al toque (así la visita recién creada se abre enseguida).
 */
export function useVisitas(proyectoIds: string[] | null): { visitas: Visita[]; loading: boolean } {
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [loading, setLoading] = useState(true);
  const key = (proyectoIds ?? []).slice().sort().join(",");
  useEffect(() => {
    if (proyectoIds === null) return;
    if (!proyectoIds.length) {
      setVisitas([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, VISITAS), where("proyecto_id", "in", key.split(",").slice(0, 30)));
    let vivo = true;
    const traer = () =>
      void getDocs(q)
        .then((s) => vivo && setVisitas(ordenar(s.docs)))
        .catch(() => undefined);
    window.addEventListener(EVENTO, traer);
    const off = onSnapshot(
      q,
      (s) => {
        setVisitas(ordenar(s.docs));
        setLoading(false);
      },
      () => {
        setVisitas([]);
        setLoading(false);
      }
    );
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO, traer);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, proyectoIds === null]);
  return { visitas, loading };
}

/** Llama al servidor y, si salió bien, pone al día las listas de esta pantalla. */
async function conAviso<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  avisarCambio();
  return r;
}

export const crearVisita = (d: DatosVisita, proyectoId?: string) => {
  assertEditable();
  return conAviso(callApi<{ ok: true; id: string }>("/api/drive/visita-crear", { ...d, ...(proyectoId ? { proyecto_id: proyectoId } : {}) }));
};
export const editarVisita = (id: string, d: DatosVisita) => {
  assertEditable();
  return conAviso(callApi("/api/drive/visita-editar", { visita_id: id, ...d }));
};
export const borrarVisita = (id: string) => {
  assertEditable();
  return conAviso(callApi("/api/drive/visita-borrar", { visita_id: id }));
};
export const videoDeVisita = (id: string) => {
  assertEditable();
  return conAviso(callApi<{ ok: true; video_id: string }>("/api/drive/visita-video", { visita_id: id }));
};
export const activarVisitas = (proyectoId: string, activo: boolean) => {
  assertEditable();
  return callApi("/api/drive/visitas-activar", { proyecto_id: proyectoId, activo });
};

/** Dónde está el vendedor (para no escribir la dirección). null si no da permiso o no hay GPS. */
export function ubicacionActual(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
    );
  });
}

export const linkMapa = (c: { lat: number; lng: number }) => `https://www.google.com/maps?q=${c.lat},${c.lng}`;

export const esVideo = (mime: string | undefined) => (mime ?? "").startsWith("video/");

export const pesoTexto = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ---------------------------------------------------------------------------
// Cola de subidas (sigue aunque cierre la visita o cambie de pantalla).

export interface SubidaVisita {
  id: string;
  visitaId: string;
  nombre: string;
  size: number;
  mime: string;
  progreso: number;
  /** "espera": sin señal o falló; se vuelve a intentar sola. */
  estado: "esperando" | "subiendo" | "espera" | "listo" | "error";
  error?: string;
  intentos: number;
  file: File;
}

let subidas: SubidaVisita[] = [];
const oyentes = new Set<() => void>();
const controles = new Map<string, AbortController>();
const emitir = () => oyentes.forEach((f) => f());
function cambiar(id: string, patch: Partial<SubidaVisita>) {
  subidas = subidas.map((s) => (s.id === id ? { ...s, ...patch } : s));
  emitir();
}
function quitar(id: string) {
  subidas = subidas.filter((x) => x.id !== id);
  emitir();
}

/** Lo que vuelve a intentar: sin señal o un error que puede ser de la conexión. */
function reintentarEnEspera() {
  let hay = false;
  subidas = subidas.map((s) => {
    if (s.estado !== "espera") return s;
    hay = true;
    return { ...s, estado: "esperando" as const };
  });
  if (hay) {
    emitir();
    arrancar();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!subidas.some((s) => ["subiendo", "esperando", "espera"].includes(s.estado))) return;
    e.preventDefault();
    e.returnValue = "Hay videos o fotos sin subir. Si cerrás la página, se corta la subida.";
  });
  window.addEventListener("online", reintentarEnEspera);
  window.setInterval(() => {
    if (navigator.onLine) reintentarEnEspera();
  }, REINTENTO_MS);
}

export function useSubidasVisita(visitaId?: string): SubidaVisita[] {
  const todas = useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => subidas
  );
  return useMemo(() => (visitaId ? todas.filter((s) => s.visitaId === visitaId) : todas), [todas, visitaId]);
}

function mimeDe(f: File): string {
  if (f.type) return f.type.toLowerCase();
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const porExt: Record<string, string> = { mov: "video/quicktime", mp4: "video/mp4", m4v: "video/mp4", "3gp": "video/3gpp", webm: "video/webm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp" };
  return porExt[ext] ?? "";
}

/** La cámara del celular a veces le pone el mismo nombre a todo ("image.jpg"): se le agrega la hora para no confundirlos. */
function nombreDe(f: File, mime: string): string {
  const hora = new Date().toTimeString().slice(0, 8).replace(/:/g, "-");
  const ext = f.name.includes(".") ? f.name.split(".").pop() : mime.split("/")[1] ?? "bin";
  const base = f.name && !/^(image|video|capturedvideo)\.\w+$/i.test(f.name) ? f.name : `${mime.startsWith("video/") ? "video" : "foto"}.${ext}`;
  return `${hora} ${base}`.slice(0, 150);
}

export function subirAVisita(visitaId: string, files: File[]) {
  assertEditable();
  for (const f of files) {
    const mime = mimeDe(f);
    if (!f.size) {
      toast.error(`“${f.name || "Archivo"}” está vacío`);
      continue;
    }
    if (!/^(video|image)\//.test(mime)) {
      toast.error(`“${f.name}”: solo se pueden subir videos y fotos`);
      continue;
    }
    if (f.size > MAX_GB * 1024 ** 3) {
      toast.error(`“${f.name}” pesa ${pesoTexto(f.size)}. El máximo por archivo es ${MAX_GB} GB.`);
      continue;
    }
    subidas = [
      ...subidas,
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, visitaId, nombre: nombreDe(f, mime), size: f.size, mime, progreso: 0, estado: "esperando", intentos: 0, file: f },
    ];
  }
  emitir();
  arrancar();
}

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

/** Errores que no se arreglan reintentando (permiso, archivo inválido, visita borrada). */
const definitivo = (msg: string) => /permiso|no podés|no es de|solo se pueden|pesa|vacío|ya no existe|inválid/i.test(msg);

async function correr(s: SubidaVisita) {
  const ctrl = new AbortController();
  controles.set(s.id, ctrl);
  try {
    const { subida, url } = await callApi<{ subida: string; url: string }>("/api/drive/visita-subida", {
      visita_id: s.visitaId,
      nombre: s.nombre,
      mime: s.mime,
      size: s.size,
    });
    let errSubida: unknown = null;
    try {
      await subirASesion({ sessionUri: url, file: s.file, mime: s.mime, signal: ctrl.signal, onProgress: (p) => cambiar(s.id, { progreso: Math.min(99, p) }) });
    } catch (e) {
      if (ctrl.signal.aborted) throw e;
      // A veces el navegador no deja leer la última respuesta de Drive aunque el archivo subió: se confirma igual.
      errSubida = e;
    }
    try {
      await callApi("/api/drive/visita-archivo", { visita_id: s.visitaId, subida });
    } catch (e) {
      throw errSubida ?? e;
    }
    cambiar(s.id, { estado: "listo", progreso: 100 });
    avisarCambio();
    // Ya aparece en la visita: la barra se va sola.
    setTimeout(() => quitar(s.id), 4000);
  } catch (e) {
    if (ctrl.signal.aborted) quitar(s.id);
    else {
      const msg = e instanceof Error ? e.message : "No se pudo subir";
      // Sin señal o un corte: queda esperando y se vuelve a intentar sola (desde cero: la sesión de Drive se abre de nuevo).
      if (!definitivo(msg)) cambiar(s.id, { estado: "espera", progreso: 0, intentos: s.intentos + 1, error: navigator.onLine ? msg : "Sin señal" });
      else cambiar(s.id, { estado: "error", error: msg });
    }
  } finally {
    controles.delete(s.id);
    arrancar();
  }
}

export function cancelarSubidaVisita(id: string) {
  const c = controles.get(id);
  if (c) c.abort();
  else quitar(id);
}

export function reintentarSubidaVisita(id: string) {
  const s = subidas.find((x) => x.id === id);
  if (!s || (s.estado !== "error" && s.estado !== "espera")) return;
  cambiar(id, { estado: "esperando", progreso: 0, error: undefined });
  arrancar();
}
