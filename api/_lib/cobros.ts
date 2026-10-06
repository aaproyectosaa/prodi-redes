// Lógica de cobros compartida entre los endpoints de pagos.

import { FieldValue } from "./db";
import { adminDb } from "./db";
import type { PagoMP } from "./mercadopago";
import { destinatariosDe, enviarAviso, usuariosConRol } from "./notify";
import { marcarCobradaPorDebito } from "./facturar";
import { videoDesdePedido, type PedidoVideo } from "./pedidos";

const ESTADO: Record<string, string> = {
  approved: "aprobado",
  authorized: "aprobado",
  rejected: "rechazado",
  cancelled: "cancelado",
  refunded: "reembolsado",
  charged_back: "reembolsado",
};

/**
 * Aplica el resultado de un pago de MP a su cobro (idempotente).
 * Devuelve el estado final del cobro.
 */
export async function aplicarPago(pago: PagoMP, baseUrl: string): Promise<string> {
  const cobroId = pago.external_reference;
  if (!cobroId) return "ignorado";
  const db = adminDb();
  const cobroRef = db.collection("cobros").doc(cobroId);
  const nuevo = ESTADO[pago.status];

  let efecto: null | { tipo: string; proyecto_id: string; concepto: string; cantidad: number; pedido?: string } = null;
  let revisar: null | { proyecto_id: string; concepto: string } = null;

  const final = await db.runTransaction(async (tx) => {
    // La transacción se puede reintentar: los efectos se recalculan en cada intento.
    efecto = null;
    revisar = null;
    const snap = await tx.get(cobroRef);
    if (!snap.exists) return "inexistente";
    const c = snap.data()!;
    if (!nuevo) return c.estado as string; // pending / in_process: no cambia
    if (c.estado === nuevo) return c.estado as string;
    // Un pago aprobado no vuelve a "rechazado" por un evento viejo.
    if (c.estado === "aprobado" && nuevo !== "reembolsado") return c.estado as string;

    if (nuevo === "aprobado") {
      if (Number(pago.transaction_amount) + 0.5 < Number(c.monto)) {
        console.warn("[pagos] monto menor al esperado", cobroId, pago.transaction_amount, c.monto);
        return c.estado as string;
      }
      if (c.tipo === "pieza_ia") {
        const pRef = db.collection("piezas_ia").doc(c.ref_id);
        const pSnap = await tx.get(pRef);
        const pz = pSnap.data();
        if (pz && pz.estado === "pendiente_pago") {
          tx.update(pRef, { estado: "pagada", cobro_id: cobroId, updated_at: new Date().toISOString() });
        } else {
          // Pago duplicado o de una pieza ya rechazada/cancelada: hay que devolverlo.
          tx.update(cobroRef, {
            estado: "aprobado",
            mp_payment_id: String(pago.id),
            pagado_at: new Date().toISOString(),
            requiere_reembolso: true,
          });
          revisar = { proyecto_id: c.proyecto_id, concepto: c.concepto };
          return "aprobado";
        }
      } else if (c.tipo === "video_extra") {
        const pRef = db.collection("projects").doc(c.proyecto_id);
        // Pedido del cliente: el video se crea recién con el pago acreditado.
        const team = c.pedido ? (((await tx.get(pRef)).data()?.team_roles ?? {}) as Record<string, string[]>) : {};
        tx.update(pRef, {
          [`creditos_extra.${c.ref_id}`]: FieldValue.increment(Number(c.cantidad) || 1),
        });
        if (c.pedido) {
          tx.set(
            db.collection("videos").doc(`pedido_${cobroId}`),
            videoDesdePedido(c.proyecto_id, team, c.ref_id, c.pedido as PedidoVideo, "Pedido y pagado por el cliente (video extra)")
          );
        }
      }
      efecto = {
        tipo: c.tipo,
        proyecto_id: c.proyecto_id,
        concepto: c.concepto,
        cantidad: c.cantidad,
        pedido: (c.pedido as PedidoVideo | undefined)?.titulo,
      };
    }

    // Reembolso o contracargo de algo ya entregado: se deshace lo que dio el pago.
    if (nuevo === "reembolsado" && c.estado === "aprobado") {
      if (c.tipo === "video_extra") {
        tx.update(db.collection("projects").doc(c.proyecto_id), {
          [`creditos_extra.${c.ref_id}`]: FieldValue.increment(-(Number(c.cantidad) || 1)),
        });
      } else if (c.tipo === "pieza_ia") {
        const pRef = db.collection("piezas_ia").doc(c.ref_id);
        const pSnap = await tx.get(pRef);
        if (pSnap.exists && pSnap.data()!.estado !== "rechazada" && pSnap.data()!.cobro_id === cobroId) {
          tx.update(pRef, { estado: "cancelada", updated_at: new Date().toISOString() });
        }
      }
    }

    tx.update(cobroRef, {
      estado: nuevo,
      mp_payment_id: String(pago.id),
      ...(nuevo === "aprobado" ? { pagado_at: new Date().toISOString() } : {}),
    });
    return nuevo;
  });

  if (revisar) {
    const r = revisar as { proyecto_id: string; concepto: string };
    const admins = await destinatariosDe(r.proyecto_id, [], true);
    await enviarAviso(
      {
        destinatarios: admins,
        titulo: "Pago para devolver",
        cuerpo: `Entró un pago de una pieza que ya no estaba pendiente (${r.concepto}). Devolvelo desde Mercado Pago.`,
        link: `/clientes/${r.proyecto_id}?tab=informe`,
        clave: `reembolsar:${cobroId}`,
        proyectoId: r.proyecto_id,
      },
      baseUrl
    );
  }

  if (efecto) {
    const e = efecto as { tipo: string; proyecto_id: string; concepto: string; cantidad: number; pedido?: string };
    const proj = (await db.collection("projects").doc(e.proyecto_id).get()).data() ?? {};
    // Las piezas pagadas le llegan a diseño; los videos, a producción.
    const destinatarios =
      e.tipo === "pieza_ia" ? await usuariosConRol(["diseno"]) : await destinatariosDe(e.proyecto_id, ["productor"]);
    await enviarAviso(
      {
        destinatarios,
        titulo: e.tipo === "pieza_ia" ? "Nueva pieza gráfica pagada" : e.pedido ? "El cliente pidió (y pagó) un video" : "Compraron videos extra",
        cuerpo: `${proj.nombre ?? "Cliente"} · ${e.pedido ?? e.concepto}`,
        link: e.tipo === "pieza_ia" ? "/piezas" : `/clientes/${e.proyecto_id}`,
        clave: `cobro:${cobroId}`,
        proyectoId: e.proyecto_id,
      },
      baseUrl
    );
  }
  return final;
}

// ---------------------------------------------------------------------------
// Abono mensual con débito automático
// ---------------------------------------------------------------------------

const ESTADO_SUSCRIPCION: Record<string, string> = {
  pending: "pendiente",
  authorized: "activa",
  paused: "pausada",
  cancelled: "cancelada",
};

export const estadoSuscripcion = (status: string) => ESTADO_SUSCRIPCION[status] ?? status;

/** Precio del abono del cliente (ajuste propio o el del plan). */
export async function precioAbono(proyectoId: string): Promise<{ nombre: string; plan: string; monto: number }> {
  const db = adminDb();
  const p = (await db.collection("projects").doc(proyectoId).get()).data() ?? {};
  let monto = Number(p.plan_redes_override?.precio_mensual ?? 0);
  let plan = "Plan";
  if (p.plan_redes_id) {
    const pl = (await db.collection("planes_redes").doc(p.plan_redes_id).get()).data();
    if (pl) {
      plan = pl.nombre ?? plan;
      if (!(monto > 0)) monto = Number(pl.precio_mensual ?? 0);
    }
  }
  return { nombre: p.nombre ?? "Cliente", plan, monto };
}

/** Busca el cliente de una suscripción. */
export async function proyectoDeSuscripcion(preapprovalId: string, externalReference?: string | null): Promise<string | null> {
  if (externalReference?.startsWith("abono:")) return externalReference.slice(6);
  const q = await adminDb().collection("projects").where("suscripcion.mp_preapproval_id", "==", preapprovalId).limit(1).get();
  return q.docs[0]?.id ?? null;
}

const MESES_AB = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Registra un cobro del abono (idempotente por id de pago). */
export async function registrarAbono(
  datos: { proyectoId: string; paymentId: string; status: string; monto: number; fecha?: string | null },
  baseUrl: string
): Promise<string> {
  const db = adminDb();
  const nuevo = ESTADO[datos.status];
  if (!nuevo) return "pendiente";
  const ref = db.collection("cobros").doc(`abono_${datos.paymentId}`);
  const fecha = datos.fecha ? new Date(datos.fecha) : new Date();
  const ar = new Date(fecha.getTime() - 3 * 3600_000);
  const mes = `${ar.getUTCFullYear()}-${String(ar.getUTCMonth() + 1).padStart(2, "0")}`;
  let esNuevo = false;
  const pRef = db.collection("projects").doc(datos.proyectoId);
  await db.runTransaction(async (tx) => {
    esNuevo = false;
    const snap = await tx.get(ref);
    const pSnap = await tx.get(pRef);
    if (!snap.exists) {
      esNuevo = nuevo === "aprobado";
      tx.set(ref, {
        proyecto_id: datos.proyectoId,
        tipo: "abono",
        concepto: `Abono ${MESES_AB[ar.getUTCMonth()]} ${ar.getUTCFullYear()} · débito automático`,
        ref_id: mes,
        cantidad: 1,
        monto: datos.monto,
        moneda: "ARS",
        estado: nuevo,
        mp_payment_id: datos.paymentId,
        created_by: "mercadopago",
        created_at: new Date().toISOString(),
        ...(nuevo === "aprobado" ? { pagado_at: fecha.toISOString() } : {}),
      });
    } else if (snap.data()!.estado !== nuevo && !(snap.data()!.estado === "aprobado" && nuevo !== "reembolsado")) {
      esNuevo = nuevo === "aprobado";
      tx.update(ref, { estado: nuevo, ...(nuevo === "aprobado" ? { pagado_at: fecha.toISOString() } : {}) });
    }
    // Solo si el cliente sigue existiendo y la fecha es más nueva (los eventos pueden llegar desordenados).
    const previo = pSnap.data()?.suscripcion?.ultimo_pago_at as string | undefined;
    if (nuevo === "aprobado" && pSnap.exists && (!previo || previo < fecha.toISOString())) {
      tx.update(pRef, { "suscripcion.ultimo_pago_at": fecha.toISOString() });
    }
  });
  if (esNuevo) {
    await marcarCobradaPorDebito(datos.proyectoId, mes).catch((err) => console.warn("[abono] factura", err));
    const p = (await db.collection("projects").doc(datos.proyectoId).get()).data() ?? {};
    await enviarAviso(
      {
        destinatarios: await destinatariosDe(datos.proyectoId, [], true),
        titulo: "Se cobró un abono",
        cuerpo: `${p.nombre ?? "Cliente"} · débito automático`,
        link: `/clientes/${datos.proyectoId}?tab=informe`,
        clave: `abono:${datos.paymentId}`,
        proyectoId: datos.proyectoId,
      },
      baseUrl
    );
  }
  return nuevo;
}
