import { useEffect, useState } from "react";
import { toast } from "sonner";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { callApi } from "./api";
import { assertEditable } from "./vistaComo";
import { subirASesion } from "@/utils/drive/driveApi";

// Fotos y videos del CRM para mandarle a un contacto: los que sube el cliente (crm_galeria) y los que hizo Prodi
// (videos terminados y piezas). Al mandarlos se arma un link público (/v/<token>) que se pega en el mensaje.

export interface ArchivoGaleria {
  id: string;
  proyecto_id: string;
  titulo: string;
  archivo: { drive_file_id: string; name: string; mime_type: string; size: number };
  subido_por: string;
  creado_at: string;
}

export const GALERIA_MAX_MB = 200;
const ACEPTA = /^(video\/(mp4|quicktime|webm|x-m4v)|image\/(png|jpeg|webp|gif))$/;

export function useGaleria(proyectoId: string | undefined) {
  const [lista, setLista] = useState<ArchivoGaleria[] | null>(null);
  useEffect(() => {
    if (!proyectoId) return;
    return onSnapshot(
      query(collection(db, "crm_galeria"), where("proyecto_id", "==", proyectoId)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ArchivoGaleria, "id">) })).sort((a, b) => b.creado_at.localeCompare(a.creado_at))),
      () => setLista([])
    );
  }, [proyectoId]);
  return lista;
}

/** Sube fotos o videos a su galería. onProgreso: 0 a 100 del archivo que va subiendo. */
export async function subirGaleria(proyectoId: string, files: File[], onProgreso?: (nombre: string, pct: number) => void) {
  assertEditable();
  let ok = 0;
  for (const f of files.slice(0, 10)) {
    const mime = (f.type || "").toLowerCase() === "video/mov" ? "video/quicktime" : (f.type || "").toLowerCase();
    if (!ACEPTA.test(mime)) {
      toast.error(`“${f.name}”: solo fotos (JPG, PNG, WEBP) o videos (MP4, MOV)`);
      continue;
    }
    if (f.size > GALERIA_MAX_MB * 1024 * 1024) {
      toast.error(`“${f.name}” pesa más de ${GALERIA_MAX_MB} MB`);
      continue;
    }
    try {
      const { subida, url } = await callApi<{ subida: string; url: string }>("/api/drive/crm-subida", { proyecto_id: proyectoId, nombre: f.name, mime, size: f.size });
      let errSubida: unknown = null;
      try {
        await subirASesion({ sessionUri: url, file: f, mime, onProgress: (p) => onProgreso?.(f.name, Math.min(99, p)) });
      } catch (e) {
        // A veces el navegador no deja leer la última respuesta de Drive aunque el archivo subió: se confirma igual.
        errSubida = e;
      }
      try {
        await callApi("/api/drive/crm-archivo", { proyecto_id: proyectoId, subida });
      } catch (e) {
        throw errSubida ?? e;
      }
      ok++;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `No se pudo subir “${f.name}”`);
    }
  }
  if (ok) toast.success(ok === 1 ? "Listo, ya está en tu galería" : `${ok} archivos subidos a tu galería`);
}

export async function borrarDeGaleria(a: ArchivoGaleria) {
  assertEditable();
  await deleteDoc(doc(db, "crm_galeria", a.id));
}

/** El link público para mandarle ese archivo a un contacto. */
export async function linkParaMandar(proyectoId: string, fileId: string): Promise<string> {
  const { url } = await callApi<{ url: string }>("/api/drive/crm-compartir", { proyecto_id: proyectoId, file_id: fileId });
  return url;
}
