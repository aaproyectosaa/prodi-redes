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
