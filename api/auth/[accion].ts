/* eslint-disable @typescript-eslint/no-explicit-any */
// Inicio de sesión y cuenta del usuario (reemplaza a Firebase Auth).
//
// POST /api/auth/login        { email, password }          → { token, uid, email, nombre }
// POST /api/auth/registrar    { email, password, nombre }  → { token, uid, email }  (queda "pendiente" hasta que el admin le dé un rol)
// POST /api/auth/yo                                         → { uid, email, nombre }  (valida la sesión guardada)
// POST /api/auth/nombre       { nombre }
// POST /api/auth/cambiar-clave { actual, nueva }            → { token }  (cierra las otras sesiones)
// POST /api/auth/usar-link    { token, nueva }              → { token, email }  (link para crear o cambiar la contraseña)
// POST /api/auth/push         { suscripcion } | { quitar: endpoint | true }  (avisos push de este dispositivo)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthError, cambiarClave, crearUsuario, iniciarSesion, tokenDeSesion, usarLinkDeClave, verificarClave, verificarSesion } from "../_lib/cuentas";
import { extractBearerToken, HttpError } from "../_lib/auth";
import { body, sendError } from "../_lib/http";
import { getPool } from "../_lib/db";
import { borrarSuscripciones, guardarSuscripcion } from "../_lib/push";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sesion(req: VercelRequest) {
  const u = await verificarSesion(extractBearerToken(req) ?? "");
  if (!u) throw new HttpError(401, "La sesión venció. Volvé a ingresar.");
  return u;
}

async function handlerAccion(accion: string, req: VercelRequest) {
  const b = body<Record<string, any>>(req);
  switch (accion) {
    case "login": {
      try {
        const { token, usuario } = await iniciarSesion(String(b.email ?? ""), String(b.password ?? ""));
        return { token, uid: usuario.uid, email: usuario.email, nombre: usuario.nombre };
      } catch (err) {
        await espera(400); // frena los intentos a ciegas
        throw err;
      }
    }
    case "registrar": {
      // Registrarse solo con el código de invitación del equipo (INVITATION_CODE). Sin código configurado, está cerrado.
      const codigo = process.env.INVITATION_CODE;
      if (!codigo) throw new HttpError(403, "El registro está cerrado. Pedile tu usuario al administrador.");
      if (String(b.codigo ?? "").trim() !== codigo) {
        await espera(400);
        throw new HttpError(403, "Código de invitación inválido");
      }
      const { uid, email } = await crearUsuario({ email: String(b.email ?? ""), password: String(b.password ?? ""), displayName: String(b.nombre ?? "") || null });
      return { token: tokenDeSesion({ uid, sesion_ver: 0 }), uid, email };
    }
    case "yo": {
      const u = await sesion(req);
      return { uid: u.uid, email: u.email, nombre: u.nombre };
    }
    case "nombre": {
      const u = await sesion(req);
      await getPool().query("update usuarios set nombre = $2 where uid = $1", [u.uid, String(b.nombre ?? "").slice(0, 120)]);
      return { ok: true };
    }
    case "cambiar-clave": {
      const u = await sesion(req);
      if (!(await verificarClave(String(b.actual ?? ""), u.clave_hash))) {
        await espera(400);
        throw new AuthError("auth/wrong-password", "La contraseña actual no es correcta");
      }
      return { token: await cambiarClave(u.uid, String(b.nueva ?? "")) };
    }
    case "usar-link":
      return usarLinkDeClave(String(b.token ?? ""), String(b.nueva ?? ""));
    case "push": {
      const u = await sesion(req);
      if (b.quitar) await borrarSuscripciones(u.uid, typeof b.quitar === "string" ? b.quitar : undefined);
      else await guardarSuscripcion(u.uid, b.suscripcion);
      return { ok: true };
    }
    default:
      throw new HttpError(404, "Acción desconocida");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    res.status(200).json(await handlerAccion(String(req.query.accion ?? ""), req));
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "auth/email-already-exists" ? 409 : err.code === "auth/user-disabled" ? 403 : 400;
      res.status(status).json({ error: err.message, code: err.code });
    } else sendError(res, err);
  }
}
