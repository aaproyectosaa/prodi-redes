// Carga al sistema la planilla de administración de 2026 (antes del sistema): facturado por mes, pagos al
// equipo, gastos, créditos/convenios/impuestos y lo que deben los clientes.
//
// Uso: pnpm exec tsx --env-file=.env scripts/importar-planilla.ts <carpeta-con-los-csv>            → SIMULA (no escribe)
//      pnpm exec tsx --env-file=.env scripts/importar-planilla.ts <carpeta-con-los-csv> --aplicar  → escribe
// En la carpeta: FACTURACION.csv (o fact.csv), FREELANCER.csv, PAGOS.csv y DEUDAS.csv (exportadas de Google Sheets).
// Los ids son fijos (planilla_…): correrlo dos veces no duplica nada, pisa lo mismo.
// El historial del equipo queda con `importado: true`: lo ve solo administración (ver reglas.ts).

import fs from "fs";
import path from "path";
import { adminDb } from "../api/_lib/db";
import { ars, csv as leerCsv, fecha, mesDe as mesDeAnio, plata, slug, sumarMes, titulo } from "./planilla-util";

const APLICAR = process.argv.includes("--aplicar");
const carpeta = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!carpeta) {
  console.error("Uso: tsx scripts/importar-planilla.ts <carpeta-con-los-csv> [--aplicar]");
  process.exit(1);
}
const ANIO = 2026;
const AHORA = new Date().toISOString();
const POR = "planilla";
const csv = (nombre: string) => leerCsv(carpeta!, nombre);
const mesDe = (s: string | undefined) => mesDeAnio(s, ANIO);


type Escritura = { col: string; id: string; data: Record<string, unknown> };
const escrituras: Escritura[] = [];
const avisos: string[] = [];
const poner = (col: string, id: string, data: Record<string, unknown>) => escrituras.push({ col, id, data });

// ── 1. Facturado por mes ─────────────────────────────────────────────────────────────────────────
{
  const filas = csv(fs.existsSync(path.join(carpeta, "FACTURACION.csv")) ? "FACTURACION.csv" : "fact.csv");
  for (const f of filas) {
    const mes = mesDe(f[6]);
    if (!mes || f[7]?.trim() !== "REDES") continue;
    const neto = plata(f[8]);
    if (!neto) continue;
    poner("historico_mensual", mes, { ingresos: neto, bruto: plata(f[9]) || null, fuente: "planilla 2026", created_at: AHORA });
  }
}

// ── 2. Pagos al equipo ───────────────────────────────────────────────────────────────────────────
const UID: Record<string, string> = {
  "ANIC IVAN": "ZZ5x91NBh3PyubwsFlMflDetq3X2",
  "CAMARGO LAURA": "jjlK0BhEIDU32vJVwJdw4MlsqHe2",
  "CIAN PATRICIO": "5JCF9WDZ8ilgC3B4cKic",
  MELI: "Qbnd3cyyu8VNMYXMoZPCTd88DaA2",
  "PASETTO LUCIA": "Iug05vCBOEYKXJWuy0Fs9ny4sem2",
  "RICART EXEQUIEL": "BiYAs7OUgOM1tZaCGRnQD6x4YwJ3",
  "SINCHI ARIEL": "v7igmyEjc6WB7fy7fY5QML5FU9K2",
  "NATALIA MERINO": "dNldcPSlBUeKUOnW25DPD6GFtZ22",
  EMILIANA: "QphetHwZqRTdxTF07VRG7NtxN0y2",
};
{
  const filas = csv("FREELANCER.csv").slice(1);
  for (const f of filas) {
    const mes = mesDe(f[0]);
    const nombre = String(f[1] ?? "").trim();
    if (!mes || !nombre) continue;
    const total = plata(f[6]);
    const base = plata(f[2]);
    const extras = plata(f[3]);
    const baja = plata(f[4]);
    const alta = plata(f[5]);
    const clave = nombre.toUpperCase();
    const uid = UID[clave] ?? `planilla_${slug(nombre)}`;
    if (!UID[clave]) avisos.push(`Equipo: "${nombre}" no tiene usuario en el sistema → queda con su nombre (${mes}).`);
    const pagado = String(f[10] ?? "").trim().toUpperCase() === "TRUE";
    const detalle = [
      `Base ${ars(base)}`,
      extras ? `+ extras ${ars(extras)}` : "",
      alta ? `+ altas de clientes ${ars(alta)}` : "",
      baja ? `− bajas de clientes ${ars(baja)}` : "",
      f[9]?.trim() ? `· ${titulo(f[9])}` : "",
      f[8]?.trim() ? `· ${titulo(f[8])}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (!total && !pagado) continue;
    poner("equipo_liquidaciones", `${uid}_${mes}`, {
      uid,
      mes,
      nombre: titulo(nombre),
      importado: true,
      detalle,
      ...(pagado
        ? { estado: "pagado", ajustes: [], total_pagado: total, pagado_at: `${fecha(f[7]) ?? sumarMes(`${mes}-10`, 1)}T12:00:00.000Z` }
        : { estado: "pendiente", ajustes: total ? [{ concepto: "Según la planilla", monto: total }] : [], total_pagado: null, pagado_at: null }),
    });
  }
}

// ── 3. Gastos, créditos, convenios e impuestos ──────────────────────────────────────────────────
type Fila = { mes: string; concepto: string; tipo: string; monto: number; cuota: string; pago: string | null; vto: string | null; medio: string; pagado: boolean };
const pagos: Fila[] = csv("PAGOS.csv")
  .slice(1)
  .map((f) => ({
    mes: mesDe(f[1]) ?? "",
    concepto: String(f[2] ?? "").trim(),
    tipo: String(f[3] ?? "").trim().toUpperCase(),
    monto: plata(f[6]) || plata(f[4]),
    cuota: String(f[7] ?? "").trim(),
    pago: fecha(f[8]),
    vto: fecha(f[9]),
    medio: String(f[10] ?? "").trim().toUpperCase(),
    pagado: String(f[11] ?? "").trim().toUpperCase() === "TRUE",
  }))
  .filter((p) => p.mes && p.concepto && p.monto > 0);

// Créditos y convenios: cuotas con número ("11/24"). Clave = de qué plan es.
const PLANES: { re: RegExp; id: string; tipo: "credito" | "arca"; nombre: string; entidad: string | null; total: number }[] = [
  { re: /^PRESTAMO 1/, id: "prestamo_1", tipo: "credito", nombre: "Préstamo 1", entidad: null, total: 24 },
  { re: /^PRESTAMO 2/, id: "prestamo_2", tipo: "credito", nombre: "Préstamo 2", entidad: null, total: 18 },
  { re: /^FINANZACION UVA/, id: "financiacion_uva", tipo: "credito", nombre: "Financiación UVA", entidad: null, total: 18 },
  { re: /^CONVENIO DE PAGO IIBB/, id: "convenio_iibb", tipo: "arca", nombre: "Convenio de pago IIBB", entidad: "API Santa Fe", total: 12 },
  { re: /^PLAN (DE PAGO IVA|DEUDA IVA3)/, id: "plan_iva_3", tipo: "arca", nombre: "Plan de pago IVA (8 cuotas)", entidad: "ARCA", total: 8 },
  { re: /^PLAN DEUDA IVA1/, id: "plan_iva_1", tipo: "arca", nombre: "Plan de deuda IVA 1", entidad: "ARCA", total: 12 },
  { re: /^PLAN DEUDA IVA2/, id: "plan_iva_2", tipo: "arca", nombre: "Plan de deuda IVA 2", entidad: "ARCA", total: 12 },
];
// Impuestos que se pagan cada mes.
const IMPUESTOS: { re: RegExp; id: string; nombre: string; entidad: string }[] = [
  { re: /^IIBB/, id: "iibb", nombre: "Ingresos Brutos", entidad: "API Santa Fe" },
  { re: /^AUTONOMO/, id: "autonomo", nombre: "Autónomo", entidad: "ARCA" },
  { re: /^IVA/, id: "iva", nombre: "IVA", entidad: "ARCA" },
];

type Cuota = { n: number; vence: string; monto: number; pagada: boolean; pagada_at: string | null; medio: string | null };
const medioDe = (m: string) => (m.includes("DEBITO") ? "debito" : m === "TC" ? "otro" : "transferencia");

for (const plan of PLANES) {
  const filas = pagos.filter((p) => plan.re.test(p.concepto.toUpperCase())).sort((a, b) => a.mes.localeCompare(b.mes));
  if (!filas.length) continue;
  const cuotas: Cuota[] = [];
  let prevN = 0;
  let prevVence = "";
  for (const p of filas) {
    let n = Number(p.cuota.split("/")[0]) || prevN + 1;
    if (n <= prevN) n = prevN + 1;
    const vence = p.vto ?? p.pago ?? (prevVence ? sumarMes(prevVence, 1) : sumarMes(`${p.mes}-10`, 1));
    cuotas.push({ n, vence, monto: p.monto, pagada: p.pagado, pagada_at: p.pagado ? `${p.pago ?? vence}T12:00:00.000Z` : null, medio: p.pagado ? medioDe(p.medio) : null });
    prevN = n;
    prevVence = vence;
  }
  // Huecos en la numeración (la planilla saltea alguna): igual que la anterior.
  for (let i = 1; i < cuotas.length; i++) {
    const a = cuotas[i - 1];
    if (cuotas[i].n > a.n + 1) {
      const vence = sumarMes(a.vence, 1);
      cuotas.splice(i, 0, { ...a, n: a.n + 1, vence, pagada_at: a.pagada ? `${vence}T12:00:00.000Z` : null });
    }
  }
  // Las de antes de la planilla: pagadas, con el mismo monto que la primera.
  const primera = cuotas[0];
  for (let n = primera.n - 1, k = 1; n >= 1; n--, k++) {
    const vence = sumarMes(primera.vence, -k);
    cuotas.unshift({ n, vence, monto: primera.monto, pagada: true, pagada_at: `${vence}T12:00:00.000Z`, medio: primera.medio ?? "debito" });
  }
  // Las que faltan: pendientes, con el último monto (si cambia, se corrige al pagarla).
  const ultima = cuotas[cuotas.length - 1];
  for (let n = ultima.n + 1, k = 1; n <= plan.total; n++, k++) {
    cuotas.push({ n, vence: sumarMes(ultima.vence, k), monto: ultima.monto, pagada: false, pagada_at: null, medio: null });
  }
  const faltan = cuotas.filter((c) => !c.pagada).length;
  poner("obligaciones", `planilla_${plan.id}`, {
    tipo: plan.tipo,
    nombre: plan.nombre,
    entidad: plan.entidad,
    detalle: `Cargado de la planilla. Las cuotas anteriores a enero y las futuras se estimaron con el monto conocido.`,
    cuotas,
    activa: faltan > 0,
    created_at: AHORA,
    created_by: POR,
  });
}

for (const imp of IMPUESTOS) {
  const filas = pagos.filter((p) => imp.re.test(p.concepto.toUpperCase()) && !PLANES.some((x) => x.re.test(p.concepto.toUpperCase())));
  if (!filas.length) continue;
  const cuotas: Cuota[] = filas
    .map((p) => ({ p, vence: p.vto ?? p.pago ?? sumarMes(`${p.mes}-15`, 1) }))
    .sort((a, b) => a.vence.localeCompare(b.vence))
    .map(({ p, vence }, i) => ({
      n: i + 1,
      vence,
      monto: p.monto,
      pagada: p.pagado,
      pagada_at: p.pagado ? `${p.pago ?? vence}T12:00:00.000Z` : null,
      medio: p.pagado ? medioDe(p.medio) : null,
    }));
  poner("obligaciones", `planilla_${imp.id}`, {
    tipo: "impuesto",
    nombre: imp.nombre,
    entidad: imp.entidad,
    detalle: "Cargado de la planilla (enero a agosto).",
    cuotas,
    activa: true,
    created_at: AHORA,
    created_by: POR,
  });
}

// El resto: gastos (lo pagado). Lo que figura sin pagar se avisa, no se carga.
const CATEGORIA = (p: Fila) =>
  p.tipo.startsWith("SUSCRIPCIONES") ? "Software y suscripciones" : p.tipo === "OPERATIVOS" ? "Alquiler y servicios" : p.tipo === "IMPOSITIVO" ? "Impuestos" : "Otros";
const usados = new Map<string, number>();
for (const p of pagos) {
  const up = p.concepto.toUpperCase();
  if (PLANES.some((x) => x.re.test(up)) || IMPUESTOS.some((x) => x.re.test(up))) continue;
  if (!p.pagado) {
    avisos.push(`Sin pagar en la planilla (no se cargó como gasto): ${titulo(p.concepto)} de ${p.mes} · ${ars(p.monto)}`);
    continue;
  }
  const base = `planilla_${p.mes}_${slug(p.concepto)}`;
  const k = (usados.get(base) ?? 0) + 1;
  usados.set(base, k);
  const dia = p.pago ?? p.vto ?? sumarMes(`${p.mes}-28`, 0);
  poner("gastos", k > 1 ? `${base}_${k}` : base, {
    fecha: dia,
    mes: p.mes,
    concepto: titulo(p.concepto),
    categoria: CATEGORIA(p),
    monto: p.monto,
    medio: medioDe(p.medio),
    proveedor: null,
    nota: p.medio === "TC" ? "Tarjeta de crédito · cargado de la planilla" : "Cargado de la planilla",
    fijo: p.tipo === "OPERATIVOS" || p.tipo.startsWith("SUSCRIPCIONES"),
    created_at: AHORA,
    created_by: POR,
  });
}

// ── 4. Lo que deben los clientes ─────────────────────────────────────────────────────────────────
{
  const plan = (n: number, primera: string, monto: number, cobradas: Record<number, string>) =>
    Array.from({ length: n }, (_, i) => {
      const cobrada = cobradas[i + 1];
      return { n: i + 1, vence: sumarMes(primera, i), monto, pagada: !!cobrada, pagada_at: cobrada ? `${cobrada}T12:00:00.000Z` : null, medio: cobrada ? "transferencia" : null };
    });
  poner("deudas_clientes", "planilla_metal_nor", {
    cliente: "Metal Nor",
    proyecto_id: null,
    detalle: "Diciembre y préstamo · financiada en 9 cuotas",
    base: 1266262.75,
    interes: "0,8% diario",
    cuotas: plan(9, "2026-01-27", 225000, { 1: "2026-01-27", 2: "2026-02-27", 3: "2026-03-28", 4: "2026-05-22" }),
    incobrable: false,
    activa: true,
    nota: "Según la planilla, al 27/08 debía $1.221.600 con intereses (cuotas 5 a 8).",
    created_at: AHORA,
    created_by: POR,
  });
  poner("deudas_clientes", "planilla_el_norteno", {
    cliente: "El Norteño",
    proyecto_id: null,
    detalle: "Julio y octubre · financiada en 6 cuotas",
    base: 1177000,
    interes: "0,8% diario",
    cuotas: plan(6, "2026-02-20", 300000, { 1: "2026-02-21", 2: "2026-03-20", 3: "2026-04-20", 4: "2026-05-20", 5: "2026-06-20", 6: "2026-07-20" }),
    incobrable: false,
    activa: false,
    nota: "La planilla lo marca como COBRADO.",
    created_at: AHORA,
    created_by: POR,
  });
  poner("deudas_clientes", "planilla_barbershop_incobrable", {
    cliente: "Barbershop",
    proyecto_id: null,
    detalle: "Boleta de abril (venció el 5/05/2026)",
    cuotas: [{ n: 1, vence: "2026-05-05", monto: 160000, pagada: false, pagada_at: null, medio: null }],
    incobrable: true,
    activa: false,
    created_at: AHORA,
    created_by: POR,
  });
  poner("deudas_clientes", "planilla_el_norteno_incobrable", {
    cliente: "El Norteño",
    proyecto_id: null,
    detalle: "Factura de mayo (venció el 5/06/2026) · neto $413.223 + IVA",
    cuotas: [{ n: 1, vence: "2026-06-05", monto: 500000, pagada: false, pagada_at: null, medio: null }],
    incobrable: true,
    activa: false,
    created_at: AHORA,
    created_by: POR,
  });
}

// ── Resumen y escritura ──────────────────────────────────────────────────────────────────────────
const porCol = escrituras.reduce<Record<string, number>>((a, e) => ((a[e.col] = (a[e.col] ?? 0) + 1), a), {});
console.log(APLICAR ? "ESCRIBIENDO" : "SIMULACIÓN (no escribe nada; agregá --aplicar)", porCol);
const obligs = escrituras.filter((e) => e.col === "obligaciones");
for (const o of obligs) {
  const c = o.data.cuotas as Cuota[];
  console.log(`  ${o.data.nombre}: ${c.length} cuotas · ${c.filter((x) => x.pagada).length} pagadas · faltan ${ars(c.filter((x) => !x.pagada).reduce((a, x) => a + x.monto, 0))}`);
}
const liq = escrituras.filter((e) => e.col === "equipo_liquidaciones");
console.log(`  Equipo: ${liq.length} liquidaciones · ${liq.filter((l) => l.data.estado === "pendiente").length} sin pagar`);
console.log(`  Gastos: ${escrituras.filter((e) => e.col === "gastos").length} · total ${ars(escrituras.filter((e) => e.col === "gastos").reduce((a, e) => a + Number(e.data.monto), 0))}`);
console.log(`  Facturado: ${escrituras.filter((e) => e.col === "historico_mensual").map((e) => `${e.id} ${ars(Number(e.data.ingresos))}`).join(" · ")}`);
if (avisos.length) console.log("\nAvisos:\n" + [...new Set(avisos)].map((a) => `  - ${a}`).join("\n"));

if (APLICAR) {
  const db = adminDb();
  for (const e of escrituras) await db.collection(e.col).doc(e.id).set(e.data);
  console.log(`\nListo: ${escrituras.length} documentos.`);
}
process.exit(0);
