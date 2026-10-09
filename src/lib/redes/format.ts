import { MONTO_OCULTO, montosOcultos } from "@/lib/privacidad";
import { fechaAR, formatearFecha, mesAR, sumarMeses } from "@/lib/fecha";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Mes actual (o del instante dado) en formato YYYY-MM, hora de AR. */
export function mesActual(d: Date | string | number = new Date()): string {
  return mesAR(d);
}

export { sumarMeses };

/** "2026-10" → "Octubre 2026" */
export function mesLabel(mes: string, opts: { corto?: boolean } = {}): string {
  const [y, m] = mes.split("-").map(Number);
  const nombre = MESES[(m || 1) - 1] ?? "";
  const cap = nombre.charAt(0).toUpperCase() + nombre.slice(1);
  return opts.corto ? `${cap.slice(0, 3)} ${String(y).slice(2)}` : `${cap} ${y}`;
}

export function formatARS(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (montosOcultos()) return MONTO_OCULTO;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatNum(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n);
}

/** "2026-10-14" → "mar 14 oct" */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatearFecha(iso, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatearFecha(iso, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function hace(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

/** YYYY-MM-DD de hoy (o del instante dado) en hora de AR. */
export function hoyISO(d: Date | string | number = new Date()): string {
  return fechaAR(d);
}

/** 8 → "0:08", 75 → "1:15" */
export function segundos(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
