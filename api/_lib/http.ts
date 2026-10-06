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
  if (data.activo === false) throw new HttpError(403, "Tu usuario está desactivado");
  const role = (data.role as Rol) ?? "pending";
  if (roles && !roles.includes(role)) {
    throw new HttpError(403, "No tenés permiso para esta acción");
  }
  return { ...user, role, nombre: (data.nombre as string) ?? "" };
}

/** ¿El usuario está asignado a ese cliente (o es admin)? */
export async function assertProjectAccess(caller: Caller, proyectoId: string) {
  // Admin y diseño (hace la gráfica de todos los clientes) no necesitan estar asignados.
  if (caller.role === "admin" || caller.role === "diseno" || caller.role === "administracion") return;
  const snap = await adminDb().collection("projects").doc(proyectoId).get();
  if (!snap.exists) throw new HttpError(404, "Cliente no encontrado");
  const team = (snap.data()?.team_roles ?? {}) as Record<string, string[]>;
  const ok = Object.values(team).some((ids) => (ids ?? []).includes(caller.uid));
  if (!ok) throw new HttpError(403, "No tenés acceso a este cliente");
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
