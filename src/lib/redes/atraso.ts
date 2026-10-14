// Atrasado = ya pasó su fecha y no está terminado. En los tableros (edición, diseño, producción) la tarjeta
// se ve en rojo y titila. Distinto de "trabado" (muchos días en la misma etapa), que sigue en naranja.

import { hoyISO } from "./format";
import type { PiezaIA, Video } from "./types";

const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);

/**
 * Días de atraso de un video (0 = al día): pasó la fecha de publicación que pidió el cliente sin publicarse,
 * o está en edición y pasó la fecha de entrega. Cuenta la más vieja.
 */
export function diasAtrasoVideo(v: Pick<Video, "etapa" | "fecha_deseada" | "entrega_edicion">, hoy = hoyISO()): number {
  if (v.etapa === "publicado") return 0;
  const fechas = [v.fecha_deseada, v.etapa === "edicion" ? v.entrega_edicion : null].filter((f): f is string => !!f && f < hoy);
  return fechas.length ? Math.max(...fechas.map((f) => diasEntre(f, hoy))) : 0;
}

/** Días de atraso de una pieza: pasó la fecha de publicación y todavía no está entregada. */
export function diasAtrasoPieza(p: Pick<PiezaIA, "estado" | "fecha_deseada">, hoy = hoyISO()): number {
  if (!["pagada", "en_proceso", "revision_interna", "para_aprobar"].includes(p.estado)) return 0;
  return p.fecha_deseada && p.fecha_deseada < hoy ? diasEntre(p.fecha_deseada, hoy) : 0;
}

/** Clases de la tarjeta atrasada: borde rojo que titila (sin animación si el sistema pide menos movimiento). */
export const CLASE_ATRASADO = "border-red-500/80 bg-red-500/[0.06] motion-safe:animate-titilar";
