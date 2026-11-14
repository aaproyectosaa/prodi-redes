/* eslint-disable @typescript-eslint/no-explicit-any */
// Inicio de sesión y cuenta del usuario (reemplaza a Firebase Auth).
//
// POST /api/auth/login        { email, password }          → { token, uid, email, nombre }
// POST /api/auth/registrar    { email, password, nombre }  → { token, uid, email }  (queda "pendiente" hasta que el admin le dé un rol)
// POST /api/auth/yo                                         → { uid, email, nombre }  (valida la sesión guardada)
// POST /api/auth/nombre       { nombre }
// POST /api/auth/cambiar-clave { actual, nueva }            → { token }  (cierra las otras sesiones)
// POST /api/auth/usar-link    { token, nueva }              → { token, email }  (link para crear o cambiar la contraseña)
// POST /api/auth/push         { suscripcion } | { nativo: { token, plataforma } } | { quitar: endpoint | true }  (avisos push de este dispositivo)
// POST /api/auth/push-prueba  { uid? }  → prueba los avisos propios (o de otra persona, solo admin)
// POST /api/auth/push-estado  { endpoint } → { existe }  (si este equipo sigue anotado)
// POST /api/auth/pedir-baja   { motivo? }  → pide borrar la cuenta (lo exigen las tiendas): avisa a los admins

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, timingSafeEqual } from "crypto";
import { AuthError, cambiarClave, crearUsuario, iniciarSesion, tokenDeSesion, usarLinkDeClave, usuarioFresco, verificarClave, verificarSesion } from "../_lib/cuentas";
import { extractBearerToken, HttpError } from "../_lib/auth";
import { appUrl, body, requireCaller, sendError } from "../_lib/http";
import { getPool } from "../_lib/db";
import { borrarSuscripciones, existeSuscripcion, guardarSuscripcion, guardarTokenNativo, probarPush } from "../_lib/push";
import { enviarAviso } from "../_lib/notify";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Compara dos textos sin que el tiempo revele cuántas letras coinciden. */
const mismoTexto = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

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
        // La IP real la pone Vercel (x-real-ip); sirve para frenar a quien prueba muchas contraseñas.
        const ip = String(req.headers["x-real-ip"] ?? "").trim() || String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || null;
        const { token, usuario } = await iniciarSesion(String(b.email ?? ""), String(b.password ?? ""), ip);
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
      if (!mismoTexto(String(b.codigo ?? "").trim(), codigo)) {
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
      const s = await sesion(req);
      // La contraseña actual se compara con la de la base, no con lo recordado.
      const u = await usuarioFresco(s.uid);
      if (!u || u.sesion_ver !== s.sesion_ver || !(await verificarClave(String(b.actual ?? ""), u.clave_hash))) {
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
      else if (b.nativo) await guardarTokenNativo(u.uid, String(b.nativo.token ?? ""), String(b.nativo.plataforma ?? ""));
      else await guardarSuscripcion(u.uid, b.suscripcion, b.app === "chat" ? "chat" : "sistema");
      return { ok: true };
    }
    case "push-prueba": {
      // El admin puede probar los avisos de otra persona (Equipo): ve en qué equipos le llegan y en cuáles fallan.
      if (b.uid && typeof b.uid === "string") {
        await requireCaller(req, ["admin"]);
        return probarPush(b.uid);
      }
      const u = await sesion(req);
      return probarPush(u.uid);
    }
    case "push-estado": {
      // ¿El servidor todavía tiene anotado este equipo? (si el servicio de avisos lo dio de baja, se borró).
      const u = await sesion(req);
      return { existe: typeof b.endpoint === "string" && (await existeSuscripcion(u.uid, b.endpoint)) };
    }
    case "pedir-baja": {
      // Borrar la cuenta desde la app (Apple y Google lo piden). Lo hace un admin a mano (puede haber facturas o
      // trabajos en curso): le llega el aviso con quién es y el motivo, y se le confirma por mail.
      const u = await sesion(req);
      const r = await getPool().query("select data->>'nombre' as nombre, data->>'email' as email from documentos where coleccion = 'profiles' and id = $1", [u.uid]);
      const p = (r.rows[0] ?? {}) as { nombre?: string; email?: string };
      const admins = await getPool().query("select id from documentos where coleccion = 'profiles' and data->>'role' = 'admin'");
      const motivo = String(b.motivo ?? "").trim().slice(0, 300);
      await enviarAviso(
        {
          destinatarios: admins.rows.map((x: { id: string }) => x.id),
          titulo: "Pedido de baja de cuenta",
          cuerpo: `${p.nombre || "Alguien"} (${p.email || u.email || u.uid}) pidió borrar su cuenta desde la app.${motivo ? ` Motivo: ${motivo}` : ""}`,
          link: "/equipo",
          clave: `baja:${u.uid}`,
        },
        appUrl(req)
      );
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
