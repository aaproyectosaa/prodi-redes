/* eslint-disable @typescript-eslint/no-explicit-any */
// Gestión de usuarios (solo super admin).
// POST /api/usuarios/racha → racha de respuestas a los clientes (la propia; el admin, la de todos y por cliente)
// POST /api/usuarios/crear       { nombre, email, rol, clientes?: string[], password? }
// POST /api/usuarios/editar      { uid, nombre?, email?, rol?, clientes?: string[] }
// POST /api/usuarios/desactivar  { uid, activo: boolean }
// POST /api/usuarios/eliminar    { uid }
// POST /api/usuarios/clave       { uid }  → link para que la persona elija contraseña
// POST /api/usuarios/ejemplo-cargar  → carga los datos de ejemplo (mismos de la demo)
// POST /api/usuarios/ejemplo-borrar  → los borra
// POST /api/usuarios/chat-borrar    { chat_id } → borra un grupo con sus mensajes (el del equipo o de un cliente queda dado de baja)
// Contactos (solo chat), super admin o producción asignada al cliente:
// POST /api/usuarios/contacto-crear   { proyecto_id, nombre, email, telefono?, cargo?, password?, acceso? } → { uid, link, mail } o { uid, password }
//   Con password (solo super admin): queda con esa contraseña y no se manda invitación. acceso "sistema" (solo super
//   admin): entra al panel del cliente como un usuario más de la empresa; "chat" (el de siempre): solo Prodi Chat.
// POST /api/usuarios/contacto-clave   { uid, password } → el super admin le pone la contraseña (cierra sus sesiones)
// POST /api/usuarios/contacto-activo  { uid, activo }  → (des)activa y lo saca/suma al grupo del cliente
// POST /api/usuarios/contacto-invitar { uid }          → link nuevo para crear la contraseña (y lo manda por mail)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { FieldValue } from "../_lib/db";
import { adminDb } from "../_lib/db";
import { adminAuth, cambiarClave, crearUsuario, linkDeClave, usuarioFresco, validarClave } from "../_lib/cuentas";
import { appUrl, body, HttpError, olvidarPerfil, requireCaller, rolesDe, sendError, type Caller } from "../_lib/http";
import { enviarMailsLote } from "../_lib/informe";
import { mailAvisoHtml } from "../_lib/mail-aviso";
import { borrarEjemplo, cargarEjemplo } from "../_lib/ejemplo";
import { anotarMinuto, anotarMinutosPasados, nuevoToken, resumenTiempo, tieneToken, uidDelToken } from "../_lib/mi-tiempo";
import { rachaVacia, rachasDeRespuesta } from "../_lib/racha";
import { avisarAdmin, comisionEstandar, configValida } from "../_lib/socios";

export const config = { maxDuration: 60 };

const ROLES = ["admin", "productor", "editor", "pauta", "diseno", "administracion", "programador", "ventas", "socio", "cliente", "pending"];
const ROL_EN_CLIENTE: Record<string, string> = { productor: "productor", editor: "editor", pauta: "pauta", diseno: "diseno", cliente: "cliente" };

/**
 * Deja a la persona exactamente en esos clientes, en todos sus roles (el principal y los adicionales):
 * ej. Producción + Pauta queda como productora y como pauta en cada uno de esos clientes.
 */
async function asignarClientes(uid: string, rol: string | string[], clientes: string[]) {
  const db = adminDb();
  const projects = await db.collection("projects").get();
  const batch = db.batch();
  const campos = new Set((Array.isArray(rol) ? rol : [rol]).map((r) => ROL_EN_CLIENTE[r]).filter(Boolean));
  for (const p of projects.docs) {
    // Los clientes dados de baja no se tocan (no aparecen en la pantalla de edición).
    if (p.data().enabled === false && clientes.length > 0) continue;
    const team = (p.data().team_roles ?? {}) as Record<string, string[]>;
    const updates: Record<string, unknown> = {};
    // Se saca de los roles que ya no tiene y de los clientes que no están elegidos.
    for (const [k, ids] of Object.entries(team)) {
      if ((ids ?? []).includes(uid) && (!campos.has(k) || !clientes.includes(p.id))) {
        updates[`team_roles.${k}`] = FieldValue.arrayRemove(uid);
      }
    }
    for (const campo of campos) {
      if (clientes.includes(p.id) && !(team[campo] ?? []).includes(uid)) {
        updates[`team_roles.${campo}`] = FieldValue.arrayUnion(uid);
      }
    }
    if (Object.keys(updates).length) batch.update(p.ref, updates);
  }
  await batch.commit();
}

/** Roles adicionales válidos para ese rol principal (solo el equipo interno; nunca admin ni el mismo principal). */
const extrasValidos = (rol: string, extra: unknown): string[] => rolesDe(rol, extra).filter((r) => r !== rol);

async function crear(req: VercelRequest) {
  const b = body<{ nombre?: string; email?: string; rol?: string; roles_extra?: string[]; clientes?: string[]; password?: string; socio?: unknown }>(req);
  const nombre = String(b.nombre ?? "").trim();
  const email = String(b.email ?? "").trim().toLowerCase();
  const rol = String(b.rol ?? "");
  if (!nombre || !/.+@.+\..+/.test(email) || !(ROLES.includes(rol) || rol === "contacto")) throw new HttpError(400, "Completá nombre, mail y rol");
  const password = b.password && b.password.length >= 6 ? b.password : `Prodi-${crypto.randomBytes(4).toString("hex")}`;
  // Socio comercial (principal o adicional): su código y su comisión, validados antes de crear la cuenta.
  const esSocioNuevo = rol === "socio" || extrasValidos(rol, b.roles_extra).includes("socio");
  const socio = esSocioNuevo ? await configValida(b.socio) : null;
  let user;
  try {
    user = await adminAuth().createUser({ email, password, displayName: nombre });
  } catch (err: any) {
    if (err?.code === "auth/email-already-exists") throw new HttpError(409, "Ya existe un usuario con ese mail");
    throw err;
  }
  await adminDb().collection("profiles").doc(user.uid).set({
    nombre,
    email,
    role: rol,
    roles_extra: extrasValidos(rol, b.roles_extra),
    ...(socio ? { socio } : {}),
    activo: true,
    created_at: new Date().toISOString(),
  });
  if (socio && (!socio.comision_pct || !socio.meses) && !(await comisionEstandar()))
    await avisarAdmin(`Falta la comisión de ${nombre}`, "Cargale el porcentaje y los meses (o una comisión estándar en CRM → Vendedores): sin eso no se le calcula comisión.", "/equipo", `socio-config:${user.uid}`, appUrl(req));
  if (b.clientes?.length) await asignarClientes(user.uid, [rol, ...extrasValidos(rol, b.roles_extra)], b.clientes);
  return { ok: true, uid: user.uid, password };
}

async function editar(req: VercelRequest, adminUid: string) {
  const b = body<{ uid?: string; nombre?: string; email?: string; rol?: string; roles_extra?: string[]; clientes?: string[]; socio?: unknown }>(req);
  if (!b.uid) throw new HttpError(400, "Falta uid");
  if (b.uid === adminUid && b.rol && b.rol !== "admin") throw new HttpError(409, "No te podés sacar el rol de super admin a vos mismo");
  const ref = adminDb().collection("profiles").doc(b.uid);
  const prev = (await ref.get()).data() ?? {};
  const patch: Record<string, unknown> = {};
  if (b.nombre?.trim()) patch.nombre = b.nombre.trim();
  if (b.rol) {
    // "contacto" desde Equipo = solo chat, sin cliente: entra solo a los grupos donde lo sume el super admin.
    // (Los contactos de un cliente se crean desde su ficha y conservan su cliente.)
    if (!ROLES.includes(b.rol) && b.rol !== "contacto") throw new HttpError(400, "Rol inválido");
    patch.role = b.rol;
  }
  if (b.email && b.email.trim().toLowerCase() !== prev.email) {
    const email = b.email.trim().toLowerCase();
    await adminAuth().updateUser(b.uid, { email });
    patch.email = email;
  }
  const rolFinal = (patch.role as string) ?? String(prev.role ?? "");
  // Roles adicionales: los que vienen (o los que tenía), siempre válidos para el rol principal.
  const extras = extrasValidos(rolFinal, b.roles_extra !== undefined ? b.roles_extra : prev.roles_extra);
  if (b.roles_extra !== undefined || patch.role) patch.roles_extra = extras;
  // Socio comercial: su código y comisión (si deja de ser socio, la configuración queda guardada por si vuelve).
  if ((rolFinal === "socio" || extras.includes("socio")) && b.socio !== undefined) {
    patch.socio = await configValida(b.socio, b.uid);
    const s = patch.socio as { comision_pct: number | null; meses: number | null };
    if ((!s.comision_pct || !s.meses) && !(await comisionEstandar()))
      await avisarAdmin(`Falta la comisión de ${String(patch.nombre ?? prev.nombre ?? "un vendedor")}`, "Cargale el porcentaje y los meses (o una comisión estándar en CRM → Vendedores): sin eso no se le calcula comisión.", "/equipo", `socio-config:${b.uid}`, appUrl(req));
  }
  if (patch.nombre) await adminAuth().updateUser(b.uid, { displayName: patch.nombre as string }).catch(() => undefined);
  if (Object.keys(patch).length) await ref.set(patch, { merge: true });
  if (Object.keys(patch).length) olvidarPerfil(b.uid);
  if (b.clientes) await asignarClientes(b.uid, [rolFinal, ...extras], b.clientes);
  return { ok: true };
}

async function desactivar(req: VercelRequest, adminUid: string) {
  const b = body<{ uid?: string; activo?: boolean }>(req);
  if (!b.uid) throw new HttpError(400, "Falta uid");
  if (b.uid === adminUid) throw new HttpError(409, "No te podés desactivar a vos mismo");
  await adminAuth().updateUser(b.uid, { disabled: !b.activo });
  if (!b.activo) await adminAuth().revokeRefreshTokens(b.uid);
  await adminDb().collection("profiles").doc(b.uid).set({ activo: !!b.activo }, { merge: true });
  // Desactivado: deja de figurar en el equipo de todos los clientes (y, con eso, en sus grupos de chat).
  if (!b.activo) await asignarClientes(b.uid, "", []);
  return { ok: true };
}

async function eliminar(req: VercelRequest, adminUid: string) {
  const b = body<{ uid?: string }>(req);
  if (!b.uid) throw new HttpError(400, "Falta uid");
  if (b.uid === adminUid) throw new HttpError(409, "No te podés eliminar a vos mismo");
  const db = adminDb();
  await asignarClientes(b.uid, "", []);
  // Sacarlo de los grupos de chat.
  const chats = await db.collection("chats").where("miembros", "array-contains", b.uid).get();
  const batch = db.batch();
  chats.docs.forEach((c) =>
    batch.update(
      c.ref,
      c.data()?.tipo === "grupo"
        ? { miembros: FieldValue.arrayRemove(b.uid), admins: FieldValue.arrayRemove(b.uid) }
        : c.data()?.tipo === "cliente"
          ? { miembros: FieldValue.arrayRemove(b.uid), contactos: FieldValue.arrayRemove(b.uid) }
          : { miembros: FieldValue.arrayRemove(b.uid) }
    )
  );
  batch.delete(db.collection("profiles").doc(b.uid));
  batch.delete(db.collection("avatares").doc(b.uid));
  await batch.commit();
  await adminAuth()
    .deleteUser(b.uid)
    .catch((err: any) => {
      if (err?.code !== "auth/user-not-found") throw err;
    });
  return { ok: true };
}

async function clave(req: VercelRequest) {
  const b = body<{ uid?: string }>(req);
  if (!b.uid) throw new HttpError(400, "Falta uid");
  const u = await adminAuth().getUser(b.uid);
  if (!u.email) throw new HttpError(409, "El usuario no tiene mail");
  const link = await adminAuth().generatePasswordResetLink(u.email, { url: `${appUrl(req)}/auth` });
  return { ok: true, link };
}

// ---------------------------------------------------------------------------
// Contactos (solo chat): gente de un cliente que usa solo Prodi Chat. Los crean el super admin o la producción
// asignada a ese cliente, desde su ficha.
// ---------------------------------------------------------------------------

/** Puede manejar los contactos de este cliente: super admin o productor asignado. Devuelve el cliente. */
async function clienteParaContactos(caller: Caller, proyectoId: unknown) {
  if (typeof proyectoId !== "string" || !proyectoId) throw new HttpError(400, "Falta el cliente");
  const snap = await adminDb().collection("projects").doc(proyectoId).get();
  if (!snap.exists) throw new HttpError(404, "Cliente no encontrado");
  const p = snap.data() ?? {};
  if (caller.role !== "admin") {
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    if (!caller.roles.includes("productor") || !Object.values(team).some((ids) => (ids ?? []).includes(caller.uid)))
      throw new HttpError(403, "Solo el super admin o la producción de este cliente");
  }
  return { id: proyectoId, nombre: String(p.nombre ?? "") };
}

/** Lo suma (o lo saca) del grupo del cliente, marcado como contacto (o como gente del cliente, con acceso al sistema). */
async function grupoDelCliente(proyectoId: string, uid: string, nombre: string, adentro: boolean, comoContacto = true) {
  const ref = adminDb().collection("chats").doc(`cliente_${proyectoId}`);
  const chat = await ref.get();
  // Si el grupo todavía no existe, lo arma el super admin al abrir la app (sincronizarChats ya los incluye).
  if (!chat.exists) return;
  await ref.update(
    adentro
      ? { miembros: FieldValue.arrayUnion(uid), ...(comoContacto ? { contactos: FieldValue.arrayUnion(uid) } : {}), [`nombres.${uid}`]: nombre }
      : { miembros: FieldValue.arrayRemove(uid), contactos: FieldValue.arrayRemove(uid) }
  );
}

/** La contraseña que pone el super admin: mismas reglas que al elegirla uno. */
function claveValida(clave: unknown): string {
  try {
    validarClave(String(clave ?? ""));
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Contraseña inválida");
  }
  return String(clave);
}

/** Link para que elija su contraseña: entra directo a Prodi Chat. */
const linkContacto = async (uid: string, req: VercelRequest) =>
  (await linkDeClave(uid, appUrl(req))).replace("/auth?clave=", "/chat-app/ingresar?clave=");

async function invitarContacto(email: string, nombre: string, cliente: string, link: string, req: VercelRequest) {
  const enviados = await enviarMailsLote([
    {
      to: email,
      asunto: "Te sumaron a Prodi Chat",
      html: mailAvisoHtml({
        titulo: "Te sumaron a Prodi Chat",
        cuerpo: `Vas a poder chatear con el equipo de Prodi${cliente ? ` que trabaja con ${cliente}` : ""}.\nTocá el botón para crear tu contraseña (el link vence en 3 días). Después podés instalar Prodi Chat en el celular.`,
        link,
        baseUrl: appUrl(req),
        nombre,
      }),
    },
  ]);
  return enviados > 0;
}

async function contactoCrear(req: VercelRequest, caller: Caller) {
  const b = body<{ proyecto_id?: string; nombre?: string; email?: string; telefono?: string; cargo?: string; password?: string; acceso?: string }>(req);
  const cliente = await clienteParaContactos(caller, b.proyecto_id);
  const nombre = String(b.nombre ?? "").trim().slice(0, 80);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!nombre) throw new HttpError(400, "Completá el nombre");
  // El mail mal escrito (ej. "@hotmailcom", sin el punto): que se entienda qué está mal.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    throw new HttpError(400, email.includes("@") ? `Revisá el mail: “${email}” no está completo (¿falta el punto, como en @hotmail.com?)` : "Revisá el mail: le falta la @");
  const sistema = b.acceso === "sistema";
  const conClave = !!b.password;
  // Poner la contraseña o dar acceso al sistema: solo el super admin (nadie más del equipo puede entrar como el cliente).
  if ((sistema || conClave) && caller.role !== "admin") throw new HttpError(403, "Solo el super admin puede poner la contraseña o dar acceso al sistema");
  const password = conClave ? claveValida(b.password) : null;
  let user;
  try {
    user = await crearUsuario({ email, displayName: nombre, password });
  } catch (err: any) {
    if (err?.code === "auth/email-already-exists") throw new HttpError(409, "Ya existe un usuario con ese mail");
    throw err;
  }
  await adminDb()
    .collection("profiles")
    .doc(user.uid)
    .set({
      nombre,
      email,
      role: sistema ? "cliente" : "contacto",
      proyecto_id: cliente.id,
      telefono: String(b.telefono ?? "").trim().slice(0, 40) || null,
      cargo: String(b.cargo ?? "").trim().slice(0, 80) || null,
      activo: true,
      creado_por: caller.uid,
      created_at: new Date().toISOString(),
    });
  // Con acceso al sistema es uno más del cliente (ve sus videos, aprueba, etc.).
  if (sistema) await asignarClientes(user.uid, "cliente", [cliente.id]);
  await grupoDelCliente(cliente.id, user.uid, nombre, true, !sistema);
  // Con contraseña puesta: se le pasan el usuario y la contraseña, no hace falta invitación.
  if (password) return { ok: true, uid: user.uid, password, acceso: sistema ? "sistema" : "chat" };
  const link = sistema ? await linkDeClave(user.uid, appUrl(req)) : await linkContacto(user.uid, req);
  const mail = await invitarContacto(email, nombre, cliente.nombre, link, req);
  return { ok: true, uid: user.uid, link, mail, acceso: sistema ? "sistema" : "chat" };
}

/** El super admin le pone la contraseña a un integrante de un cliente (contacto o usuario del cliente). */
async function contactoClave(req: VercelRequest, caller: Caller) {
  if (caller.role !== "admin") throw new HttpError(403, "Solo el super admin");
  const b = body<{ uid?: string; password?: string }>(req);
  if (!b.uid) throw new HttpError(400, "Falta el usuario");
  const p = (await adminDb().collection("profiles").doc(b.uid).get()).data();
  if (!p || !["contacto", "cliente"].includes(String(p.role))) throw new HttpError(404, "Solo para gente de un cliente");
  const password = claveValida(b.password);
  await cambiarClave(b.uid, password);
  return { ok: true, password };
}

async function contactoDe(req: VercelRequest, caller: Caller) {
  const b = body<{ uid?: string; activo?: boolean }>(req);
  if (!b.uid) throw new HttpError(400, "Falta el contacto");
  const p = (await adminDb().collection("profiles").doc(b.uid).get()).data();
  if (!p || p.role !== "contacto") throw new HttpError(404, "No es un contacto");
  const cliente = await clienteParaContactos(caller, p.proyecto_id);
  return { b, p, cliente, uid: b.uid };
}

async function contactoActivo(req: VercelRequest, caller: Caller) {
  const { b, p, cliente, uid } = await contactoDe(req, caller);
  const activo = !!b.activo;
  // Reactivar a alguien que dieron de baja: solo el admin.
  if (activo && p.activo === false && caller.role !== "admin") throw new HttpError(403, "Solo el administrador puede volver a activar un contacto.");
  await adminAuth().updateUser(uid, { disabled: !activo });
  if (!activo) await adminAuth().revokeRefreshTokens(uid);
  await adminDb().collection("profiles").doc(uid).set({ activo }, { merge: true });
  await grupoDelCliente(cliente.id, uid, String(p.nombre ?? ""), activo);
  return { ok: true };
}

async function contactoInvitar(req: VercelRequest, caller: Caller) {
  const { p, cliente, uid } = await contactoDe(req, caller);
  if (p.activo === false) throw new HttpError(409, "El contacto está desactivado");
  const link = await linkContacto(uid, req);
  const mail = await invitarContacto(String(p.email ?? ""), String(p.nombre ?? ""), cliente.nombre, link, req);
  // Si ya tiene contraseña, el link le llega solo por mail (que nadie del equipo pueda entrar como él).
  const yaTieneClave = !!(await usuarioFresco(uid))?.clave_hash;
  return { ok: true, link: yaTieneClave && caller.role !== "admin" ? null : link, mail };
}

/**
 * Borra un grupo de chat y todos sus mensajes y audios. Los grupos que arma la app sola ("equipo" y uno por cliente)
 * quedan dados de baja (sin miembros) para que no se vuelvan a crear al abrir la app.
 */
async function chatBorrar(req: VercelRequest) {
  const { chat_id } = body<{ chat_id?: string }>(req);
  if (!chat_id || typeof chat_id !== "string" || chat_id.includes("/")) throw new HttpError(400, "Falta el chat");
  const db = adminDb();
  const ref = db.collection("chats").doc(chat_id);
  const chat = (await ref.get()).data();
  if (!chat) throw new HttpError(404, "El grupo ya no existe");
  if (chat.tipo === "directo") throw new HttpError(400, "Solo se borran grupos");
  let mensajes = 0;
  for (const sub of ["mensajes", "audios"]) {
    const docs = (await db.collection(`chats/${chat_id}/${sub}`).get()).docs;
    if (sub === "mensajes") mensajes = docs.length;
    for (let i = 0; i < docs.length; i += 400) {
      const lote = db.batch();
      docs.slice(i, i + 400).forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
  }
  if (chat.tipo === "grupo") await ref.delete();
  else
    await ref.set({
      tipo: chat.tipo,
      proyecto_id: chat.proyecto_id ?? null,
      nombre: chat.nombre ?? "",
      borrado: true,
      borrado_at: new Date().toISOString(),
      miembros: [],
      nombres: {},
      ultimo: null,
      leido: {},
    });
  return { ok: true, mensajes };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const accion = String(req.query.accion ?? "");
    // Mi tiempo: Claude Code avisa con el token personal (no tiene la sesión de la app).
    if (accion === "tiempo-cc") {
      const uid = await uidDelToken(String(req.headers["x-prodi-token"] ?? ""));
      const b = body<{ que?: string; proyecto?: string; minutos?: { at?: string; que?: string; proyecto?: string }[] }>(req);
      // Con "minutos": carga de antes (los registros de Claude Code); si no, el minuto de ahora.
      if (Array.isArray(b.minutos)) {
        res.status(200).json({ ok: true, cargados: await anotarMinutosPasados(uid, "claude", b.minutos) });
        return;
      }
      await anotarMinuto(uid, "claude", String(b.que ?? "").trim() || null, String(b.proyecto ?? "").trim() || null);
      res.status(200).json({ ok: true });
      return;
    }
    if (accion.startsWith("tiempo-")) {
      // Solo se mide (y lo ve) el admin, a sí mismo.
      const yo = await requireCaller(req, ["admin"]);
      if (accion === "tiempo-latido") {
        const b = body<{ que?: string }>(req);
        await anotarMinuto(yo.uid, "app", String(b.que ?? "").trim() || null, null);
        res.status(200).json({ ok: true });
      } else if (accion === "tiempo-ver") {
        const b = body<{ dias?: number }>(req);
        const dias = Math.min(Math.max(Math.floor(Number(b.dias) || 14), 1), 90);
        res.status(200).json({ dias: await resumenTiempo(yo.uid, dias), conectado: await tieneToken(yo.uid) });
      } else if (accion === "tiempo-token") {
        res.status(200).json({ token: await nuevoToken(yo.uid) });
      } else res.status(404).json({ error: "Acción desconocida" });
      return;
    }
    // Racha de respuestas a los clientes: cada uno ve lo suyo; el admin, todo (ver api/_lib/racha.ts).
    if (accion === "racha") {
      const yo = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "administracion"]);
      const { personas, clientes } = await rachasDeRespuesta();
      const mia = personas.find((x) => x.uid === yo.uid) ?? rachaVacia(yo.uid, yo.nombre);
      const admin = yo.roles.includes("admin");
      res.status(200).json({ yo: mia, ...(admin ? { personas, clientes } : {}) });
      return;
    }
    if (accion.startsWith("contacto-")) {
      const caller = await requireCaller(req, ["admin", "productor"]);
      if (accion === "contacto-crear") res.status(200).json(await contactoCrear(req, caller));
      else if (accion === "contacto-activo") res.status(200).json(await contactoActivo(req, caller));
      else if (accion === "contacto-invitar") res.status(200).json(await contactoInvitar(req, caller));
      else if (accion === "contacto-clave") res.status(200).json(await contactoClave(req, caller));
      else res.status(404).json({ error: "Acción desconocida" });
      return;
    }
    const admin = await requireCaller(req, ["admin"]);
    if (accion === "crear") res.status(200).json(await crear(req));
    else if (accion === "editar") res.status(200).json(await editar(req, admin.uid));
    else if (accion === "desactivar") res.status(200).json(await desactivar(req, admin.uid));
    else if (accion === "eliminar") res.status(200).json(await eliminar(req, admin.uid));
    else if (accion === "clave") res.status(200).json(await clave(req));
    else if (accion === "ejemplo-cargar") res.status(200).json(await cargarEjemplo(admin.uid));
    else if (accion === "ejemplo-borrar") res.status(200).json(await borrarEjemplo());
    else if (accion === "chat-borrar") res.status(200).json(await chatBorrar(req));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    sendError(res, err);
  }
}
