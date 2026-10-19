import { useEffect, useState } from "react";
import { callApi } from "@/lib/redes/api";
import { collection, onSnapshot, query, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";

// Pauta de toda la cuenta publicitaria por campaña y día, y el Instagram de cada día. Lo traen solos el cron diario y
// "Actualizar ahora" (api/_lib/meta-cuenta.ts). Acá: leerlo y resumirlo por rango.

export interface PautaDia {
  id: string;
  proyecto_id: string;
  fecha: string;
  campaign_id: string;
  campaign_name?: string | null;
  objetivo?: string | null;
  gasto: number;
  impresiones: number;
  alcance: number;
  clics: number;
  mensajes: number;
  compras: number;
  valor_compras: number;
  leads: number;
  /** Moneda de la cuenta publicitaria (ARS, USD…). */
  moneda?: string | null;
  reproducciones_3s?: number;
  thruplays?: number;
}

export interface IgDia {
  fecha: string;
  ig_seguidores?: number | null;
  ig_alcance_dia?: number | null;
  ig_vistas_dia?: number | null;
  ig_interacciones_dia?: number | null;
}

export type Rango = "mes" | "mes_pasado" | "7" | "30" | "90";
export const RANGOS: { k: Rango; label: string }[] = [
  { k: "mes", label: "Este mes" },
  { k: "mes_pasado", label: "Mes pasado" },
  { k: "7", label: "7 días" },
  { k: "30", label: "30 días" },
  { k: "90", label: "90 días" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const sumarDiasF = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const diasEntre = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000) + 1;

/** Desde/hasta del rango y del período anterior del mismo largo (para comparar). */
export function fechasDe(r: Rango, hoy = iso(new Date())): { desde: string; hasta: string; antDesde: string; antHasta: string } {
  if (r === "mes" || r === "mes_pasado") {
    const [y, m] = hoy.split("-").map(Number);
    const ini = (yy: number, mm: number) => iso(new Date(yy, mm - 1, 1));
    const fin = (yy: number, mm: number) => iso(new Date(yy, mm, 0));
    // El mes en curso se compara con los mismos días del mes pasado (del 1 al día de hoy).
    const dia = Math.min(Number(hoy.slice(8, 10)), Number(fin(y, m - 1).slice(8, 10)));
    if (r === "mes") return { desde: ini(y, m), hasta: hoy, antDesde: ini(y, m - 1), antHasta: iso(new Date(y, m - 2, dia)) };
    return { desde: ini(y, m - 1), hasta: fin(y, m - 1), antDesde: ini(y, m - 2), antHasta: fin(y, m - 2) };
  }
  const n = Number(r);
  const desde = sumarDiasF(hoy, -(n - 1));
  return { desde, hasta: hoy, antDesde: sumarDiasF(desde, -n), antHasta: sumarDiasF(desde, -1) };
}

/** Desde/hasta de un mes ("2026-10") y del mes anterior. El mes en curso, como "mes" (se compara hasta el mismo día). */
export function fechasDeMes(mes: string, hoy = iso(new Date())) {
  if (hoy.startsWith(mes)) return fechasDe("mes", hoy);
  const [y, m] = mes.split("-").map(Number);
  return { desde: iso(new Date(y, m - 1, 1)), hasta: iso(new Date(y, m, 0)), antDesde: iso(new Date(y, m - 2, 1)), antHasta: iso(new Date(y, m - 1, 0)) };
}

/** Filas de pauta de un cliente (o de todos, sin `proyectoId`) desde una fecha. */
export function usePautaMeta(proyectoId: string | undefined | null, desde: string) {
  const [lista, setLista] = useState<PautaDia[] | null>(null);
  useEffect(() => {
    if (proyectoId === undefined) return;
    const filtros = proyectoId ? [where("proyecto_id", "==", proyectoId), where("fecha", ">=", desde)] : [where("fecha", ">=", desde)];
    return onSnapshot(
      query(collection(db, "meta_pauta_diaria"), ...filtros),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PautaDia, "id">) }))),
      () => setLista([])
    );
  }, [proyectoId, desde]);
  return lista;
}

/** Pauta por anuncio y día (api/_lib/meta-anuncios.ts). */
export interface AnuncioDia {
  id: string;
  proyecto_id: string;
  fecha: string;
  ad_id: string;
  ad_name?: string | null;
  campaign_id?: string | null;
  objetivo?: string | null;
  gasto: number;
  impresiones: number;
  clics: number;
  mensajes: number;
  compras: number;
  valor_compras: number;
  leads: number;
}

/** Nombre y miniatura de un anuncio, y el post al que apunta. */
export interface AnuncioInfo {
  id: string;
  ad_id: string;
  nombre?: string | null;
  miniatura?: string | null;
  post_id?: string | null;
  ig_media_id?: string | null;
  permalink?: string | null;
}

export function useAnunciosMeta(proyectoId: string | undefined, desde: string) {
  const [lista, setLista] = useState<AnuncioDia[] | null>(null);
  useEffect(() => {
    if (!proyectoId) return;
    return onSnapshot(
      query(collection(db, "meta_anuncios_diaria"), where("proyecto_id", "==", proyectoId), where("fecha", ">=", desde)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AnuncioDia, "id">) }))),
      () => setLista([])
    );
  }, [proyectoId, desde]);
  return lista;
}

export function useAnunciosInfo(proyectoId: string | undefined) {
  const [lista, setLista] = useState<AnuncioInfo[]>([]);
  useEffect(() => {
    if (!proyectoId) return;
    return onSnapshot(
      query(collection(db, "meta_anuncios"), where("proyecto_id", "==", proyectoId)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AnuncioInfo, "id">) }))),
      () => setLista([])
    );
  }, [proyectoId]);
  return lista;
}

/** El anuncio que más resultados trajo en el rango (según el resultado principal de la cuenta). */
export function mejorAnuncio(filas: AnuncioDia[], desde: string, hasta: string, tipo: TipoResultado) {
  const por = new Map<string, { ad_id: string; nombre: string; gasto: number; resultados: number; valor_compras: number }>();
  for (const f of filas) {
    if (f.fecha < desde || f.fecha > hasta) continue;
    const a = por.get(f.ad_id) ?? { ad_id: f.ad_id, nombre: f.ad_name || f.ad_id, gasto: 0, resultados: 0, valor_compras: 0 };
    a.gasto += f.gasto || 0;
    a.resultados += Number(f[tipo]) || 0;
    a.valor_compras += f.valor_compras || 0;
    por.set(f.ad_id, a);
  }
  const top = [...por.values()].filter((a) => a.resultados > 0).sort((a, b) => b.resultados - a.resultados || a.gasto - b.gasto)[0];
  return top ? { ...top, costo: top.gasto / top.resultados } : null;
}

/** Resultado principal, inversión y costo de cada mes (para el gráfico de los últimos meses). */
export function resumirPorMes(filas: PautaDia[], meses: string[], tipo: TipoResultado) {
  return meses.map((mes) => {
    const del = filas.filter((f) => f.fecha.startsWith(mes));
    const gasto = del.reduce((a, f) => a + (f.gasto || 0), 0);
    const resultados = del.reduce((a, f) => a + (Number(f[tipo]) || 0), 0);
    // Sin filas: ese mes es anterior al historial que se trajo de Meta (no es que no haya habido resultados).
    return { mes, gasto, resultados, costo: resultados ? gasto / resultados : null, conDatos: del.length > 0 };
  });
}

/** El resultado que importa en todo un período (para que todos los meses del gráfico midan lo mismo). */
export const principalDelPeriodo = (filas: PautaDia[]): TipoResultado => principalDe(filas);

const pedidos = new Map<string, number>();

/**
 * Al abrir los resultados de un cliente: le pide al servidor que busque lo nuevo en Meta (el servidor decide si hace
 * falta: más de 3 horas, o el historial la primera vez). Una vez por cliente cada 10 minutos. Devuelve si está buscando.
 */
export function useMetaAuto(proyectoId: string | undefined, conectado: boolean) {
  const [buscando, setBuscando] = useState(false);
  useEffect(() => {
    if (!proyectoId || !conectado) return;
    const ultimo = pedidos.get(proyectoId) ?? 0;
    if (Date.now() - ultimo < 10 * 60_000) return;
    pedidos.set(proyectoId, Date.now());
    let vivo = true;
    setBuscando(true);
    callApi("/api/informes/meta-cuenta", { proyecto_id: proyectoId })
      .catch(() => undefined)
      .finally(() => vivo && setBuscando(false));
    return () => {
      vivo = false;
    };
  }, [proyectoId, conectado]);
  return buscando;
}

export type TipoResultado = "mensajes" | "compras" | "leads" | "clics";
export const NOMBRE_RESULTADO: Record<TipoResultado, { uno: string; varios: string; titulo: string; cliente: (n: string) => string }> = {
  mensajes: { uno: "mensaje", varios: "Mensajes", titulo: "Mensajes", cliente: (n) => `Te escribieron ${n} veces` },
  compras: { uno: "venta", varios: "Ventas", titulo: "Ventas", cliente: (n) => `Vendiste ${n} veces` },
  leads: { uno: "contacto", varios: "Contactos", titulo: "Contactos", cliente: (n) => `${n} te dejaron sus datos` },
  clics: { uno: "clic", varios: "Clics", titulo: "Clics", cliente: (n) => `${n} clics` },
};

export interface ResumenPauta {
  /** Moneda de la cuenta (la que más aparece; ARS si no dice). */
  moneda: string;
  gasto: number;
  impresiones: number;
  alcance: number;
  clics: number;
  mensajes: number;
  compras: number;
  valor_compras: number;
  leads: number;
  ctr: number | null;
  cpm: number | null;
  principal: TipoResultado;
  resultados: number;
  costo: number | null;
  roas: number | null;
  porDia: { fecha: string; gasto: number }[];
  campanias: { id: string; nombre: string; objetivo: string | null; gasto: number; resultados: number; costo: number | null; impresiones: number; clics: number }[];
}

const OBJ_A_RESULTADO: Record<string, TipoResultado> = {
  OUTCOME_SALES: "compras",
  CONVERSIONS: "compras",
  OUTCOME_LEADS: "leads",
  LEAD_GENERATION: "leads",
  MESSAGES: "mensajes",
  OUTCOME_ENGAGEMENT: "mensajes",
};

/** El resultado que importa: el del objetivo con más gasto; si no dice, el que más hubo (mensajes, compras, leads). */
function principalDe(filas: PautaDia[]): TipoResultado {
  const porTipo = new Map<TipoResultado, number>();
  for (const f of filas) {
    const t = f.objetivo ? OBJ_A_RESULTADO[f.objetivo] : undefined;
    if (t && f[t] > 0) porTipo.set(t, (porTipo.get(t) ?? 0) + f.gasto);
  }
  const top = [...porTipo.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  const tot = (k: "mensajes" | "compras" | "leads") => filas.reduce((a, f) => a + (f[k] || 0), 0);
  if (tot("compras")) return "compras";
  if (tot("mensajes")) return "mensajes";
  if (tot("leads")) return "leads";
  return "clics";
}

/** La moneda de una cuenta publicitaria (la que más aparece en sus filas). */
export function monedaDe(filas: Pick<PautaDia, "moneda">[]): string {
  const n = new Map<string, number>();
  for (const f of filas) if (f.moneda) n.set(f.moneda, (n.get(f.moneda) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ARS";
}

/** Plata en la moneda de la cuenta: "$ 1.234" en pesos, "US$ 1.234" en dólares. */
export function dinero(n: number | null | undefined, moneda = "ARS"): string {
  if (n == null || !isFinite(n)) return "—";
  const dec = moneda === "ARS" || n === 0 ? 0 : Math.abs(n) < 100 ? 2 : 0;
  const v = new Intl.NumberFormat("es-AR", { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(n);
  return moneda === "ARS" ? `$ ${v}` : moneda === "USD" ? `US$ ${v}` : `${moneda} ${v}`;
}

export function resumirPauta(filas: PautaDia[], desde: string, hasta: string): ResumenPauta {
  const f = filas.filter((x) => x.fecha >= desde && x.fecha <= hasta);
  const suma = (k: keyof PautaDia) => f.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const gasto = Math.round(suma("gasto") * 100) / 100;
  const impresiones = suma("impresiones");
  const clics = suma("clics");
  const principal = principalDe(f);
  const resultados = suma(principal);
  const compras = suma("compras");
  const valor = suma("valor_compras");
  const dias = new Map<string, number>();
  for (let d = desde, i = 0; d <= hasta && i < 400; d = sumarDiasF(d, 1), i++) dias.set(d, 0);
  for (const x of f) dias.set(x.fecha, (dias.get(x.fecha) ?? 0) + x.gasto);
  const camp = new Map<string, ResumenPauta["campanias"][number]>();
  for (const x of f) {
    const c = camp.get(x.campaign_id) ?? { id: x.campaign_id, nombre: x.campaign_name || x.campaign_id, objetivo: x.objetivo ?? null, gasto: 0, resultados: 0, costo: null, impresiones: 0, clics: 0 };
    c.gasto += x.gasto;
    c.resultados += Number(x[principal]) || 0;
    c.impresiones += x.impresiones;
    c.clics += x.clics;
    camp.set(x.campaign_id, c);
  }
  return {
    moneda: monedaDe(f.length ? f : filas),
    gasto,
    impresiones,
    alcance: suma("alcance"),
    clics,
    mensajes: suma("mensajes"),
    compras,
    valor_compras: valor,
    leads: suma("leads"),
    ctr: impresiones ? (clics / impresiones) * 100 : null,
    cpm: impresiones ? (gasto / impresiones) * 1000 : null,
    principal,
    resultados,
    costo: resultados ? gasto / resultados : null,
    roas: compras && gasto ? valor / gasto : null,
    porDia: [...dias.entries()].map(([fecha, g]) => ({ fecha, gasto: g })),
    campanias: [...camp.values()].map((c) => ({ ...c, costo: c.resultados ? c.gasto / c.resultados : null })).sort((a, b) => b.gasto - a.gasto),
  };
}

/** Instagram del rango: seguidores (y cuánto cambiaron), alcance, visualizaciones e interacciones sumados. */
export function resumirIg(lista: IgDia[], desde: string, hasta: string) {
  const f = lista.filter((x) => x.fecha >= desde && x.fecha <= hasta);
  const seg = f.filter((x) => x.ig_seguidores != null);
  const antes = [...lista].filter((x) => x.fecha < desde && x.ig_seguidores != null).pop();
  const ini = antes ?? seg[0];
  const fin = seg[seg.length - 1] ?? [...lista].filter((x) => x.ig_seguidores != null && x.fecha <= hasta).pop();
  const suma = (k: keyof IgDia) => {
    const v = f.filter((x) => x[k] != null);
    return v.length ? v.reduce((a, x) => a + Number(x[k]), 0) : null;
  };
  return {
    seguidores: fin?.ig_seguidores ?? null,
    seguidoresFecha: fin?.fecha ?? null,
    variacion: fin && ini && fin !== ini ? Number(fin.ig_seguidores) - Number(ini.ig_seguidores) : null,
    alcance: suma("ig_alcance_dia"),
    // Promedio por día (sumar el alcance de cada día repite a las mismas personas).
    alcanceDia: (() => {
      const v = f.filter((x) => x.ig_alcance_dia != null);
      return v.length ? v.reduce((a, x) => a + Number(x.ig_alcance_dia), 0) / v.length : null;
    })(),
    vistas: suma("ig_vistas_dia"),
    interacciones: suma("ig_interacciones_dia"),
  };
}

export const largoRango = diasEntre;
