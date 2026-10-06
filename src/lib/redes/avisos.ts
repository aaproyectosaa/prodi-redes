import { auth } from "@/integrations/firebase/client";
import type { Profile, Project, ProjectTeamRole } from "@/integrations/firebase/types";
import { callApi } from "@/lib/redes/api";
import { enModoVista } from "@/lib/redes/vistaComo";

export interface Aviso {
  destinatarios: string[];
  titulo: string;
  cuerpo: string;
  /** Ruta interna a abrir (ej. /edicion?video=abc). */
  link: string;
  /** Evita duplicados: misma clave + destinatario actualiza el aviso. */
  clave: string;
  proyectoId?: string | null;
  videoId?: string | null;
}

/**
 * Envía un aviso in-app + push (+ WhatsApp si el usuario lo activó).
 * Nunca rompe el flujo: si falla, solo lo registra en consola.
 */
export async function avisar(aviso: Aviso): Promise<void> {
  if (enModoVista()) return;
  const me = auth.currentUser?.uid;
  const destinatarios = Array.from(new Set(aviso.destinatarios)).filter(
    (uid) => uid && uid !== me
  );
  if (destinatarios.length === 0) return;
  try {
    await callApi("/api/avisos", { ...aviso, destinatarios });
  } catch (err) {
    console.warn("[avisos] no se pudo enviar", aviso.clave, err);
  }
}

/** IDs asignados a un rol dentro de un cliente. */
export function equipoDe(
  project: Project | undefined,
  rol: ProjectTeamRole
): string[] {
  return project?.team_roles?.[rol] ?? [];
}

export function adminsDe(profiles: Profile[]): string[] {
  return profiles.filter((p) => p.role === "admin").map((p) => p.id);
}
