// Carga al sistema el "Balance general oficial" de 2024 (enero a abril): facturado por cliente y por mes
// y los sueldos de abril. Los clientes que no están quedan como "clientes viejos" (inactivos).
//
// Uso: pnpm exec tsx --env-file=.env scripts/importar-planilla-2024.ts <carpeta-con-los-csv>            → SIMULA (no escribe)
//      pnpm exec tsx --env-file=.env scripts/importar-planilla-2024.ts <carpeta-con-los-csv> --aplicar  → escribe
// En la carpeta: BALANCE.csv, PROGRAMADORES.csv ("Ingresos programadores") y SUELDOS.csv.
// Esta planilla usa formato de EE.UU. ("$1,055.00"). Si una fila está solo en dólares, se pasa a pesos con la
// cotización que figura en la planilla para ese mes (enero no tiene: se usa la de febrero).

import { adminDb } from "../api/_lib/db";
import { ars, csv as leerCsv, fecha, slug, titulo } from "./planilla-util";

const APLICAR = process.argv.includes("--aplicar");
const carpeta = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!carpeta) {
  console.error("Uso: tsx scripts/importar-planilla-2024.ts <carpeta-con-los-csv> [--aplicar]");
  process.exit(1);
}
const AHORA = new Date().toISOString();
const POR = "planilla";
const csv = (nombre: string) => leerCsv(carpeta!, nombre);
/** "$1,055.00" → 1055 */
const plataUS = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(/[$\s,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const COTIZACION: Record<string, number> = { "2024-01": 1070, "2024-02": 1070, "2024-03": 1010, "2024-04": 1055 };

type Escritura = { col: string; id: string; data: Record<string, unknown> };
const escrituras: Escritura[] = [];
const avisos: string[] = [];
const poner = (col: string, id: string, data: Record<string, unknown>) => escrituras.push({ col, id, data });

(async () => {
  const db = adminDb();
  const proyectos = (await db.collection("projects").get()).docs.map((d) => ({ id: d.id, nombre: String((d.data() as { nombre?: string }).nombre ?? "") }));
  // Nombres de la planilla 2024 → cliente del sistema (o cliente viejo ya creado con la planilla 2025).
  const ALIAS: Record<string, string> = {
    lider_auto: "lider_autos",
    copy_master_rqta: "copy_master",
    copy_master_ctes: "copy_master",
    el_pulqui_van_tur: "la_tostadense_vantur",
    pulqui_van_tourd: "la_tostadense_vantur",
    aroma_deco_avda: "aroma_y_deco",
    proyeccion_electroluz_tienda: "proyeccion_electroluz",
    recortourd: "record_tour_viajes",
    fundacion_entender_rqta: "fundacion_entender",
  };
  const proyectoDe = (cliente: string): { id: string; nuevo: boolean; nombre: string } => {
    const s = ALIAS[slug(cliente)] ?? slug(cliente);
    const p = proyectos.find((x) => slug(x.nombre) === s) ?? proyectos.find((x) => x.id === `planilla_cli_${s}`);
    return p ? { id: p.id, nuevo: false, nombre: p.nombre } : { id: `planilla_cli_${s}`, nuevo: true, nombre: titulo(s.replace(/_/g, " ")) };
  };

  // ── 1. Facturado por cliente ──────────────────────────────────────────────────────────────────
  type Fila = { cliente: string; grupo: string; mes: string; usd: number; ar: number };
  const filas: Fila[] = [];
  let mesBloque = 1;
  for (const f of csv("BALANCE.csv").slice(1)) {
    const c0 = String(f[0] ?? "").trim();
    if (c0.startsWith("$")) {
      mesBloque++; // "$1070 (VALOR 27 DE FEBRERO)": empieza el mes siguiente
      continue;
    }
    if (!c0) continue;
    filas.push({ cliente: c0, grupo: String(f[1] ?? "").trim(), mes: `2024-${String(mesBloque).padStart(2, "0")}`, usd: plataUS(f[5]), ar: plataUS(f[6]) });
  }
  for (const f of csv("PROGRAMADORES.csv").slice(1)) {
    const c0 = String(f[0] ?? "").trim();
    const d = fecha(f[2]);
    if (!c0 || !d) continue;
    filas.push({ cliente: c0, grupo: String(f[1] ?? "").trim(), mes: d.slice(0, 7), usd: plataUS(f[5]), ar: plataUS(f[6]) });
  }
  const viejos = new Map<string, string>();
  const porMes: Record<string, number> = {};
  const usadas = new Map<string, number>();
  const vistas = new Set<string>();
  for (const r of filas) {
    const m = r.cliente.match(/^(.*?)\s*\((.+)\)\s*$/);
    const nombre = (m ? m[1] : r.cliente).trim();
    const extra = m?.[2].toLowerCase() ?? "";
    const servicio = r.grupo.startsWith("P") || extra ? (extra.includes("manten") || r.grupo.endsWith("M") ? "MANTENIMIENTO WEB" : "PROGRAMACIÓN") : "REDES";
    const monto = r.ar || Math.round(r.usd * COTIZACION[r.mes]);
    if (!monto) {
      avisos.push(`Sin monto: ${r.cliente} (${r.mes}) → no se cargó.`);
      continue;
    }
    // La hoja de programadores repite filas de abril que ya están en el balance.
    const clave = `${slug(r.cliente)}_${r.mes}_${r.usd}_${r.ar}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    const p = proyectoDe(nombre);
    if (p.nuevo) viejos.set(p.id, p.nombre);
    porMes[r.mes] = (porMes[r.mes] ?? 0) + monto;
    const base = `planilla24_${p.id}_${r.mes}_${slug(servicio)}`;
    const k = (usadas.get(base) ?? 0) + 1;
    usadas.set(base, k);
    poner("historico_facturas", k > 1 ? `${base}_${k}` : base, {
      proyecto_id: p.id,
      cliente: p.nombre,
      mes: r.mes,
      servicio,
      neto: monto,
      bruto: monto,
      cobrado: 0,
      usd: r.usd || null,
      fecha_pago: null,
      forma: r.ar ? null : `US$${r.usd} a $${COTIZACION[r.mes]}`,
      detalle: r.cliente,
      fuente: "planilla 2024",
      created_at: AHORA,
    });
  }
  for (const [mes, total] of Object.entries(porMes)) poner("historico_mensual", mes, { ingresos: total, bruto: total, fuente: "planilla 2024", created_at: AHORA });
  for (const [id, nombre] of viejos) {
    poner("projects", id, {
      nombre,
      color: "#A1A1AA",
      enabled: false,
      cliente_viejo: true,
      team_roles: { productor: [], editor: [], pauta: [], cliente: [] },
      contacto_emails: [],
      created_at: AHORA,
      created_by: POR,
    });
  }

  // ── 2. Sueldos de abril (de mayo en adelante la hoja es una proyección: no se carga) ──────────
  const UID: Record<string, string> = {
    IVAN: "ZZ5x91NBh3PyubwsFlMflDetq3X2",
    PATO: "5JCF9WDZ8ilgC3B4cKic",
    "CIAN T": "planilla_cian_tomas",
    CELINA: "planilla_muchiut_celina",
    "TOMAS C.": "planilla_carrasco_tomas",
  };
  const NOMBRE: Record<string, string> = { "CIAN T": "Cian Tomas", CELINA: "Muchiut Celina", "TOMAS C.": "Carrasco Tomas", PATO: "Cian Patricio", IVAN: "Anic Ivan" };
  {
    const hoja = csv("SUELDOS.csv");
    const ini = hoja.findIndex((f) => String(f[1] ?? "").trim() === "ABRIL");
    const fin = hoja.findIndex((f, i) => i > ini && String(f[1] ?? "").trim() === "MAYO");
    const mes = "2024-04";
    for (const f of hoja.slice(ini, fin)) {
      for (const [col, area] of [[1, "Redes"], [4, "Programación (mantenimientos)"]] as const) {
        const quien = String(f[col] ?? "").trim();
        const monto = plataUS(f[col + 1]);
        if (!quien || !monto || quien === "NOMBRE") continue;
        const clave = quien.toUpperCase();
        const uid = UID[clave] ?? `planilla_${slug(quien)}`;
        poner("equipo_liquidaciones", `${uid}_${mes}`, {
          uid,
          mes,
          nombre: NOMBRE[clave] ?? titulo(quien),
          importado: true,
          detalle: [area, String(f[col + 2] ?? "").trim() ? `+ ${String(f[col + 2]).trim()}` : ""].filter(Boolean).join(" "),
          estado: "pagado",
          ajustes: [],
          total_pagado: monto,
          pagado_at: "2024-05-10T12:00:00.000Z",
        });
      }
    }
  }

  // ── Resumen y escritura ───────────────────────────────────────────────────────────────────────
  const de = (col: string) => escrituras.filter((e) => e.col === col);
  console.log(APLICAR ? "ESCRIBIENDO" : "SIMULACIÓN (no escribe nada; agregá --aplicar)");
  console.log(`  Facturado: ${de("historico_mensual").map((e) => `${e.id} ${ars(Number(e.data.ingresos))}`).join(" · ")}`);
  console.log(`  Facturas por cliente: ${de("historico_facturas").length}`);
  console.log(`  Clientes viejos nuevos (${viejos.size}): ${[...viejos.values()].join(", ")}`);
  const ya = new Set(de("historico_facturas").filter((e) => !viejos.has(e.data.proyecto_id as string)).map((e) => e.data.cliente as string));
  console.log(`  Ya estaban (${ya.size}): ${[...ya].join(", ")}`);
  const liq = de("equipo_liquidaciones");
  console.log(`  Sueldos abril: ${liq.map((e) => `${e.data.nombre} ${ars(Number(e.data.total_pagado))}`).join(" · ")}`);
  if (avisos.length) console.log("\nAvisos:\n" + [...new Set(avisos)].map((a) => `  - ${a}`).join("\n"));

  if (APLICAR) {
    for (const e of escrituras) await db.collection(e.col).doc(e.id).set(e.data);
    console.log(`\nListo: ${escrituras.length} documentos.`);
  }
  process.exit(0);
})();
