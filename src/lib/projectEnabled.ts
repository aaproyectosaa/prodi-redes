import type { Project } from "@/integrations/firebase/types";

/**
 * Proyectos habilitados (default). Si `enabled` falta en docs viejos, se trata como true.
 * Deshabilitar no borra datos: solo oculta el proyecto y sus tareas en la app.
 */
export function isProjectEnabled(
  project: Pick<Project, "enabled"> | null | undefined
): boolean {
  if (!project) return false;
  return project.enabled !== false;
}

export function getEnabledProjects<T extends Pick<Project, "enabled">>(
  projects: T[]
): T[] {
  return projects.filter(isProjectEnabled);
}

export function getEnabledProjectIds(
  projects: Array<Pick<Project, "id" | "enabled">>
): Set<string> {
  return new Set(
    projects.filter(isProjectEnabled).map((p) => p.id)
  );
}

/** Tareas cuyo proyecto está habilitado (sin proyecto → se ocultan). */
export function filterTasksByEnabledProjects<
  T extends { proyecto_id: string | null },
>(tasks: T[], projects: Array<Pick<Project, "id" | "enabled">>): T[] {
  const enabledIds = getEnabledProjectIds(projects);
  return tasks.filter(
    (t) => !!t.proyecto_id && enabledIds.has(t.proyecto_id)
  );
}
