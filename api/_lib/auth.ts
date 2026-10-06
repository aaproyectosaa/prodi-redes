// Valida la sesión del usuario (token "Bearer" que guarda la app al iniciar sesión).

import type { VercelRequest } from "@vercel/node";
import { verificarSesion } from "./cuentas";

export interface AuthedUser {
  uid: string;
  email?: string;
}

export function extractBearerToken(req: VercelRequest): string | null {
  const header =
    (req.headers.authorization as string | undefined) ??
    (req.headers.Authorization as string | undefined);
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match) return match[1];
  }
  const queryToken = req.query?.token;
  if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;
  return null;
}

export async function requireUser(req: VercelRequest): Promise<AuthedUser> {
  const token = extractBearerToken(req);
  if (!token) throw new HttpError(401, "Falta iniciar sesión");
  const u = await verificarSesion(token);
  if (!u) throw new HttpError(401, "La sesión venció. Volvé a ingresar.");
  return { uid: u.uid, email: u.email };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
