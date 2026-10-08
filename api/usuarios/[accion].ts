/* eslint-disable @typescript-eslint/no-explicit-any */
// Gestión de usuarios (solo super admin).
// POST /api/usuarios/crear       { nombre, email, rol, clientes?: string[], password? }
// POST /api/usuarios/editar      { uid, nombre?, email?, rol?, clientes?: string[] }
// POST /api/usuarios/desactivar  { uid, activo: boolean }
// POST /api/usuarios/eliminar    { uid }
// POST /api/usuarios/clave       { uid }  → link para que la persona elija contraseña
// POST /api/usuarios/ejemplo-cargar  → carga los datos de ejemplo (mismos de la demo)
// POST /api/usuarios/ejemplo-borrar  → los borra
// Contactos (solo chat), super admin o producción asignada al cliente:
// POST /api/usuarios/contacto-crear   { proyecto_id, nombre, email, telefono?, cargo? } → { uid, link, mail }
// POST /api/usuarios/contacto-activo  { uid, activo }  → (des)activa y lo saca/suma al grupo del cliente
// POST /api/usuarios/contacto-invitar { uid }          → link nuevo para crear la contraseña (y lo manda por mail)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { FieldValue } from "../_lib/db";
import { adminDb } from "../_lib/db";
import { adminAuth, crearUsuario, linkDeClave } from "../_lib/cuentas";
import { appUrl, body, HttpError, requireCaller, sendError, type Caller } from "../_lib/http";
import { enviarMailsLote } from "../_lib/informe";
import { mailAvisoHtml } from "../_lib/mail-aviso";
import { borrarEjemplo, cargarEjemplo } from "../_lib/ejemplo";

export const config = { maxDuration: 60 };

const ROLES = ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente", "pending"];
const ROL_EN_CLIENTE: Record<string, string> = { productor: "productor", editor: "editor", pauta: "pauta", diseno: "diseno", cliente: "cliente" };

/** Deja a la persona exactamente en esos clientes (para su rol). */
async function asignarClientes(uid: string, rol: string, clientes: string[]) {
  const db = adminDb();
  const projects = await db.collection("projects").get();
  const batch = db.batch();
  const campo = ROL_EN_CLIENTE[rol];
  for (const p of projects.docs) {
    // Los clientes dados de baja no se tocan (no aparecen en la pantalla de edición).
    if (p.data().enabled === false && clientes.length > 0) continue;
    const team = (p.data().team_roles ?? {}) as Record<string, string[]>;
    const updates: Record<string, unknown> = {};
    // Se saca de cualquier otro rol del proyecto (cambió de rol o de clientes).
    for (const [k, ids] of Object.entries(team)) {
      if ((ids ?? []).includes(uid) && (k !== campo || !clientes.includes(p.id))) {
        updates[`team_roles.${k}`] = FieldValue.arrayRemove(uid);
      }
    }
    if (campo && clientes.includes(p.id) && !(team[campo] ?? []).includes(uid)) {
      updates[`team_roles.${campo}`] = FieldValue.arrayUnion(uid);
    }
    if (Object.keys(updates).length) batch.update(p.ref, updates);
  }
  await batch.commit();
}

async function crear(req: VercelRequest) {
  const b = body<{ nombre?: string; email?: string; rol?: string; clientes?: string[]; password?: string }>(req);
  const nombre = String(b.nombre ?? "").trim();
  const email = String(b.email ?? "").trim().toLowerCase();
  const rol = String(b.rol ?? "");
  if (!nombre || !/.+@.+\..+/.test(email) || !ROLES.includes(rol)) throw new HttpError(400, "Completá nombre, mail y rol");
  const password = b.password && b.password.length >= 6 ? b.password : `Prodi-${crypto.randomBytes(4).toString("hex")}`;
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
    activo: true,
    created_at: new Date().toISOString(),
  });
  if (b.clientes?.length) await asignarClientes(user.uid, rol, b.clientes);
  return { ok: true, uid: user.uid, password };
}

async function editar(req: VercelRequest, adminUid: string) {
  const b = body<{ uid?: string; nombre?: string; email?: string; rol?: string; clientes?: string[] }>(req);
  if (!b.uid) throw new HttpError(400, "Falta uid");
  if (b.uid === adminUid && b.rol && b.rol !== "admin") throw new HttpError(409, "No te podés sacar el rol de super admin a vos mismo");
  const ref = adminDb().collection("profiles").doc(b.uid);
  const prev = (await ref.get()).data() ?? {};
  const patch: Record<string, unknown> = {};
  if (b.nombre?.trim()) patch.nombre = b.nombre.trim();
  if (b.rol) {
    // "contacto" no se asigna desde Equipo (se crea desde la ficha del cliente), pero editar uno lo mantiene.
    if (!ROLES.includes(b.rol) && !(b.rol === "contacto" && prev.role === "contacto")) throw new HttpError(400, "Rol inválido");
    patch.role = b.rol;
  }
  if (b.email && b.email.trim().toLowerCase() !== prev.email) {
    const email = b.email.trim().toLowerCase();
    await adminAuth().updateUser(b.uid, { email });
    patch.email = email;
  }
  if (patch.nombre) await adminAuth().updateUser(b.uid, { displayName: patch.nombre as string }).catch(() => undefined);
  if (Object.keys(patch).length) await ref.set(patch, { merge: true });
  if (b.clientes) await asignarClientes(b.uid, (patch.role as string) ?? prev.role, b.clientes);
  return { ok: true };
}

async function desactivar(req: VercelRequest, adminUid: string) {
  const b = body<{ uid?: string; activo?: boolean }>(req);
  if (!b.uid) throw new HttpError(400, "Falta uid");
  if (b.uid === adminUid) throw new HttpError(409, "No te podés desactivar a vos mismo");
  await adminAuth().updateUser(b.uid, { disabled: !b.activo });
  if (!b.activo) await adminAuth().revokeRefreshTokens(b.uid);
  await adminDb().collection("profiles").doc(b.uid).set({ activo: !!b.activo }, { merge: true });
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
    if (caller.role !== "productor" || !Object.values(team).some((ids) => (ids ?? []).includes(caller.uid)))
      throw new HttpError(403, "Solo el super admin o la producción de este cliente");
  }
  return { id: proyectoId, nombre: String(p.nombre ?? "") };
}

/** Lo suma (o lo saca) del grupo del cliente, marcado como contacto. */
async function grupoDelCliente(proyectoId: string, uid: string, nombre: string, adentro: boolean) {
  const ref = adminDb().collection("chats").doc(`cliente_${proyectoId}`);
  const chat = await ref.get();
  // Si el grupo todavía no existe, lo arma el super admin al abrir la app (sincronizarChats ya los incluye).
  if (!chat.exists) return;
  await ref.update(
    adentro
      ? { miembros: FieldValue.arrayUnion(uid), contactos: FieldValue.arrayUnion(uid), [`nombres.${uid}`]: nombre }
      : { miembros: FieldValue.arrayRemove(uid), contactos: FieldValue.arrayRemove(uid) }
  );
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
  const b = body<{ proyecto_id?: string; nombre?: string; email?: string; telefono?: string; cargo?: string }>(req);
  const cliente = await clienteParaContactos(caller, b.proyecto_id);
  const nombre = String(b.nombre ?? "").trim().slice(0, 80);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!nombre || !/.+@.+\..+/.test(email)) throw new HttpError(400, "Completá nombre y mail");
  let user;
  try {
    user = await crearUsuario({ email, displayName: nombre });
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
      role: "contacto",
      proyecto_id: cliente.id,
      telefono: String(b.telefono ?? "").trim().slice(0, 40) || null,
      cargo: String(b.cargo ?? "").trim().slice(0, 80) || null,
      activo: true,
      creado_por: caller.uid,
      created_at: new Date().toISOString(),
    });
  await grupoDelCliente(cliente.id, user.uid, nombre, true);
  const link = await linkContacto(user.uid, req);
  const mail = await invitarContacto(email, nombre, cliente.nombre, link, req);
  return { ok: true, uid: user.uid, link, mail };
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
  return { ok: true, link, mail };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const accion = String(req.query.accion ?? "");
    if (accion.startsWith("contacto-")) {
      const caller = await requireCaller(req, ["admin", "productor"]);
      if (accion === "contacto-crear") res.status(200).json(await contactoCrear(req, caller));
      else if (accion === "contacto-activo") res.status(200).json(await contactoActivo(req, caller));
      else if (accion === "contacto-invitar") res.status(200).json(await contactoInvitar(req, caller));
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
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    sendError(res, err);
  }
}
