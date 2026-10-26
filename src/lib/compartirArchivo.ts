// Guardar un archivo en el celular. En el iPhone una descarga normal se va callada a Archivos → Descargas (sin aviso
// ni vista previa): ahí se abre el menú de compartir de iOS ("Guardar en Archivos", "Guardar imagen/video" en
// Fotos, WhatsApp…). En la compu y en Android, descarga común.

import { toast } from "sonner";

export const ES_IOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** Hasta este peso se pasa por el menú de compartir del iPhone (más grande, descarga común). */
export const MAX_COMPARTIR = 80 * 1024 ** 2;

function bajarComun(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function compartir(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file] });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return; // cerró el menú
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      // Tardó en bajar y iOS ya no lo toma como un toque: se pide otro toque.
      toast.message("Listo para guardar", {
        description: file.name,
        duration: 15_000,
        action: { label: "Guardar", onClick: () => void navigator.share({ files: [file] }).catch(() => undefined) },
      });
      return;
    }
    throw err;
  }
}

/** Guarda el archivo: en el iPhone con el menú de compartir; si no, descarga común. */
export async function guardarArchivo(blob: Blob, nombre: string): Promise<void> {
  const file = new File([blob], nombre, { type: blob.type || "application/octet-stream" });
  if (ES_IOS && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) return compartir(file);
  bajarComun(blob, nombre);
}
