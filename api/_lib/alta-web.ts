// Compra de un plan de Redes desde somosprodi.com, sin intervención de nadie:
//  1. La web llama a /api/web/comprar: se chequean los cupos, se guarda la compra en `altas_web/{id}` (pendiente) y se
//     crea la suscripción de Mercado Pago (débito automático) con external_reference "alta:{id}".
//  2. Cuando Mercado Pago avisa que la suscripción quedó autorizada (webhook de /api/pagos), `completarAlta` crea el
//     cliente: usuario (le llega un mail para elegir su contraseña), ficha `projects/alta_{id}` con el plan y el débito
//     ya activo, lead en Ganado (con su vendedor, si vino por un link) y aviso a los admins.
//  3. Desde ahí los cobros de cada mes siguen el camino de siempre (registrarAbono), porque el cliente se encuentra por
//     `suscripcion.mp_preapproval_id`.
// Es idempotente: el cliente tiene id fijo (`alta_{id}`) y la compra guarda el proyecto creado.

import { adminDb } from "./db";
import { crearUsuario, linkDeClave } from "./cuentas";
import { destinatariosDe, enviarAviso } from "./notify";
import { enviarMailsLote } from "./informe";
import { mailAvisoHtml } from "./mail-aviso";
import { comisionPct, montoDebito, totalMensual } from "./facturacion";
import { avisarEstadoAlSocio } from "./socios";
import { hoyAR } from "./fecha";

/** Planes de Redes que se venden en somosprodi.com (precio neto por mes, sin IVA). Igual que src/data/sitio.js de la web. */
export const PLANES_WEB: Record<string, { nombre: string; neto: number; videos: number; piezas: number; oculto?: boolean }> = {
  esencial: { nombre: "Esencial", neto: 450000, videos: 4, piezas: 4 },
  crecimiento: { nombre: "Crecimiento", neto: 600000, videos: 8, piezas: 6 },
  completa: { nombre: "Campaña completa", neto: 750000, videos: 12, piezas: 8 },
  // Plan de prueba ($100) para probar la compra de punta a punta con un pago real. No figura en /precios ni en la web;
  // se entra con somosprodi.com/comprar?plan=prueba. Sacarlo cuando termine la prueba.
  prueba: { nombre: "Prueba", neto: 100, videos: 0, piezas: 0, oculto: true },
};

/**
 * Lo que paga por mes: plan + IVA (si pide factura; sin factura va como boleta, sin IVA) + comisión de Mercado Pago del
 * débito automático. Mismo cálculo que el abono (totalMensual + montoDebito).
 */
export async function precioPlanWeb(planId: string, factura = true) {
  const plan = PLANES_WEB[planId];
  if (!plan) return null;
  const s = (await adminDb().collection("app_settings").doc("redes").get()).data() ?? {};
  const ivaPct = Number(s.iva_pct ?? 21);
  const total = totalMensual({ abono: plan.neto, facturacion: { tipo: factura ? "factura" : "boleta" } } as Parameters<typeof totalMensual>[0], ivaPct);
  const comision_pct = comisionPct(s.comision_mp_pct);
  const monto = montoDebito(total, comision_pct);
  return { ...plan, id: planId, factura, iva_pct: ivaPct, iva: Math.round(total - plan.neto), total, comision_pct, comision: Math.round(monto - total), monto };
}

const ars = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);

/** La compra quedó en otro estado en Mercado Pago (pendiente, cancelada…) y todavía no es cliente. */
export async function marcarAlta(altaId: string, estado: string) {
  const ref = adminDb().collection("altas_web").doc(altaId);
  const a = (await ref.get()).data();
  if (a && !a.proyecto_id && a.estado !== estado) await ref.update({ estado, updated_at: new Date().toISOString() });
}

/**
 * Crea el cliente de una compra cuya suscripción ya está autorizada. Devuelve el id del cliente, o null si no se pudo
 * (queda la compra en "revisar" y se avisa a los admins).
 */
export async function completarAlta(altaId: string, s: { id: string; status: string; payer_email?: string }, base: string): Promise<string | null> {
  const db = adminDb();
  const altaRef = db.collection("altas_web").doc(altaId);
  const a = (await altaRef.get()).data();
  if (!a) return null;
  if (a.proyecto_id) return String(a.proyecto_id);
  const ahora = new Date().toISOString();
  const pid = `alta_${altaId}`;
  const plan = PLANES_WEB[String(a.plan)] ?? null;
  const avisar = (titulo: string, cuerpo: string, link: string, clave: string, proyectoId: string | null) =>
    destinatariosDe(proyectoId ?? "", [], true)
      .then((d) => enviarAviso({ destinatarios: d, titulo, cuerpo, link, clave, proyectoId }, base))
      .catch(() => undefined);

  // 1. Usuario: si ya es cliente de Prodi se le suma esta empresa; si el mail es de alguien del equipo, se revisa a mano.
  const email = String(a.email);
  const previo = (await db.collection("profiles").where("email", "==", email).limit(1).get()).docs[0];
  let uid: string;
  let nuevoUsuario = false;
  if (previo) {
    if (previo.data().role !== "cliente") {
      await altaRef.update({ estado: "revisar", motivo: "El mail ya es de un usuario que no es cliente", mp_preapproval_id: s.id, updated_at: ahora });
      await avisar("Revisar compra de la web", `${a.negocio} pagó el plan ${plan?.nombre ?? a.plan} pero su mail (${email}) ya es de un usuario del equipo. Dalo de alta a mano.`, "/web", `alta_revisar:${altaId}`, null);
      return null;
    }
    uid = previo.id;
  } else {
    try {
      uid = (await crearUsuario({ email, displayName: String(a.nombre) })).uid;
      nuevoUsuario = true;
    } catch {
      await altaRef.update({ estado: "revisar", motivo: "No se pudo crear el usuario", mp_preapproval_id: s.id, updated_at: ahora });
      await avisar("Revisar compra de la web", `${a.negocio} pagó el plan ${plan?.nombre ?? a.plan} pero no se pudo crear su usuario (${email}). Dalo de alta a mano.`, "/web", `alta_revisar:${altaId}`, null);
      return null;
    }
    await db.collection("profiles").doc(uid).set({ nombre: a.nombre, email, role: "cliente", roles_extra: [], activo: true, telefono: a.telefono || null, created_at: ahora });
  }

  // 2. La ficha del cliente, con el plan, el precio y el débito automático ya activo (id fijo: no se duplica).
  const lead = a.lead_id ? (await db.collection("leads_web").doc(String(a.lead_id)).get()).data() ?? null : null;
  let creado = false;
  await db.runTransaction(async (tx) => {
    const pRef = db.collection("projects").doc(pid);
    if ((await tx.get(pRef)).exists) return;
    creado = true;
    tx.set(pRef, {
      nombre: a.negocio,
      color: "#6F40FC",
      enabled: true,
      plan_redes_id: null,
      plan_redes_override: { precio_mensual: Number(a.neto), ...(plan ? { videos_mes: plan.videos, piezas_mes: plan.piezas } : {}), nombre: plan?.nombre ?? null },
      team_roles: { productor: [], editor: [], pauta: [], diseno: [], cliente: [uid] },
      contacto_emails: [email],
      facturacion: { tipo: a.factura === false ? "boleta" : "factura", ...(a.cuit ? { cuit: a.cuit } : {}) },
      alta: hoyAR(),
      origen: "somosprodi.com",
      alta_web_id: altaId,
      instagram: a.instagram || null,
      ...(a.lead_id ? { lead_id: a.lead_id } : {}),
      ...(lead?.socio_id ? { socio_id: String(lead.socio_id), socio_alta: hoyAR() } : {}),
      suscripcion: {
        mp_preapproval_id: s.id,
        estado: "activa",
        monto: Number(a.monto),
        comision_pct: Number(a.comision_pct ?? 0),
        payer_email: s.payer_email || a.email_mp || email,
        init_point: null,
        creada_at: ahora,
        actualizada_at: ahora,
        creada_por: "web",
      },
      created_at: ahora,
    });
    tx.update(altaRef, { estado: "activa", proyecto_id: pid, uid, mp_preapproval_id: s.id, updated_at: ahora });
  });
  if (!creado) return pid;

  // 3. El lead pasa a Ganado (y si lo trajo un vendedor, le avisamos).
  if (a.lead_id && lead) {
    const lRef = db.collection("leads_web").doc(String(a.lead_id));
    const historial = [...(Array.isArray(lead.historial) ? lead.historial : []), { at: ahora, de: lead.estado ?? null, a: "ganado", texto: `Compró el plan ${plan?.nombre ?? a.plan} en la web`, por: null, por_nombre: "Web" }].slice(-100);
    await lRef.update({ estado: "ganado", cliente_id: pid, proyecto_id: pid, historial, updated_at: ahora }).catch((e) => console.warn("[alta] lead", e));
    if (lead.estado !== "ganado") await avisarEstadoAlSocio(lead, String(a.lead_id), "ganado", base).catch(() => undefined);
  }

  // 4. Mail de bienvenida: con el link para elegir su contraseña (si es nuevo) o directo a su panel.
  const link = nuevoUsuario ? await linkDeClave(uid, base).catch(() => `${base}/auth`) : `${base}/cliente`;
  await enviarMailsLote([
    {
      to: email,
      asunto: "Bienvenido a Prodi",
      html: mailAvisoHtml({
        titulo: `Bienvenido a Prodi, ${a.negocio}`,
        cuerpo: `Ya contrataste el plan ${plan?.nombre ?? ""} y el débito automático quedó activo (${ars(Number(a.monto))} por mes).\n${
          nuevoUsuario ? "Tocá el botón para crear tu contraseña y entrar a tu panel (el link vence en 3 días)." : "Entrá a tu panel con tu usuario de siempre."
        } En los próximos días te escribimos para arrancar.`,
        link,
        baseUrl: base,
        nombre: String(a.nombre),
      }),
    },
  ]).catch((e) => console.warn("[alta] mail", e));

  // 5. Aviso a los admins para asignarle el equipo.
  await avisar(
    `🎉 Nuevo cliente desde la web: ${a.negocio}`,
    `Contrató el plan ${plan?.nombre ?? a.plan} (${ars(Number(a.neto))} ${a.factura === false ? "sin factura" : "+ IVA, con factura"}) con débito automático. Asignale el equipo para arrancar.`,
    `/clientes/${pid}`,
    `alta_web:${altaId}`,
    pid
  );
  return pid;
}
