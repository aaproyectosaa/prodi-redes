/* eslint-disable @typescript-eslint/no-explicit-any */
// Presupuestos para clientes nuevos. El admin lo arma en el sistema y le manda un link (/p/{token}). El cliente lo ve
// sin usuario, toca Aceptar, crea su usuario y contraseña ahí mismo y queda como cliente de Prodi: se crea su ficha
// (con el plan y el precio del presupuesto), entra a su panel y lo lleva a instalar las apps. Al admin le llega el aviso.

import { adminDb } from "./db";
import { HttpError } from "./http";
import { crearUsuario, iniciarSesion, tokenDeSesion, validarClave } from "./cuentas";
import { destinatariosDe, enviarAviso } from "./notify";
import { hoyAR } from "./fecha";
import { totalesPresupuesto, type ItemPresupuesto } from "./presupuesto-calc";
import { limpiarPropuesta } from "./propuesta";

const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** El presupuesto por su link (o error si no existe). */
async function porToken(token: string) {
  const tok = t(token, 80);
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(tok)) throw new HttpError(404, "Este presupuesto no existe");
  const snap = await adminDb().collection("presupuestos").where("token", "==", tok).limit(1).get();
  const d = snap.docs[0];
  if (!d) throw new HttpError(404, "Este presupuesto no existe o fue borrado");
  return d;
}

/** Lo que ve el cliente en el link (sin datos internos). La primera vez anota que lo vio. */
export async function verPresupuesto(token: string) {
  const d = await porToken(token);
  const p = d.data();
  const ivaPct = Number((await adminDb().collection("app_settings").doc("redes").get()).data()?.iva_pct ?? 21);
  if (!p.visto_at && p.estado === "enviado") await d.ref.update({ visto_at: new Date().toISOString(), estado: "visto" });
  const vencido = !!p.validez && p.validez < hoyAR() && p.estado !== "aceptado";
  return {
    numero: p.numero ?? null,
    empresa: p.empresa,
    contacto: { nombre: p.contacto?.nombre ?? null, email: p.contacto?.email ?? null },
    items: (p.items ?? []) as ItemPresupuesto[],
    moneda: p.moneda === "USD" ? "USD" : "ARS",
    tipo: p.tipo === "boleta" ? "boleta" : "factura",
    validez: p.validez ?? null,
    nota: p.nota ?? null,
    propuesta: p.propuesta ? limpiarPropuesta(p.propuesta) : null,
    estado: vencido ? "vencido" : p.estado,
    totales: totalesPresupuesto(p.items ?? [], p.tipo, ivaPct),
    creado: p.created_at,
  };
}

/** El cliente acepta: se crea (o se usa) su usuario, su ficha de cliente y entra. Devuelve la sesión. */
export async function aceptarPresupuesto(b: { t?: string; nombre?: string; email?: string; password?: string }, base: string) {
  const d = await porToken(String(b.t ?? ""));
  const p = d.data();
  if (p.estado === "aceptado") throw new HttpError(409, "Este presupuesto ya fue aceptado. Entrá con tu usuario.");
  if (p.estado === "rechazado") throw new HttpError(409, "Este presupuesto ya no está vigente. Pedinos uno nuevo.");
  if (p.validez && p.validez < hoyAR()) throw new HttpError(409, "Este presupuesto venció. Escribinos y te mandamos uno actualizado.");
  const nombre = t(b.nombre, 80);
  const email = t(b.email, 160).toLowerCase();
  const password = String(b.password ?? "");
  if (!nombre) throw new HttpError(400, "Escribí tu nombre");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Revisá el mail");
  const db = adminDb();

  // ¿Ya tiene usuario? Si es cliente (dueño de otra empresa), entra con su contraseña y se le suma esta.
  const previo = (await db.collection("profiles").where("email", "==", email).limit(1).get()).docs[0];
  let uid: string;
  let token: string;
  if (previo) {
    if (previo.data().role !== "cliente") throw new HttpError(409, "Ese mail ya se usa en el sistema. Usá otro.");
    try {
      const s = await iniciarSesion(email, password);
      uid = s.usuario.uid;
      token = s.token;
    } catch {
      throw new HttpError(401, "Ese mail ya tiene usuario: poné tu contraseña de siempre.");
    }
  } else {
    try {
      validarClave(password);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : "La contraseña no sirve");
    }
    let u: { uid: string };
    try {
      u = await crearUsuario({ email, password, displayName: nombre });
    } catch {
      throw new HttpError(409, "Ese mail ya tiene usuario. Si es tuyo, poné tu contraseña de siempre o escribinos.");
    }
    uid = u.uid;
    await db.collection("profiles").doc(uid).set({ nombre, email, role: "cliente", roles_extra: [], activo: true, created_at: new Date().toISOString() });
    token = tokenDeSesion({ uid, sesion_ver: 0 });
  }

  // La ficha del cliente, con el plan y el precio mensual del presupuesto.
  const items = (p.items ?? []) as ItemPresupuesto[];
  const mensual = items.filter((i) => i.periodo === "mensual").reduce((a, i) => a + Number(i.precio || 0) * Number(i.cantidad || 1), 0);
  const ahora = new Date().toISOString();
  const proyecto = await db.collection("projects").add({
    nombre: t(p.empresa, 120) || nombre,
    color: "#6F40FC",
    enabled: true,
    plan_redes_id: p.plan_id ?? null,
    ...(p.moneda !== "USD" && mensual > 0 ? { plan_redes_override: { precio_mensual: mensual } } : {}),
    team_roles: { productor: [], editor: [], pauta: [], diseno: [], cliente: [uid] },
    contacto_emails: [email],
    facturacion: { tipo: p.tipo === "boleta" ? "boleta" : "factura" },
    alta: hoyAR(),
    presupuesto_id: d.id,
    created_at: ahora,
  });
  await d.ref.update({ estado: "aceptado", aceptado: { at: ahora, nombre, email, uid, proyecto_id: proyecto.id }, updated_at: ahora });

  // Aviso a los admins para que le asignen el equipo y arranquen.
  const admins = await destinatariosDe(proyecto.id, [], true);
  await enviarAviso(
    {
      destinatarios: admins,
      titulo: `🎉 ${t(p.empresa, 80)} aceptó el presupuesto`,
      cuerpo: `${nombre} creó su usuario (${email}). Ya está en Clientes: asignale el equipo para arrancar.`,
      link: `/clientes/${proyecto.id}`,
      clave: `presupuesto:${d.id}`,
      proyectoId: proyecto.id,
    },
    base
  ).catch(() => undefined);
  return { ok: true, token, uid, proyecto_id: proyecto.id };
}
