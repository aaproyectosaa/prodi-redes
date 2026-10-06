// Prepara la facturación del mes en Firestore (`facturas/{cliente}_{mes}`). La usan el cron del 27
// y el botón "Preparar facturación" del super admin. No pisa lo que ya existe.

import { adminDb } from "./db";
import { armarFactura, facturaId, type DatosCliente } from "./facturacion";

export async function prepararFacturacion(
  mes: string,
  por: string,
  /** Solo estos clientes (elegidos a mano). Se facturan aunque no tengan plan: los ítems se cargan después. */
  soloIds?: string[] | null
): Promise<{ creadas: number; existentes: number }> {
  const elegidos = soloIds?.length ? new Set(soloIds) : null;
  const db = adminDb();
  const [projects, planesSnap, settingsSnap, abonos] = await Promise.all([
    db.collection("projects").get(),
    db.collection("planes_redes").get(),
    db.collection("app_settings").doc("redes").get(),
    db.collection("cobros").where("tipo", "==", "abono").where("ref_id", "==", mes).get(),
  ]);
  const planes = new Map(planesSnap.docs.map((d) => [d.id, d.data()]));
  const settings = settingsSnap.data() ?? {};
  const debitados = new Set(abonos.docs.filter((d) => d.data().estado === "aprobado").map((d) => String(d.data().proyecto_id)));
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  let creadas = 0;
  let existentes = 0;

  for (const d of projects.docs) {
    const p = d.data();
    if (p.enabled === false) continue;
    if (elegidos && !elegidos.has(d.id)) continue;
    // Automático: solo los clientes de Redes con plan (los proyectos viejos sin plan no se facturan solos).
    const plan = p.plan_redes_id ? planes.get(p.plan_redes_id) : undefined;
    const abono = Number(p.plan_redes_override?.precio_mensual ?? plan?.precio_mensual ?? 0);
    if (!elegidos && !plan && !abono) continue;
    // "No facturarle el 27" (pausado, canje, etc.): solo se le factura si se lo elige a mano.
    if (!elegidos && p.facturacion?.pausada) continue;
    const datos: DatosCliente = {
      id: d.id,
      nombre: String(p.nombre ?? "Cliente"),
      abono,
      planNombre: plan?.nombre ?? null,
      videosMes: Number(p.plan_redes_override?.videos_mes ?? plan?.videos_mes ?? 0),
      facturacion: p.facturacion ?? null,
      debitoActivo: p.suscripcion?.estado === "activa",
      abonoDebitado: debitados.has(d.id),
    };
    const f = armarFactura(datos, mes, {
      ivaPct: Number(settings.iva_pct ?? 21),
      diaVencimiento: Number(settings.dia_vencimiento ?? 10),
      por,
      hoy,
    });
    try {
      await db.collection("facturas").doc(facturaId(d.id, mes)).create({ ...f, ...(p.demo_ejemplo ? { demo_ejemplo: true } : {}) });
      creadas++;
    } catch {
      existentes++; // ya estaba: no se toca
    }
  }
  return { creadas, existentes };
}

/** Cuando Mercado Pago debita el abono, la boleta de ese mes queda cobrada. */
export async function marcarCobradaPorDebito(proyectoId: string, mes: string) {
  const ref = adminDb().collection("facturas").doc(facturaId(proyectoId, mes));
  const f = (await ref.get()).data();
  if (!f || f.estado === "cobrada" || f.estado === "anulada") return;
  await ref.update({ estado: "cobrada", medio: "mercadopago", cobrado_at: new Date().toISOString() });
}
