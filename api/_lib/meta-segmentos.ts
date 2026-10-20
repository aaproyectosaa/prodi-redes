/* eslint-disable @typescript-eslint/no-explicit-any */
// Lo que la IA de pauta necesita además de las campañas: a quién le llegan los anuncios y dónde rinden.
// Se lee de Meta en el momento del análisis (no se guarda), para los mismos 90 días:
//   · público: edad y género · ubicaciones: Instagram/Facebook, feed/historias/reels · zonas · horarios
//   · conjuntos de anuncios: a quién apuntan (edad, zonas, intereses, públicos guardados) y cuánto rinden
//   · anuncios: los que más y menos rinden (de meta_anuncios_diaria, que ya se guarda en la sync diaria)
// Cada parte por separado: si Meta no da una, las otras igual sirven.

import { adminDb } from "./db";
import { accion, graphTodo } from "./meta-cuenta";

const MENSAJES = ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"];
const COMPRAS = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
const LEADS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Fila {
  nombre: string;
  gasto: number;
  impresiones: number;
  clics: number;
  resultados: number;
}

const resultadosDe = (d: any) => accion(d.actions, ...MENSAJES) + accion(d.actions, ...COMPRAS) + accion(d.actions, ...LEADS);

function aFila(d: any, nombre: string): Fila {
  return {
    nombre,
    gasto: Number(d.spend || 0),
    impresiones: Number(d.impressions || 0),
    clics: Number(d.inline_link_clicks ?? d.clicks ?? 0),
    resultados: resultadosDe(d),
  };
}

/** Junta filas con el mismo nombre (ej. la misma edad en varios géneros si hace falta). */
function juntar(filas: Fila[]): Fila[] {
  const m = new Map<string, Fila>();
  for (const f of filas) {
    const a = m.get(f.nombre) ?? { nombre: f.nombre, gasto: 0, impresiones: 0, clics: 0, resultados: 0 };
    a.gasto += f.gasto;
    a.impresiones += f.impresiones;
    a.clics += f.clics;
    a.resultados += f.resultados;
    m.set(f.nombre, a);
  }
  return [...m.values()];
}

/** Una línea por segmento: % del gasto, resultados y costo por resultado (los que más gastaron primero). */
function lineas(filas: Fila[], moneda: string, max = 10): string {
  const total = filas.reduce((s, f) => s + f.gasto, 0) || 1;
  return filas
    .filter((f) => f.gasto > 0)
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, max)
    .map(
      (f) =>
        `- ${f.nombre}: ${Math.round((f.gasto / total) * 100)}% del gasto (${r2(f.gasto)} ${moneda}), ${f.resultados} resultados, costo por resultado ${
          f.resultados ? `${r2(f.gasto / f.resultados)} ${moneda}` : "sin resultados"
        }, CTR ${f.impresiones ? r2((f.clics / f.impresiones) * 100) : "—"}%`
    )
    .join("\n");
}

const GENERO: Record<string, string> = { female: "mujeres", male: "hombres", unknown: "sin dato" };
const UBICACION: Record<string, string> = {
  feed: "feed",
  story: "historias",
  instagram_stories: "historias",
  facebook_stories: "historias",
  instagram_reels: "reels",
  facebook_reels: "reels",
  reels: "reels",
  instagram_explore: "explorar",
  instagram_explore_grid_home: "explorar",
  marketplace: "marketplace",
  video_feeds: "videos",
  right_hand_column: "columna derecha",
  search: "búsqueda",
  an_classic: "red de audiencia",
  rewarded_video: "red de audiencia",
  messenger_inbox: "messenger",
  instagram_profile_feed: "perfil",
};

async function porDesglose(cuenta: string, rango: { since: string; until: string }, breakdowns: string): Promise<any[]> {
  return graphTodo(`act_${cuenta}/insights`, {
    level: "account",
    time_range: JSON.stringify(rango),
    breakdowns,
    fields: "spend,impressions,clicks,inline_link_clicks,actions",
    limit: "500",
  });
}

/** Resumen de a quién apunta un conjunto de anuncios (su segmentación). */
function segmentacionTexto(t: any): string {
  if (!t) return "sin datos de segmentación";
  const partes: string[] = [];
  if (t.age_min || t.age_max) partes.push(`${t.age_min ?? 18} a ${t.age_max ?? 65}${t.age_max === 65 ? "+" : ""} años`);
  if (Array.isArray(t.genders) && t.genders.length === 1) partes.push(t.genders[0] === 1 ? "solo hombres" : "solo mujeres");
  const geo = t.geo_locations ?? {};
  const lugares = [
    ...(geo.cities ?? []).map((c: any) => `${c.name}${c.radius ? ` +${c.radius} ${c.distance_unit === "mile" ? "mi" : "km"}` : ""}`),
    ...(geo.regions ?? []).map((r: any) => r.name),
    ...(geo.custom_locations ?? []).map((c: any) => `${c.name ?? "punto en el mapa"}${c.radius ? ` +${c.radius} km` : ""}`),
    ...(geo.countries ?? []),
  ].filter(Boolean);
  if (lugares.length) partes.push(`zona: ${lugares.slice(0, 6).join(", ")}`);
  const intereses = (t.flexible_spec ?? [])
    .flatMap((f: any) => [...(f.interests ?? []), ...(f.behaviors ?? []), ...(f.work_positions ?? [])])
    .map((x: any) => x.name)
    .filter(Boolean);
  if (intereses.length) partes.push(`intereses: ${intereses.slice(0, 8).join(", ")}`);
  if (t.custom_audiences?.length) partes.push(`públicos guardados: ${t.custom_audiences.map((a: any) => a.name).slice(0, 4).join(", ")}`);
  if (t.excluded_custom_audiences?.length) partes.push(`excluye: ${t.excluded_custom_audiences.map((a: any) => a.name).slice(0, 3).join(", ")}`);
  if (t.targeting_automation?.advantage_audience === 1) partes.push("público Advantage+ (Meta amplía solo)");
  if (Array.isArray(t.publisher_platforms)) partes.push(`solo en ${t.publisher_platforms.join(" y ")}`);
  else partes.push("ubicaciones automáticas");
  return partes.join("; ");
}

export interface BaseSegmentos {
  texto: string;
  /** Qué se pudo leer (para mostrar "en qué se basó"). */
  leido: string[];
  conjuntos: number;
  anuncios: number;
}

export async function segmentosPauta(
  pid: string,
  cuenta: string,
  desde: string,
  hasta: string,
  moneda: string,
  conAnuncios = true
): Promise<BaseSegmentos> {
  const rango = { since: desde, until: hasta };
  const partes: string[] = [];
  const leido: string[] = [];
  let conjuntos = 0;
  let anuncios = 0;

  const [edadGenero, ubicaciones, zonas, horas, adsets, ads] = await Promise.allSettled([
    porDesglose(cuenta, rango, "age,gender"),
    porDesglose(cuenta, rango, "publisher_platform,platform_position"),
    porDesglose(cuenta, rango, "region"),
    porDesglose(cuenta, rango, "hourly_stats_aggregated_by_advertiser_time_zone"),
    graphTodo(`act_${cuenta}/adsets`, {
      fields: `name,effective_status,optimization_goal,daily_budget,lifetime_budget,campaign{name},targeting,insights.time_range(${JSON.stringify(rango)}){spend,impressions,clicks,inline_link_clicks,actions,frequency}`,
      limit: "100",
    }),
    conAnuncios ? adminDb().collection("meta_anuncios_diaria").where("proyecto_id", "==", pid).where("fecha", ">=", desde).get() : Promise.reject(new Error("sin anuncios")),
  ]);

  if (edadGenero.status === "fulfilled" && edadGenero.value.length) {
    const filas = edadGenero.value.map((d) => aFila(d, `${GENERO[d.gender] ?? d.gender} ${d.age}`));
    const porEdad = juntar(edadGenero.value.map((d) => aFila(d, `${d.age} años`)));
    const porGenero = juntar(edadGenero.value.map((d) => aFila(d, GENERO[d.gender] ?? d.gender)));
    partes.push(`Público por edad:\n${lineas(porEdad, moneda)}\n\nPúblico por género:\n${lineas(porGenero, moneda)}\n\nEdad y género juntos (los que más gastaron):\n${lineas(filas, moneda, 8)}`);
    leido.push("edad y género");
  }
  if (ubicaciones.status === "fulfilled" && ubicaciones.value.length) {
    const filas = juntar(
      ubicaciones.value.map((d) => {
        const red = d.publisher_platform === "instagram" ? "Instagram" : d.publisher_platform === "facebook" ? "Facebook" : d.publisher_platform === "messenger" ? "Messenger" : "Red de audiencia";
        return aFila(d, `${red} ${UBICACION[d.platform_position] ?? d.platform_position}`);
      })
    );
    partes.push(`Ubicaciones (dónde se vieron los anuncios):\n${lineas(filas, moneda)}`);
    leido.push("ubicaciones");
  }
  if (zonas.status === "fulfilled" && zonas.value.length) {
    partes.push(`Zonas:\n${lineas(zonas.value.map((d) => aFila(d, String(d.region))), moneda, 8)}`);
    leido.push("zonas");
  }
  if (horas.status === "fulfilled" && horas.value.length) {
    // De a 3 horas, para que se vea el patrón.
    const filas = juntar(
      horas.value.map((d) => {
        const h = Number(String(d.hourly_stats_aggregated_by_advertiser_time_zone ?? "0").slice(0, 2));
        const desdeH = Math.floor(h / 3) * 3;
        return aFila(d, `${String(desdeH).padStart(2, "0")} a ${String(desdeH + 3).padStart(2, "0")} h`);
      })
    ).sort((a, b) => a.nombre.localeCompare(b.nombre));
    partes.push(`Horarios (hora de la cuenta, de a 3 horas):\n${lineas(filas, moneda, 8)}`);
    leido.push("horarios");
  }
  if (adsets.status === "fulfilled") {
    const conGasto = adsets.value.filter((a) => Number(a.insights?.data?.[0]?.spend || 0) > 0);
    conjuntos = conGasto.length;
    if (conGasto.length) {
      const texto = conGasto
        .sort((a, b) => Number(b.insights.data[0].spend) - Number(a.insights.data[0].spend))
        .slice(0, 12)
        .map((a) => {
          const i = a.insights.data[0];
          const f = aFila(i, a.name);
          const presupuesto = a.daily_budget ? `presupuesto diario ${r2(Number(a.daily_budget) / 100)}` : a.lifetime_budget ? `presupuesto total ${r2(Number(a.lifetime_budget) / 100)}` : "presupuesto en la campaña";
          return `- "${a.name}" (campaña "${a.campaign?.name ?? "?"}", ${a.effective_status === "ACTIVE" ? "ACTIVO" : "apagado"}, optimiza para ${a.optimization_goal ?? "?"}, ${presupuesto}): gasto ${r2(f.gasto)} ${moneda}, ${f.resultados} resultados, costo por resultado ${
            f.resultados ? r2(f.gasto / f.resultados) : "sin resultados"
          }, frecuencia ${i.frequency ? r2(Number(i.frequency)) : "—"}. A quién apunta: ${segmentacionTexto(a.targeting)}`;
        })
        .join("\n");
      partes.push(`Conjuntos de anuncios (públicos armados):\n${texto}`);
      leido.push("públicos de cada conjunto");
    }
  }
  if (ads.status === "fulfilled" && ads.value.size) {
    const m = new Map<string, Fila>();
    for (const d of ads.value.docs) {
      const x = d.data();
      const a = m.get(x.ad_id) ?? { nombre: x.ad_name || x.ad_id, gasto: 0, impresiones: 0, clics: 0, resultados: 0 };
      a.gasto += Number(x.gasto || 0);
      a.impresiones += Number(x.impresiones || 0);
      a.clics += Number(x.clics || 0);
      a.resultados += Number(x.mensajes || 0) + Number(x.compras || 0) + Number(x.leads || 0);
      m.set(x.ad_id, a);
    }
    const lista = [...m.values()].filter((a) => a.gasto > 0);
    anuncios = lista.length;
    const conRes = lista.filter((a) => a.resultados > 0).sort((a, b) => a.gasto / a.resultados - b.gasto / b.resultados);
    const sinRes = lista.filter((a) => a.resultados === 0).sort((a, b) => b.gasto - a.gasto);
    const fila = (a: Fila) =>
      `- "${a.nombre}": gasto ${r2(a.gasto)} ${moneda}, ${a.resultados} resultados${a.resultados ? `, ${r2(a.gasto / a.resultados)} ${moneda} cada uno` : ""}, CTR ${a.impresiones ? r2((a.clics / a.impresiones) * 100) : "—"}%`;
    partes.push(
      `Anuncios (piezas) que mejor rinden:\n${conRes.slice(0, 6).map(fila).join("\n") || "- (ninguno con resultados)"}\n\nAnuncios que peor rinden:\n${[
        ...conRes.slice(-4).reverse(),
        ...sinRes.slice(0, 4),
      ]
        .map(fila)
        .join("\n") || "- (sin datos)"}`
    );
    leido.push("cada anuncio");
  }
  return { texto: partes.join("\n\n"), leido, conjuntos, anuncios };
}
