// Fecha de entrega de la edición: la pone producción al mandar el video a edición (o se sugiere sola),
// la editora la ve en la tarjeta y ordena por ella, y el cron avisa el día antes y si se pasó.

import { diaSemana, hoyAR, sumarDias } from "@/lib/fecha";
import type { Video } from "./types";

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** `n` días hábiles después de `fecha` (saltea sábados y domingos). */
export function sumarHabiles(fecha: string, n: number): string {
  let f = fecha;
  for (let i = 0; i < n; ) {
    f = sumarDias(f, 1);
    const d = diaSemana(f);
    if (d !== 0 && d !== 6) i++;
  }
  return f;
}

/** Fecha sugerida: un día antes de la que pidió el cliente para publicar, o en 3 días hábiles. */
export function entregaPorDefecto(video: Pick<Video, "fecha_deseada">, hoy = hoyAR()): string {
  const manana = sumarDias(hoy, 1);
  if (video.fecha_deseada) {
    const antes = sumarDias(video.fecha_deseada, -1);
    return antes > manana ? antes : manana;
  }
  return sumarHabiles(hoy, 3);
}

/** Opciones rápidas del selector, en días hábiles. */
export function opcionesEntrega(hoy = hoyAR()): { label: string; fecha: string }[] {
  const uno = sumarHabiles(hoy, 1);
  return [
    // Viernes o fin de semana: el próximo hábil es el lunes.
    { label: uno === sumarDias(hoy, 1) ? "Mañana" : "El lunes", fecha: uno },
    { label: "En 2 días hábiles", fecha: sumarHabiles(hoy, 2) },
    { label: "En 3 días hábiles", fecha: sumarHabiles(hoy, 3) },
  ];
}

/** "vie 9/10" */
export const fechaEntregaCorta = (fecha: string) => {
  const [, m, d] = fecha.split("-").map(Number);
  return `${DIAS[diaSemana(fecha)]} ${d}/${m}`;
};

export type TonoEntrega = "ok" | "pronto" | "tarde";

/** Cómo viene la entrega: atrasada, hoy/mañana, o con tiempo. */
export function estadoEntrega(fecha: string, hoy = hoyAR()): { tono: TonoEntrega; texto: string } {
  if (fecha < hoy) {
    const dias = Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${fecha}T12:00:00Z`)) / 86_400_000);
    return { tono: "tarde", texto: `Atrasado ${dias} día${dias === 1 ? "" : "s"} (era el ${fechaEntregaCorta(fecha)})` };
  }
  if (fecha === hoy) return { tono: "pronto", texto: "Entregar hoy" };
  if (fecha === sumarDias(hoy, 1)) return { tono: "pronto", texto: "Entregar mañana" };
  return { tono: "ok", texto: `Entregar el ${fechaEntregaCorta(fecha)}` };
}

export const CLASE_TONO: Record<TonoEntrega, string> = {
  ok: "bg-muted text-muted-foreground",
  pronto: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  tarde: "bg-destructive/15 text-destructive",
};

/** Para ordenar: lo que hay que entregar antes, primero (sin fecha, al final). */
export const ordenEntrega = (a: Pick<Video, "entrega_edicion">, b: Pick<Video, "entrega_edicion">) =>
  (a.entrega_edicion ?? "9999").localeCompare(b.entrega_edicion ?? "9999");
