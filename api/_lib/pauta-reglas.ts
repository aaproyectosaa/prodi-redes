// Reglas de alertas de pauta (puras: sin base ni red). Las usan la pantalla (src/lib/redes/alertasPauta.ts) y el cron
// diario, que avisa a quien maneja la pauta (api/_lib/meta-cuenta.ts). Cada alerta trae el diagnóstico y qué hacer.
// Cuáles están prendidas se elige en Ajustes (app_settings/redes.reglas_pauta); por defecto, REGLAS_DEFAULT.

export interface FilaPautaRegla {
  fecha: string;
  campaign_id: string;
  campaign_name?: string | null;
  objetivo?: string | null;
  gasto: number;
  impresiones?: number;
  clics?: number;
  mensajes?: number;
  compras?: number;
  valor_compras?: number;
  leads?: number;
  moneda?: string | null;
}

export type ReglaPauta = "costo_alto" | "sin_resultados" | "sin_gasto" | "presupuesto" | "frecuencia" | "subgasto" | "roas_bajo";

export const REGLAS_DEFAULT: Record<ReglaPauta, boolean> = {
  costo_alto: true,
  sin_resultados: true,
  sin_gasto: true,
  presupuesto: true,
  frecuencia: false,
  subgasto: false,
  roas_bajo: false,
};

export const REGLAS_INFO: Record<ReglaPauta, { label: string; detalle: string }> = {
  costo_alto: { label: "Costo por resultado alto", detalle: "Los últimos 3 días, cada resultado costó más de 1,5 veces el promedio de sus 14 días anteriores." },
  sin_resultados: { label: "Gasta sin resultados", detalle: "Una campaña gastó lo de 3 días de presupuesto (o de su gasto normal) sin ningún resultado." },
  sin_gasto: { label: "Dejó de gastar", detalle: "2 días sin inversión cuando venía pautando (anuncio cortado, rechazado o sin saldo)." },
  presupuesto: { label: "Presupuesto del mes", detalle: "Llega al 90%, se pasa, o al ritmo actual se va a pasar del presupuesto mensual del cliente." },
  frecuencia: { label: "El anuncio cansa", detalle: "Frecuencia de 3,5 o más en los últimos 7 días." },
  subgasto: { label: "Gasta de menos", detalle: "3 días seguidos gastando menos del 70% del presupuesto diario." },
  roas_bajo: { label: "ROAS bajo", detalle: "Campañas de ventas con más de 7 días que devuelven menos de 1,5 veces lo invertido." },
};

export function reglasActivas(cfg: unknown): Record<ReglaPauta, boolean> {
  const c = (cfg ?? {}) as Partial<Record<ReglaPauta, unknown>>;
  return Object.fromEntries((Object.keys(REGLAS_DEFAULT) as ReglaPauta[]).map((k) => [k, typeof c[k] === "boolean" ? (c[k] as boolean) : REGLAS_DEFAULT[k]])) as Record<ReglaPauta, boolean>;
}

export interface AlertaRegla {
  id: string;
  regla: ReglaPauta;
  /** 2 = urgente, 1 = mirar hoy, 0 = para tener en cuenta. */
  nivel: 0 | 1 | 2;
  titulo: string;
  /** Qué pasa, por qué y qué hacer. */
  detalle: string;
}

type Res = "mensajes" | "compras" | "leads";
const NOMBRE: Record<Res, { uno: string; ninguno: string }> = {
  mensajes: { uno: "mensaje", ninguno: "ningún mensaje" },
  compras: { uno: "venta", ninguno: "ninguna venta" },
  leads: { uno: "contacto", ninguno: "ningún contacto" },
};

export function sumarDiasISO(f: string, n: number): string {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dineroEn(n: number, moneda = "ARS"): string {
  const dec = moneda === "ARS" || n === 0 ? 0 : Math.abs(n) < 100 ? 2 : 0;
  const v = new Intl.NumberFormat("es-AR", { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(n);
  return moneda === "ARS" ? `$ ${v}` : moneda === "USD" ? `US$ ${v}` : `${moneda} ${v}`;
}

/** Qué resultado importa en una campaña (por su objetivo; si no dice, el que más tuvo). */
function resultadoDe(filas: FilaPautaRegla[]): Res {
  const obj = filas.find((f) => f.objetivo)?.objetivo ?? "";
  if (/SALES|CONVERSIONS/.test(obj)) return "compras";
  if (/LEAD/.test(obj)) return "leads";
  if (/MESSAGES|ENGAGEMENT/.test(obj)) return "mensajes";
  const s = (k: Res) => filas.reduce((a, f) => a + (Number(f[k]) || 0), 0);
  return s("compras") ? "compras" : s("leads") > s("mensajes") ? "leads" : "mensajes";
}

const enRango = (filas: FilaPautaRegla[], desde: string, hasta: string) => filas.filter((f) => f.fecha >= desde && f.fecha <= hasta);
const suma = (filas: FilaPautaRegla[], k: keyof FilaPautaRegla) => filas.reduce((a, f) => a + (Number(f[k]) || 0), 0);
const pct = (n: number) => `${Math.round(n * 100)}%`;

export interface EntradaReglas {
  /** Filas de pauta del cliente (al menos los últimos 31 días). */
  filas: FilaPautaRegla[];
  hoy: string;
  /** Presupuesto mensual en pesos (null si no tiene). */
  presupuesto: number | null;
  frecuencia?: { id: string; nombre: string; frecuencia: number }[];
  reglas: Record<ReglaPauta, boolean>;
}

/** Cómo viene el mes contra el presupuesto (en pesos; con la cuenta en otra moneda no se compara). */
export function estadoMes(filas: FilaPautaRegla[], hoy: string, presupuesto: number | null) {
  const moneda = monedaFilas(filas);
  const tope = moneda === "ARS" ? presupuesto : null;
  const gasto = suma(enRango(filas, `${hoy.slice(0, 7)}-01`, hoy), "gasto");
  const [y, m, d] = hoy.split("-").map(Number);
  const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const proyectado = d >= 5 ? (gasto / d) * diasMes : null;
  return { tope, gasto, uso: tope ? gasto / tope : null, proyectado, diasMes, dia: d, moneda };
}

export function monedaFilas(filas: { moneda?: string | null }[]): string {
  const n = new Map<string, number>();
  for (const f of filas) if (f.moneda) n.set(f.moneda, (n.get(f.moneda) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ARS";
}

export function evaluarPauta({ filas, hoy, presupuesto, frecuencia = [], reglas }: EntradaReglas): AlertaRegla[] {
  const out: AlertaRegla[] = [];
  if (!filas.length) return out;
  const moneda = monedaFilas(filas);
  const $ = (n: number) => dineroEn(n, moneda);
  const ayer = sumarDiasISO(hoy, -1);
  const mes = estadoMes(filas, hoy, presupuesto);

  if (reglas.presupuesto && mes.tope && mes.uso != null) {
    if (mes.uso >= 1) {
      out.push({ id: "pres", regla: "presupuesto", nivel: 2, titulo: "Se pasó del presupuesto", detalle: `Lleva ${$(mes.gasto)} de ${$(mes.tope)} (${pct(mes.uso)}). Pausá las campañas o bajá el presupuesto diario en Meta hoy; si sigue, todo lo que gaste de más no lo cubre el cliente.` });
    } else if (mes.uso >= 0.9) {
      out.push({ id: "pres", regla: "presupuesto", nivel: 1, titulo: "Casi llega al presupuesto", detalle: `Lleva ${$(mes.gasto)} de ${$(mes.tope)} (${pct(mes.uso)}) y faltan ${mes.diasMes - mes.dia} días. Bajá el diario a ${$(Math.max(mes.tope - mes.gasto, 0) / Math.max(mes.diasMes - mes.dia, 1))} para llegar justo a fin de mes.` });
    } else if (mes.proyectado != null && mes.proyectado > mes.tope * 1.1) {
      const diario = Math.max(mes.tope - mes.gasto, 0) / Math.max(mes.diasMes - mes.dia, 1);
      out.push({ id: "pres", regla: "presupuesto", nivel: 1, titulo: "Al ritmo actual se pasa del presupuesto", detalle: `Va a terminar el mes en ${$(mes.proyectado)} y el presupuesto es ${$(mes.tope)}. Bajá el diario total a unos ${$(diario)} para cerrar en el presupuesto.` });
    }
  }

  if (reglas.sin_gasto) {
    const ult2 = suma(enRango(filas, sumarDiasISO(hoy, -2), ayer), "gasto");
    const antes = suma(enRango(filas, sumarDiasISO(hoy, -14), sumarDiasISO(hoy, -3)), "gasto");
    if (ult2 === 0 && antes > 0 && !(mes.uso != null && mes.uso >= 1)) {
      out.push({ id: "sg", regla: "sin_gasto", nivel: 2, titulo: "Dejó de gastar", detalle: "No tuvo inversión en los últimos 2 días y venía pautando. Revisá en el Administrador de anuncios si el anuncio se rechazó, terminó o la cuenta se quedó sin saldo; cada día parado son mensajes que no llegan." });
    }
  }

  // Por campaña.
  const porCamp = new Map<string, FilaPautaRegla[]>();
  for (const f of filas) porCamp.set(f.campaign_id, [...(porCamp.get(f.campaign_id) ?? []), f]);

  if (reglas.costo_alto) {
    // Toda la cuenta: los últimos 3 días contra el promedio de los 14 anteriores.
    const res = resultadoDe(filas);
    const ult = enRango(filas, sumarDiasISO(hoy, -3), ayer);
    const base = enRango(filas, sumarDiasISO(hoy, -17), sumarDiasISO(hoy, -4));
    const rU = suma(ult, res);
    const rB = suma(base, res);
    if (rU >= 2 && rB >= 5) {
      const cU = suma(ult, "gasto") / rU;
      const cB = suma(base, "gasto") / rB;
      if (cU > cB * 1.5) {
        out.push({ id: "costo", regla: "costo_alto", nivel: 1, titulo: `Cada ${NOMBRE[res].uno} sale ${Math.round((cU / cB) * 10) / 10}× más caro`, detalle: `Los últimos 3 días cada ${NOMBRE[res].uno} costó ${$(cU)} contra ${$(cB)} de promedio en las 2 semanas anteriores. Mirá qué anuncio se encareció: renová esa creatividad o pasale el presupuesto al que mejor rinde. Si no se toca, el mes cierra con menos resultados por la misma plata.` });
      }
    }
  }

  for (const [id, lista] of porCamp) {
    const nombre = lista[0].campaign_name || id;
    const res = resultadoDe(lista);

    if (reglas.sin_resultados) {
      // Días recientes seguidos con gasto y sin resultados.
      let gasto = 0;
      let dias = 0;
      for (let d = ayer; d >= sumarDiasISO(hoy, -10); d = sumarDiasISO(d, -1)) {
        const del = lista.filter((f) => f.fecha === d);
        const g = suma(del, "gasto");
        if (g === 0 && !dias) continue;
        if (suma(del, res) > 0 || g === 0) break;
        gasto += g;
        dias++;
      }
      const promedio = suma(enRango(lista, sumarDiasISO(hoy, -14), ayer), "gasto") / 14;
      const diario = mes.tope ? mes.tope / mes.diasMes : promedio;
      if (dias >= 2 && diario > 0 && gasto >= diario * 3) {
        out.push({ id: `sr-${id}`, regla: "sin_resultados", nivel: 2, titulo: "Gasta sin resultados", detalle: `"${nombre}" gastó ${$(gasto)} en ${dias} días y ${NOMBRE[res].ninguno} (es más de 3 días de presupuesto). Pausala o cambiale el anuncio o el público hoy: así está tirando plata.` });
      }
    }

    if (reglas.roas_bajo && res === "compras") {
      const activa = lista.some((f) => f.fecha >= sumarDiasISO(hoy, -2) && f.gasto > 0);
      const desde = lista.map((f) => f.fecha).sort()[0];
      const u7 = enRango(lista, sumarDiasISO(hoy, -7), ayer);
      const g = suma(u7, "gasto");
      if (activa && desde <= sumarDiasISO(hoy, -7) && g > 0) {
        const roas = suma(u7, "valor_compras") / g;
        if (roas < 1.5) {
          out.push({ id: `roas-${id}`, regla: "roas_bajo", nivel: 1, titulo: `ROAS bajo (${roas.toFixed(1).replace(".", ",")}×)`, detalle: `"${nombre}" devolvió ${$(suma(u7, "valor_compras"))} por ${$(g)} invertidos en 7 días. Revisá el público y la oferta, o mové presupuesto a lo que vende; por debajo de 1,5× la campaña probablemente pierde plata.` });
        }
      }
    }
  }

  if (reglas.subgasto && mes.tope) {
    const diario = mes.tope / mes.diasMes;
    const dias = [1, 2, 3].map((k) => suma(enRango(filas, sumarDiasISO(hoy, -k), sumarDiasISO(hoy, -k)), "gasto"));
    if (dias.every((g) => g < diario * 0.7)) {
      out.push({ id: "sub", regla: "subgasto", nivel: 1, titulo: "Gasta de menos", detalle: `Los últimos 3 días gastó menos del 70% del diario (${$(diario)}). Subí el presupuesto diario o revisá si el anuncio tiene poca entrega; si no, el mes cierra con menos resultados de los que el cliente pagó.` });
    }
  }

  if (reglas.frecuencia) {
    for (const fr of frecuencia) {
      if (fr.frecuencia >= 3.5) {
        out.push({ id: `fr-${fr.id}`, regla: "frecuencia", nivel: fr.frecuencia >= 5 ? 1 : 0, titulo: "El anuncio ya cansa", detalle: `"${fr.nombre}": cada persona lo vio ${fr.frecuencia.toFixed(1).replace(".", ",")} veces en 7 días. Subí una creatividad nueva o ampliá el público; si no, el costo va a subir.` });
      }
    }
  }

  return out.sort((a, b) => b.nivel - a.nivel);
}
