// Horario de descanso del equipo: de noche (y los domingos) no les llegan avisos al celular. Lo que entra en ese
// rato queda en Avisos y a la mañana les llega uno solo con el resumen ("Mientras descansabas…").
// Se configura en Ajustes (app_settings/redes → descanso). Lo usan el servidor (push) y la app (aviso de noche).
// No aplica al super admin ni a los clientes.

export interface Descanso {
  activo: boolean;
  /** Hora en que empieza (0–23, hora argentina). */
  desde: number;
  /** Hora en que termina (0–23). */
  hasta: number;
  /** Los domingos, todo el día. */
  domingo: boolean;
}

export const DESCANSO_DEFAULT: Descanso = { activo: true, desde: 20, hasta: 8, domingo: true };

/** Roles a los que se les respeta el descanso (el equipo; no el super admin ni los clientes). */
export const ROLES_CON_DESCANSO = ["productor", "editor", "pauta", "diseno", "administracion", "programador"];

const hora = (v: unknown, def: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : def;
};

export function leerDescanso(settings: { descanso?: unknown } | null | undefined): Descanso {
  const d = (settings?.descanso ?? {}) as Partial<Descanso>;
  return {
    activo: d.activo !== false,
    desde: hora(d.desde, DESCANSO_DEFAULT.desde),
    hasta: hora(d.hasta, DESCANSO_DEFAULT.hasta),
    domingo: d.domingo !== false,
  };
}

/** Hora y día de la semana en Argentina (0 = domingo). */
export function ahoraAR(fecha = new Date()): { hora: number; minuto: number; dia: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour: "numeric", minute: "numeric", weekday: "short", hour12: false }).formatToParts(fecha);
  const val = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { hora: Number(val("hour")) % 24, minuto: Number(val("minute")), dia: dias.indexOf(val("weekday")) };
}

/** ¿Es horario de descanso? (de `desde` a `hasta`, cruzando la medianoche si hace falta; y los domingos). */
export function esHorarioDescanso(d: Descanso, fecha = new Date()): boolean {
  if (!d.activo) return false;
  const { hora: h, dia } = ahoraAR(fecha);
  if (d.domingo && dia === 0) return true;
  if (d.desde === d.hasta) return false;
  return d.desde > d.hasta ? h >= d.desde || h < d.hasta : h >= d.desde && h < d.hasta;
}
