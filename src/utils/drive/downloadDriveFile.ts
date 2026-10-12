import { asset } from "@/lib/asset";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";
import { downloadDriveFileBlob } from "@/utils/drive/driveApi";
import { getDriveDownloadUrl, getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";

/** Hasta este tamaño se baja por la app (con el permiso corto de media-token); más grande, directo de Drive. */
const MAX_POR_APP = 150 * 1024 * 1024;

const DRIVE_API = "https://www.googleapis.com/drive/v3";

function getPublicDownloadUrl(fileId: string): string {
  if (fileId.startsWith("demo/")) return asset(fileId); // datos de ejemplo
  // confirm=t: Drive no frena los archivos grandes con la página de "no se pudo analizar" (son públicos por link).
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

/** Guarda un blob en disco con el nombre indicado (misma origen vía blob:). */
export function saveBlobAsDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

/** Baja con el navegador (el archivo llega como adjunto: la página no se mueve). Sirve para videos de cualquier tamaño. */
function downloadViaLink(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Fallback: iframe oculto (evita bloqueo de popups en descargas públicas). */
function downloadViaHiddenFrame(url: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => {
    iframe.remove();
  }, 120_000);
}

async function downloadOneAttachment(
  att: DriveAttachmentRef,
  getAccessToken?: () => Promise<string>
): Promise<void> {
  if (getAccessToken) {
    try {
      const token = await getAccessToken();
      const blob = await downloadDriveFileBlob(att.drive_file_id, token);
      saveBlobAsDownload(blob, att.name);
      return;
    } catch (err) {
      console.warn("Descarga vía API falló, probando enlace público:", err);
    }
  }


  // Sin el acceso de Drive en el navegador: los chicos se bajan por la app (mismo origen, se guardan con su nombre)…
  if (!att.drive_file_id.startsWith("demo/") && Number(att.size) > 0 && Number(att.size) <= MAX_POR_APP) {
    try {
      const res = await fetch(await getDriveMediaPlayUrl(att.drive_file_id));
      if (res.ok) {
        saveBlobAsDownload(await res.blob(), att.name);
        return;
      }
    } catch (err) {
      console.warn("Descarga por la app falló, probando enlace de Drive:", err);
    }
  }

  // …y los grandes, directo de Drive (enlace público del archivo).
  const publicUrl = getPublicDownloadUrl(att.drive_file_id);

  try {
    const res = await fetch(publicUrl, { mode: "cors", credentials: "omit" });
    if (res.ok) {
      const blob = await res.blob();
      saveBlobAsDownload(blob, att.name);
      return;
    }
  } catch {
    // CORS habitual en Drive — iframe
  }

  downloadViaHiddenFrame(publicUrl);
}

export type DownloadProgress = {
  current: number;
  total: number;
  fileName: string;
};

/**
 * Descarga archivos uno por uno. Con token de Drive usa alt=media (fiable en todos
 * los navegadores). Sin token, intenta fetch público o iframe por archivo.
 */
export async function downloadAttachmentsSequential(
  files: DriveAttachmentRef[],
  options?: {
    getAccessToken?: () => Promise<string>;
    onProgress?: (progress: DownloadProgress) => void;
    delayMs?: number;
  }
): Promise<void> {
  // Un respiro entre archivos: si no, el navegador puede saltearse alguno.
  const delayMs = options?.delayMs ?? 1200;

  // El equipo (sin la llave de Drive): la descarga arranca EN el toque, directo de Drive (videos y fotos de cualquier
  // tamaño). En el celular, si se espera al servidor antes, el navegador la bloquea sin avisar. Los archivos que sube
  // Prodi ya se abren con el link; igual se le pide al servidor que lo asegure (revisa que la persona tenga acceso).
  if (!options?.getAccessToken && files.length && files.every((f) => !f.drive_file_id.startsWith("demo/"))) {
    for (const f of files) void getDriveDownloadUrl(f.drive_file_id).catch(() => undefined);
    for (let i = 0; i < files.length; i++) {
      options?.onProgress?.({ current: i + 1, total: files.length, fileName: files[i].name });
      downloadViaLink(getPublicDownloadUrl(files[i].drive_file_id));
      if (i < files.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return;
  }

  for (let i = 0; i < files.length; i++) {
    const att = files[i];
    options?.onProgress?.({
      current: i + 1,
      total: files.length,
      fileName: att.name,
    });

    await downloadOneAttachment(att, options?.getAccessToken);

    if (i < files.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
