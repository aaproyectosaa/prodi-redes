// Asistente del dueño (solo el super admin): una conversación con Claude que ve TODO el sistema, también la plata.
// POST /api/ia/dueno { mensajes: [{ role: "user"|"assistant", content }] } → { texto }
// La conversación la guarda el navegador; acá se arma el contexto en cada pregunta.

import { adminDb, type Data } from "./db";
import { HttpError } from "./http";
import { conversarClaude } from "./ia";
import { contextoSistema } from "./chat-contexto";
import { fechaAR } from "./fecha";

const $ = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const mesMenos = (mes: string, n: number) => {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
};

export async function contextoDueno(pregunta: string): Promise<string> {
  const db = adminDb();
  const hoy = fechaAR();
  const mes = hoy.slice(0, 7);
  const desde = mesMenos(mes, 12);
  const [sis, fSnap, gSnap, lSnap, oSnap, dSnap, hSnap, hfSnap, pSnap, perfSnap, vSnap] = await Promise.all([
    contextoSistema({ finanzas: true, texto: pregunta, proyectoChat: null }),
    db.collection("facturas").where("mes", ">=", desde).get(),
    db.collection("gastos").where("mes", ">=", desde).get(),
    db.collection("equipo_liquidaciones").where("mes", ">=", mesMenos(mes, 6)).get(),
    db.collection("obligaciones").get(),
    db.collection("deudas_clientes").get(),
    db.collection("historico_mensual").get(),
    db.collection("historico_facturas").get(),
    db.collection("projects").get(),
    db.collection("profiles").get(),
    db.collection("videos").where("mes", ">=", mesMenos(mes, 3)).get(),
  ]);
  const proyectos = new Map(pSnap.docs.map((d) => [d.id, d.data() ?? {}]));
  const nombreP = (id: unknown) => String(proyectos.get(String(id))?.nombre ?? id);
  const perfiles = new Map(perfSnap.docs.map((d) => [d.id, d.data() ?? {}]));
  const nombreU = (id: unknown) => String(perfiles.get(String(id))?.nombre ?? id);

  // Facturado por mes: lo del sistema y, antes, lo de las planillas.
  const facturas = fSnap.docs.map((d) => d.data() ?? {}).filter((f) => f.estado !== "anulada");
  const porMes = new Map<string, { neto: number; cobrado: number; pendiente: number }>();
  for (const f of facturas) {
    const x = porMes.get(String(f.mes)) ?? { neto: 0, cobrado: 0, pendiente: 0 };
    x.neto += Number(f.neto) || 0;
    if (f.estado === "cobrada") x.cobrado += Number(f.bruto) || 0;
    else x.pendiente += Number(f.bruto) || 0;
    porMes.set(String(f.mes), x);
  }
  const historico = hSnap.docs.map((d) => [d.id, d.data() ?? {}] as const).sort(([a], [b]) => a.localeCompare(b));
  const facturadoLineas = [
    ...historico.filter(([m]) => !porMes.has(m)).map(([m, h]) => `- ${m}: ${$(h.ingresos)} neto (planilla)`),
    ...[...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, x]) => `- ${m}: ${$(x.neto)} neto · cobrado ${$(x.cobrado)} · falta cobrar ${$(x.pendiente)}`),
  ];

  const pendientes = facturas
    .filter((f) => f.estado === "pendiente")
    .map((f) => `- ${f.cliente ?? nombreP(f.proyecto_id)} · ${f.mes} · ${$(f.bruto)} · vence ${f.vencimiento}${String(f.vencimiento) < hoy ? " (VENCIDA)" : ""}`);

  // Por cliente: lo facturado en el sistema y en las planillas, por año.
  const porCliente = new Map<string, Record<string, number>>();
  const sumar = (cli: string, anio: string, n: number) => {
    const r = porCliente.get(cli) ?? {};
    r[anio] = (r[anio] ?? 0) + n;
    porCliente.set(cli, r);
  };
  for (const d of hfSnap.docs) {
    const f = d.data() ?? {};
    sumar(nombreP(f.proyecto_id), String(f.mes).slice(0, 4), Number(f.cobrado || f.bruto || f.neto) || 0);
  }
  for (const f of facturas) sumar(String(f.cliente ?? nombreP(f.proyecto_id)), String(f.mes).slice(0, 4), Number(f.bruto) || 0);
  const clientesLineas = [...porCliente.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, r]) => {
      const p = [...proyectos.values()].find((x) => x.nombre === c);
      const estado = p?.cliente_viejo ? " (ya no es cliente)" : p && p.enabled === false ? " (inactivo)" : "";
      return `- ${c}${estado}: ${Object.entries(r).sort().map(([a, n]) => `${a} ${$(n)}`).join(" · ")}`;
    });

  const gastos = gSnap.docs.map((d) => d.data() ?? {});
  const gastoMes = new Map<string, Record<string, number>>();
  for (const g of gastos) {
    const r = gastoMes.get(String(g.mes)) ?? {};
    r[String(g.categoria ?? "Otros")] = (r[String(g.categoria ?? "Otros")] ?? 0) + (Number(g.monto) || 0);
    gastoMes.set(String(g.mes), r);
  }
  const gastosLineas = [...gastoMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, r]) => `- ${m}: total ${$(Object.values(r).reduce((a, b) => a + b, 0))} (${Object.entries(r).map(([c, n]) => `${c} ${$(n)}`).join(", ")})`);

  const equipo = lSnap.docs
    .map((d) => d.data() ?? {})
    .sort((a, b) => String(a.mes).localeCompare(String(b.mes)))
    .map((l) => {
      const ajustes = (Array.isArray(l.ajustes) ? l.ajustes : []) as Data[];
      const total = l.total_pagado ?? ajustes.reduce((a, x) => a + (Number(x.monto) || 0), 0);
      return `- ${l.mes} · ${l.nombre ?? nombreU(l.uid)} · ${$(total)} · ${l.estado}${l.detalle ? ` · ${String(l.detalle).slice(0, 80)}` : ""}`;
    });

  const obligaciones = oSnap.docs
    .map((d) => d.data() ?? {})
    .filter((o) => o.activa !== false)
    .map((o) => {
      const cuotas = (Array.isArray(o.cuotas) ? o.cuotas : []) as Data[];
      const faltan = cuotas.filter((c) => !c.pagada);
      const prox = faltan.sort((a, b) => String(a.vence).localeCompare(String(b.vence)))[0];
      return `- ${o.nombre} (${o.tipo}${o.entidad ? `, ${o.entidad}` : ""}): faltan ${faltan.length} de ${cuotas.length} · ${$(faltan.reduce((a, c) => a + (Number(c.monto) || 0), 0))}${prox ? ` · próxima ${prox.vence} ${$(prox.monto)}` : ""}`;
    });

  const deudas = dSnap.docs
    .map((d) => d.data() ?? {})
    .map((d) => {
      const cuotas = (Array.isArray(d.cuotas) ? d.cuotas : []) as Data[];
      const falta = cuotas.filter((c) => !c.pagada).reduce((a, c) => a + (Number(c.monto) || 0), 0);
      return `- ${d.cliente}: ${d.incobrable ? "INCOBRABLE " : ""}falta ${$(falta)}${d.detalle ? ` · ${d.detalle}` : ""}`;
    });

  // Producción de los últimos meses por persona (para preguntas sobre el equipo).
  const hechos = new Map<string, Record<string, number>>();
  for (const d of vSnap.docs) {
    const v = d.data() ?? {};
    for (const [rol, campo] of [["filmó/produjo", "productor_id"], ["editó", "editor_id"]] as const) {
      if (!v[campo]) continue;
      const r = hechos.get(nombreU(v[campo])) ?? {};
      r[rol] = (r[rol] ?? 0) + 1;
      hechos.set(nombreU(v[campo]), r);
    }
  }
  const equipoActivo = perfSnap.docs
    .map((d) => d.data() ?? {})
    .filter((p) => p.activo !== false && !["cliente", "contacto"].includes(String(p.role)) && p.nombre)
    .map((p) => `- ${p.nombre} · ${p.role}${hechos.get(String(p.nombre)) ? ` · últimos 3 meses: ${Object.entries(hechos.get(String(p.nombre))!).map(([r, n]) => `${r} ${n} videos`).join(", ")}` : ""}`);

  return `${sis.texto}

EQUIPO:
${equipoActivo.join("\n")}

FACTURADO POR MES:
${facturadoLineas.join("\n") || "- sin datos"}

BOLETAS SIN COBRAR:
${pendientes.join("\n") || "- ninguna"}

FACTURADO POR CLIENTE Y AÑO (sistema + planillas 2024-2026):
${clientesLineas.join("\n") || "- sin datos"}

GASTOS POR MES (último año):
${gastosLineas.join("\n") || "- sin datos"}

PAGOS AL EQUIPO (últimos 6 meses):
${equipo.join("\n") || "- sin datos"}

CRÉDITOS, PLANES E IMPUESTOS ACTIVOS:
${obligaciones.join("\n") || "- ninguno"}

LO QUE DEBEN LOS CLIENTES:
${deudas.join("\n") || "- nada"}`;
}

export async function asistenteDueno(mensajes: unknown): Promise<{ texto: string }> {
  if (!Array.isArray(mensajes) || !mensajes.length) throw new HttpError(400, "Falta la pregunta");
  const limpios = mensajes
    .slice(-20)
    .map((m: Data) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: String(m.content ?? "").slice(0, 6000) }))
    .filter((m) => m.content.trim());
  if (!limpios.length || limpios[limpios.length - 1].role !== "user") throw new HttpError(400, "Falta la pregunta");
  const contexto = await contextoDueno(limpios[limpios.length - 1].content);
  const system = `Sos el asistente personal de Lucas, dueño de Prodi (agencia de redes, videos y pauta en Reconquista, Santa Fe, Argentina). Solo él te usa.
Hoy es ${fechaAR()}. Tenés todos los datos del sistema, también la plata. Respondé como un socio que conoce el negocio: directo, con números concretos cuando sirven, y dando tu opinión y recomendaciones cuando te las pida (rentabilidad por cliente, qué cliente conviene subir de precio, carga del equipo, flujo de caja, riesgos, etc.).
Si un dato no está en lo que tenés, decilo; no inventes. Las planillas de antes (2024-2025) pueden tener huecos: aclaralo cuando importe.
Español rioplatense con voseo. Usá listas cortas y negritas con ** cuando ayuden; nada de tablas largas.

${contexto}`;
  const texto = await conversarClaude(system, limpios);
  return { texto: texto || "No tengo una respuesta para eso." };
}
