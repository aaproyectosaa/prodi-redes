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

export interface ConsejosPauta {
  proyecto_id: string;
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

${bench ? `${benchmarksTexto(bench, p)}
Compará contra estos benchmarks cuando sirva para decir si un número es bueno o malo.` : ""}`;

  const r = await generarJSON<{ estado?: string; titular?: string; numeros?: any[]; resumen?: string; sugerencias?: any[] }>(
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
