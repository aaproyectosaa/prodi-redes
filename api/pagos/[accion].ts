// Pagos con Mercado Pago (Checkout Pro).
// POST /api/pagos/crear       { tipo: "pieza_ia", pieza_id } | { tipo: "video_extra", proyecto_id, mes, cantidad }
// POST /api/pagos/webhook     (lo llama Mercado Pago)
// POST /api/pagos/verificar   { cobro_id }  (al volver del checkout)
// POST /api/pagos/reembolsar  { pieza_id, nota }  (el equipo rechaza una pieza)
// POST /api/pagos/suscribir   { proyecto_id, email }  (cliente o admin) → débito automático del abono
// POST /api/pagos/suscripcion { proyecto_id, accion: "cancelar" | "actualizar_monto" }  (admin)
// POST /api/pagos/pedir-video { proyecto_id, mes, titulo, idea?, objetivo? }  (cliente)
//      → si entra en el plan se crea; si no, se cobra como video extra y se crea al pagar

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../_lib/db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError } from "../_lib/http";
import {
  actualizarSuscripcion,
  buscarPagos,
  crearPreferencia,
  crearSuscripcion,
  firmaValida,
  obtenerCobroSuscripcion,
  obtenerPago,
  obtenerSuscripcion,
  reembolsar,
  type PagoMP,
} from "../_lib/mercadopago";
import { aplicarPago, estadoSuscripcion, precioAbono, proyectoDeSuscripcion, registrarAbono } from "../_lib/cobros";
import { destinatariosDe, enviarAviso, usuariosConRol } from "../_lib/notify";
import { FORMATOS_PIEZA, leerPedidoPieza, piezaDoc, precioPieza } from "../_lib/piezas";
import { prepararFacturacion } from "../_lib/facturar";
import { asuntoFactura, facturaId, mailFacturaHtml, type Factura } from "../_lib/facturacion";
import { enviarMail } from "../_lib/informe";
import { videoDesdePedido } from "../_lib/pedidos";

export const config = { maxDuration: 30 };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

async function crear(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin", "productor"]);
  const b = body<{ tipo?: string; pieza_id?: string; proyecto_id?: string; mes?: string; cantidad?: number }>(req);
  const db = adminDb();
  const base = appUrl(req);
  const settings = (await db.collection("app_settings").doc("redes").get()).data() ?? {};
  const now = new Date().toISOString();

  let proyectoId: string;
  let concepto: string;
  let monto: number;
  let refId: string;
  let cantidad = 1;
  let tab: string;

  if (b.tipo === "pieza_ia") {
    if (!b.pieza_id) throw new HttpError(400, "Falta pieza_id");
    const pz = await db.collection("piezas_ia").doc(b.pieza_id).get();
    if (!pz.exists) throw new HttpError(404, "Pieza no encontrada");
    const pieza = pz.data()!;
    if (pieza.estado !== "pendiente_pago") throw new HttpError(409, "Esta pieza ya está paga");
    // Si ya hay un cobro pendiente para esta pieza, se reusa el mismo link (evita pagar dos veces).
    if (pieza.cobro_id) {
      const prev = (await db.collection("cobros").doc(pieza.cobro_id).get()).data();
      if (prev?.estado === "pendiente" && prev.mp_init_point) {
        await assertProjectAccess(caller, pieza.proyecto_id);
        return { init_point: prev.mp_init_point as string, cobro_id: pieza.cobro_id as string };
      }
    }
    proyectoId = pieza.proyecto_id;
    monto = precioPieza(settings, String(pieza.formato));
    if (!(monto > 0)) throw new HttpError(409, "El precio de las piezas no está configurado");
    concepto = `Pieza gráfica · ${FORMATOS_PIEZA[String(pieza.formato)]?.label ?? "diseño"}`;
    refId = b.pieza_id;
    tab = "piezas";
  } else if (b.tipo === "video_extra") {
    if (!b.proyecto_id || !/^\d{4}-\d{2}$/.test(String(b.mes))) throw new HttpError(400, "Datos incompletos");
    proyectoId = b.proyecto_id;
    cantidad = Math.min(10, Math.max(1, Math.floor(Number(b.cantidad) || 1)));
    const proj = (await db.collection("projects").doc(proyectoId).get()).data() ?? {};
    let unit = proj.plan_redes_override?.precio_video_extra ?? null;
    if (unit == null && proj.plan_redes_id) {
      const plan = (await db.collection("planes_redes").doc(proj.plan_redes_id).get()).data();
      unit = plan?.precio_video_extra ?? null;
    }
    if (!(Number(unit) > 0)) throw new HttpError(409, "Este plan no tiene precio de video extra");
    monto = Number(unit) * cantidad;
    const [y, m] = String(b.mes).split("-").map(Number);
    concepto = `${cantidad} video${cantidad === 1 ? "" : "s"} extra · ${MESES[m - 1]} ${y}`;
    refId = String(b.mes);
    tab = "plan";
  } else {
    throw new HttpError(400, "Tipo de cobro inválido");
  }

  await assertProjectAccess(caller, proyectoId);

  const cobroRef = db.collection("cobros").doc();
  await cobroRef.set({
    proyecto_id: proyectoId,
    tipo: b.tipo,
    concepto,
    ref_id: refId,
    cantidad,
    monto,
    moneda: "ARS",
    estado: "pendiente",
    created_by: caller.uid,
    created_at: now,
  });

  const pref = await crearPreferencia({
    titulo: `Prodi · ${concepto}`,
    monto,
    cantidad,
    externalReference: cobroRef.id,
    notificationUrl: `${base}/api/pagos/webhook`,
    backUrl: `${base}/cliente?tab=${tab}&cobro=${cobroRef.id}`,
    email: caller.email,
  });

  await cobroRef.update({ mp_preference_id: pref.id, mp_init_point: pref.init_point });
  if (b.tipo === "pieza_ia") {
    await db.collection("piezas_ia").doc(refId).update({ cobro_id: cobroRef.id, precio: monto, updated_at: now });
  }
  return { init_point: pref.init_point, cobro_id: cobroRef.id };
}

async function webhook(req: VercelRequest) {
  const b = body<{ type?: string; action?: string; data?: { id?: string | number }; topic?: string; resource?: string }>(req);
  const q = req.query as Record<string, string>;
  const tipo = b.type ?? q.type ?? q.topic ?? b.topic ?? "";
  const id = String(b.data?.id ?? q["data.id"] ?? q.id ?? "");
  const base = appUrl(req);
  if (!id || !["payment", "subscription_preapproval", "subscription_authorized_payment"].includes(tipo)) {
    return { ok: true, ignorado: true };
  }
  // Sin firma solo se aceptan las notificaciones viejas (IPN) de pagos; igual se consultan a la API de MP.
  const firmado = !!req.headers["x-signature"];
  if (!firmado && process.env.MP_WEBHOOK_SECRET && tipo !== "payment") {
    throw new HttpError(401, "Falta la firma");
  }
  if (!firmaValida(req.headers as Record<string, unknown>, id)) {
    throw new HttpError(401, "Firma inválida");
  }

  // Alta, pausa o baja del débito automático.
  if (tipo === "subscription_preapproval") {
    const s = await obtenerSuscripcion(id);
    const pid = await proyectoDeSuscripcion(s.id, s.external_reference);
    if (!pid) return { ok: true, ignorado: "sin cliente" };
    const ref = adminDb().collection("projects").doc(pid);
    const actual = (await ref.get()).data()?.suscripcion;
    // Solo se aplica a la suscripción vigente: un evento de una vieja (ya reemplazada) no la pisa.
    if (actual?.mp_preapproval_id && actual.mp_preapproval_id !== s.id) {
      if (s.status === "authorized") {
        // Quedó autorizada una suscripción vieja: hay riesgo de cobro doble. Que lo revise un admin.
        await enviarAviso(
          {
            destinatarios: await destinatariosDe(pid, [], true),
            titulo: "Revisar débito automático",
            cuerpo: `El cliente tiene más de una suscripción autorizada en Mercado Pago (${s.id}). Cancelá la que sobra.`,
            link: `/clientes/${pid}?tab=informe`,
            clave: `suscripcion_doble:${s.id}`,
            proyectoId: pid,
          },
          base
        );
      }
      return { ok: true, ignorado: "suscripción anterior" };
    }
    await ref.update({
      "suscripcion.mp_preapproval_id": s.id,
      "suscripcion.estado": estadoSuscripcion(s.status),
      "suscripcion.actualizada_at": new Date().toISOString(),
    });
    return { ok: true, estado: estadoSuscripcion(s.status) };
  }

  // Cobro mensual de la suscripción.
  if (tipo === "subscription_authorized_payment") {
    const c = await obtenerCobroSuscripcion(id);
    // Se busca el cliente por la referencia de la suscripción (sirve aunque ya no sea la vigente).
    const sus = await obtenerSuscripcion(c.preapproval_id).catch(() => null);
    const pid = await proyectoDeSuscripcion(c.preapproval_id, sus?.external_reference);
    if (!pid || !c.payment?.id) return { ok: true, ignorado: "sin pago" };
    const pago = await obtenerPago(String(c.payment.id));
    return { ok: true, estado: await registrarAbono(datosAbono(pid, pago), base) };
  }

  const pago = await obtenerPago(id);
  if (pago.external_reference?.startsWith("abono:")) {
    return { ok: true, estado: await registrarAbono(datosAbono(pago.external_reference.slice(6), pago), base) };
  }
  const estado = await aplicarPago(pago, base);
  return { ok: true, estado };
}

const datosAbono = (proyectoId: string, pago: PagoMP) => ({
  proyectoId,
  paymentId: String(pago.id),
  status: pago.status,
  monto: Number(pago.transaction_amount) || 0,
  fecha: pago.date_approved ?? null,
});

async function suscribir(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin"]);
  const b = body<{ proyecto_id?: string; email?: string }>(req);
  if (!b.proyecto_id) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, b.proyecto_id);
  const email = String(b.email ?? caller.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Poné el mail de tu cuenta de Mercado Pago");

  const db = adminDb();
  const ref = db.collection("projects").doc(b.proyecto_id);
  const actual = (await ref.get()).data()?.suscripcion;
  if (actual?.estado === "activa") throw new HttpError(409, "El débito automático ya está activo");

  const { nombre, plan, monto } = await precioAbono(b.proyecto_id);
  if (!(monto > 0)) throw new HttpError(409, "Este cliente no tiene precio de abono cargado");

  // Si ya hay una pendiente con el mismo monto y mail, se reusa el link.
  if (actual?.estado === "pendiente" && actual.init_point && actual.monto === monto && actual.payer_email === email) {
    return { init_point: actual.init_point as string };
  }
  // Cualquier suscripción anterior que no esté cancelada se cancela antes (evita cobros dobles).
  if (actual?.mp_preapproval_id && actual.estado !== "cancelada") {
    try {
      await actualizarSuscripcion(actual.mp_preapproval_id, { status: "cancelled" });
    } catch (err) {
      throw new HttpError(502, `No se pudo cancelar el débito anterior en Mercado Pago: ${err instanceof Error ? err.message : err}`);
    }
  }

  const base = appUrl(req);
  const s = await crearSuscripcion({
    titulo: `Prodi · ${plan} · ${nombre}`,
    monto,
    email,
    externalReference: `abono:${b.proyecto_id}`,
    backUrl: `${base}/cliente?tab=plan&suscripcion=ok`,
  });
  const now = new Date().toISOString();
  await ref.update({
    suscripcion: {
      mp_preapproval_id: s.id,
      estado: estadoSuscripcion(s.status),
      monto,
      payer_email: email,
      init_point: s.init_point ?? null,
      creada_at: now,
      actualizada_at: now,
      creada_por: caller.uid,
    },
  });
  return { init_point: s.init_point };
}

async function suscripcion(req: VercelRequest) {
  await requireCaller(req, ["admin"]);
  const b = body<{ proyecto_id?: string; accion?: string }>(req);
  if (!b.proyecto_id) throw new HttpError(400, "Falta el cliente");
  const ref = adminDb().collection("projects").doc(b.proyecto_id);
  const actual = (await ref.get()).data()?.suscripcion;
  if (!actual?.mp_preapproval_id) throw new HttpError(404, "Este cliente no tiene débito automático");
  const now = new Date().toISOString();
  if (b.accion === "cancelar") {
    await actualizarSuscripcion(actual.mp_preapproval_id, { status: "cancelled" });
    await ref.update({ "suscripcion.estado": "cancelada", "suscripcion.actualizada_at": now });
    return { ok: true };
  }
  if (b.accion === "actualizar_monto") {
    const { monto } = await precioAbono(b.proyecto_id);
    if (!(monto > 0)) throw new HttpError(409, "El plan no tiene precio");
    await actualizarSuscripcion(actual.mp_preapproval_id, { monto });
    await ref.update({ "suscripcion.monto": monto, "suscripcion.actualizada_at": now });
    return { ok: true, monto };
  }
  throw new HttpError(400, "Acción inválida");
}

async function verificar(req: VercelRequest) {
  const caller = await requireCaller(req);
  const { cobro_id } = body<{ cobro_id?: string }>(req);
  if (!cobro_id) throw new HttpError(400, "Falta cobro_id");
  const db = adminDb();
  const snap = await db.collection("cobros").doc(cobro_id).get();
  if (!snap.exists) throw new HttpError(404, "Cobro no encontrado");
  const c = snap.data()!;
  await assertProjectAccess(caller, c.proyecto_id);
  if (c.estado !== "pendiente") return { estado: c.estado };
  const pagos = await buscarPagos(cobro_id);
  const aprobado = pagos.find((p) => p.status === "approved") ?? pagos[0];
  if (!aprobado) return { estado: "pendiente" };
  return { estado: await aplicarPago(aprobado, appUrl(req)) };
}

async function reembolsarPieza(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "diseno"]);
  const { pieza_id, nota } = body<{ pieza_id?: string; nota?: string }>(req);
  if (!pieza_id) throw new HttpError(400, "Falta pieza_id");
  const db = adminDb();
  const ref = db.collection("piezas_ia").doc(pieza_id);
  const pz = (await ref.get()).data();
  if (!pz) throw new HttpError(404, "Pieza no encontrada");
  await assertProjectAccess(caller, pz.proyecto_id);

  if (pz.cobro_id) {
    const cRef = db.collection("cobros").doc(pz.cobro_id);
    const c = (await cRef.get()).data();
    if (c?.estado === "aprobado" && c.mp_payment_id) {
      await reembolsar(String(c.mp_payment_id));
      await cRef.update({ estado: "reembolsado" });
    }
  }
  await ref.update({ estado: "rechazada", nota_equipo: String(nota ?? "").slice(0, 500), updated_at: new Date().toISOString() });

  const team = ((await db.collection("projects").doc(pz.proyecto_id).get()).data()?.team_roles ?? {}) as Record<string, string[]>;
  await enviarAviso(
    {
      destinatarios: team.cliente ?? [],
      titulo: "No pudimos hacer tu pieza",
      cuerpo: `${pz.incluida ? "No se descuenta de tu plan." : "Te devolvimos el pago."} ${String(nota ?? "").slice(0, 150)}`,
      link: "/cliente?tab=piezas",
      clave: `pieza_rechazada:${pieza_id}`,
      proyectoId: pz.proyecto_id,
    },
    appUrl(req)
  );
  return { ok: true };
}

/** Mes actual en Argentina (YYYY-MM). */
const mesAR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);

/**
 * El cliente pide una pieza gráfica. Si le quedan piezas del plan este mes, se crea y le llega
 * a diseño; si no, queda pendiente de pago y se devuelve el link de Mercado Pago.
 */
async function pedirPieza(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin", "productor"]);
  const b = body<Record<string, unknown>>(req);
  const pid = String(b.proyecto_id ?? "");
  if (!pid) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, pid);
  const pedido = leerPedidoPieza(b);
  if (typeof pedido === "string") throw new HttpError(400, pedido);
  const db = adminDb();
  const proj = (await db.collection("projects").doc(pid).get()).data() ?? {};
  let incluidas = Number(proj.plan_redes_override?.piezas_mes ?? NaN);
  if (isNaN(incluidas) && proj.plan_redes_id) {
    incluidas = Number((await db.collection("planes_redes").doc(proj.plan_redes_id).get()).data()?.piezas_mes ?? 0);
  }
  incluidas = incluidas || 0;
  const mes = mesAR();
  const base = appUrl(req);
  const ref = db.collection("piezas_ia").doc();

  // Se cuenta y se crea en una transacción: dos pedidos a la vez no se pasan del plan.
  const incluida = await db.runTransaction(async (tx) => {
    const q = await tx.get(db.collection("piezas_ia").where("proyecto_id", "==", pid).where("mes", "==", mes));
    const usadas = q.docs.filter((d) => d.data().incluida === true && !["cancelada", "rechazada"].includes(d.data().estado)).length;
    const entra = usadas < incluidas;
    if (entra) tx.set(ref, piezaDoc(pid, caller.uid, mes, pedido, true, 0));
    return entra;
  });

  if (incluida) {
    await enviarAviso(
      {
        destinatarios: await usuariosConRol(["diseno"]),
        titulo: "Nueva pieza para diseñar",
        cuerpo: `${proj.nombre ?? "Cliente"} · ${FORMATOS_PIEZA[pedido.formato].label} · ${pedido.enfoque === "comercial" ? "para vender" : "para comunicar"}`,
        link: `/piezas?pieza=${ref.id}`,
        clave: `pieza_nueva:${ref.id}`,
        proyectoId: pid,
      },
      base
    );
    return { estado: "creada", pieza_id: ref.id };
  }

  const settings = (await db.collection("app_settings").doc("redes").get()).data() ?? {};
  const monto = precioPieza(settings, pedido.formato);
  if (!(monto > 0)) throw new HttpError(409, "El precio de las piezas no está configurado. Escribinos y lo vemos.");
  await ref.set(piezaDoc(pid, caller.uid, mes, pedido, false, monto));
  const concepto = `Pieza gráfica · ${FORMATOS_PIEZA[pedido.formato].label}`;
  const cobroRef = db.collection("cobros").doc();
  const now = new Date().toISOString();
  await cobroRef.set({
    proyecto_id: pid,
    tipo: "pieza_ia",
    concepto,
    ref_id: ref.id,
    cantidad: 1,
    monto,
    moneda: "ARS",
    estado: "pendiente",
    created_by: caller.uid,
    created_at: now,
  });
  const pref = await crearPreferencia({
    titulo: `Prodi · ${concepto}`,
    monto,
    cantidad: 1,
    externalReference: cobroRef.id,
    notificationUrl: `${base}/api/pagos/webhook`,
    backUrl: `${base}/cliente?tab=piezas&cobro=${cobroRef.id}`,
    email: caller.email,
  });
  await cobroRef.update({ mp_preference_id: pref.id, mp_init_point: pref.init_point });
  await ref.update({ cobro_id: cobroRef.id });
  return { estado: "pago", pieza_id: ref.id, cobro_id: cobroRef.id, monto, init_point: pref.init_point };
}

/** El super admin prepara (o completa) la facturación de un mes. */
async function facturar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "administracion"]);
  const { mes, proyecto_ids } = body<{ mes?: string; proyecto_ids?: unknown }>(req);
  if (!/^\d{4}-\d{2}$/.test(String(mes))) throw new HttpError(400, "Elegí el mes");
  const ids = Array.isArray(proyecto_ids) ? proyecto_ids.map(String).slice(0, 200) : null;
  if (ids && !ids.length) throw new HttpError(400, "Elegí al menos un cliente");
  return { ok: true, ...(await prepararFacturacion(String(mes), caller.uid, ids)) };
}

/**
 * Emite boletas: el cliente la ve en su panel, le llega el aviso (app, push, WhatsApp)
 * y un duplicado por correo con el botón para verla y descargarla desde el sistema.
 */
async function emitir(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "administracion"]);
  const { ids, mes, proyecto_ids } = body<{ ids?: unknown; mes?: unknown; proyecto_ids?: unknown }>(req);
  let lista = Array.isArray(ids) ? ids.map(String).slice(0, 200) : [];
  // Emitir directo a clientes elegidos: arma la boleta si todavía no está y la emite.
  if (Array.isArray(proyecto_ids) && proyecto_ids.length && typeof mes === "string" && /^\d{4}-\d{2}$/.test(mes)) {
    const pids = proyecto_ids.map(String).slice(0, 200);
    await prepararFacturacion(mes, caller.uid, pids);
    lista = [...new Set([...lista, ...pids.map((pid) => facturaId(pid, mes))])];
  }
  if (!lista.length) throw new HttpError(400, "Elegí qué boletas emitir");
  const db = adminDb();
  const base = appUrl(req);
  const now = new Date().toISOString();
  let emitidas = 0;
  let mails = 0;
  const sinMail: string[] = [];
  const fallaMail: string[] = [];
  for (const id of lista) {
    const ref = db.collection("facturas").doc(id);
    const f = await db.runTransaction(async (tx) => {
      const x = (await tx.get(ref)).data() as Factura | undefined;
      if (!x || x.estado !== "borrador") return null;
      tx.update(ref, { estado: "pendiente", emitida_at: now, emitida_por: caller.uid });
      return x;
    });
    if (!f) continue;
    emitidas++;
    const p = (await db.collection("projects").doc(f.proyecto_id).get()).data() ?? {};
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const link = `/cliente?tab=plan&factura=${id}`;
    const doc = f.tipo === "factura" ? "factura" : "boleta";
    await enviarAviso(
      {
        destinatarios: team.cliente ?? [],
        titulo: `Tu ${doc} de ${MESES[Number(f.mes.slice(5)) - 1]}`,
        cuerpo: `Total ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(f.bruto)}${f.debito ? " · se debita solo" : ` · vence el ${f.vencimiento.split("-").reverse().slice(0, 2).join("/")}`}`,
        link,
        clave: `factura:${id}`,
        proyectoId: f.proyecto_id,
      },
      base
    );
    // Duplicado por correo: los mails de contacto del cliente y los de sus usuarios.
    const perfiles = await Promise.all((team.cliente ?? []).slice(0, 10).map((u) => db.collection("profiles").doc(u).get()));
    const destinos = Array.from(
      new Set([...((p.contacto_emails ?? []) as string[]), ...perfiles.map((x) => String(x.data()?.email ?? ""))].map((e) => e.trim().toLowerCase()).filter((e) => /.+@.+\..+/.test(e)))
    );
    if (!destinos.length || p.demo_ejemplo) {
      sinMail.push(f.cliente);
      continue;
    }
    try {
      await enviarMail(destinos, asuntoFactura(f), mailFacturaHtml(f, `${base}${link}`, base));
      await ref.update({ mail_enviado_at: new Date().toISOString(), mail_destinos: destinos });
      mails++;
    } catch (err) {
      console.warn("[emitir] mail", id, err);
      fallaMail.push(f.cliente);
    }
  }
  return { ok: true, emitidas, mails, sin_mail: sinMail, falla_mail: fallaMail };
}

async function pedirVideo(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin"]);
  const b = body<{ proyecto_id?: string; mes?: string; fecha_deseada?: string | null; titulo?: string; idea?: string; objetivo?: string }>(req);
  // Con fecha, el mes sale de la fecha (no puede ser pasada ni a más de 4 meses).
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha_deseada ?? "")) ? String(b.fecha_deseada) : null;
  if (fecha) {
    const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const tope = new Date(Date.now() + 125 * 86_400_000).toISOString().slice(0, 10);
    if (fecha < hoy || fecha > tope) throw new HttpError(400, "Elegí una fecha entre hoy y los próximos 3 meses");
    b.mes = fecha.slice(0, 7);
  }
  if (!b.proyecto_id || !/^\d{4}-\d{2}$/.test(String(b.mes))) throw new HttpError(400, "Datos incompletos");
  await assertProjectAccess(caller, b.proyecto_id);
  const titulo = String(b.titulo ?? "").trim().slice(0, 120);
  if (titulo.length < 3) throw new HttpError(400, "Contanos de qué se trata el video");
  const mes = String(b.mes);
  const pedido = {
    titulo,
    idea: String(b.idea ?? "").trim().slice(0, 2000) || null,
    objetivo: String(b.objetivo ?? "").trim().slice(0, 200) || null,
    fecha_deseada: fecha,
    pedido_por: caller.uid,
  };

  const db = adminDb();
  const pRef = db.collection("projects").doc(b.proyecto_id);
  const proj = (await pRef.get()).data() ?? {};
  let incluidos = Number(proj.plan_redes_override?.videos_mes ?? NaN);
  let precioExtra = Number(proj.plan_redes_override?.precio_video_extra ?? NaN);
  if (proj.plan_redes_id && (isNaN(incluidos) || isNaN(precioExtra))) {
    const plan = (await db.collection("planes_redes").doc(proj.plan_redes_id).get()).data() ?? {};
    if (isNaN(incluidos)) incluidos = Number(plan.videos_mes ?? 0);
    if (isNaN(precioExtra)) precioExtra = Number(plan.precio_video_extra ?? 0);
  }
  incluidos = incluidos || 0;
  const cupo = incluidos + Number(proj.creditos_extra?.[mes] ?? 0);
  const videosMes = await db.collection("videos").where("proyecto_id", "==", b.proyecto_id).where("mes", "==", mes).get();
  const usados = videosMes.docs.filter((d) => d.data().extra !== true).length;
  const team = (proj.team_roles ?? {}) as Record<string, string[]>;
  const base = appUrl(req);

  // Entra en el plan: se crea directo y producción recibe el aviso.
  if (usados < cupo) {
    const ref = db.collection("videos").doc();
    await ref.set(videoDesdePedido(b.proyecto_id, team, mes, pedido, "Pedido por el cliente"));
    await enviarAviso(
      {
        destinatarios: team.productor ?? [],
        titulo: "El cliente pidió un video",
        cuerpo: `${proj.nombre ?? "Cliente"} · ${titulo}${fecha ? ` · para el ${fecha.split("-").reverse().join("/")}` : ""}`,
        link: `/videos?video=${ref.id}`,
        clave: `pedido_video:${ref.id}`,
        proyectoId: b.proyecto_id,
        videoId: ref.id,
      },
      base
    );
    return { estado: "creado", video_id: ref.id };
  }

  // Se pasa del plan: se cobra como video extra.
  if (!(precioExtra > 0)) throw new HttpError(409, "Tu plan no tiene precio de video extra. Escribinos y lo vemos.");
  const [y, m] = mes.split("-").map(Number);
  const concepto = `Video extra · ${MESES[m - 1]} ${y}: ${titulo}`.slice(0, 120);
  const cobroRef = db.collection("cobros").doc();
  await cobroRef.set({
    proyecto_id: b.proyecto_id,
    tipo: "video_extra",
    concepto,
    ref_id: mes,
    cantidad: 1,
    monto: precioExtra,
    moneda: "ARS",
    estado: "pendiente",
    pedido,
    created_by: caller.uid,
    created_at: new Date().toISOString(),
  });
  const pref = await crearPreferencia({
    titulo: `Prodi · ${concepto}`,
    monto: precioExtra,
    cantidad: 1,
    externalReference: cobroRef.id,
    notificationUrl: `${base}/api/pagos/webhook`,
    backUrl: `${base}/cliente?cobro=${cobroRef.id}`,
    email: caller.email,
  });
  await cobroRef.update({ mp_preference_id: pref.id, mp_init_point: pref.init_point });
  return { estado: "pago", init_point: pref.init_point, cobro_id: cobroRef.id, monto: precioExtra };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const accion = String(req.query.accion ?? "");
  if (req.method !== "POST" && !(accion === "webhook" && req.method === "GET")) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    if (accion === "crear") res.status(200).json(await crear(req));
    else if (accion === "webhook") res.status(200).json(await webhook(req));
    else if (accion === "verificar") res.status(200).json(await verificar(req));
    else if (accion === "reembolsar") res.status(200).json(await reembolsarPieza(req));
    else if (accion === "suscribir") res.status(200).json(await suscribir(req));
    else if (accion === "suscripcion") res.status(200).json(await suscripcion(req));
    else if (accion === "pedir-video") res.status(200).json(await pedirVideo(req));
    else if (accion === "pedir-pieza") res.status(200).json(await pedirPieza(req));
    else if (accion === "facturar") res.status(200).json(await facturar(req));
    else if (accion === "emitir") res.status(200).json(await emitir(req));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    // Si falla el webhook respondemos error: Mercado Pago lo reintenta solo.
    sendError(res, err);
  }
}
