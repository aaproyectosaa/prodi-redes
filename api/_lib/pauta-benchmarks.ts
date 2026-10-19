/* eslint-disable @typescript-eslint/no-explicit-any */
// Benchmarks internos de Prodi: cuánto cuesta un resultado (mensaje, venta, contacto), el CTR y el CPM en los
// clientes del mismo rubro y tipo de zona, sobre los últimos 90 días de todas las cuentas en pesos. Sirven para que
// la IA de pauta diga si un número es bueno o malo "para este tipo de negocio". Se recalculan una vez por día.

import { adminDb } from "./db";
import { hoyAR, sumarDias } from "./fecha";
import { labelRubro, labelZona, rubroPauta, zonaPauta } from "./pauta-rubros";

export { labelRubro, labelZona, rubroPauta, zonaPauta };

type Res = "mensajes" | "compras" | "leads";
interface MetricasCliente {
  pid: string;
  rubro: string;
  zona: string | null;
  res: Res;
  costo: number;
  ctr: number | null;
  cpm: number | null;
}
interface Grupo {
  clientes: number;
  costo: number | null;
  ctr: number | null;
  cpm: number | null;
}
export interface Benchmarks {
  calculado_at: string;
  /** Por "rubro|zona|tipo de resultado", "rubro||res", "|zona|res" y "||res" (todos). */
  grupos: Record<string, Grupo>;
}

const mediana = (xs: number[]) => {
  const s = xs.filter((x) => isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function calcular(): Promise<Benchmarks> {
  const db = adminDb();
  const desde = sumarDias(hoyAR(), -89);
  const [proys, filas] = await Promise.all([db.collection("projects").get(), db.collection("meta_pauta_diaria").where("fecha", ">=", desde).get()]);
  const porCliente = new Map<string, any[]>();
  for (const d of filas.docs) {
    const f = d.data();
    if (f.moneda && f.moneda !== "ARS") continue; // Solo cuentas en pesos (no se mezclan monedas).
    porCliente.set(f.proyecto_id, [...(porCliente.get(f.proyecto_id) ?? []), f]);
  }
  const datos: MetricasCliente[] = [];
  for (const p of proys.docs) {
    const fs = porCliente.get(p.id);
    if (!fs?.length || p.data().demo_ejemplo) continue;
    const s = (k: string) => fs.reduce((a, f) => a + (Number(f[k]) || 0), 0);
    const res: Res = s("compras") >= 5 ? "compras" : s("leads") > s("mensajes") ? "leads" : "mensajes";
    const n = s(res);
    if (n < 5) continue; // Con pocos resultados el costo no es representativo.
    const imp = s("impresiones");
    datos.push({
      pid: p.id,
      rubro: rubroPauta(p.data()),
      zona: zonaPauta(p.data()),
      res,
      costo: s("gasto") / n,
      ctr: imp ? (s("clics") / imp) * 100 : null,
      cpm: imp ? (s("gasto") / imp) * 1000 : null,
    });
  }
  const porGrupo = new Map<string, MetricasCliente[]>();
  const sumar = (clave: string, x: MetricasCliente) => porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), x]);
  for (const x of datos) {
    sumar(`${x.rubro}|${x.zona ?? ""}|${x.res}`, x);
    sumar(`${x.rubro}||${x.res}`, x);
    if (x.zona) sumar(`|${x.zona}|${x.res}`, x);
    sumar(`||${x.res}`, x);
  }
  const grupos: Record<string, Grupo> = {};
  for (const [k, xs] of porGrupo) {
    grupos[k] = {
      clientes: xs.length,
      costo: mediana(xs.map((x) => x.costo)),
      ctr: mediana(xs.filter((x) => x.ctr != null).map((x) => x.ctr!)),
      cpm: mediana(xs.filter((x) => x.cpm != null).map((x) => x.cpm!)),
    };
  }
  return { calculado_at: new Date().toISOString(), grupos };
}

/** Los benchmarks (calculados hoy; si no, se recalculan). */
export async function benchmarksPauta(forzar = false): Promise<Benchmarks> {
  const ref = adminDb().collection("ia_benchmarks").doc("pauta");
  const b = (await ref.get()).data() as Benchmarks | undefined;
  if (!forzar && b && b.calculado_at.slice(0, 10) === new Date().toISOString().slice(0, 10)) return b;
  const nuevo = await calcular();
  await ref.set(nuevo);
  return nuevo;
}

const r = (n: number | null, dec = 0) => (n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: dec }).format(n));
const NOMBRE: Record<Res, string> = { mensajes: "mensaje", compras: "venta", leads: "contacto" };

/** Los benchmarks que le sirven a este cliente, en texto para la IA. */
export function benchmarksTexto(b: Benchmarks, p: Record<string, any>): string {
  const rubro = rubroPauta(p);
  const zona = zonaPauta(p);
  const lineas: string[] = [];
  for (const res of ["mensajes", "compras", "leads"] as Res[]) {
    const opciones: [string, string][] = [
      [`${rubro}|${zona ?? ""}|${res}`, `${labelRubro(rubro)} en ${labelZona(zona).toLowerCase()}`],
      [`${rubro}||${res}`, `${labelRubro(rubro)} (todas las zonas)`],
      ...(zona ? ([[`|${zona}|${res}`, `todos los rubros en ${labelZona(zona).toLowerCase()}`]] as [string, string][]) : []),
      [`||${res}`, "todos los clientes de Prodi"],
    ];
    for (const [k, nombre] of opciones) {
      const g = b.grupos[k];
      if (!g || g.clientes < 2 || g.costo == null) continue;
      lineas.push(`- ${nombre} (${g.clientes} clientes): costo por ${NOMBRE[res]} $ ${r(g.costo)} (mediana), CTR ${r(g.ctr, 2)}%, CPM $ ${r(g.cpm)}`);
    }
  }
  return lineas.length
    ? `Benchmarks de Prodi (últimos 90 días, cuentas en pesos). Este cliente: ${labelRubro(rubro)}, ${labelZona(zona)}.\n${lineas.join("\n")}`
    : `Benchmarks de Prodi: todavía no hay suficientes clientes con datos para comparar (este cliente: ${labelRubro(rubro)}, ${labelZona(zona)}).`;
}
