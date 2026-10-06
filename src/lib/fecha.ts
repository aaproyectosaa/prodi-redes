// Fechas siempre en hora de Argentina (UTC-3), sin importar la zona del dispositivo.
// Los timestamps se guardan como instantes ISO UTC; las fechas "YYYY-MM-DD" son días
// de calendario y se operan como texto (nunca new Date("YYYY-MM-DD") + getters locales).

export const ZONA = "America/Argentina/Buenos_Aires";

type Entrada = Date | string | number;

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const partes = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Instante o "YYYY-MM-DD" → Date. Las fechas sin hora se anclan al mediodía de AR. */
export function aDate(x: Entrada): Date {
  if (x instanceof Date) return x;
  if (typeof x === "string" && SOLO_FECHA.test(x)) return new Date(`${x}T12:00:00-03:00`);
  return new Date(x);
}

/** Año, mes, día, hora y minuto del instante, en hora de AR. */
export function partesAR(x: Entrada = new Date()) {
  const p: Record<string, string> = {};
  for (const { type, value } of partes.formatToParts(aDate(x))) p[type] = value;
  return { anio: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute };
}

/** "YYYY-MM-DD" del instante en AR ("" si no es válido). */
export function fechaAR(x: Entrada = new Date()): string {
  const d = aDate(x);
  if (isNaN(d.getTime())) return "";
  const p = partesAR(d);
  return `${p.anio}-${p.mes}-${p.dia}`;
}

/** Hoy en AR: "YYYY-MM-DD". */
export const hoyAR = (): string => fechaAR(new Date());

/** Mes en AR: "YYYY-MM". */
export const mesAR = (x: Entrada = new Date()): string => fechaAR(x).slice(0, 7);

/** Día del mes (1-31) en AR. */
export const diaAR = (x: Entrada = new Date()): number => Number(fechaAR(x).slice(8, 10));

/** Días que tiene un mes "YYYY-MM". */
export function diasDelMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Día de la semana de un "YYYY-MM-DD" (0 = domingo). */
export function diaSemana(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "YYYY-MM-DD" + n días. */
export function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "YYYY-MM" o "YYYY-MM-DD" + n meses. Con día, se ajusta al último del mes (31 → 30/28). */
export function sumarMeses(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const mes = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  if (fecha.length <= 7) return mes;
  return `${mes}-${String(Math.min(d, diasDelMes(mes))).padStart(2, "0")}`;
}

/** Formatea en es-AR siempre con la zona de AR. "—" si no es válido. */
export function formatearFecha(x: Entrada | null | undefined, opciones: Intl.DateTimeFormatOptions = {}): string {
  if (x === null || x === undefined || x === "") return "—";
  const d = aDate(x);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", { ...opciones, timeZone: ZONA }).format(d);
}

/** Instante → valor de <input type="datetime-local"> en hora de AR. */
export function aInputAR(x: Entrada = new Date()): string {
  const p = partesAR(x);
  return `${p.anio}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}`;
}

/** Valor de <input type="datetime-local"> (hora de AR) → instante ISO UTC. */
export function desdeInputAR(v: string): string {
  return new Date(`${v.length === 16 ? `${v}:00` : v}-03:00`).toISOString();
}
