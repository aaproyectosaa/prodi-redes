// Prepara la facturación en Firestore (`facturas/{cliente}_{mes}`). La usan el cron del 27 y el botón
// "Preparar facturación" del super admin. No pisa lo que ya existe. `mes` es el mes en que se arma
// (el del 27); la boleta cubre el mes siguiente (ver `periodoDe` en facturacion.ts).

import { adminDb, YaExiste } from "./db";
import { armarFactura, DIA_VENCIMIENTO, debitoCubre, facturaId, notaDebitoParcial, type DatosCliente } from "./facturacion";
import { hoyAR } from "./fecha";

export async function prepararFacturacion(
  mes: string,
  por: string,
  /** Solo estos clientes (elegidos a mano). Se facturan aunque no tengan plan: los ítems se cargan después. */
  soloIds?: string[] | null
): Promise<{ creadas: number; existentes: number }> {
  const elegidos = soloIds?.length ? new Set(soloIds) : null;
  const db = adminDb();
  const [projects, planesSnap, settingsSnap, sueltos] = await Promise.all([
    db.collection("projects").get(),
    db.collection("planes_redes").get(),
    db.collection("app_settings").doc("redes").get(),
    // Débitos que llegaron cuando el cliente no tenía ninguna boleta para pagar: van a la que se arme ahora.
    db.collection("cobros").where("sin_factura", "==", true).get(),
  ]);
  const planes = new Map(planesSnap.docs.map((d) => [d.id, d.data()]));
  const settings = settingsSnap.data() ?? {};
  const debitados = new Map<string, { monto: number; refs: (typeof sueltos.docs)[number]["ref"][] }>();
  for (const a of sueltos.docs) {
    const c = a.data();
    if (c.tipo !== "abono" || c.estado !== "aprobado") continue;
    const pid = String(c.proyecto_id);
    const x = debitados.get(pid) ?? { monto: 0, refs: [] };
    x.monto += Number(c.monto) || 0;
    x.refs.push(a.ref);
    debitados.set(pid, x);
  }
  const hoy = hoyAR();
  let creadas = 0;
  let existentes = 0;

  for (const d of projects.docs) {
    const p = d.data();
    if (p.enabled === false) continue;
    if (elegidos && !elegidos.has(d.id)) continue;
    // Los clientes de ejemplo no se facturan solos (solo si se los elige a mano, en la demo).
    if (!elegidos && p.demo_ejemplo) continue;
    // Automático: solo los clientes de Redes con plan (los proyectos viejos sin plan no se facturan solos).
    const plan = p.plan_redes_id ? planes.get(p.plan_redes_id) : undefined;
    const abono = Number(p.plan_redes_override?.precio_mensual ?? plan?.precio_mensual ?? 0);
    if (!elegidos && !plan && !abono) continue;
    // "No facturarle el 27" (pausado, canje, etc.): solo se le factura si se lo elige a mano.
    if (!elegidos && p.facturacion?.pausada) continue;
    const suelto = debitados.get(d.id);
    const datos: DatosCliente = {
      id: d.id,
      nombre: String(p.nombre ?? "Cliente"),
      abono,
      planNombre: plan?.nombre ?? null,
      videosMes: Number(p.plan_redes_override?.videos_mes ?? plan?.videos_mes ?? 0),
      facturacion: p.facturacion ?? null,
      debitoActivo: p.suscripcion?.estado === "activa",
      abonoDebitado: !!suelto,
      montoDebitado: suelto?.monto ?? null,
    };
    const f = armarFactura(datos, mes, {
      ivaPct: Number(settings.iva_pct ?? 21),
      diaVencimiento: Number(settings.dia_vencimiento ?? DIA_VENCIMIENTO),
      por,
      hoy,
    });
    const id = facturaId(d.id, mes);
    try {
      await db.collection("facturas").doc(id).create({ ...f, ...(p.demo_ejemplo ? { demo_ejemplo: true } : {}) });
      creadas++;
    } catch (err) {
      // Ya estaba: no se toca. Cualquier otro error (conexión, etc.) se propaga.
      if (!(err instanceof YaExiste)) throw err;
      existentes++;
      continue;
    }
    // Los débitos sueltos quedan aplicados a esta boleta.
    for (const ref of suelto?.refs ?? []) await ref.update({ sin_factura: false, factura_id: id });
  }
  return { creadas, existentes };
}

/**
 * Cuando Mercado Pago debita, el débito paga la boleta más reciente del cliente que esté emitida y
 * sin cobrar (la del último 27), no la del mes calendario del débito. Si no hay ninguna emitida, va
 * al borrador más reciente; si no hay nada, el cobro queda `sin_factura` y lo toma la próxima boleta
 * que se arme. Se suma a lo ya debitado: si cubre el total queda cobrada; si no (suscripción con un
 * monto viejo), queda pendiente con el saldo. Devuelve el id de la boleta (o null).
 */
export async function marcarCobradaPorDebito(proyectoId: string, monto: number, cobroId?: string): Promise<string | null> {
  const db = adminDb();
  return db.runTransaction(async (tx) => {
    const q = await tx.get(db.collection("facturas").where("proyecto_id", "==", proyectoId));
    const masNueva = (estado: string) =>
      q.docs.filter((d) => d.data().estado === estado).sort((a, b) => String(b.data().mes).localeCompare(String(a.data().mes)))[0];
    const doc = masNueva("pendiente") ?? masNueva("borrador");
    const cobroRef = cobroId ? db.collection("cobros").doc(cobroId) : null;
    if (!doc) {
      if (cobroRef) tx.update(cobroRef, { sin_factura: true });
      return null;
    }
    const f = doc.data();
    const debitado = Math.round(Number(f.debitado ?? 0) + (Number(monto) || 0));
    const bruto = Number(f.bruto) || 0;
    if (cobroRef) tx.update(cobroRef, { factura_id: doc.id });
    if (debitoCubre(debitado, bruto)) {
      // El débito cobra un monto fijo: no lleva interés por mora aunque llegue después del 5.
      tx.update(doc.ref, { estado: "cobrada", medio: "mercadopago", debitado, cobrado_at: new Date().toISOString(), interes_cobrado: 0 });
      return doc.id;
    }
    // Débito parcial: no se marca cobrada. La nota automática se actualiza; la que escribió alguien, no.
    const notaAuto = !f.nota || /^(Se cobra solo por débito|Mercado Pago debitó)/.test(String(f.nota));
    tx.update(doc.ref, { debitado, ...(notaAuto ? { nota: notaDebitoParcial(debitado, bruto - debitado) } : {}) });
    return doc.id;
  });
}
