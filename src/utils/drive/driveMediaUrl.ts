// URL para reproducir archivos de Drive en <video>.
// El elemento video no puede enviar headers: el servidor da un permiso corto (1 hora)
// solo para ese archivo, y la sesión nunca va en la URL.

import { auth } from "@/integrations/firebase/client";
import { logVideo } from "@/utils/drive/videoDebug";
import { ES_IOS, guardarArchivo, MAX_COMPARTIR } from "@/lib/compartirArchivo";

/** Permisos ya pedidos (valen 1 hora): la misma URL deja que el navegador reuse lo que ya bajó. */
const permisos = new Map<string, { url: string; hasta: number }>();

export async function getDriveMediaPlayUrl(fileId: string): Promise<string> {
  const guardado = permisos.get(fileId);
  if (guardado && guardado.hasta > Date.now()) return guardado.url;
  const user = auth.currentUser;
  if (!user) {
    logVideo("auth:missing", { fileId });
    throw new Error("Necesitás estar logueado");
  }
  const idToken = await user.getIdToken();
  const res = await fetch("/api/drive/media-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fileId }),
  });
  let data: { url?: string; error?: string } = {};
  try {
    data = await res.json();
  } catch {
    /* respuesta vacía */
  }
  if (!res.ok || !data.url) {
    logVideo("auth:media-token-error", { fileId, status: res.status, error: data.error });
    throw new Error(data.error ?? `No se pudo abrir el archivo (${res.status})`);
  }
  logVideo("auth:token-ok", { fileId, uid: user.uid });
  // Se usa hasta 50 minutos (el permiso vence a la hora).
  permisos.set(fileId, { url: data.url, hasta: Date.now() + 50 * 60_000 });
  return data.url;
}

/**
 * Ver un video o una foto directo desde Drive, sin pasar por el servidor de Prodi (pasar por el servidor es lo que
 * cobra Vercel por GB). Anda con los archivos compartidos por link (lo que sube Prodi). Si Drive no lo deja (archivo
 * privado, como los del chat, o un límite de Drive), el reproductor vuelve solo a getDriveMediaPlayUrl.
 */
export function urlVerDirectoDrive(fileId: string): string {
  return urlDescargaDrive(fileId);
}

/** Miniatura de Drive (chica, no baja el archivo entero). */
export function urlMiniaturaDrive(fileId: string, ancho = 400): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${ancho}`;
}

/** Link para bajar el archivo directo de Drive (el servidor revisa el acceso y deja el archivo abierto con el link). */
export async function getDriveDownloadUrl(fileId: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Necesitás estar logueado");
  const res = await fetch("/api/drive/media-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ fileId, descarga: true }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `No se pudo bajar el archivo (${res.status})`);
  return data.url;
}

/** Link público de descarga de Drive (los archivos que sube Prodi se abren con el link). */
export function urlDescargaDrive(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

/**
 * Descarga un archivo al celular o a la compu a través del servidor de Prodi (con el permiso corto de media-token).
 * No depende de que el archivo esté compartido por link en Drive: así le anda también a los clientes y contactos
 * (antes, con un archivo no compartido, les aparecía la pantalla de Google). Navega a la descarga en la misma
 * ventana: el navegador la baja sin salir de la página (en el iPhone, se abre para guardar o compartir).
 */
export async function descargarArchivo(fileId: string, nombre: string, peso?: number): Promise<void> {
  const url = await getDriveMediaPlayUrl(fileId);
  // iPhone: la descarga común se va callada a Archivos. Si no es muy pesado, menú de compartir (Guardar en Fotos/Archivos).
  if (ES_IOS && peso && peso <= MAX_COMPARTIR) {
    const res = await fetch(url);
    if (res.ok) return guardarArchivo(await res.blob(), nombre || "archivo");
  }
  const sep = url.includes("?") ? "&" : "?";
  window.location.assign(`${url}${sep}descarga=1&nombre=${encodeURIComponent(nombre || "archivo")}`);
}
