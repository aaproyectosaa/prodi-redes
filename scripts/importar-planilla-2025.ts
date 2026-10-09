// Carga al sistema la planilla de administración de 2025: facturado por mes y por cliente (los que ya no
// están quedan como "clientes viejos", inactivos), pagos al equipo y gastos/impuestos. Las cuotas de 2025
// de los créditos y convenios ya cargados (importar-planilla.ts) se corrigen con el monto real.
//
// Uso: pnpm exec tsx --env-file=.env scripts/importar-planilla-2025.ts <carpeta-con-los-csv>            → SIMULA (no escribe)
//      pnpm exec tsx --env-file=.env scripts/importar-planilla-2025.ts <carpeta-con-los-csv> --aplicar  → escribe
// En la carpeta: FACTURADO.csv, RETRIBUCION.csv y PAGOSMENS.csv (exportadas de Google Sheets).
// Los ids son fijos (planilla…): correrlo dos veces no duplica nada.

import { adminDb } from "../api/_lib/db";
import { ars, csv as leerCsv, fecha, mesDe as mesDeAnio, plata, slug, sumarMes, titulo } from "./planilla-util";

const APLICAR = process.argv.includes("--aplicar");
const carpeta = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!carpeta) {
  console.error("Uso: tsx scripts/importar-planilla-2025.ts <carpeta-con-los-csv> [--aplicar]");
  process.exit(1);
}
const ANIO = 2025;
const AHORA = new Date().toISOString();
const POR = "planilla";
const csv = (nombre: string) => leerCsv(carpeta!, nombre);
const mesDe = (s: string | undefined) => mesDeAnio(s, ANIO);

type Escritura = { col: string; id: string; data: Record<string, unknown>; merge?: boolean };
const escrituras: Escritura[] = [];
const avisos: string[] = [];
const poner = (col: string, id: string, data: Record<string, unknown>, merge = false) => escrituras.push({ col, id, data, merge });

(async () => {
  const db = adminDb();

  // ── 1. Facturado: por mes y por cliente ───────────────────────────────────────────────────────
  const proyectos = (await db.collection("projects").get()).docs.map((d) => ({ id: d.id, nombre: String((d.data() as { nombre?: string }).nombre ?? "") }));
  const ALIAS: Record<string, string> = { lider_auto: "lider_autos", buyatti: "yMFxUZOLQuMpNRXKlXzk" };
  const proyectoDe = (cliente: string): { id: string; nuevo: boolean } => {
    const s = slug(cliente);
    const alias = ALIAS[s];
    const p = proyectos.find((x) => x.id === alias) ?? proyectos.find((x) => slug(x.nombre) === (alias ?? s));
    return p ? { id: p.id, nuevo: false } : { id: `planilla_cli_${s}`, nuevo: true };
  };
  const COLORES = ["#94A3B8", "#A8A29E", "#9CA3AF", "#A1A1AA"];
  const viejos = new Map<string, string>();
  const porMes: Record<string, { neto: number; bruto: number }> = {};
  const usadas = new Map<string, number>();
  for (const f of csv("FACTURADO.csv").slice(1)) {
    const cliente = String(f[0] ?? "").trim();
    const mes = mesDe(f[4]);
    if (!cliente || !mes) continue;
    const neto = plata(f[9]);
    const bruto = plata(f[11]) || neto;
    const cobrado = plata(f[17]);
    if (!neto && !bruto) continue;
    (porMes[mes] ??= { neto: 0, bruto: 0 }).neto += neto;
    porMes[mes].bruto += bruto;
    const p = proyectoDe(cliente);
    if (p.nuevo) viejos.set(p.id, titulo(cliente));
    const base = `planilla25_${p.id}_${mes}`;
    const k = (usadas.get(base) ?? 0) + 1;
    usadas.set(base, k);
    if (!fecha(f[23])) avisos.push(`Sin fecha de pago: ${titulo(cliente)} ${mes} · ${ars(bruto)}`);
    poner("historico_facturas", k > 1 ? `${base}_${k}` : base, {
      proyecto_id: p.id,
      cliente: titulo(cliente),
      mes,
      servicio: String(f[6] ?? "").trim().toUpperCase() || "REDES",
      tipo_cobro: String(f[3] ?? "").trim().toLowerCase() || null,
      neto,
      bruto,
      cobrado,
      fecha_pago: fecha(f[23]),
      forma: String(f[24] ?? "").trim() || null,
      comprobante: String(f[18] ?? "").trim() || null,
      fuente: "planilla 2025",
      created_at: AHORA,
    });
  }
  for (const [mes, t] of Object.entries(porMes)) {
    poner("historico_mensual", mes, { ingresos: Math.round(t.neto * 100) / 100, bruto: Math.round(t.bruto * 100) / 100, fuente: "planilla 2025", created_at: AHORA });
  }
  let i = 0;
  for (const [id, nombre] of viejos) {
    poner("projects", id, {
      nombre,
      color: COLORES[i++ % COLORES.length],
      enabled: false,
      cliente_viejo: true,
      team_roles: { productor: [], editor: [], pauta: [], cliente: [] },
      contacto_emails: [],
      created_at: AHORA,
      created_by: POR,
    });
  }

  // ── 2. Pagos al equipo ────────────────────────────────────────────────────────────────────────
  const UID: Record<string, string> = {
    "ANIC IVAN": "ZZ5x91NBh3PyubwsFlMflDetq3X2",
    "CAMARGO LAURA": "jjlK0BhEIDU32vJVwJdw4MlsqHe2",
    "CIAN PATRICIO": "5JCF9WDZ8ilgC3B4cKic",
    MELI: "Qbnd3cyyu8VNMYXMoZPCTd88DaA2",
    "PASETTO LUCIA": "Iug05vCBOEYKXJWuy0Fs9ny4sem2",
    "RICART EXEQUIEL": "BiYAs7OUgOM1tZaCGRnQD6x4YwJ3",
    "SINCHI ARIEL": "v7igmyEjc6WB7fy7fY5QML5FU9K2",
    MARIAN: "XiFn4TKmDTa8VIRQW4aqfGGJH8s2",
  };
  const liqs = new Map<string, Escritura>();
  for (const f of csv("RETRIBUCION.csv").slice(1)) {
    const mes = mesDe(f[1]);
    const nombre = String(f[2] ?? "").trim().replace(/\s+/g, " ");
    const total = plata(f[10]);
    if (!mes || !nombre || !total || mesDe(nombre)) continue;
    const clave = nombre.toUpperCase();
    const uid = UID[clave] ?? `planilla_${slug(nombre)}`;
    const usd = f[9]?.trim();
    const detalle = [
      usd ? `US${usd.replace(/\s/g, "")}` : "",
      plata(f[5]) ? `+ extras ${ars(plata(f[5]))}` : "",
      f[6]?.trim() ? `+ extras US${f[6].trim()}` : "",
      f[8]?.trim() ? `+ altas US${f[8].trim()}` : "",
      f[7]?.trim() ? `bajas US${f[7].trim().replace("-", "−")}` : "",
      f[14]?.trim() ? `· ${titulo(f[14])}` : f[13]?.trim() ? `· ${titulo(f[13])}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const id = `${uid}_${mes}`;
    const previa = liqs.get(id);
    if (previa) {
      previa.data.total_pagado = Number(previa.data.total_pagado) + total;
      previa.data.detalle = `${previa.data.detalle} · y otro pago`;
      continue;
    }
    liqs.set(id, {
      col: "equipo_liquidaciones",
      id,
      data: {
        uid,
        mes,
        nombre: titulo(nombre),
        importado: true,
        detalle,
        estado: "pagado",
        ajustes: [],
        total_pagado: total,
        pagado_at: `${fecha(f[11]) ?? sumarMes(`${mes}-10`, 1)}T12:00:00.000Z`,
      },
    });
  }
  escrituras.push(...liqs.values());

  // ── 3. Gastos e impuestos; cuotas 2025 de créditos y convenios ────────────────────────────────
  const PLANES: { re: RegExp; id: string }[] = [
    { re: /^PRESTAMO 1/, id: "prestamo_1" },
    { re: /^PRESTAMO 2/, id: "prestamo_2" },
    { re: /^FINANZACION UVA/, id: "financiacion_uva" },
    { re: /^CONVENIO DE PAGO IIBB/, id: "convenio_iibb" },
    { re: /^PLAN (DE PAGO IVA|DEUDA IVA3)/, id: "plan_iva_3" },
    { re: /^PLAN DEUDA IVA1/, id: "plan_iva_1" },
    { re: /^PLAN DEUDA IVA2/, id: "plan_iva_2" },
  ];
  type Cuota = { n: number; vence: string; monto: number; pagada: boolean; pagada_at: string | null; medio: string | null };
  const medioDe = (m: string) => (m.includes("DEBITO") ? "debito" : m === "TC" ? "otro" : "transferencia");
  const obligs = new Map<string, Cuota[]>();
  const CATEGORIA = (tipo: string) =>
    tipo.startsWith("SUSCRIPCIONES") ? "Software y suscripciones" : tipo === "OPERATIVOS" ? "Alquiler y servicios" : tipo === "IMPOSITIVO" ? "Impuestos" : "Otros";
  const usados = new Map<string, number>();
  for (const f of csv("PAGOSMENS.csv").slice(1)) {
    const mes = mesDe(f[1]);
    const concepto = String(f[2] ?? "").trim();
    const tipo = String(f[3] ?? "").trim().toUpperCase();
    const monto = plata(f[6]) || plata(f[4]);
    if (!mes || !concepto || monto <= 0) continue;
    const pago = fecha(f[9]);
    const vto = fecha(f[10]);
    const medio = String(f[11] ?? "").trim().toUpperCase();
    const up = concepto.toUpperCase();
    const plan = PLANES.find((x) => x.re.test(up));
    const n = Number(String(f[7] ?? "").split("/")[0]);
    if (plan && n) {
      const id = `planilla_${plan.id}`;
      if (!obligs.has(id)) {
        const doc = await db.collection("obligaciones").doc(id).get();
        obligs.set(id, doc.exists ? ((doc.data() as { cuotas: Cuota[] }).cuotas ?? []) : []);
      }
      const cuotas = obligs.get(id)!;
      const c = cuotas.find((x) => x.n === n);
      if (!c) {
        avisos.push(`${titulo(concepto)} cuota ${n} (${mes}) no está en el sistema → no se cargó.`);
        continue;
      }
      const dia = pago ?? vto ?? c.vence;
      Object.assign(c, { monto, vence: vto ?? c.vence, pagada: true, pagada_at: `${dia}T12:00:00.000Z`, medio: medioDe(medio) });
      continue;
    }
    const base = `planilla_${mes}_${slug(concepto)}`;
    const k = (usados.get(base) ?? 0) + 1;
    usados.set(base, k);
    poner("gastos", k > 1 ? `${base}_${k}` : base, {
      fecha: pago ?? vto ?? sumarMes(`${mes}-28`, 0),
      mes,
      concepto: titulo(concepto),
      categoria: CATEGORIA(tipo),
      monto,
      medio: medioDe(medio),
      proveedor: null,
      nota: medio === "TC" ? "Tarjeta de crédito · cargado de la planilla 2025" : "Cargado de la planilla 2025",
      fijo: tipo === "OPERATIVOS" || tipo.startsWith("SUSCRIPCIONES"),
      created_at: AHORA,
      created_by: POR,
    });
  }
  for (const [id, cuotas] of obligs) poner("obligaciones", id, { cuotas }, true);

  // ── Resumen y escritura ───────────────────────────────────────────────────────────────────────
  const de = (col: string) => escrituras.filter((e) => e.col === col);
  console.log(APLICAR ? "ESCRIBIENDO" : "SIMULACIÓN (no escribe nada; agregá --aplicar)");
  console.log(`  Facturado: ${de("historico_mensual").map((e) => `${e.id} ${ars(Number(e.data.ingresos))}`).join(" · ")}`);
  console.log(`  Facturas por cliente: ${de("historico_facturas").length}`);
  console.log(`  Clientes viejos nuevos (${viejos.size}): ${[...viejos.values()].join(", ")}`);
  const conocidos = new Set(de("historico_facturas").map((e) => e.data.proyecto_id as string).filter((id) => !viejos.has(id)));
  console.log(`  Clientes que ya estaban (${conocidos.size}): ${[...conocidos].map((id) => proyectos.find((p) => p.id === id)?.nombre).join(", ")}`);
  const liq = de("equipo_liquidaciones");
  console.log(`  Equipo: ${liq.length} pagos · total ${ars(liq.reduce((a, e) => a + Number(e.data.total_pagado), 0))} · sin usuario: ${[...new Set(liq.filter((e) => String(e.data.uid).startsWith("planilla_")).map((e) => e.data.nombre))].join(", ")}`);
  console.log(`  Gastos: ${de("gastos").length} · total ${ars(de("gastos").reduce((a, e) => a + Number(e.data.monto), 0))}`);
  for (const [id, cuotas] of obligs) console.log(`  ${id}: ${cuotas.filter((c) => c.vence < "2026-01-01").length} cuotas de 2025 con monto real`);
  if (avisos.length) console.log("\nAvisos:\n" + [...new Set(avisos)].map((a) => `  - ${a}`).join("\n"));

  if (APLICAR) {
    for (const e of escrituras) await db.collection(e.col).doc(e.id).set(e.data, e.merge ? { merge: true } : undefined);
    console.log(`\nListo: ${escrituras.length} documentos.`);
  }
  process.exit(0);
})();
