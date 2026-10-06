// Fechas en hora de Argentina. Vercel corre en UTC: el día y el mes "de hoy" siempre se sacan de acá.
// Los timestamps se siguen guardando en ISO UTC (toISOString); esto es solo para días y meses del calendario.

export const ZONA = "America/Argentina/Buenos_Aires";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Año, mes (1-12), día, hora y minuto de un instante, en Argentina. */
export function partesAR(d: Date | string | number = new Date()): { y: number; m: number; d: number; h: number; min: number } {
  const t = d instanceof Date ? d : new Date(d);
  const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute) };
}

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * YYYY-MM-DD de un instante (Date o timestamp ISO) en Argentina.
 * Una fecha sola ("2026-10-05") ya es un día del calendario: se devuelve tal cual. Inválida → "".
 */
export function fechaAR(d: Date | string | number = new Date()): string {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = d instanceof Date ? d : new Date(d);
  if (isNaN(t.getTime())) return "";
  const p = partesAR(t);
  return `${p.y}-${dos(p.m)}-${dos(p.d)}`;
}

/** YYYY-MM de un instante en Argentina (por defecto, ahora). */
export function mesAR(d: Date | string | number = new Date()): string {
  return fechaAR(d).slice(0, 7);
}

/** Hoy en Argentina (YYYY-MM-DD). */
export const hoyAR = () => fechaAR(new Date());

/** Suma días a una fecha YYYY-MM-DD (cuenta sobre el calendario, sin zona horaria). */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Suma meses a un YYYY-MM. */
export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}`;
}
