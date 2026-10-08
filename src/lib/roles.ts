import type { Project, UserRole } from "@/integrations/firebase/types";

/**
 * Roles de Prodi Redes (modelo videos comerciales + pauta).
 *
 * - admin      → super admin (dueño): ve todo y configura todo.
 * - productor  → producción: clientes, planificación, rodajes, sube crudo y
 *                hace la revisión interna antes del cliente.
 * - editor     → edita los videos.
 * - pauta      → sube los videos aprobados a las redes y maneja la pauta.
 * - diseno     → diseño gráfico: arma las piezas de sus clientes (los asignados en la ficha y los sin diseñadora).
 * - administracion → facturación, cobros, pagos al equipo y gastos.
 * - cliente    → aprueba videos, ve resultados y pide piezas con IA.
 */
export interface RoleInfo {
  value: UserRole;
  label: string;
  description: string;
}

export const ROLES: RoleInfo[] = [
  {
    value: "admin",
    label: "Super admin",
    description: "Acceso total: tablero, clientes, planes, equipo y cobros.",
  },
  {
    value: "productor",
    label: "Producción",
    description:
      "Planifica con el cliente, agenda rodajes, filma, sube el crudo y revisa antes del cliente.",
  },
  {
    value: "editor",
    label: "Edición",
    description: "Edita los videos y los entrega para revisión.",
  },
  {
    value: "pauta",
    label: "Pauta",
    description: "Sube los videos aprobados a las redes, los pauta y carga resultados.",
  },
  {
    value: "diseno",
    label: "Diseño",
    description: "Arma las piezas gráficas de sus clientes (redes y cartelería), con la IA como ayuda.",
  },
  {
    value: "administracion",
    label: "Administración",
    description: "Facturación del mes, cobros, pagos al equipo, gastos y números del negocio. No ve la producción.",
  },
  {
    value: "cliente",
    label: "Cliente",
    description: "Aprueba los videos, ve resultados y pide piezas gráficas.",
  },
];

export const PENDING_ROLE: RoleInfo = {
  value: "pending",
  label: "Sin rol",
  description: "Usuario nuevo o con un rol del sistema anterior. Asignale un rol.",
};

/** Roles del modelo anterior que ya no existen. */
export const LEGACY_ROLES: UserRole[] = ["cm", "pm", "disenador"];

export const LEGACY_LABELS: Partial<Record<UserRole, string>> = {
  cm: "Community Manager (rol anterior)",
  pm: "Project Manager (rol anterior)",
  disenador: "Diseñador (rol anterior)",
};

/** Normaliza: los roles viejos se tratan como pendientes. */
export function normalizeRole(role: UserRole | undefined | null): UserRole {
  if (!role) return "pending";
  if (LEGACY_ROLES.includes(role)) return "pending";
  return role;
}

export const getRoleInfo = (role: UserRole | undefined): RoleInfo => {
  if (role && LEGACY_LABELS[role]) {
    return { ...PENDING_ROLE, label: LEGACY_LABELS[role]! };
  }
  if (role === "contacto") return CONTACTO_ROLE;
  return ROLES.find((r) => r.value === role) ?? PENDING_ROLE;
};

/**
 * Contacto de un cliente que usa solo Prodi Chat (no entra al sistema). Pertenece a un cliente (profile.proyecto_id).
 * No está en ROLES: no se asigna desde Equipo, lo crean el super admin o la producción del cliente desde su ficha.
 */
export const CONTACTO_ROLE: RoleInfo = {
  value: "contacto",
  label: "Contacto (solo chat)",
  description: "Persona de un cliente que usa solo Prodi Chat: chatea con el equipo asignado y con la gente de su empresa.",
};

export const esContacto = (role: UserRole | string | undefined | null) => role === "contacto";

/** Roles internos del equipo (no clientes). */
export const TEAM_ROLES: UserRole[] = ["admin", "productor", "editor", "pauta", "diseno", "administracion"];

/** Ve y maneja la plata: facturación, cobros, pagos al equipo y gastos. */
export function canManageFinanzas(role: UserRole | undefined): boolean {
  return role === "admin" || role === "administracion";
}

export function isTeamRole(role: UserRole | undefined): boolean {
  return !!role && TEAM_ROLES.includes(role);
}

/** Puede gestionar clientes, planificar y revisar (admin + producción). */
export function canManageProduction(role: UserRole | undefined): boolean {
  return role === "admin" || role === "productor";
}

/** Pantalla de inicio de cada rol. */
export const defaultRouteForRole = (role: UserRole | undefined): string => {
  switch (normalizeRole(role)) {
    case "admin":
      return "/tablero";
    case "productor":
    case "editor":
    case "pauta":
      return "/videos";
    case "diseno":
      return "/piezas";
    case "administracion":
      return "/administracion";
    case "cliente":
      return "/cliente";
    case "contacto":
      return "/chat-app";
    default:
      return "/auth";
  }
};

/** El cliente todavía no tiene diseñadora asignada en su ficha: lo ven todas las de diseño (igual que api/_lib/http.ts). */
export const sinDisenadora = (p: Pick<Project, "team_roles"> | undefined | null): boolean => !p?.team_roles?.diseno?.length;

/**
 * ¿Trabaja en este cliente? En cualquier rol de su equipo; diseño, también en los clientes sin diseñadora
 * (igual que trabajaEn en api/_lib/http.ts y las reglas del servidor).
 */
export function trabajaEnCliente(role: UserRole | string | undefined | null, uid: string | undefined | null, p: Pick<Project, "team_roles">): boolean {
  if (!uid) return false;
  if (Object.values(p.team_roles ?? {}).some((ids) => Array.isArray(ids) && ids.includes(uid))) return true;
  return role === "diseno" && sinDisenadora(p);
}
