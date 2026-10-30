import { toast } from "sonner";
import { enModoVista } from "@/lib/redes/vistaComo";
import { empezarGrabacion, type ModoGrabacion } from "@/lib/redes/grabacion";
import type { Reunion } from "@/lib/redes/types";

export const EVENTO_ABRIR_GRABACION = "prodi:grabacion-abrir";

/** Abre la vista grande de la grabación en curso. */
export const abrirVistaGrabacion = () => window.dispatchEvent(new Event(EVENTO_ABRIR_GRABACION));

/** Arranca la grabación de una reunión (la sigue GrabacionEnCurso en toda la app). */
export async function grabarReunion(reunion: Pick<Reunion, "id" | "titulo" | "fecha">, clienteNombre: string, modo: ModoGrabacion) {
  if (enModoVista()) {
    toast.error("Estás en modo 'ver como': es solo lectura.");
    return false;
  }
  try {
    await empezarGrabacion({ reunionId: reunion.id, titulo: reunion.titulo, clienteNombre, fecha: reunion.fecha }, modo);
    abrirVistaGrabacion();
    return true;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    toast.error(
      /denied|permission|NotAllowed/i.test(e.message + e.name)
        ? "No diste permiso para el micrófono. Habilitalo en el candado de la barra de direcciones (o en Ajustes del celular)."
        : /en curso/.test(e.message)
          ? e.message
          : "Este navegador no permite grabar acá. Probá desde Chrome, o subí el audio."
    );
    return false;
  }
}
