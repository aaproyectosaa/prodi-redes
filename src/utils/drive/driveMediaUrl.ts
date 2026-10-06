// URL autenticada para reproducir archivos de Drive en <video>.
// El token va en query porque el elemento video no puede enviar headers.

import { auth } from "@/integrations/firebase/client";
import { logVideo } from "@/utils/drive/videoDebug";

export async function getDriveMediaPlayUrl(fileId: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    logVideo("auth:missing", { fileId });
    throw new Error("Necesitás estar logueado");
  }
  const idToken = await user.getIdToken();
  logVideo("auth:token-ok", { fileId, uid: user.uid });
  return `/api/drive/media?fileId=${encodeURIComponent(fileId)}&token=${encodeURIComponent(idToken)}`;
}
