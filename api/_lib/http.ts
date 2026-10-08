// Helpers comunes para las funciones de Prodi Redes.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, requireUser, type AuthedUser } from "./auth";
import { adminDb } from "./db";

export type Rol = "pending" | "admin" | "productor" | "editor" | "pauta" | "diseno" | "administracion" | "cliente" | string;

export interface Caller extends AuthedUser {
  role: Rol;
  nombre: string;
}

/** Valida el token y trae el rol del perfil. */
export async function requireCaller(req: VercelRequest, roles?: Rol[]): Promise<Caller> {
  const user = await requireUser(req);
  const snap = await adminDb().collection("profiles").doc(user.uid).get();
  const data = snap.exists ? snap.data() ?? {} : {};
  // Solo campos propios del perfil: nunca heredados del prototipo.
  const propio = (k: string) => (Object.hasOwn(data, k) ? data[k] : undefined);
  if (propio("activo") === false) throw new HttpError(403, "Tu usuario está desactivado");
  const role = (propio("role") as Rol) ?? "pending";
  if (roles && !roles.includes(role)) {
    throw new HttpError(403, "No tenés permiso para esta acción");
  }
  return { ...user, role, nombre: (propio("nombre") as string) ?? "" };
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
export function trabajaEn(role: Rol, uid: string, team: unknown): boolean {
  const t = team && typeof team === "object" && !Array.isArray(team) ? (team as Record<string, unknown>) : {};
  if (Object.values(t).some((ids) => Array.isArray(ids) && ids.includes(uid))) return true;
  return role === "diseno" && sinDisenadora(t);
}

/** ¿El usuario está asignado a ese cliente (o es admin)? */
export async function assertProjectAccess(caller: Caller, proyectoId: string) {
  // Admin y administración no necesitan estar asignados.
  if (caller.role === "admin" || caller.role === "administracion") return;
  const snap = await adminDb().collection("projects").doc(proyectoId).get();
  if (!snap.exists) throw new HttpError(404, "Cliente no encontrado");
  if (!trabajaEn(caller.role, caller.uid, snap.data()?.team_roles)) throw new HttpError(403, "No tenés acceso a este cliente");
}

export function sendError(res: VercelResponse, err: unknown) {
  const status = err instanceof HttpError ? err.status : 500;
  const msg = err instanceof Error ? err.message : "Error interno";
  if (status >= 500) console.error("[api]", err);
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
