// "Mis ganancias" de programación en Prodi Software: lo que le toca a cada uno por su porcentaje.
// Usa el mismo cálculo que la liquidación (no hay dos cuentas distintas) y devuelve solo lo de esa persona.

import { HttpError } from "../http";
import { getSql } from "./sql";
import { NextRequest } from "./next-shim";
import { GET as liquidacion } from "./rutas/liquidacion";

type Item = { partner_id: string; share?: number; paid?: number; pending?: number; [k: string]: unknown };

export async function misGanancias(uid: string, mes: string) {
  const sql = getSql();
  const [p] = await sql<{ id: string; name: string; pct: number }>`
    SELECT id, name, pct::float8 AS pct FROM hub_partners WHERE prodi_uid = ${uid} LIMIT 1
  `;
  if (!p) throw new HttpError(404, "Todavía no estás en el reparto de Prodi Software. Pedile al admin que te sume.");

  // Del mes elegido (YYYY-MM) o, si no, del año en curso.
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  let from = `${hoy.slice(0, 4)}-01-01`;
  let to = hoy;
  if (/^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    from = `${mes}-01`;
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    to = `${mes}-${String(ultimo).padStart(2, "0")}`;
  }

  const r = await liquidacion(new NextRequest(`http://local/?from=${from}&to=${to}`, "GET", new Headers(), ""));
  const d = JSON.parse(r.body) as Record<string, unknown>;
  const mio = (lista: unknown) => ((Array.isArray(lista) ? lista : []) as Item[]).find((i) => String(i.partner_id) === String(p.id)) ?? null;
  const totales = mio(d.byPartnerTotals);
  const transferencias = ((Array.isArray(d.payouts) ? d.payouts : []) as Item[]).filter((x) => String(x.partner_id) === String(p.id));

  return {
    nombre: p.name,
    pct: p.pct,
    desde: from,
    hasta: to,
    liberadoHasta: d.releasedUntil,
    diasParaLiberar: d.releaseDays,
    total: { corresponde: totales?.share ?? 0, cobrado: totales?.paid ?? 0, falta: totales?.pending ?? 0 },
    porOrigen: {
      fees: mio(d.feeItems),
      mantenimientos: mio(d.maintenanceItems),
      extras: mio(d.extraItems),
      suscripciones: mio(d.subscriptionItems),
    },
    transferencias,
  };
}
