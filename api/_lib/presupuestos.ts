/* eslint-disable @typescript-eslint/no-explicit-any */
// Presupuestos para clientes nuevos. El admin lo arma en el sistema y le manda un link (/p/{token}). El cliente lo ve
// sin usuario, toca Aceptar, crea su usuario y contraseña ahí mismo y queda como cliente de Prodi: se crea su ficha
// (con el plan y el precio del presupuesto), entra a su panel y lo lleva a instalar las apps. Al admin le llega el aviso.

import { avisarEstadoAlSocio } from "./socios";
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

/** El cliente bajó el PDF desde el link: se anota y se avisa a quien lo armó. */
export async function pdfPresupuesto(token: string) {
  const d = await porToken(token);
  const p = d.data();
  const ahora = new Date().toISOString();
  const veces = Number(p.pdf_descargas ?? 0) + 1;
  await d.ref.update({ pdf_descargas: veces, pdf_at: ahora });
  await anotarEnLead(p.lead_id, { at: ahora, tipo: "presupuesto", texto: "Bajó el presupuesto en PDF", por: null, por_nombre: p.empresa ?? "Cliente" }).catch(() => {});
  if (p.created_by)
    await enviarAviso(
      {
        destinatarios: [String(p.created_by)],
        titulo: `${p.empresa ?? "El cliente"} bajó tu propuesta en PDF`,
        cuerpo: "Seguramente la está pasando a alguien más para decidir. Buen momento para escribirle.",
        link: "/presupuestos",
        clave: `presupuesto_pdf:${d.ref.id}:${ahora.slice(0, 13)}`,
        proyectoId: null,
      },
      process.env.APP_URL || ""
    ).catch(() => {});
  return { ok: true };
}

/** Lo que ve el cliente en el link (sin datos internos). La primera vez anota que lo vio. */
/** Al lead del CRM (si el presupuesto salió de uno): una entrada en su línea de tiempo y, si se dice, otro estado. */
async function anotarEnLead(leadId: unknown, entrada: Record<string, unknown>, cambios: Record<string, unknown> = {}) {
  if (typeof leadId !== "string" || !/^[0-9a-f-]{36}$/i.test(leadId)) return;
  const ref = adminDb().collection("leads_web").doc(leadId);
  const l = (await ref.get()).data();
  if (!l) return;
  const historial = [...(Array.isArray(l.historial) ? l.historial : []), entrada].slice(-100);
  await ref.update({ ...cambios, historial, updated_at: new Date().toISOString() });
  // Si lo trajo un socio comercial y cambió de etapa (propuesta, ganado), le avisamos.
  if (typeof cambios.estado === "string" && cambios.estado !== l.estado) await avisarEstadoAlSocio(l, leadId, cambios.estado, process.env.APP_URL || "");
}

export async function verPresupuesto(token: string, equipo = false) {
  const d = await porToken(token);
  const p = d.data();
  // Lo abrió el cliente (no alguien de Prodi mirándolo): se cuenta y se avisa, a lo sumo cada 30 minutos.
  // Cuenta aunque siga en borrador: si lo abrió es que se lo mandaron (por PDF, copiando el link de otro lado…).
  if (!equipo && p.estado === "borrador") {
    const ahora = new Date().toISOString();
    await d.ref.update({ estado: "visto", enviado_at: p.enviado_at ?? ahora, visto_at: ahora });
    p.estado = "visto";
    p.visto_at = ahora;
  }
  if (!equipo) {
    const ahora = new Date();
    const ultima = p.ultima_apertura ? new Date(String(p.ultima_apertura)).getTime() : 0;
    if (ahora.getTime() - ultima > 30 * 60_000) {
      const veces = Number(p.aperturas ?? 0) + 1;
      await d.ref.update({ aperturas: veces, ultima_apertura: ahora.toISOString() });
      await anotarEnLead(p.lead_id, { at: ahora.toISOString(), tipo: "presupuesto", texto: `Abrió el presupuesto${veces > 1 ? ` (${veces}ª vez)` : ""}`, por: null, por_nombre: p.empresa ?? "Cliente" }).catch(() => {});
      if (p.created_by)
        await enviarAviso(
          {
            destinatarios: [String(p.created_by)],
            titulo: `${p.empresa ?? "El cliente"} abrió tu propuesta`,
            cuerpo: veces > 1 ? `Es la ${veces}ª vez que la mira. Buen momento para llamar.` : "La está mirando ahora: buen momento para llamar.",
            link: p.lead_id ? "/web" : "/presupuestos",
            clave: `presupuesto_abierto:${d.ref.id}:${ahora.toISOString().slice(0, 13)}`,
            proyectoId: null,
          },
          process.env.APP_URL || ""
        ).catch(() => {});
    }
  }
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
  // El lead del CRM pasa solo a Ganado (y queda vinculado al cliente nuevo).
  await anotarEnLead(
    p.lead_id,
    { at: ahora, de: null, a: "ganado", tipo: "presupuesto", texto: "Aceptó el presupuesto: ya es cliente", por: null, por_nombre: nombre },
    { estado: "ganado", proyecto_id: proyecto.id, proximo_paso: null, ultimo_contacto_at: ahora }
  ).catch((e) => console.warn("[presupuesto] lead", e));

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
