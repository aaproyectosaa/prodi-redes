// Pagos con Mercado Pago (Checkout Pro).
// POST /api/pagos/crear       { tipo: "pieza_ia", pieza_id } | { tipo: "video_extra", proyecto_id, mes, cantidad } | { tipo: "viatico", video_id }
// POST /api/pagos/webhook     (lo llama Mercado Pago)
// POST /api/pagos/verificar   { cobro_id }  (al volver del checkout)
// POST /api/pagos/reembolsar  { pieza_id, nota }  (el equipo rechaza una pieza)
// POST /api/pagos/suscribir   { proyecto_id, email }  (cliente o admin) → débito automático del abono
// POST /api/pagos/suscripcion { proyecto_id, accion: "cancelar" | "actualizar_monto" }  (admin)
// POST /api/pagos/pedir-video { proyecto_id, mes, titulo, idea?, objetivo?, filma_cliente?, localidad? }  (cliente)
//      Filmación nueva fuera de Reconquista: viáticos por zona (ver _lib/viaticos.ts). Si es extra van en el mismo pago;
//      si entra en el plan, el video se crea y vuelve el link para pagar el viaje.
//      → si entra en el plan se crea; si no, se cobra como video extra y se crea al pagar.
//        Si lo filma el cliente ("Yo mando el material", o la ficha dice que filma él) arranca esperando su material.
// POST /api/pagos/arca-autorizar { factura_id, reintentar? }  (admin/administración) → CAE de ARCA para una boleta emitida
// POST /api/pagos/arca-estado    (admin) → prueba la conexión con ARCA

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "../_lib/db";
import { adminDb, aplicarEscritura, ejecutarConsulta, enTransaccion, leerDoc, type Data, type DocRef, type Query } from "../_lib/db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError } from "../_lib/http";
import {
  actualizarSuscripcion,
  buscarPagos,
  crearPreferencia,
  detalleDePago,
  crearSuscripcion,
  faltaSecretoWebhook,
  firmaValida,
  obtenerCobroSuscripcion,
  obtenerPago,
  obtenerSuscripcion,
  reembolsar,
  type PagoMP,
} from "../_lib/mercadopago";
import { aplicarPago, estadoSuscripcion, precioAbono, proyectoDeSuscripcion, registrarAbono } from "../_lib/cobros";
import { completarAlta, marcarAlta } from "../_lib/alta-web";
import { destinatariosDe, disenadorasDe, enviarAviso } from "../_lib/notify";
import { ESTADOS_IDEA_EDITABLE, FORMATOS_PIEZA, cupoPieza, leerPedidoPieza, piezaDoc, precioPieza } from "../_lib/piezas";
import { prepararFacturacion } from "../_lib/facturar";
import { asuntoFactura, facturaId, mailFacturaHtml, periodoFactura, saldoDe, pagoUnaParte, type Factura } from "../_lib/facturacion";
import { enviarMail } from "../_lib/informe";
import {
  archivosBaseDe,
  filmaElCliente,
  preferenciaRodaje,
  textoMaterial,
  videoDesdePedido,
  type MaterialBase,
  type PedidoVideo,
  type TipoMaterial,
} from "../_lib/pedidos";
import { hoyAR, mesAR, sumarMeses } from "../_lib/fecha";
import { autorizarFactura, estadoArca } from "../_lib/arca";
import { viajeYaPago, viaticoDe, type ViaticoVideo } from "../_lib/viaticos";
import { cuentaJornada, MAX_VIDEOS_JORNADA, promoJornada } from "../_lib/jornada";
import { actualizarMora, moraBloquea } from "../_lib/mora";

export const config = { maxDuration: 30 };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Para dónde es un video extra: Instagram/Facebook ("meta", el de siempre), TikTok o YouTube. */
type Plataforma = "meta" | "tiktok" | "short" | "youtube";
const PLATAFORMA_NOMBRE: Record<Plataforma, string> = { meta: "Instagram/Facebook", tiktok: "TikTok", short: "YouTube Shorts", youtube: "YouTube" };
const plataformaDe = (v: unknown): Plataforma => (v === "tiktok" || v === "short" || v === "youtube" ? v : "meta");

/** Precio del video extra de un cliente para esa plataforma (TikTok y YouTube, si no tienen uno propio, el de Instagram). */
async function precioExtra(proj: Data, plataforma: Plataforma): Promise<number> {
  const o = (proj.plan_redes_override ?? {}) as Data;
  let meta = o.precio_video_extra ?? null;
  if (meta == null && proj.plan_redes_id) {
    const plan = (await adminDb().collection("planes_redes").doc(String(proj.plan_redes_id)).get()).data();
    meta = plan?.precio_video_extra ?? null;
  }
  const propio = plataforma === "tiktok" ? o.precio_extra_tiktok : plataforma === "short" ? o.precio_extra_short : plataforma === "youtube" ? o.precio_extra_youtube : null;
  return Number(propio ?? meta ?? 0) || 0;
}

async function crear(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin", "productor"]);
  const b = body<{ tipo?: string; pieza_id?: string; proyecto_id?: string; mes?: string; cantidad?: number; plataforma?: string; video_id?: string }>(req);
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
    const plataforma = plataformaDe(b.plataforma);
    const unit = await precioExtra(proj, plataforma);
    if (!(Number(unit) > 0)) throw new HttpError(409, "Este plan no tiene precio de video extra");
    monto = Number(unit) * cantidad;
    const [y, m] = String(b.mes).split("-").map(Number);
    concepto = `${cantidad} video${cantidad === 1 ? "" : "s"} extra${plataforma === "meta" ? "" : ` para ${PLATAFORMA_NOMBRE[plataforma]}`} · ${MESES[m - 1]} ${y}`;
    refId = String(b.mes);
    tab = "plan";
  } else if (b.tipo === "viatico") {
    // Viáticos que quedaron sin pagar (video del plan que se filma fuera de Reconquista).
    if (!b.video_id) throw new HttpError(400, "Falta video_id");
    const v = (await db.collection("videos").doc(b.video_id).get()).data();
    if (!v) throw new HttpError(404, "Video no encontrado");
    await assertProjectAccess(caller, v.proyecto_id);
    const vi = v.viatico as ViaticoVideo | null;
    if (vi?.estado !== "pendiente" || !(Number(vi.monto) > 0)) throw new HttpError(409, "Este video no tiene viáticos para pagar");
    const prev = (await db.collection("cobros").where("tipo", "==", "viatico").where("ref_id", "==", b.video_id).get()).docs.find(
      (d) => d.data().estado === "pendiente" && d.data().mp_init_point
    );
    if (prev) return { init_point: prev.data().mp_init_point as string, cobro_id: prev.id };
    proyectoId = v.proyecto_id;
    monto = Number(vi.monto);
    concepto = `Viáticos de filmación en ${vi.localidad} · ${String(v.titulo ?? "").slice(0, 60)}`;
    refId = b.video_id;
    tab = "videos";
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
  try {
    return await procesarWebhook(req);
  } catch (err) {
    // Un pago o suscripción que no existe (ej. "Simular notificación" de Mercado Pago, que manda uno inventado):
    // se responde OK para que no reintente; no hay nada que aplicar.
    if ((err as { status?: number }).status === 404) return { ok: true, ignorado: "no existe en Mercado Pago" };
    throw err;
  }
}

async function procesarWebhook(req: VercelRequest) {
  const b = body<{ type?: string; action?: string; data?: { id?: string | number }; topic?: string; resource?: string }>(req);
  const q = req.query as Record<string, string>;
  const tipo = b.type ?? q.type ?? q.topic ?? b.topic ?? "";
  const id = String(b.data?.id ?? q["data.id"] ?? q.id ?? "");
  const base = appUrl(req);
  if (!id || !["payment", "subscription_preapproval", "subscription_authorized_payment"].includes(tipo)) {
    return { ok: true, ignorado: true };
  }
  // En producción sin secreto no se procesa nada (Mercado Pago reintenta cuando se configure).
  if (faltaSecretoWebhook()) {
    console.error("[pagos] falta MP_WEBHOOK_SECRET en producción: webhook rechazado");
    throw new HttpError(503, "Webhook sin configurar");
  }
  // Con secreto, toda notificación (también las de pagos) tiene que venir firmada y bien.
  if (!firmaValida(req.headers as Record<string, unknown>, id)) {
    throw new HttpError(401, "Firma inválida");
  }

  // Alta, pausa o baja del débito automático.
  if (tipo === "subscription_preapproval") {
    const s = await obtenerSuscripcion(id);
    // Compra de un plan en somosprodi.com: al autorizarse el débito se crea el cliente (api/_lib/alta-web.ts).
    if (s.external_reference?.startsWith("alta:")) {
      const altaId = s.external_reference.slice(5);
      if (s.status === "authorized") await completarAlta(altaId, s, base);
      else await marcarAlta(altaId, estadoSuscripcion(s.status));
    }
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
    // Si el primer cobro de una compra de la web llega antes que el aviso de la suscripción, primero se crea el cliente.
    if (sus?.external_reference?.startsWith("alta:") && sus.status === "authorized") await completarAlta(sus.external_reference.slice(5), sus, base);
    const pid = await proyectoDeSuscripcion(c.preapproval_id, sus?.external_reference);
    if (!pid || !c.payment?.id) return { ok: true, ignorado: "sin pago" };
    const pago = await obtenerPago(String(c.payment.id));
    const estadoAbono = await registrarAbono(datosAbono(pid, pago), base);
    // Si pagó lo que debía, sale de la mora al toque.
    await actualizarMora(pid, base).catch(() => undefined);
    return { ok: true, estado: estadoAbono };
  }

  const pago = await obtenerPago(id);
  if (pago.external_reference?.startsWith("abono:")) {
    const pidAbono = pago.external_reference.slice(6);
    const estadoAbono = await registrarAbono(datosAbono(pidAbono, pago), base);
    await actualizarMora(pidAbono, base).catch(() => undefined);
    return { ok: true, estado: estadoAbono };
  }
  const estado = await aplicarPago(pago, base);
  // Cuánto entra de verdad (sin la comisión) y cuándo se libera: para repartir el cobro.
  if (estado === "aprobado" && pago.external_reference) await guardarDetalleMp(pago.external_reference, pago).catch(() => undefined);
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

  const { nombre, plan, monto, comision_pct } = await precioAbono(b.proyecto_id);
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
      // Comisión de Mercado Pago que ya va sumada en `monto` (se descuenta al aplicar cada débito).
      comision_pct,
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
    // Total de la boleta + comisión de Mercado Pago de Ajustes (las suscripciones viejas quedan con su
    // monto hasta que se toca "Cobrar $X desde ahora").
    const { monto, comision_pct } = await precioAbono(b.proyecto_id);
    if (!(monto > 0)) throw new HttpError(409, "El plan no tiene precio");
    await actualizarSuscripcion(actual.mp_preapproval_id, { monto });
    await ref.update({ "suscripcion.monto": monto, "suscripcion.comision_pct": comision_pct, "suscripcion.actualizada_at": now });
    return { ok: true, monto };
  }
  throw new HttpError(400, "Acción inválida");
}

/**
 * Cambiar la idea (el pedido) de una pieza antes de que diseño la empiece: el cliente, la productora del cliente o el
 * admin. Queda en el historial (quién, cuándo y el texto anterior) y, si el cliente tiene diseñadora, se le avisa.
 */
async function piezaIdea(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "productor", "admin"]);
  const b = body<{ pieza_id?: string; pedido?: string }>(req);
  if (!b.pieza_id) throw new HttpError(400, "Falta la pieza");
  const nuevo = String(b.pedido ?? "").trim().slice(0, 2000);
  if (nuevo.length < 10) throw new HttpError(400, "Contanos un poco más (al menos 10 letras)");
  const db = adminDb();
  const ref = db.collection("piezas_ia").doc(b.pieza_id);
  const pz = (await ref.get()).data();
  if (!pz) throw new HttpError(404, "La pieza ya no existe");
  await assertProjectAccess(caller, pz.proyecto_id);
  const team = ((await db.collection("projects").doc(String(pz.proyecto_id)).get()).data()?.team_roles ?? {}) as Record<string, string[]>;
  // Del equipo: solo el admin o la productora de ese cliente (diseño y edición no la cambian).
  const esAdmin = caller.role === "admin";
  const esCliente = caller.role === "cliente" && (team.cliente ?? []).includes(caller.uid);
  const esProductora = caller.roles.includes("productor") && (team.productor ?? []).includes(caller.uid);
  if (!esAdmin && !esCliente && !esProductora) throw new HttpError(403, "No podés cambiar esta pieza");
  // El cliente, solo antes de que se empiece a diseñar; el admin y la productora, siempre (salvo cancelada o rechazada).
  if (esCliente && !esAdmin && !esProductora && !ESTADOS_IDEA_EDITABLE.includes(String(pz.estado)))
    throw new HttpError(409, "Ya la está diseñando: la idea no se puede cambiar. Escribile al equipo por el chat.");
  if (["cancelada", "rechazada"].includes(String(pz.estado))) throw new HttpError(409, "Esta pieza ya no está activa");
  const anterior = String(pz.pedido ?? "");
  if (anterior.trim() === nuevo) return { ok: true, sinCambios: true };
  const now = new Date().toISOString();
  await ref.update({
    pedido: nuevo,
    updated_at: now,
    historial: FieldValue.arrayUnion({ at: now, by: caller.uid, accion: "Cambió la idea", nota: `Antes: ${anterior}`.slice(0, 2000) }),
  });
  // Si el cliente ya tiene diseñadora asignada, se le avisa (aviso interno + push, como el resto de los avisos de piezas).
  if ((team.diseno ?? []).length > 0) {
    const destinatarios = (await disenadorasDe(pz.proyecto_id)).filter((id) => id !== caller.uid);
    if (destinatarios.length) {
      const proj = (await db.collection("projects").doc(String(pz.proyecto_id)).get()).data() ?? {};
      await enviarAviso(
        {
          destinatarios,
          titulo: "Cambió la idea de una pieza",
          cuerpo: `${proj.nombre ?? "Cliente"}: ${nuevo.slice(0, 160)}`,
          link: `/piezas?pieza=${b.pieza_id}`,
          clave: `pieza_idea:${b.pieza_id}:${now}`,
          proyectoId: pz.proyecto_id,
        },
        appUrl(req)
      ).catch((e) => console.warn("[pieza-idea] aviso", e));
    }
  }
  return { ok: true };
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
  const estado = await aplicarPago(aprobado, appUrl(req));
  if (estado === "aprobado") await guardarDetalleMp(cobro_id, aprobado).catch(() => undefined);
  return { estado };
}

/** Guarda en el cobro lo que se quedó Mercado Pago, lo neto y cuándo se libera la plata. */
async function guardarDetalleMp(cobroId: string, pago: PagoMP) {
  const db = adminDb();
  const ref = db.collection("cobros").doc(cobroId);
  const c = (await ref.get()).data();
  if (!c) return;
  const det = detalleDePago(pago);
  await ref.update({ ...det, mp_payment_id: String(pago.id) });
  // Los trabajos que pagó este extra: se marcan para que no cuenten en el pago del mes del equipo (se pagan aparte,
  // cuando se libera la plata) y para que cada uno vea cuándo se le libera.
  const marca = { cobro_extra_id: cobroId, extra_libera_at: det.mp_libera_at };
  const docs =
    c.tipo === "pieza_ia"
      ? [db.collection("piezas_ia").doc(String(c.ref_id))]
      : c.tipo === "video_extra"
        ? [db.collection("videos").doc(`pedido_${cobroId}`)]
        : c.tipo === "jornada"
          ? ((c.detalle?.items ?? []) as { plan: boolean }[]).flatMap((it, i) => (it.plan ? [] : [db.collection("videos").doc(`pedido_${cobroId}_${i}`)]))
          : [];
  for (const d of docs) if ((await d.get()).exists) await d.update(marca);
}

/**
 * Para repartir lo cobrado (Cobros → detalle): trae de Mercado Pago la comisión, lo neto y la fecha de liberación
 * de los cobros aprobados que todavía no lo tienen (o que no se liberaron). Solo administración.
 */
async function mpDetalle(req: VercelRequest) {
  await requireCaller(req, ["admin", "administracion"]);
  const { cobro_ids } = body<{ cobro_ids?: string[] }>(req);
  const ids = (Array.isArray(cobro_ids) ? cobro_ids : []).filter((x) => typeof x === "string").slice(0, 30);
  const db = adminDb();
  const out: Record<string, ReturnType<typeof detalleDePago>> = {};
  for (const id of ids) {
    const c = (await db.collection("cobros").doc(id).get()).data();
    if (!c || c.estado !== "aprobado") continue;
    if (c.mp_neto != null && c.mp_liberado) continue;
    try {
      const pago = c.mp_payment_id ? await obtenerPago(String(c.mp_payment_id)) : (await buscarPagos(id)).find((x) => x.status === "approved");
      if (!pago) continue;
      await guardarDetalleMp(id, pago);
      out[id] = detalleDePago(pago);
    } catch (err) {
      console.warn("[pagos] detalle de MP", id, err instanceof Error ? err.message : err);
    }
  }
  return { ok: true, detalles: out };
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
      cuerpo: `${pz.cobro_id ? "Te devolvimos el pago." : pz.incluida ? "No se descuenta de tu plan." : ""} ${String(nota ?? "").slice(0, 150)}`,
      link: "/cliente?tab=piezas",
      clave: `pieza_rechazada:${pieza_id}`,
      proyectoId: pz.proyecto_id,
    },
    appUrl(req)
  );
  return { ok: true };
}

/**
 * Cuenta lo usado del mes y crea el documento si entra, en una transacción con un lock por cliente
 * y mes: el FOR UPDATE de la consulta no frena los inserts nuevos, el lock sí (dos pedidos a la vez
 * no se pasan del plan).
 */
async function crearSiHayCupo(o: {
  /** Qué se cuenta ("pieza" / "video"): va en la clave del lock junto con el cliente y el mes. */
  tipo: string;
  pid: string;
  mes: string;
  /** Lo que ya hay del mes (se filtra con `usado`). */
  consulta: Query;
  usado: (d: Data) => boolean;
  /** Cuánto ocupa cada uno de lo ya usado (por defecto 1) y cuánto ocupa el nuevo. */
  peso?: (d: Data) => number;
  ocupa?: number;
  /** Cupo según el cliente (se lee dentro de la transacción: los créditos extra pueden cambiar). */
  cupo: (proyecto: Data) => number;
  ref: DocRef;
  data: () => Data;
}): Promise<boolean> {
  return enTransaccion(async (cli) => {
    await cli.query("select pg_advisory_xact_lock(hashtext($1))", [`${o.tipo}:${o.pid}:${o.mes}`]);
    const proyecto = (await leerDoc(cli, "projects", o.pid)) ?? {};
    const usados = (await ejecutarConsulta(cli, o.consulta.consulta)).filter((f) => o.usado(f.data)).reduce((a, f) => a + (o.peso?.(f.data) ?? 1), 0);
    if (usados + (o.ocupa ?? 1) > o.cupo(proyecto)) return false;
    await aplicarEscritura(cli, { tipo: "create", coleccion: o.ref.coleccion, id: o.ref.id, data: o.data() });
    return true;
  });
}

/**
 * El cliente pide una pieza gráfica. Si le quedan piezas del plan este mes, se crea y le llega
 * a diseño; si no, queda pendiente de pago y se devuelve el link de Mercado Pago.
 */
/** Mora: un cliente atrasado no puede pedir extras (desde "sin extras") ni nada (en "pausa"). El equipo sí. */
async function moraCliente(caller: { role: string }, pid: string, extra: boolean) {
  if (caller.role !== "cliente") return;
  const msg = await moraBloquea(pid, extra);
  if (msg) throw new HttpError(402, msg);
}

/** Recalcula la mora de un cliente (después de registrar un pago, editar una boleta o dar una tregua). */
async function moraRecalcular(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "administracion"]);
  const { proyecto_id } = body<{ proyecto_id?: string }>(req);
  if (!proyecto_id) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, proyecto_id);
  return { mora: await actualizarMora(proyecto_id, appUrl(req)) };
}

/** Panel de morosos: "Recordar ahora" le manda al cliente (app y mail) lo que debe con el interés a hoy. */
async function moraRecordar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "administracion"]);
  const { proyecto_id } = body<{ proyecto_id?: string }>(req);
  if (!proyecto_id) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, proyecto_id);
  const e = await actualizarMora(proyecto_id, null);
  if (!e || e.dias <= 0) throw new HttpError(400, "Ese cliente no tiene pagos vencidos");
  const ars = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
  const clientes = await destinatariosDe(proyecto_id, ["cliente"], false);
  if (!clientes.length) throw new HttpError(400, "Ese cliente no tiene usuarios para avisarle");
  await enviarAviso(
    {
      destinatarios: clientes,
      titulo: "Tenés un pago atrasado",
      cuerpo: `Hace ${e.dias} día${e.dias === 1 ? "" : "s"} que venció. Hoy son ${ars(e.deuda + e.interes)} con el interés (0,5% por día). Si ya lo pagaste, avisanos y lo marcamos.`,
      link: "/cliente?tab=plan",
      clave: `mora-recordar:${proyecto_id}:${new Date().toISOString().slice(0, 10)}`,
      proyectoId: proyecto_id,
    },
    appUrl(req)
  );
  await adminDb().collection("projects").doc(proyecto_id).update({ mora_recordado_at: new Date().toISOString() });
  return { ok: true };
}

async function pedirPieza(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin", "productor"]);
  const b = body<Record<string, unknown>>(req);
  const pid = String(b.proyecto_id ?? "");
  if (!pid) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, pid);
  const pedido = leerPedidoPieza(b);
  if (typeof pedido === "string") throw new HttpError(400, pedido);
  await moraCliente(caller, pid, false);
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
  const settings = (await db.collection("app_settings").doc("redes").get()).data() ?? {};
  // No todas valen lo mismo: un banner puede ocupar 2 piezas del plan.
  const ocupa = cupoPieza(settings, pedido.formato);
  // Para la bandeja "Pedidos" del equipo: la pidió el cliente (no la cargó producción).
  const piezaDocDe = (incl: boolean, precio: number, cupo?: number) => ({
    ...piezaDoc(pid, caller.uid, mes, pedido, incl, precio, cupo),
    pedido_cliente: caller.role === "cliente",
  });

  // Se cuenta y se crea con lock: dos pedidos a la vez no se pasan del plan. Lo que no entra en el plan
  // (ocupa 0: cartelería, otros diseños) va directo a "aparte".
  const incluida = ocupa > 0 && await crearSiHayCupo({
    tipo: "pieza",
    pid,
    mes,
    consulta: db.collection("piezas_ia").where("proyecto_id", "==", pid).where("mes", "==", mes),
    usado: (d) => d.incluida === true && !["cancelada", "rechazada"].includes(d.estado),
    peso: (d) => Number(d.cupo_usado) || 1,
    ocupa,
    cupo: () => incluidas,
    ref,
    data: () => piezaDocDe(true, 0, ocupa),
  });

  // Cargada por el equipo (productora o admin) y ya no le quedan piezas del plan: se elige en el momento.
  const delEquipo = caller.role === "admin" || caller.roles.includes("productor");
  if (!incluida && delEquipo) {
    const fuera = String(b.fuera_plan ?? "");
    if (fuera !== "sin_cargo" && fuera !== "cobrar") return { estado: "sin_cupo", incluidas, ocupa };
    if (fuera === "sin_cargo") {
      const d = piezaDocDe(false, 0);
      await ref.set({
        ...d,
        estado: "pagada",
        historial: [{ at: d.created_at, by: caller.uid, accion: "Cargada por el equipo (sin cargo, fuera del plan)", nota: null }],
      });
      await enviarAviso(
        {
          destinatarios: await disenadorasDe(pid),
          titulo: "Nueva pieza para diseñar",
          cuerpo: `${proj.nombre ?? "Cliente"} · ${FORMATOS_PIEZA[pedido.formato].label} · la cargó el equipo`,
          link: `/piezas?pieza=${ref.id}`,
          clave: `pieza_nueva:${ref.id}`,
          proyectoId: pid,
        },
        base
      );
      return { estado: "creada", pieza_id: ref.id };
    }
    // "Que la pague el cliente": queda pendiente de pago y le avisamos para que la pague desde su panel.
    const monto = precioPieza(settings, pedido.formato);
    if (!(monto > 0)) throw new HttpError(409, "El precio de las piezas no está configurado (Ajustes).");
    await ref.set(piezaDocDe(false, monto));
    await enviarAviso(
      {
        destinatarios: await destinatariosDe(pid, ["cliente"], false),
        titulo: "Te preparamos una pieza",
        cuerpo: `${FORMATOS_PIEZA[pedido.formato].label} · se paga aparte del plan. Pagala desde tu panel y la empezamos.`,
        link: `/cliente?tab=piezas&pieza=${ref.id}`,
        clave: `pieza_cobrar:${ref.id}`,
        proyectoId: pid,
      },
      base
    ).catch((err) => console.warn("[pieza] aviso al cliente", err));
    return { estado: "pendiente_cliente", pieza_id: ref.id, monto };
  }

  if (incluida) {
    await enviarAviso(
      {
        destinatarios: await disenadorasDe(pid),
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

  const monto = precioPieza(settings, pedido.formato);
  if (!(monto > 0)) throw new HttpError(409, "El precio de las piezas no está configurado. Escribinos y lo vemos.");
  await ref.set(piezaDocDe(false, monto));
  const concepto = `Pieza gráfica · ${FORMATOS_PIEZA[pedido.formato].label}`;
  await moraCliente(caller, pid, true);
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
 * Emite boletas: el cliente la ve en su panel, le llega el aviso (app, push, correo)
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
  /** Facturas que ARCA no autorizó: no se mandaron y vuelven a «Emitir». */
  const arcaFallas: { cliente: string; error: string }[] = [];
  for (const id of lista) {
    const ref = db.collection("facturas").doc(id);
    const f = await db.runTransaction(async (tx) => {
      const x = (await tx.get(ref)).data() as Factura | undefined;
      if (!x || x.estado !== "borrador") return null;
      tx.update(ref, { estado: "pendiente", emitida_at: now, emitida_por: caller.uid });
      return x;
    });
    if (!f) continue;
    // La factura es el documento legal: se le manda recién con el CAE de ARCA. La boleta no pasa por ARCA.
    if (f.tipo === "factura" && !f.arca?.cae) {
      try {
        // En la app publicada nunca se le manda al cliente un comprobante de prueba (homologación).
        if (process.env.VERCEL_ENV === "production" && process.env.ARCA_PRODUCCION !== "true") {
          throw new Error("ARCA está en modo prueba (falta ARCA_PRODUCCION=true en Vercel)");
        }
        f.arca = await autorizarFactura(id, caller.uid);
      } catch (err) {
        await ref.update({ estado: "borrador", emitida_at: null, emitida_por: null });
        arcaFallas.push({ cliente: f.cliente, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
    }
    emitidas++;
    const p = (await db.collection("projects").doc(f.proyecto_id).get()).data() ?? {};
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const link = `/cliente?tab=plan&factura=${id}`;
    const doc = f.tipo === "factura" ? "factura" : "boleta";
    const ars = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
    const vto = f.vencimiento.split("-").reverse().slice(0, 2).join("/");
    // Si el débito automático no cubrió todo (monto viejo en la suscripción), el cliente paga la diferencia.
    const saldo = pagoUnaParte(f) ? saldoDe(f) : 0;
    await enviarAviso(
      {
        destinatarios: team.cliente ?? [],
        titulo: `Tu ${doc} de ${MESES[Number(periodoFactura(f).slice(5)) - 1]}`,
        cuerpo: `Total ${ars(f.bruto)}${
          saldo > 0
            ? ` · falta pagar ${ars(saldo)}, vence el ${vto} (después, 0,5% de interés por día)`
            : f.debito
              ? " · se debita solo"
              : ` · vence el ${vto} (después, 0,5% de interés por día)`
        }`,
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
  return { ok: true, emitidas, mails, sin_mail: sinMail, falla_mail: fallaMail, arca_fallas: arcaFallas };
}

async function arcaAutorizar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "administracion"]);
  const { factura_id, reintentar } = body<{ factura_id?: string; reintentar?: boolean }>(req);
  if (!factura_id || !/^[^/\s]{1,200}$/.test(factura_id)) throw new HttpError(400, "Falta la boleta");
  return { ok: true, arca: await autorizarFactura(factura_id, caller.uid, { reintentar: !!reintentar }) };
}

async function arcaEstado(req: VercelRequest) {
  await requireCaller(req, ["admin"]);
  return { ok: true, ...(await estadoArca()) };
}

/**
 * Después de un pedido que entró en el plan: si al cliente le queda 1 video del mes, o ninguno, se le
 * avisa (app, push y mail) para que no se entere recién al pedir el próximo. Si falla, el pedido sigue igual.
 */
async function avisarCupo(pid: string, mes: string, incluidos: number, creditosExtra: number, clientes: string[], base: string) {
  if (!clientes.length) return;
  const cupo = incluidos + creditosExtra;
  if (cupo <= 0) return;
  const q = await adminDb().collection("videos").where("proyecto_id", "==", pid).where("mes", "==", mes).get();
  const usados = q.docs.filter((d) => d.data().extra !== true).length;
  const quedan = cupo - usados;
  if (quedan > 1) return;
  const [y, m] = mes.split("-").map(Number);
  const nombre = MESES[m - 1];
  const siguiente = MESES[m % 12];
  await enviarAviso(
    {
      destinatarios: clientes,
      titulo: quedan === 1 ? `Te queda 1 video de ${nombre}` : `Se te terminaron los videos de ${nombre}`,
      cuerpo:
        quedan === 1
          ? `Usaste ${usados} de los ${cupo} videos de tu plan de ${nombre} ${y}. El 1 de ${siguiente} se renuevan.`
          : `Ya usaste los ${cupo} videos de tu plan de ${nombre} ${y}. Si necesitás otro, podés pedir un video extra desde la app, o esperar al 1 de ${siguiente}, cuando se renuevan.`,
      link: "/cliente?tab=plan",
      clave: `cupo_videos:${pid}:${mes}:${quedan === 1 ? "uno" : "cero"}`,
      proyectoId: pid,
    },
    base
  );
}

async function pedirVideo(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin"]);
  const b = body<{
    proyecto_id?: string;
    mes?: string;
    fecha_deseada?: string | null;
    titulo?: string;
    idea?: string;
    objetivo?: string;
    filma_cliente?: boolean;
    /** Con qué material: { tipo: "existente", archivos: [drive_file_id] } | { tipo: "nueva", preferencia? } | { tipo: "cliente" }. */
    material?: { tipo?: unknown; archivos?: unknown; preferencia?: unknown };
    /** Si es extra: para dónde es (meta | tiktok | youtube), cambia el precio. */
    plataforma?: string;
    /** Filmación nueva: en qué localidad se filma (viáticos). */
    localidad?: string;
    /** Más videos para filmar en la misma jornada (un solo viaje, promo desde el 2º extra). */
    otros?: { titulo?: unknown; idea?: unknown }[];
    /** Extra: el cliente lo quiere para subirlo él (no lo publicamos nosotros). Solo cuenta si termina siendo extra. */
    sube_cliente?: boolean;
  }>(req);
  // Con fecha, el mes sale de la fecha (no puede ser pasada). Con o sin fecha, el mes tiene que ser
  // este o uno de los 3 siguientes (hora de Argentina): si no, cada mes viejo o lejano daría su cupo gratis.
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha_deseada ?? "")) ? String(b.fecha_deseada) : null;
  const mesActual = mesAR();
  const mesTope = sumarMeses(mesActual, 3);
  if (fecha) {
    if (fecha < hoyAR() || fecha.slice(0, 7) > mesTope) throw new HttpError(400, "Elegí una fecha entre hoy y los próximos 3 meses");
    b.mes = fecha.slice(0, 7);
  }
  if (!b.proyecto_id || !/^\d{4}-\d{2}$/.test(String(b.mes))) throw new HttpError(400, "Datos incompletos");
  if (String(b.mes) < mesActual || String(b.mes) > mesTope) throw new HttpError(400, "Elegí este mes o uno de los próximos 3");
  await moraCliente(caller, String(b.proyecto_id), false);
  await assertProjectAccess(caller, b.proyecto_id);
  const titulo = String(b.titulo ?? "").trim().slice(0, 120);
  if (titulo.length < 3) throw new HttpError(400, "Contanos de qué se trata el video");
  const mes = String(b.mes);
  const db = adminDb();
  const pRef = db.collection("projects").doc(b.proyecto_id);
  const proj = (await pRef.get()).data() ?? {};
  // Con qué material. Sin `material` (versiones viejas de la app): como antes, con `filma_cliente`.
  const tipoMaterial: TipoMaterial | null = ["existente", "nueva", "cliente"].includes(String(b.material?.tipo))
    ? (String(b.material?.tipo) as TipoMaterial)
    : null;
  let material_base: MaterialBase | null = null;
  if (tipoMaterial === "existente") {
    // Cada archivo tiene que ser material de un video de este cliente (el cliente, solo el editado que ya le llegó).
    material_base = { tipo: "existente", archivos: await archivosBaseDe(b.proyecto_id, b.material?.archivos, caller.role === "cliente") };
  } else if (tipoMaterial === "nueva") {
    material_base = { tipo: "nueva", preferencia: preferenciaRodaje(b.material?.preferencia) };
  } else if (tipoMaterial === "cliente") {
    material_base = { tipo: "cliente" };
  }
  // "Yo mando el material": lo filma él, diga lo que diga la ficha (a veces filman ellos). Si no, sale de
  // la ficha del cliente; si filman los dos, de lo que eligió en el pedido.
  // Con material ya cargado no filma nadie (va a edición).
  const filma =
    tipoMaterial === "existente"
      ? false
      : tipoMaterial === "cliente" || filmaElCliente(proj, tipoMaterial ? false : b.filma_cliente === true);
  // Si filma siempre el cliente, una "filmación nueva" también la hace él.
  if (filma && material_base?.tipo === "nueva") material_base = { tipo: "cliente" };
  // Filmación nueva: dónde se filma. Fuera de Reconquista se cobran viáticos por zona, una vez por jornada.
  let viatico: ViaticoVideo | null = null;
  if (material_base?.tipo === "nueva" && !filma) {
    const st = (await db.collection("app_settings").doc("redes").get()).data() ?? {};
    viatico = viaticoDe(st.viaticos, b.localidad);
    if (viatico.estado === "pendiente") {
      const suyos = (await db.collection("videos").where("proyecto_id", "==", b.proyecto_id).get()).docs.map((d) => d.data());
      if (viajeYaPago(suyos, b.proyecto_id, viatico.localidad)) viatico = { ...viatico, monto: 0, estado: "cubierto" };
    }
  }
  const pedido: PedidoVideo = {
    titulo,
    idea: String(b.idea ?? "").trim().slice(0, 2000) || null,
    objetivo: String(b.objetivo ?? "").trim().slice(0, 200) || null,
    fecha_deseada: fecha,
    pedido_por: caller.uid,
    filma_cliente: filma,
    material_base,
    viatico,
  };
  let incluidos = Number(proj.plan_redes_override?.videos_mes ?? NaN);
  if (proj.plan_redes_id && isNaN(incluidos)) {
    const plan = (await db.collection("planes_redes").doc(proj.plan_redes_id).get()).data() ?? {};
    incluidos = Number(plan.videos_mes ?? 0);
  }
  // El video extra se cobra según para dónde es (Instagram/Facebook, TikTok o YouTube).
  const plataforma = plataformaDe(b.plataforma);
  // Solo edición (el cliente manda las tomas o elige material ya cargado): 30% menos.
  const soloEdicion = tipoMaterial === "existente" || filma;
  const precioBase = await precioExtra(proj, plataforma);
  const precioVideo = soloEdicion ? Math.round(precioBase * 0.7) : precioBase;
  incluidos = incluidos || 0;
  const team = (proj.team_roles ?? {}) as Record<string, string[]>;
  const base = appUrl(req);

  // Varios videos en la misma filmación: un solo viaje y promo desde el 2º video extra.
  const otros = (Array.isArray(b.otros) ? b.otros : [])
    .slice(0, MAX_VIDEOS_JORNADA - 1)
    .map((o) => ({ titulo: String(o?.titulo ?? "").trim().slice(0, 120), idea: String(o?.idea ?? "").trim().slice(0, 2000) || null }))
    .filter((o) => o.titulo.length >= 3);
  if (otros.length) {
    if (material_base?.tipo !== "nueva" || filma) throw new HttpError(400, "Varios videos juntos son para una filmación nueva");
    const pid = b.proyecto_id;
    const pedidos: PedidoVideo[] = [pedido, ...otros.map((o) => ({ ...pedido, titulo: o.titulo, idea: o.idea }))];
    // El viaje lo lleva el 1º; los demás van en la misma jornada.
    const viajeDe = (i: number): ViaticoVideo | null =>
      !viatico || i === 0 || viatico.estado === "sin_cargo" || viatico.estado === "cotizar" ? viatico : { ...viatico, monto: 0, estado: "cubierto" };
    const st = (await db.collection("app_settings").doc("redes").get()).data() ?? {};
    const viaje = viatico?.estado === "pendiente" ? Number(viatico.monto) || 0 : 0;
    const qMes = db.collection("videos").where("proyecto_id", "==", pid).where("mes", "==", mes);
    const usados = (await qMes.get()).docs.filter((d) => d.data().extra !== true).length;
    const cupo = incluidos + Number(proj.creditos_extra?.[mes] ?? 0);
    const cuenta = cuentaJornada({ cantidad: pedidos.length, disponibles: cupo - usados, precioExtra: precioVideo, promoPct: promoJornada(st), viaje });
    if (cuenta.extras > 0 && !(precioVideo > 0)) throw new HttpError(409, "Tu plan no tiene precio de video extra. Escribinos y lo vemos.");
    const titulos = pedidos.map((p) => p.titulo).join(", ");

    if (cuenta.total === 0) {
      // Todo entra en el plan y no hay viaje que pagar: se crean ya (con lock, como uno solo).
      const refs = pedidos.map(() => db.collection("videos").doc());
      const ok = await enTransaccion(async (cli) => {
        await cli.query("select pg_advisory_xact_lock(hashtext($1))", [`video:${pid}:${mes}`]);
        const p = (await leerDoc(cli, "projects", pid)) ?? {};
        const ya = (await ejecutarConsulta(cli, qMes.consulta)).filter((f) => f.data.extra !== true).length;
        if (ya + pedidos.length > incluidos + Number(p.creditos_extra?.[mes] ?? 0)) return false;
        for (const [i, r] of refs.entries()) {
          await aplicarEscritura(cli, {
            tipo: "create",
            coleccion: r.coleccion,
            id: r.id,
            data: videoDesdePedido(pid, team, mes, { ...pedidos[i], viatico: viajeDe(i) }, `Pedido por el cliente (filmación de ${pedidos.length} videos)`),
          });
        }
        return true;
      });
      if (!ok) throw new HttpError(409, "Justo cambió lo que te queda del plan. Volvé a intentar.");
      await enviarAviso(
        {
          destinatarios: team.productor ?? [],
          titulo: `El cliente pidió ${pedidos.length} videos para filmar juntos`,
          cuerpo: `${proj.nombre ?? "Cliente"} · ${titulos}${textoMaterial(pedido)}`.slice(0, 300),
          link: `/videos?video=${refs[0].id}`,
          clave: `pedido_jornada:${refs[0].id}`,
          proyectoId: pid,
          videoId: refs[0].id,
        },
        base
      );
      await avisarCupo(pid, mes, incluidos, Number(proj.creditos_extra?.[mes] ?? 0), team.cliente ?? [], base).catch((e) => console.error("aviso de cupo", e));
      return { estado: "creado", video_id: refs[0].id, video_ids: refs.map((r) => r.id) };
    }

    // Hay algo para pagar (extras y/o viaje): un solo pago; los videos se crean cuando se acredita.
    const [y, m] = mes.split("-").map(Number);
    const concepto = `Filmación de ${pedidos.length} videos · ${MESES[m - 1]} ${y}${viaje ? ` + viaje a ${viatico!.localidad}` : ""}: ${titulos}`.slice(0, 120);
    await moraCliente(caller, String(b.proyecto_id), true);
    const cobroRef = db.collection("cobros").doc();
    await cobroRef.set({
      proyecto_id: pid,
      tipo: "jornada",
      concepto,
      ref_id: mes,
      cantidad: 1,
      extras_n: cuenta.extras,
      monto: cuenta.total,
      moneda: "ARS",
      estado: "pendiente",
      pedidos: pedidos.map((p, i) => ({
        ...p,
        viatico: i === 0 && viaje > 0 ? { ...viatico!, estado: "pagado" } : viajeDe(i),
        // "Pasámelo": solo en los que son extra (los del plan siguen el circuito del cliente).
        ...(b.sube_cliente === true && !cuenta.items[i]?.plan ? { sube_cliente: true } : {}),
        ...(!cuenta.items[i]?.plan ? { extra_pagado: true } : {}),
      })),
      detalle: cuenta,
      created_by: caller.uid,
      created_at: new Date().toISOString(),
    });
    const pref = await crearPreferencia({
      titulo: `Prodi · ${concepto}`,
      monto: cuenta.total,
      cantidad: 1,
      externalReference: cobroRef.id,
      notificationUrl: `${base}/api/pagos/webhook`,
      backUrl: `${base}/cliente?cobro=${cobroRef.id}`,
      email: caller.email,
    });
    await cobroRef.update({ mp_preference_id: pref.id, mp_init_point: pref.init_point });
    return { estado: "pago", init_point: pref.init_point, cobro_id: cobroRef.id, monto: cuenta.total };
  }

  // Entra en el plan: se crea directo y producción recibe el aviso. Se cuenta y se crea con lock
  // por cliente y mes, así dos pedidos a la vez no se pasan del cupo.
  const ref = db.collection("videos").doc();
  const entra = await crearSiHayCupo({
    tipo: "video",
    pid: b.proyecto_id,
    mes,
    consulta: db.collection("videos").where("proyecto_id", "==", b.proyecto_id).where("mes", "==", mes),
    usado: (d) => d.extra !== true,
    cupo: (p) => incluidos + Number(p.creditos_extra?.[mes] ?? 0),
    ref,
    data: () => videoDesdePedido(b.proyecto_id!, team, mes, pedido, "Pedido por el cliente"),
  });
  if (entra) {
    const existente = material_base?.tipo === "existente";
    await enviarAviso(
      {
        // Con material ya cargado arranca en edición: le llega también a edición.
        destinatarios: [...new Set([...(team.productor ?? []), ...(existente ? (team.editor ?? []) : [])])],
        titulo: existente
          ? "El cliente pidió un video con material ya cargado"
          : filma
            ? "El cliente pidió un video (lo filma él)"
            : "El cliente pidió un video",
        cuerpo: `${proj.nombre ?? "Cliente"} · ${titulo}${fecha ? ` · para el ${fecha.split("-").reverse().join("/")}` : ""}${textoMaterial(pedido)}`,
        link: `/videos?video=${ref.id}`,
        clave: `pedido_video:${ref.id}`,
        proyectoId: b.proyecto_id,
        videoId: ref.id,
      },
      base
    );
    await avisarCupo(b.proyecto_id, mes, incluidos, Number(proj.creditos_extra?.[mes] ?? 0), team.cliente ?? [], base).catch((e) => console.error("aviso de cupo", e));
    // Entra en el plan pero se filma lejos: el video ya está; el viaje se paga aparte (vuelve el link).
    if (viatico?.estado === "pendiente" && Number(viatico.monto) > 0) {
      const vRef = db.collection("cobros").doc();
      const conc = `Viáticos de filmación en ${viatico.localidad} · ${titulo}`.slice(0, 120);
      await vRef.set({
        proyecto_id: b.proyecto_id,
        tipo: "viatico",
        concepto: conc,
        ref_id: ref.id,
        cantidad: 1,
        monto: viatico.monto,
        moneda: "ARS",
        estado: "pendiente",
        created_by: caller.uid,
        created_at: new Date().toISOString(),
      });
      const pv = await crearPreferencia({
        titulo: `Prodi · ${conc}`,
        monto: Number(viatico.monto),
        cantidad: 1,
        externalReference: vRef.id,
        notificationUrl: `${base}/api/pagos/webhook`,
        backUrl: `${base}/cliente?cobro=${vRef.id}`,
        email: caller.email,
      });
      await vRef.update({ mp_preference_id: pv.id, mp_init_point: pv.init_point });
      return { estado: "creado", video_id: ref.id, viatico: { init_point: pv.init_point, monto: viatico.monto, cobro_id: vRef.id } };
    }
    return { estado: "creado", video_id: ref.id };
  }

  // Se pasa del plan: se cobra como video extra.
  if (!(precioVideo > 0)) throw new HttpError(409, "Tu plan no tiene precio de video extra. Escribinos y lo vemos.");
  const [y, m] = mes.split("-").map(Number);
  // Extra con viaje: el viático va en el mismo pago (el video se crea al acreditarse, ya con el viaje pago).
  const conViaje = viatico?.estado === "pendiente" && Number(viatico.monto) > 0;
  if (conViaje) pedido.viatico = { ...viatico!, estado: "pagado" };
  if (b.sube_cliente === true) pedido.sube_cliente = true;
  pedido.extra_pagado = true;
  const total = precioVideo + (conViaje ? Number(viatico!.monto) : 0);
  const concepto = `Video extra${soloEdicion ? " solo edición" : ""}${plataforma === "meta" ? "" : ` (${PLATAFORMA_NOMBRE[plataforma]})`} · ${MESES[m - 1]} ${y}: ${titulo}${conViaje ? ` + viáticos a ${viatico!.localidad}` : ""}`.slice(0, 120);
  await moraCliente(caller, String(b.proyecto_id), true);
    const cobroRef = db.collection("cobros").doc();
  await cobroRef.set({
    proyecto_id: b.proyecto_id,
    tipo: "video_extra",
    concepto,
    ref_id: mes,
    cantidad: 1,
    monto: total,
    moneda: "ARS",
    estado: "pendiente",
    pedido,
    created_by: caller.uid,
    created_at: new Date().toISOString(),
  });
  const pref = await crearPreferencia({
    titulo: `Prodi · ${concepto}`,
    monto: total,
    cantidad: 1,
    externalReference: cobroRef.id,
    notificationUrl: `${base}/api/pagos/webhook`,
    backUrl: `${base}/cliente?cobro=${cobroRef.id}`,
    email: caller.email,
  });
  await cobroRef.update({ mp_preference_id: pref.id, mp_init_point: pref.init_point });
  return { estado: "pago", init_point: pref.init_point, cobro_id: cobroRef.id, monto: total };
}

/** Cuánto tiempo tiene el cliente para corregir o borrar un video que pidió (si cargó algo mal). */
const CORREGIR_PEDIDO_MS = 2 * 60 * 60_000;

/**
 * El cliente corrige (título, idea, objetivo, fecha dentro del mismo mes) o borra un video que pidió, en las primeras
 * 2 horas y mientras no se haya empezado (esperando su material o planificado sin rodaje) y sin cobros (un extra pago o un viático
 * no se borran acá: se escribe al equipo).
 */
async function pedidoCorregir(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin"]);
  const b = body<{ video_id?: string; accion?: string; titulo?: string; idea?: string; objetivo?: string; fecha_deseada?: string | null }>(req);
  if (!b.video_id || !["editar", "borrar"].includes(String(b.accion))) throw new HttpError(400, "Datos incompletos");
  const db = adminDb();
  const ref = db.collection("videos").doc(b.video_id);
  const v = (await ref.get()).data();
  if (!v) throw new HttpError(404, "El video ya no existe");
  await assertProjectAccess(caller, String(v.proyecto_id));
  const esAdmin = caller.role === "admin";
  if (!esAdmin && (v.pedido_cliente !== true || v.created_by !== caller.uid)) throw new HttpError(403, "Solo lo puede cambiar quien lo pidió");
  if (!esAdmin && Date.now() - new Date(String(v.created_at)).getTime() > CORREGIR_PEDIDO_MS)
    throw new HttpError(409, "Pasaron más de 2 horas: escribile al equipo por el chat y lo cambiamos.");
  // Mientras espera el material (aunque ya haya subido algo) o está planificado sin rodaje.
  if (!["material_cliente", "planificado"].includes(String(v.etapa)) || v.rodaje_id)
    throw new HttpError(409, "Ya lo empezamos: escribile al equipo por el chat y lo cambiamos.");
  const now = new Date().toISOString();
  const proj = (await db.collection("projects").doc(String(v.proyecto_id)).get()).data() ?? {};
  const team = (proj.team_roles ?? {}) as Record<string, string[]>;
  const avisarEquipo = (titulo: string, cuerpo: string) =>
    enviarAviso(
      {
        destinatarios: [...(v.productor_id ? [String(v.productor_id)] : team.productor ?? [])].filter((x) => x !== caller.uid),
        titulo,
        cuerpo,
        link: `/videos?video=${b.video_id}`,
        clave: `pedido_corregido:${b.video_id}:${now}`,
        proyectoId: String(v.proyecto_id),
      },
      appUrl(req)
    ).catch((e) => console.warn("[pedido-corregir] aviso", e));

  if (b.accion === "borrar") {
    if (v.extra_pagado === true || (v.viatico && Number((v.viatico as { monto?: number }).monto) > 0))
      throw new HttpError(409, "Este video tiene un pago: escribile al equipo por el chat y lo vemos.");
    await ref.delete();
    await avisarEquipo("El cliente borró un video que había pedido", `${proj.nombre ?? "Cliente"} · ${v.titulo}`);
    return { ok: true, borrado: true };
  }

  const titulo = String(b.titulo ?? "").trim().slice(0, 140);
  if (titulo.length < 3) throw new HttpError(400, "Poné un título");
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha_deseada ?? "")) ? String(b.fecha_deseada) : null;
  // La fecha, solo dentro del mismo mes (cambiar de mes cambia el cupo del plan).
  if (fecha && fecha.slice(0, 7) !== String(v.mes)) throw new HttpError(409, "Para pasarlo a otro mes, escribile al equipo por el chat.");
  await ref.update({
    titulo,
    idea: String(b.idea ?? "").trim().slice(0, 4000) || null,
    objetivo: String(b.objetivo ?? "").trim().slice(0, 300) || null,
    fecha_deseada: fecha,
    updated_at: now,
    historial: FieldValue.arrayUnion({ at: now, by: caller.uid, accion: "El cliente corrigió el pedido", nota: v.titulo !== titulo ? `Antes: ${v.titulo}` : null }),
  });
  await avisarEquipo("El cliente corrigió un video que pidió", `${proj.nombre ?? "Cliente"} · ${titulo}`);
  return { ok: true };
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
    else if (accion === "arca-autorizar") res.status(200).json(await arcaAutorizar(req));
    else if (accion === "arca-estado") res.status(200).json(await arcaEstado(req));
    else if (accion === "mp-detalle") res.status(200).json(await mpDetalle(req));
    else if (accion === "pieza-idea") res.status(200).json(await piezaIdea(req));
    else if (accion === "pedido-corregir") res.status(200).json(await pedidoCorregir(req));
    else if (accion === "mora-recalcular") res.status(200).json(await moraRecalcular(req));
    else if (accion === "mora-recordar") res.status(200).json(await moraRecordar(req));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    // Si falla el webhook respondemos error: Mercado Pago lo reintenta solo.
    sendError(res, err);
  }
}
