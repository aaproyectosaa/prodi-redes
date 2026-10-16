// Mora de los clientes: la parte de cálculo (sin base de datos), la usan el servidor y el navegador.
// Ver api/_lib/mora.ts.

import { interesMora, pagoUnaParte, saldoDe, type Factura } from "./facturacion";

export type NivelMora = "al_dia" | "vencido" | "mora" | "sin_extras" | "pausa";
export const ORDEN_MORA: NivelMora[] = ["al_dia", "vencido", "mora", "sin_extras", "pausa"];
export const subeDe = (a: NivelMora, b: NivelMora) => ORDEN_MORA.indexOf(a) >= ORDEN_MORA.indexOf(b);

export interface ConfigMora {
  activo: boolean;
  /** Días de atraso para cada escalón. */
  aviso: number;
  extras: number;
  pausa: number;
}
export const MORA_DEFAULT: ConfigMora = { activo: true, aviso: 10, extras: 20, pausa: 30 };

export function leerConfigMora(settings: Record<string, unknown> | null | undefined): ConfigMora {
  const m = (settings?.mora ?? {}) as Partial<ConfigMora>;
  const n = (v: unknown, d: number) => (Number(v) >= 1 && Number(v) <= 365 ? Math.round(Number(v)) : d);
  const aviso = n(m.aviso, MORA_DEFAULT.aviso);
  const extras = Math.max(aviso, n(m.extras, MORA_DEFAULT.extras));
  const pausa = Math.max(extras, n(m.pausa, MORA_DEFAULT.pausa));
  return { activo: m.activo !== false, aviso, extras, pausa };
}

/** El escalón según los días de atraso (con tregua del admin, no pasa de "en mora"). */
export function nivelMora(dias: number, cfg: ConfigMora, tregua = false): NivelMora {
  if (!cfg.activo || dias <= 0) return dias > 0 ? "vencido" : "al_dia";
  let n: NivelMora = dias >= cfg.pausa ? "pausa" : dias >= cfg.extras ? "sin_extras" : dias >= cfg.aviso ? "mora" : "vencido";
  if (tregua && subeDe(n, "sin_extras")) n = "mora";
  return n;
}

export interface EstadoMora {
  nivel: NivelMora;
  /** Días de atraso de la boleta vencida más vieja. */
  dias: number;
  /** Lo que debe (saldo de las boletas vencidas) y el interés a hoy. */
  deuda: number;
  interes: number;
  boletas: number;
  /** Vencimiento más viejo sin pagar. */
  desde: string | null;
  at: string;
}

/** Boletas vencidas de un cliente que cuentan para la mora (emitidas, con saldo; débito automático sin cobrar, no). */
export function vencidas(facturas: (Factura & { debito?: boolean })[], hoy: string) {
  return facturas.filter((f) => {
    if (f.estado !== "pendiente" || !f.emitida_at || !f.vencimiento || f.vencimiento >= hoy) return false;
    if (saldoDe(f) <= 0) return false;
    // Con débito automático y sin nada cobrado todavía: lo cobra Mercado Pago, no es mora.
    return !(f.debito && !pagoUnaParte(f));
  });
}

export function estadoMora(facturas: (Factura & { debito?: boolean })[], hoy: string, cfg: ConfigMora, tregua = false): EstadoMora {
  const vs = vencidas(facturas, hoy);
  const mora = vs.map((f) => interesMora(f, hoy));
  const dias = Math.max(0, ...mora.map((m) => m.dias));
  return {
    nivel: nivelMora(dias, cfg, tregua),
    dias,
    deuda: Math.round(mora.reduce((a, m) => a + m.saldo, 0)),
    interes: Math.round(mora.reduce((a, m) => a + m.interes, 0)),
    boletas: vs.length,
    desde: vs.map((f) => f.vencimiento).sort()[0] ?? null,
    at: new Date().toISOString(),
  };
}

