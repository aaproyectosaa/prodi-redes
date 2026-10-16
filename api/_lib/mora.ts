// Mora de los clientes: según los días de atraso de su boleta vencida más vieja, el cliente pasa por escalones.
//   vencido (1+ días) → en mora (aviso) → sin extras (no puede pedir videos ni piezas pagos) → producción pausada
//   (no se agendan rodajes ni se manda a edición nada nuevo; tampoco puede pedir videos).
// El estado queda guardado en el cliente (projects.mora) para que lo vea todo el equipo y lo usen las reglas;
// se recalcula todos los días (cron) y cada vez que se registra un pago. El interés (0,5% diario) es aparte
// (ver interesMora en facturacion.ts). El admin puede dar una tregua: hasta esa fecha no pasa de "en mora".

import { adminDb } from "./db";
import { destinatariosDe, enviarAviso } from "./notify";
import { hoyAR } from "./fecha";
import type { Factura } from "./facturacion";
import { estadoMora, leerConfigMora, ORDEN_MORA, subeDe, type EstadoMora, type NivelMora } from "./mora-calc";

export * from "./mora-calc";

const TEXTO_NIVEL: Record<NivelMora, string> = {
  al_dia: "al día",
  vencido: "con un pago vencido",
  mora: "en mora",
  sin_extras: "sin extras por mora",
  pausa: "con la producción pausada por mora",
};

/**
 * Recalcula la mora de un cliente y la guarda en su ficha. Si sube de escalón avisa: al admin (en mora y más)
 * y al cliente (cuando se le frenan los extras o la producción). Devuelve el estado nuevo.
 */
export async function actualizarMora(pid: string, base: string | null): Promise<EstadoMora | null> {
  const db = adminDb();
  const pref = db.collection("projects").doc(pid);
  const p = (await pref.get()).data();
  if (!p) return null;
  const settings = (await db.collection("app_settings").doc("redes").get()).data() ?? {};
  const cfg = leerConfigMora(settings);
  const hoy = hoyAR();
  const snap = await db.collection("facturas").where("proyecto_id", "==", pid).where("estado", "==", "pendiente").get();
  const tregua = typeof p.mora_tregua_hasta === "string" && p.mora_tregua_hasta >= hoy;
  const nuevo = estadoMora(
    snap.docs.map((d) => d.data() as Factura & { debito?: boolean }),
    hoy,
    cfg,
    tregua
  );
  const antes = (p.mora ?? null) as EstadoMora | null;
  const nivelAntes: NivelMora = antes?.nivel ?? "al_dia";
  // Sin cambios de escalón ni de monto: no se toca (no ensucia la ficha con escrituras diarias).
  if (antes && antes.nivel === nuevo.nivel && antes.dias === nuevo.dias && antes.deuda === nuevo.deuda) return antes;
  await pref.update({ mora: nuevo.nivel === "al_dia" ? null : nuevo });

  if (base && ORDEN_MORA.indexOf(nuevo.nivel) > ORDEN_MORA.indexOf(nivelAntes) && subeDe(nuevo.nivel, "mora")) {
    const nombre = String(p.nombre ?? "Un cliente");
    const ars = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
    const admins = (await db.collection("profiles").where("role", "in", ["admin", "administracion"]).get()).docs.map((d) => d.id);
    await enviarAviso(
      {
        destinatarios: admins,
        titulo: `${nombre}: ${TEXTO_NIVEL[nuevo.nivel]}`,
        cuerpo: `${nuevo.dias} días de atraso · debe ${ars(nuevo.deuda + nuevo.interes)} con interés.`,
        link: "/cobros?morosos=1",
        clave: `mora:${pid}:${nuevo.nivel}:${nuevo.desde}`,
        proyectoId: pid,
      },
      base
    ).catch((err) => console.warn("[mora] aviso admin", err));
    if (nuevo.nivel === "sin_extras" || nuevo.nivel === "pausa") {
      const clientes = await destinatariosDe(pid, ["cliente"], false);
      if (clientes.length) {
        await enviarAviso(
          {
            destinatarios: clientes,
            titulo: nuevo.nivel === "pausa" ? "Pausamos la producción por pagos atrasados" : "Tenés pagos atrasados",
            cuerpo:
              nuevo.nivel === "pausa"
                ? `Tenés ${nuevo.dias} días de atraso. Apenas se registre el pago, seguimos con tus videos.`
                : `Tenés ${nuevo.dias} días de atraso. Hasta ponerte al día no se pueden pedir videos ni piezas extra.`,
            link: "/cliente?tab=plan",
            clave: `mora-cliente:${pid}:${nuevo.nivel}:${nuevo.desde}`,
            proyectoId: pid,
          },
          base
        ).catch((err) => console.warn("[mora] aviso cliente", err));
      }
    }
  }
  return nuevo;
}

/** Cron diario: recalcula la mora de los clientes con boletas pendientes y de los que estaban en mora. */
export async function moraTodos(base: string): Promise<string> {
  const db = adminDb();
  const [pend, conMora] = await Promise.all([
    db.collection("facturas").where("estado", "==", "pendiente").get(),
    db.collection("projects").get(),
  ]);
  const ids = new Set<string>(pend.docs.map((d) => String(d.data().proyecto_id)));
  conMora.docs.forEach((d) => d.data().mora && ids.add(d.id));
  const niveles: Record<string, number> = {};
  for (const pid of ids) {
    const e = await actualizarMora(pid, base).catch(() => null);
    if (e) niveles[e.nivel] = (niveles[e.nivel] ?? 0) + 1;
  }
  return Object.entries(niveles)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

/** Para los pedidos del cliente: corta si su mora no lo deja (extras desde "sin extras"; todo en "pausa"). */
export async function moraBloquea(pid: string, extra: boolean): Promise<string | null> {
  const p = (await adminDb().collection("projects").doc(pid).get()).data();
  const n = ((p?.mora as EstadoMora | null)?.nivel ?? "al_dia") as NivelMora;
  if (n === "pausa") return "Tenés pagos atrasados y la producción está pausada. Apenas te pongas al día seguimos con tus videos.";
  if (extra && n === "sin_extras") return "Tenés pagos atrasados: hasta ponerte al día no se pueden pedir videos ni piezas extra.";
  return null;
}
