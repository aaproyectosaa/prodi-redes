// Helpers comunes para las funciones de Prodi Redes.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, requireUser, type AuthedUser } from "./auth";
import { adminDb } from "./db";

export type Rol = "pending" | "admin" | "productor" | "editor" | "pauta" | "diseno" | "administracion" | "cliente" | string;

export interface Caller extends AuthedUser {
  /** Rol principal (el que define su pantalla de inicio y su menú). */
  role: Rol;
  /** Rol principal + roles adicionales (ej. Producción que también hace Pauta). Para los permisos. */
  roles: Rol[];
  nombre: string;
}

/** Roles que se pueden sumar a una persona del equipo además del principal. */
export const ROLES_ADICIONALES: Rol[] = ["productor", "editor", "pauta", "diseno", "administracion"];
const EQUIPO_INTERNO: Rol[] = ["admin", ...ROLES_ADICIONALES];

/** Rol principal + adicionales válidos (solo el equipo interno puede sumar roles; nunca "admin"). */
export function rolesDe(role: Rol, extra: unknown): Rol[] {
  if (!EQUIPO_INTERNO.includes(role) || !Array.isArray(extra)) return [role];
  return [role, ...extra.filter((r): r is Rol => typeof r === "string" && ROLES_ADICIONALES.includes(r) && r !== role)].filter(
    (r, i, a) => a.indexOf(r) === i
  );
}

/** ¿Tiene este rol (como principal o adicional)? */
export const tieneRol = (caller: Pick<Caller, "role" | "roles">, rol: Rol) => (caller.roles ?? [caller.role]).includes(rol);

/** Valida el token y trae el rol del perfil. */
// El perfil (rol, activo) se recuerda 30 s en esta instancia: la app pregunta cada pocos segundos y así
// no va a la base en cada pedido. Un cambio de rol se nota en ≤ 30 s.
const PERFIL_TTL = 30_000;
const perfiles = new Map<string, { data: Record<string, unknown>; hasta: number }>();
export function olvidarPerfil(uid?: string) {
  if (uid) perfiles.delete(uid);
  else perfiles.clear();
}

export async function requireCaller(req: VercelRequest, roles?: Rol[]): Promise<Caller> {
  const user = await requireUser(req);
  let c = perfiles.get(user.uid);
  if (!c || c.hasta < Date.now()) {
    const snap = await adminDb().collection("profiles").doc(user.uid).get();
    c = { data: snap.exists ? snap.data() ?? {} : {}, hasta: Date.now() + PERFIL_TTL };
    if (perfiles.size > 500) perfiles.clear();
    perfiles.set(user.uid, c);
  }
  const data = c.data;
  // Solo campos propios del perfil: nunca heredados del prototipo.
  const propio = (k: string) => (Object.hasOwn(data, k) ? data[k] : undefined);
  if (propio("activo") === false) throw new HttpError(403, "Tu usuario está desactivado");
  const role = (propio("role") as Rol) ?? "pending";
  const todos = rolesDe(role, propio("roles_extra"));
  if (roles && !todos.some((r) => roles.includes(r))) {
    throw new HttpError(403, "No tenés permiso para esta acción");
  }
  return { ...user, role, roles: todos, nombre: (propio("nombre") as string) ?? "" };
}

/** El cliente todavía no tiene diseñadora asignada (team_roles.diseno vacío): lo ven todas las de diseño. */
export const sinDisenadora = (team: unknown): boolean => {
  const d = team && typeof team === "object" && !Array.isArray(team) ? (team as Record<string, unknown>).diseno : undefined;
  return !Array.isArray(d) || d.length === 0;
};

/**
 * ¿Trabaja en este cliente? Equipo: en cualquier rol de team_roles. Diseño: además, los clientes
 * sin diseñadora asignada (transición: así no se pierde ningún pedido hasta que el admin las asigne).
 */
export function trabajaEn(role: Rol | Rol[], uid: string, team: unknown): boolean {
  const lista = Array.isArray(role) ? role : [role];
  const t = team && typeof team === "object" && !Array.isArray(team) ? (team as Record<string, unknown>) : {};
  if (Object.values(t).some((ids) => Array.isArray(ids) && ids.includes(uid))) return true;
  return lista.includes("diseno") && sinDisenadora(t);
}

/** ¿El usuario está asignado a ese cliente (o es admin)? */
export async function assertProjectAccess(caller: Caller, proyectoId: string) {
  // Admin y administración no necesitan estar asignados.
  if (tieneRol(caller, "admin") || tieneRol(caller, "administracion")) return;
  const snap = await adminDb().collection("projects").doc(proyectoId).get();
  if (!snap.exists) throw new HttpError(404, "Cliente no encontrado");
  if (!trabajaEn(caller.roles ?? caller.role, caller.uid, snap.data()?.team_roles)) throw new HttpError(403, "No tenés acceso a este cliente");
}

export function sendError(res: VercelResponse, err: unknown) {
  const status = err instanceof HttpError ? err.status : 500;
  let msg = err instanceof Error ? err.message : "Error interno";
  if (status >= 500) console.error("[api]", err);
  // Detalles técnicos de la base o de la red no salen (pueden revelar tablas, columnas o direcciones internas).
  if (status >= 500 && /relation|column|syntax|constraint|duplicate key|violates|ECONN|ETIMEDOUT|getaddrinfo|password authentication|SSL|socket|pg_|sql/i.test(msg)) {
    msg = "Error interno. Probá de nuevo en un rato.";
  }
  if (!res.headersSent) res.status(status).json({ error: msg });
}

/** URL pública de la app (para links en push, mails y Mercado Pago). */
export function appUrl(req?: VercelRequest): string {
  const env = (process.env.APP_URL || process.env.VITE_APP_URL || "").replace(/\/$/, "");
  if (env) return env;
  const host = (req?.headers["x-forwarded-host"] as string) || (req?.headers.host as string) || "";
  const proto = (req?.headers["x-forwarded-proto"] as string) || "https";
  return host ? `${proto}://${host}` : "";
}

export function body<T = Record<string, unknown>>(req: VercelRequest): T {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as T;
    } catch {
      return {} as T;
    }
  }
  return (req.body ?? {}) as T;
}

export { HttpError };
