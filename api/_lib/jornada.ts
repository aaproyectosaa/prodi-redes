// Varios videos en una misma filmación (una jornada): el cliente los pide juntos, paga un solo viaje y desde el
// 2º video extra tiene una promo. Lo usan el servidor (cobra) y la pantalla del pedido (muestra el total): misma cuenta.

/** Promo por defecto desde el 2º video extra de la misma filmación (Ajustes → promo_jornada_pct). */
export const PROMO_JORNADA_DEFAULT = 15;
/** Cuántos videos se pueden pedir juntos. */
export const MAX_VIDEOS_JORNADA = 5;

export interface ItemJornada {
  /** Entra en el plan (sin costo). */
  plan: boolean;
  precio: number;
  /** Tiene la promo de la jornada. */
  promo: boolean;
}

export interface CuentaJornada {
  items: ItemJornada[];
  enPlan: number;
  extras: number;
  /** Lo que suman los videos extra (con promo). */
  videos: number;
  /** Lo que se ahorra con la promo. */
  ahorro: number;
  viaje: number;
  total: number;
}

export const promoJornada = (settings: { promo_jornada_pct?: unknown } | null | undefined) => {
  const v = Number(settings?.promo_jornada_pct);
  return Number.isFinite(v) && v >= 0 ? Math.min(50, v) : PROMO_JORNADA_DEFAULT;
};

/**
 * Los primeros videos usan lo que le queda del plan; el resto es extra. Desde el 2º video del pedido, cada extra
 * tiene la promo (si el 1º entró en el plan, todos los extras la tienen). El viaje se paga una vez.
 */
export function cuentaJornada(o: { cantidad: number; disponibles: number; precioExtra: number; promoPct: number; viaje: number }): CuentaJornada {
  const items: ItemJornada[] = Array.from({ length: Math.max(1, o.cantidad) }, (_, i) => {
    if (i < Math.max(0, o.disponibles)) return { plan: true, precio: 0, promo: false };
    const promo = i >= 1 && o.promoPct > 0;
    const precio = promo ? Math.round((o.precioExtra * (1 - o.promoPct / 100)) / 100) * 100 : o.precioExtra;
    return { plan: false, precio, promo };
  });
  const extras = items.filter((x) => !x.plan);
  const videos = extras.reduce((a, x) => a + x.precio, 0);
  const ahorro = extras.filter((x) => x.promo).reduce((a, x) => a + (o.precioExtra - x.precio), 0);
  const viaje = Math.max(0, o.viaje || 0);
  return { items, enPlan: items.length - extras.length, extras: extras.length, videos, ahorro, viaje, total: videos + viaje };
}
