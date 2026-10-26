/* eslint-disable @typescript-eslint/no-explicit-any */
// Consejos de la IA para quien maneja la pauta: lee los últimos 90 días de la cuenta publicitaria del cliente
// (meta_pauta_diaria, por campaña y día) y dice qué mantener, qué mejorar y qué cortar. Se guarda en
// ia_pauta/{cliente} para no gastar IA cada vez que se abre: se rehace a pedido o si tiene más de 3 días.

import { adminDb } from "./db";
import { HttpError, type Caller } from "./http";
import { generarJSON } from "./ia";
import { marcaTexto } from "./marca";
import { comercialTexto, memoriaTexto, type MemoriaIA } from "./plan-mes";
import { hoyAR, sumarDias } from "./fecha";
import { benchmarksPauta, benchmarksTexto } from "./pauta-benchmarks";
import { segmentosPauta } from "./meta-segmentos";

export interface SugerenciaPauta {
  titulo: string;
  /** Qué hacer en Meta, en una línea. */
  accion?: string;
  /** Por qué, en una línea con el dato clave. */
  porque?: string;
  /** La explicación completa (se ve al desplegar). */
  detalle: string;
  /** A qué apunta: una campaña, un anuncio, un público, una ubicación… o algo general. */
  sobre?: { tipo: TipoSobre; nombre: string } | null;
  tipo: "mantener" | "mejorar" | "cortar" | "probar";
  prioridad: "alta" | "media" | "baja";
}

export type TipoSobre = "campaña" | "conjunto" | "anuncio" | "público" | "ubicación" | "zona" | "horario" | "presupuesto" | "general";
const TIPOS_SOBRE: TipoSobre[] = ["campaña", "conjunto", "anuncio", "público", "ubicación", "zona", "horario", "presupuesto", "general"];

/** Un número clave de la cuenta, para verlo de un vistazo. */
export interface NumeroPauta {
  etiqueta: string;
  valor: string;
  tendencia: "sube" | "baja" | "igual";
  bueno: boolean;
}

/** Antes y después de aplicar un consejo: los 14 días previos contra los días desde que se aplicó. */
export interface EfectoConsejo {
  /** Sobre qué se midió: la campaña del consejo o toda la cuenta. */
  medido: string;
  dias_despues: number;
  antes: { gasto: number; resultados: number; costo: number | null };
  despues: { gasto: number; resultados: number; costo: number | null };
}

/** Un consejo que el equipo marcó como hecho (queda en el historial aunque la IA vuelva a analizar). */
export interface ConsejoAplicado {
  titulo: string;
  accion: string;
  tipo: SugerenciaPauta["tipo"];
  sobre: SugerenciaPauta["sobre"];
  at: string;
  por?: string | null;
  por_nombre: string;
  efecto?: EfectoConsejo | null;
  /** Lo que concluyó la IA: si funcionó, si no, o si todavía es pronto. */
  veredicto?: "funciono" | "no_funciono" | "pronto" | null;
  conclusion?: string | null;
}

export interface ConsejosPauta {
  proyecto_id: string;
  /** Lo que ya se aplicó (con el antes y el después), del más nuevo al más viejo. */
  aplicados?: ConsejoAplicado[];
  /** Los "Hecho" de las sugerencias actuales, por índice (lo escribe /api/ia/pauta-hecho). */
  hechos?: Record<string, { uid: string; nombre: string; at: string } | null>;
  /** Semáforo de cómo viene la cuenta. */
  estado?: "bien" | "regular" | "mal";
  /** Cómo viene la cuenta en una frase corta. */
  titular?: string;
  numeros?: NumeroPauta[];
  resumen: string;
  sugerencias: SugerenciaPauta[];
  /** En qué se basó el análisis. */
  base?: { campanias: number; conjuntos: number; anuncios: number; gasto: number; moneda: string; leido: string[] };
  desde: string;
  hasta: string;
  generado_at: string;
  generado_por: string;
}

const VIGENCIA = 3 * 86_400_000;

/** Antes y después de un consejo aplicado, con la pauta diaria. Si apunta a una campaña, se mide esa; si no, toda la cuenta. */
function efectoDe(filas: any[], at: string, sobre: SugerenciaPauta["sobre"], hoy: string): EfectoConsejo {
  const dia = at.slice(0, 10);
  const nombre = sobre?.tipo === "campaña" ? sobre.nombre.trim().toLowerCase() : "";
  const deCampania = nombre ? filas.filter((f) => String(f.campaign_name ?? "").toLowerCase().includes(nombre)) : [];
  const usar = deCampania.length ? deCampania : filas;
  const res = (f: any) => Number(f.mensajes || 0) + Number(f.compras || 0) + Number(f.leads || 0);
  const tramo = (desde: string, hasta: string) => {
    const t = usar.filter((f) => f.fecha >= desde && f.fecha <= hasta);
    const gasto = t.reduce((a, f) => a + Number(f.gasto || 0), 0);
    const resultados = t.reduce((a, f) => a + res(f), 0);
    return { gasto: r2(gasto), resultados, costo: resultados ? r2(gasto / resultados) : null };
  };
  const finDespues = [sumarDias(dia, 13), hoy].sort()[0];
  return {
    medido: deCampania.length ? `la campaña "${sobre!.nombre}"` : "toda la cuenta",
    dias_despues: Math.max(0, Math.round((Date.parse(hoy) - Date.parse(dia)) / 86_400_000) + 1),
    antes: tramo(sumarDias(dia, -14), sumarDias(dia, -1)),
    despues: tramo(dia, finDespues),
  };
}

const textoEfecto = (e: EfectoConsejo, moneda: string) => {
  const c = (x: { gasto: number; resultados: number; costo: number | null }) =>
    `${x.resultados} resultados con ${x.gasto} ${moneda}${x.costo != null ? ` (${x.costo} ${moneda} c/u)` : ""}`;
  return `medido en ${e.medido}: 14 días antes ${c(e.antes)} · después (${e.dias_despues} días) ${c(e.despues)}`;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** La pauta de 90 días resumida para la IA: por campaña, por mes y las últimas semanas. */
export function resumenPauta(filas: any[], hoy: string): string {
  const res = (f: any) => Number(f.mensajes || 0) + Number(f.compras || 0) + Number(f.leads || 0);
  const moneda = filas.find((f) => f.moneda)?.moneda ?? "ARS";
  const camp = new Map<string, any>();
  for (const f of filas) {
    const c = camp.get(f.campaign_id) ?? { nombre: f.campaign_name, objetivo: f.objetivo, desde: f.fecha, hasta: f.fecha, gasto: 0, impresiones: 0, clics: 0, mensajes: 0, compras: 0, valor: 0, leads: 0, thruplays: 0 };
    c.gasto += Number(f.gasto || 0);
    c.impresiones += Number(f.impresiones || 0);
    c.clics += Number(f.clics || 0);
    c.mensajes += Number(f.mensajes || 0);
    c.compras += Number(f.compras || 0);
    c.valor += Number(f.valor_compras || 0);
    c.leads += Number(f.leads || 0);
    c.thruplays += Number(f.thruplays || 0);
    if (f.fecha < c.desde) c.desde = f.fecha;
    if (f.fecha > c.hasta) c.hasta = f.fecha;
    camp.set(f.campaign_id, c);
  }
  const lineaCamp = [...camp.values()]
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, 15)
    .map((c) => {
      const resultados = c.mensajes + c.compras + c.leads;
      const ctr = c.impresiones ? r2((c.clics / c.impresiones) * 100) : null;
      const cpm = c.impresiones ? r2((c.gasto / c.impresiones) * 1000) : null;
      return `- "${c.nombre}" (${c.objetivo ?? "sin objetivo"}, ${c.desde} a ${c.hasta}${c.hasta >= sumarDias(hoy, -1) ? ", ACTIVA" : ""}): gasto ${r2(c.gasto)} ${moneda}, ${c.impresiones} impresiones, CTR ${ctr ?? "—"}%, CPM ${cpm ?? "—"}, mensajes ${c.mensajes}, compras ${c.compras}${c.valor ? ` (vendido ${r2(c.valor)})` : ""}, leads ${c.leads}, costo por resultado ${resultados ? r2(c.gasto / resultados) : "sin resultados"}`;
    })
    .join("\n");
  // Por bloques de 30 días (del más viejo al más nuevo) y las últimas 6 semanas.
  const bloque = (desde: string, hasta: string, nombre: string) => {
    const a = filas.filter((f) => f.fecha >= desde && f.fecha <= hasta);
    const g = a.reduce((s, f) => s + Number(f.gasto || 0), 0);
    const r = a.reduce((s, f) => s + res(f), 0);
    const imp = a.reduce((s, f) => s + Number(f.impresiones || 0), 0);
    const cl = a.reduce((s, f) => s + Number(f.clics || 0), 0);
    return `- ${nombre} (${desde} a ${hasta}): gasto ${r2(g)}, resultados ${r}, costo por resultado ${r ? r2(g / r) : "—"}, CTR ${imp ? r2((cl / imp) * 100) : "—"}%`;
  };
  const meses = [2, 1, 0].map((k) => bloque(sumarDias(hoy, -(k + 1) * 30 + 1), sumarDias(hoy, -k * 30), k === 0 ? "últimos 30 días" : `hace ${k * 30}-${(k + 1) * 30} días`));
  const semanas = [5, 4, 3, 2, 1, 0].map((k) => bloque(sumarDias(hoy, -(k + 1) * 7 + 1), sumarDias(hoy, -k * 7), k === 0 ? "esta semana" : `hace ${k} semana${k === 1 ? "" : "s"}`));
  return `Moneda de la cuenta: ${moneda}\n\nCampañas (90 días, de más a menos gasto):\n${lineaCamp || "(sin campañas)"}\n\nPor tramos de 30 días:\n${meses.join("\n")}\n\nÚltimas 6 semanas:\n${semanas.join("\n")}`;
}

export async function consejosPauta(caller: Caller, pid: string, rehacer: boolean): Promise<ConsejosPauta> {
  const db = adminDb();
  const ref = db.collection("ia_pauta").doc(pid);
  const previo = (await ref.get()).data() as ConsejosPauta | undefined;
  if (previo && !rehacer && Date.now() - new Date(previo.generado_at).getTime() < VIGENCIA) return previo;

  const hoy = hoyAR();
  const desde = sumarDias(hoy, -89);
  const [proj, mem, cfg, snap] = await Promise.all([
    db.collection("projects").doc(pid).get(),
    db.collection("ia_memoria").doc(pid).get(),
    db.collection("app_settings").doc("redes").get(),
    db.collection("meta_pauta_diaria").where("proyecto_id", "==", pid).where("fecha", ">=", desde).get(),
  ]);
  const p = proj.data() ?? {};
  const filas = snap.docs.map((d) => d.data());
  // Lo que el equipo ya aplicó: los "Hecho" del análisis anterior pasan al historial (con su antes y después).
  const nuevosAplicados: ConsejoAplicado[] = (previo?.sugerencias ?? []).flatMap((s, i) => {
    const h = previo?.hechos?.[String(i)];
    return h?.at ? [{ titulo: s.titulo, accion: s.accion ?? s.titulo, tipo: s.tipo, sobre: s.sobre ?? null, at: h.at, por: h.uid ?? null, por_nombre: h.nombre ?? "" }] : [];
  });
  const aplicados: ConsejoAplicado[] = [...nuevosAplicados, ...(previo?.aplicados ?? [])]
    .filter((a, i, arr) => a.at >= sumarDias(hoy, -120) && arr.findIndex((x) => x.accion === a.accion && x.at === a.at) === i)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 15)
    .map((a) => ({ ...a, efecto: efectoDe(filas, a.at, a.sobre, hoy) }));
  if (!filas.length) throw new HttpError(409, "Todavía no hay pauta de este cliente traída de Meta (cargá su cuenta publicitaria).");
  const memoria = (mem.data() ?? null) as MemoriaIA | null;
  const tope = Number(p.pauta_cliente?.monto ?? p.plan_redes_override?.pauta?.monto ?? 0) || null;
  const frecuencia = (p.meta_sync?.frecuencia ?? []) as { nombre: string; frecuencia: number }[];
  const bench = await benchmarksPauta().catch(() => null);
  // Públicos, ubicaciones, zonas, horarios, conjuntos y anuncios (se leen de Meta en el momento).
  const moneda = String(filas.find((f) => f.moneda)?.moneda ?? "ARS");
  const cuenta = String(p.meta?.ad_account_id ?? "").trim().replace(/^act_/, "");
  const seg = cuenta
    ? await segmentosPauta(pid, cuenta, desde, hoy, moneda).catch((err) => {
        console.warn("[ia-pauta] segmentos", pid, err instanceof Error ? err.message : err);
        return null;
      })
    : null;

  const prompt = `Sos un media buyer senior de Meta Ads (Instagram y Facebook) en una agencia argentina que trabaja con negocios chicos y medianos. Prodi busca resultados comerciales: mensajes por WhatsApp, ventas y contactos.
Analizá la pauta de los últimos 90 días de este cliente y decile a la persona que maneja la pauta qué hacer para MANTENER lo que funciona y MEJORAR lo que no.

Reglas:
- Basate en los números de abajo; citá los datos concretos (costo por resultado, CTR, frecuencia, tendencia semanal) cuando justifiques.
- Sugerencias accionables en Meta Ads Manager: presupuesto (subir/bajar/redistribuir), apagar o escalar campañas, renovar creatividades si cansan, probar públicos, objetivos, ubicaciones, horarios, copy, formato de video, pruebas A/B.
- Si algo funciona bien, decilo como "mantener" (no todo tiene que cambiar).
- Si faltan datos para concluir algo, decilo.
- Usá los datos de público (edad y género), ubicaciones, zonas, horarios, conjuntos de anuncios (a quién apunta cada uno) y anuncios para que los consejos sean PUNTUALES: nombrá el segmento, conjunto o anuncio exacto (ej. "sacá Facebook columna derecha: gastó 18% sin resultados", "concentrá el presupuesto en mujeres de 35 a 54, que traen mensajes a la mitad de costo", "duplicá el anuncio 'Promo julio' en el conjunto nuevo"). Solo recomendá cosas generales si no hay datos para ser concreto, y aclaralo.
- Español rioplatense con voseo, directo, sin vueltas. Nada de jerga innecesaria.
- Escribí para alguien que tiene 10 segundos: primero lo corto y claro, el detalle después.
- "estado": bien, regular o mal (cómo viene la cuenta en general).
- "titular": cómo viene la cuenta en UNA frase de máximo 12 palabras, sin siglas (ej. "Los mensajes salen cada vez más caros desde septiembre").
- "numeros": de 3 a 4 números clave para mirar de un vistazo (ej. costo por mensaje, mensajes del mes, inversión del mes, ventas). etiqueta corta (máx. 4 palabras), valor con su unidad ("4,65 USD", "102", "0 ventas"), tendencia contra el período anterior (sube, baja o igual) y bueno: si ese movimiento es bueno para el negocio.
- "resumen": 2 a 3 frases con cómo viene la cuenta (el detalle, con los números).
- "sugerencias": de 3 a 6, de la más importante a la menos. tipo: mantener, mejorar, cortar o probar. prioridad: alta, media o baja.
  - titulo: máximo 8 palabras.
  - accion: qué hacer concretamente en Meta, en UNA oración imperativa de máximo 18 palabras (ej. "Apagá 'Interacciones Octubre' y creá una campaña de mensajes a WhatsApp").
  - porque: el motivo en UNA oración corta con el dato clave (ej. "Cada mensaje cuesta 5,68 USD, el doble que en julio").
  - detalle: la explicación completa con los números, para quien quiera profundizar.
  - sobre: a qué apunta el consejo. tipo: campaña, conjunto, anuncio, público, ubicación, zona, horario, presupuesto o general. nombre: el nombre exacto (de la campaña, conjunto o anuncio) o el segmento (ej. "mujeres 35-44", "Instagram reels", "Córdoba", "20 a 23 h"); vacío si es general.

${marcaTexto(p)}

${comercialTexto(memoria?.comercial ?? null, [hoy, sumarDias(hoy, 30)], cfg.data()?.ia_enfoque ?? null)}

${memoriaTexto(memoria)}

${tope ? `Presupuesto mensual de pauta acordado con el cliente: ${tope} ARS.` : "No tiene un presupuesto mensual cargado."}
${frecuencia.length ? `Frecuencia de los últimos 7 días por campaña: ${frecuencia.map((x) => `"${x.nombre}" ${x.frecuencia}`).join(", ")}` : ""}

${resumenPauta(filas, hoy)}

${seg?.texto || "(No se pudieron leer los públicos, ubicaciones ni anuncios de esta cuenta.)"}
${
  aplicados.length
    ? `
Consejos que el equipo YA APLICÓ (no los repitas tal cual). Para cada uno está el antes y el después:
${aplicados.map((a, i) => `${i + 1}. [${a.at.slice(0, 10)}, ${a.por_nombre || "el equipo"}] "${a.accion}" → ${textoEfecto(a.efecto!, moneda)}`).join("\n")}
- En "aplicados" evaluá cada uno (por su número): funciono, no_funciono o pronto (si pasaron menos de 5 días o hay muy pocos datos), con una conclusión de una oración con el dato (ej. "Desde que se apagó, el mensaje bajó de 5,6 a 3,9 USD").
- Si uno funcionó, construí sobre eso; si no funcionó, proponé otra cosa (no lo mismo).
- Mencioná en el resumen lo más importante de lo aplicado.`
    : ""
}

${bench ? `${benchmarksTexto(bench, p)}
Compará contra estos benchmarks cuando sirva para decir si un número es bueno o malo.` : ""}`;

  const r = await generarJSON<{ estado?: string; titular?: string; numeros?: any[]; resumen?: string; sugerencias?: any[]; aplicados?: { numero?: number; veredicto?: string; conclusion?: string }[] }>(
    prompt,
    {
      type: "OBJECT",
      properties: {
        estado: { type: "STRING", enum: ["bien", "regular", "mal"] },
        titular: { type: "STRING" },
        numeros: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              etiqueta: { type: "STRING" },
              valor: { type: "STRING" },
              tendencia: { type: "STRING", enum: ["sube", "baja", "igual"] },
              bueno: { type: "BOOLEAN" },
            },
            required: ["etiqueta", "valor", "tendencia", "bueno"],
          },
        },
        resumen: { type: "STRING" },
        aplicados: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              numero: { type: "INTEGER" },
              veredicto: { type: "STRING", enum: ["funciono", "no_funciono", "pronto"] },
              conclusion: { type: "STRING" },
            },
            required: ["numero", "veredicto", "conclusion"],
          },
        },
        sugerencias: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              titulo: { type: "STRING" },
              accion: { type: "STRING" },
              porque: { type: "STRING" },
              detalle: { type: "STRING" },
              sobre: {
                type: "OBJECT",
                properties: { tipo: { type: "STRING", enum: TIPOS_SOBRE }, nombre: { type: "STRING" } },
                required: ["tipo", "nombre"],
              },
              tipo: { type: "STRING", enum: ["mantener", "mejorar", "cortar", "probar"] },
              prioridad: { type: "STRING", enum: ["alta", "media", "baja"] },
            },
            required: ["titulo", "accion", "porque", "detalle", "sobre", "tipo", "prioridad"],
          },
        },
      },
      required: ["estado", "titular", "numeros", "resumen", "sugerencias"],
    },
    0.4
  );
  const tipos = ["mantener", "mejorar", "cortar", "probar"];
  const prioridades = ["alta", "media", "baja"];
  const estados = ["bien", "regular", "mal"];
  const out: ConsejosPauta = {
    proyecto_id: pid,
    estado: (estados.includes(String(r.estado)) ? r.estado : "regular") as ConsejosPauta["estado"],
    titular: String(r.titular ?? "").trim().slice(0, 140),
    numeros: (r.numeros ?? [])
      .map((n) => ({
        etiqueta: String(n?.etiqueta ?? "").trim().slice(0, 40),
        valor: String(n?.valor ?? "").trim().slice(0, 30),
        tendencia: (["sube", "baja", "igual"].includes(n?.tendencia) ? n.tendencia : "igual") as NumeroPauta["tendencia"],
        bueno: !!n?.bueno,
      }))
      .filter((n) => n.etiqueta && n.valor)
      .slice(0, 4),
    resumen: String(r.resumen ?? "").trim().slice(0, 800),
    // El historial de lo aplicado, con lo que concluyó la IA de cada uno.
    aplicados: aplicados.map((a, i) => {
      const v = (r.aplicados ?? []).find((x) => Number(x?.numero) === i + 1);
      const veredicto = ["funciono", "no_funciono", "pronto"].includes(String(v?.veredicto)) ? (v!.veredicto as ConsejoAplicado["veredicto"]) : null;
      return { ...a, veredicto, conclusion: v?.conclusion ? String(v.conclusion).trim().slice(0, 240) : null };
    }),
    hechos: {},
    sugerencias: (r.sugerencias ?? [])
      .map((s) => ({
        titulo: String(s?.titulo ?? "").trim().slice(0, 120),
        accion: String(s?.accion ?? "").trim().slice(0, 220),
        porque: String(s?.porque ?? "").trim().slice(0, 220),
        detalle: String(s?.detalle ?? "").trim().slice(0, 800),
        sobre: TIPOS_SOBRE.includes(s?.sobre?.tipo)
          ? { tipo: s.sobre.tipo as TipoSobre, nombre: String(s.sobre.nombre ?? "").trim().slice(0, 120) }
          : null,
        tipo: (tipos.includes(s?.tipo) ? s.tipo : "mejorar") as SugerenciaPauta["tipo"],
        prioridad: (prioridades.includes(s?.prioridad) ? s.prioridad : "media") as SugerenciaPauta["prioridad"],
      }))
      .filter((s) => s.titulo)
      .slice(0, 8),
    base: {
      campanias: new Set(filas.map((f) => f.campaign_id)).size,
      conjuntos: seg?.conjuntos ?? 0,
      anuncios: seg?.anuncios ?? 0,
      gasto: Math.round(filas.reduce((a, f) => a + Number(f.gasto || 0), 0) * 100) / 100,
      moneda,
      leido: seg?.leido ?? [],
    },
    desde,
    hasta: hoy,
    generado_at: new Date().toISOString(),
    generado_por: caller.uid,
  };
  if (!out.sugerencias.length) throw new HttpError(502, "La IA no devolvió sugerencias. Probá de nuevo.");
  await ref.set(out);
  return out;
}

export interface ComoSeHace {
  /** Pasos en el Administrador de anuncios, en orden. */
  pasos: string[];
  /** Algo a tener en cuenta (opcional). */
  ojo?: string | null;
  generado_at: string;
}

/**
 * "Cómo se hace": la IA explica paso a paso, en el Administrador de anuncios de Meta, cómo aplicar un consejo.
 * Queda guardado con el análisis (ia_pauta/{cliente}.como.{n}) para no gastar IA cada vez.
 */
export async function comoSeHaceConsejo(pid: string, indice: number): Promise<ComoSeHace> {
  const db = adminDb();
  const ref = db.collection("ia_pauta").doc(pid);
  const d = (await ref.get()).data() as (ConsejosPauta & { como?: Record<string, ComoSeHace & { de?: string }> }) | undefined;
  const s = d?.sugerencias?.[indice];
  if (!d || !s) throw new HttpError(404, "Ese consejo ya no está: analizá de nuevo.");
  const guardado = d.como?.[String(indice)];
  if (guardado && guardado.de === d.generado_at) return guardado;

  const prompt = `Sos especialista en Meta Ads y le explicás a alguien del equipo de una agencia cómo aplicar un consejo en el Administrador de anuncios de Meta (Ads Manager, versión web en español, 2026).

El consejo:
- Qué hacer: ${s.accion || s.titulo}
- Por qué: ${s.porque ?? ""}
- Detalle: ${s.detalle}
${s.sobre?.nombre ? `- Sobre: ${s.sobre.tipo} "${s.sobre.nombre}"` : ""}

Devolvé los pasos en orden, concretos (qué pestaña, qué botón, qué campo y qué poner), usando los nombres reales de las campañas, conjuntos o anuncios que aparecen en el consejo. Entre 3 y 9 pasos, cada uno en una o dos frases cortas, en español rioplatense (voseo). Si hay algo importante a tener en cuenta (ej. que el cambio reinicia el aprendizaje, o que hay que duplicar el conjunto), ponelo en "ojo" en una frase; si no, dejalo vacío.`;

  const r = await generarJSON<{ pasos?: string[]; ojo?: string }>(
    prompt,
    {
      type: "OBJECT",
      properties: {
        pasos: { type: "ARRAY", items: { type: "STRING" } },
        ojo: { type: "STRING", nullable: true },
      },
      required: ["pasos"],
    },
    0.3
  );
  const pasos = (r.pasos ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
  if (!pasos.length) throw new HttpError(502, "La IA no devolvió los pasos. Probá de nuevo.");
  const como: ComoSeHace = { pasos, ojo: r.ojo?.trim() || null, generado_at: new Date().toISOString() };
  await ref.update({ [`como.${indice}`]: { ...como, de: d.generado_at } }).catch((e) => console.warn("[ia-pauta] guardar cómo", pid, e));
  return como;
}
