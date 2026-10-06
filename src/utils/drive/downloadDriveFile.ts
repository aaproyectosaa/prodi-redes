import { asset } from "@/lib/asset";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";
import { downloadDriveFileBlob } from "@/utils/drive/driveApi";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

function getPublicDownloadUrl(fileId: string): string {
  if (fileId.startsWith("demo/")) return asset(fileId); // datos de ejemplo
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
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

  const publicUrl =
    att.web_content_link ?? getPublicDownloadUrl(att.drive_file_id);

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
  const delayMs = options?.delayMs ?? 350;

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
