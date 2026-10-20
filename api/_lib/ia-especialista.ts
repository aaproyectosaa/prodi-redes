/* eslint-disable @typescript-eslint/no-explicit-any */
// "Especialista Meta": el chat de quien maneja la pauta, por cliente. En cada mensaje lee la pauta de 90 días (por
// campaña y por anuncio), las alertas activas, los benchmarks de Prodi del mismo rubro y zona y los últimos consejos,
// y responde con diagnóstico, acción con números y riesgo. También arma el resumen para el cliente en criollo.
// Nunca toca nada en Meta: solo aconseja.

import { adminDb } from "./db";
import { HttpError } from "./http";
import { generarJSON } from "./ia";
import { marcaTexto } from "./marca";
import { comercialTexto, memoriaTexto, type MemoriaIA } from "./plan-mes";
import { hoyAR, sumarDias } from "./fecha";
import { resumenPauta } from "./ia-pauta";
import { benchmarksPauta, benchmarksTexto, labelRubro, labelZona, rubroPauta, zonaPauta } from "./pauta-benchmarks";
import { evaluarPauta, monedaFilas, reglasActivas, type FilaPautaRegla } from "./pauta-reglas";
import { segmentosPauta } from "./meta-segmentos";

const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Los anuncios de los últimos 30 días, del que más gastó al que menos. */
async function anunciosTexto(pid: string, hoy: string, moneda: string): Promise<string> {
  const snap = await adminDb().collection("meta_anuncios_diaria").where("proyecto_id", "==", pid).where("fecha", ">=", sumarDias(hoy, -29)).get();
  const ads = new Map<string, any>();
  for (const d of snap.docs) {
    const f = d.data();
    const a = ads.get(f.ad_id) ?? { nombre: f.ad_name ?? f.ad_id, campania: f.campaign_name ?? "", gasto: 0, imp: 0, clics: 0, res: 0, valor: 0 };
    a.gasto += Number(f.gasto || 0);
    a.imp += Number(f.impresiones || 0);
    a.clics += Number(f.clics || 0);
    a.res += Number(f.mensajes || 0) + Number(f.compras || 0) + Number(f.leads || 0);
    a.valor += Number(f.valor_compras || 0);
    ads.set(f.ad_id, a);
  }
  const lista = [...ads.values()].filter((a) => a.gasto > 0).sort((a, b) => b.gasto - a.gasto).slice(0, 12);
  if (!lista.length) return "Anuncios: todavía no hay datos por anuncio.";
  return `Anuncios de los últimos 30 días (de más a menos gasto, moneda ${moneda}):\n${lista
    .map((a) => `- "${a.nombre}" (campaña "${a.campania}"): gasto ${r2(a.gasto)}, resultados ${a.res}, costo por resultado ${a.res ? r2(a.gasto / a.res) : "sin resultados"}, CTR ${a.imp ? r2((a.clics / a.imp) * 100) : "—"}%${a.valor ? `, vendido ${r2(a.valor)}` : ""}`)
    .join("\n")}`;
}

export async function chatEspecialista(
  b: { proyecto_id?: string; mensajes?: { rol?: string; texto?: string }[] }
): Promise<{ respuesta: string; propuesta: Record<string, unknown> | null; recordado: null }> {
  const pid = t(b.proyecto_id, 200);
  if (!pid) throw new HttpError(400, "Falta el cliente");
  const mensajes = (b.mensajes ?? [])
    .map((m) => ({ rol: m.rol === "ia" ? "ia" : "yo", texto: t(m.texto, 2000) }))
    .filter((m) => m.texto)
    .slice(-14);
  if (!mensajes.length || mensajes[mensajes.length - 1].rol !== "yo") throw new HttpError(400, "Escribí qué querés preguntarle");

  const db = adminDb();
  const hoy = hoyAR();
  const [proj, mem, cfg, snap, consejos, bench] = await Promise.all([
    db.collection("projects").doc(pid).get(),
    db.collection("ia_memoria").doc(pid).get(),
    db.collection("app_settings").doc("redes").get(),
    db.collection("meta_pauta_diaria").where("proyecto_id", "==", pid).where("fecha", ">=", sumarDias(hoy, -89)).get(),
    db.collection("ia_pauta").doc(pid).get(),
    benchmarksPauta().catch(() => null),
  ]);
  const p = proj.data() ?? {};
  const filas = snap.docs.map((d) => d.data());
  const memoria = (mem.data() ?? null) as MemoriaIA | null;
  const moneda = monedaFilas(filas);
  const presupuesto = Number(p.pauta_cliente?.monto ?? p.plan_redes_override?.pauta?.monto ?? 0) || null;
  const alertas = evaluarPauta({
    filas: filas as FilaPautaRegla[],
    hoy,
    presupuesto,
    frecuencia: p.meta_sync?.frecuencia ?? [],
    reglas: reglasActivas(cfg.data()?.reglas_pauta),
  });
  const c = consejos.data();

  const prompt = `Sos el especialista en pauta de Meta de Prodi, agencia argentina con clientes en todo el país. Hablás en rioplatense, corto y concreto.
Siempre respondés con:
1. Diagnóstico: qué pasa y por qué (con los números de abajo).
2. Acción concreta con números: qué tocar, cuánto y cuándo (ej. "bajá el diario de la campaña X de $5.000 a $3.500 desde hoy").
3. Riesgo si no se hace.
Comparás contra los benchmarks de Prodi del mismo rubro y tipo de zona cuando los hay. Nunca inventás métricas: si falta un dato, lo pedís. No podés tocar nada en Meta: las campañas las crea y activa una persona (si sugerís crear una, que se cree en pausa).
Si es una pregunta simple, respondé simple (no fuerces los 3 puntos).

Formato de salida:
- "respuesta": tu respuesta (podés usar saltos de línea y viñetas cortas).
- "resumen_cliente": SOLO si te piden un resumen o un mensaje para el cliente: un texto en criollo, cálido y claro, sin jerga (nada de CTR ni CPM), con qué se hizo, qué resultados hubo y qué sigue. Si no lo piden, vacío.

Cliente: ${p.nombre ?? ""}. Rubro: ${labelRubro(rubroPauta(p))}. Zona de la pauta: ${labelZona(zonaPauta(p))}${p.meta?.ciudad_pauta ? ` (${p.meta.ciudad_pauta})` : ""}.
${presupuesto ? `Presupuesto mensual de pauta: ${presupuesto} ARS.` : "Sin presupuesto mensual cargado."} Moneda de la cuenta publicitaria: ${moneda}.

${marcaTexto(p)}

${comercialTexto(memoria?.comercial ?? null, [hoy, sumarDias(hoy, 30)], cfg.data()?.ia_enfoque ?? null)}

${memoriaTexto(memoria)}

${filas.length ? resumenPauta(filas, hoy) : "Todavía no hay pauta traída de Meta para este cliente."}

${await anunciosTexto(pid, hoy, moneda)}

${await segmentosTexto(pid, p, hoy, moneda)}

${p.meta_sync?.frecuencia?.length ? `Frecuencia últimos 7 días: ${p.meta_sync.frecuencia.map((x: any) => `"${x.nombre}" ${x.frecuencia}`).join(", ")}` : ""}

${alertas.length ? `Alertas activas hoy:\n${alertas.map((a) => `- ${a.titulo}: ${a.detalle}`).join("\n")}` : "Sin alertas activas hoy."}

${bench ? benchmarksTexto(bench, p) : ""}

${c?.resumen ? `Último análisis de la IA (${String(c.generado_at).slice(0, 10)}): ${c.resumen}` : ""}

Charla (lo último es lo que te preguntan ahora):
${mensajes.map((m) => `${m.rol === "yo" ? "Equipo" : "Vos"}: ${m.texto}`).join("\n")}`;

  const r = await generarJSON<{ respuesta?: string; resumen_cliente?: string }>(
    prompt,
    { type: "OBJECT", properties: { respuesta: { type: "STRING" }, resumen_cliente: { type: "STRING" } }, required: ["respuesta"] },
    0.4
  );
  const resumen = t(r.resumen_cliente, 2500);
  return { respuesta: t(r.respuesta, 4000) || "No tengo una respuesta, probá preguntarlo de otra forma.", propuesta: resumen ? { resumen_cliente: resumen } : null, recordado: null };
}

/** Públicos, ubicaciones, zonas, horarios y conjuntos de anuncios de los últimos 90 días (de Meta, en el momento). */
async function segmentosTexto(pid: string, p: Record<string, any>, hoy: string, moneda: string): Promise<string> {
  const cuenta = String(p.meta?.ad_account_id ?? "").trim().replace(/^act_/, "");
  if (!cuenta) return "";
  const r = await segmentosPauta(pid, cuenta, sumarDias(hoy, -89), hoy, moneda, false).catch(() => null);
  return r?.texto ? `${r.texto}
Usá estos datos para ser puntual: nombrá el público, la ubicación, la zona, el horario o el conjunto exacto.` : "";
}
