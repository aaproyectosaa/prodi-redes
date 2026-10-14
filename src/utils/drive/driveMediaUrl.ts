// URL para reproducir archivos de Drive en <video>.
// El elemento video no puede enviar headers: el servidor da un permiso corto (1 hora)
// solo para ese archivo, y la sesión nunca va en la URL.

import { auth } from "@/integrations/firebase/client";
import { logVideo } from "@/utils/drive/videoDebug";

export async function getDriveMediaPlayUrl(fileId: string): Promise<string> {
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
  return data.url;
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
export async function descargarArchivo(fileId: string, nombre: string): Promise<void> {
  const url = await getDriveMediaPlayUrl(fileId);
  const sep = url.includes("?") ? "&" : "?";
  window.location.assign(`${url}${sep}descarga=1&nombre=${encodeURIComponent(nombre || "archivo")}`);
}
