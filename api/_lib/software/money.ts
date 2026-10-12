const AR_TZ = "America/Argentina/Buenos_Aires";

export function money(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

export function money2(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function clampMpFeePct(n: number) {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 1e6) / 1e6;
}

export function chargeNetAmount(amount: number, pct: number) {
  const gross = Number(amount) || 0;
  return Math.round(gross * (1 - clampMpFeePct(pct) / 100) * 100) / 100;
}

export function chargeMpFeeAmount(amount: number, pct: number) {
  const gross = Number(amount) || 0;
  return Math.round((gross - chargeNetAmount(gross, pct)) * 100) / 100;
}

/** "4,19" / "191.624,52" / "191624.52" */
export function parseDecimalInput(raw: string): number | null {
  let s = String(raw || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\$/g, "");
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function formatPctInput(n: number | null | undefined) {
  const v = Number(n || 0);
  if (!v) return "";
  return v.toFixed(6).replace(/\.?0+$/, "").replace(".", ",");
}

export function formatNetInput(n: number | null | undefined) {
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Suma/resta meses a un YYYY-MM. */
export function addMonthsYm(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Mes actual en horario Argentina (YYYY-MM). */
export function yearMonth(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

/**
 * Inicio/fin del mes en Argentina (UTC-3 todo el año).
 * Ej. 2026-07 → 2026-07-01 00:00 ART … 2026-07-31 23:59:59 ART
 */
export function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = new Date(`${ym}-01T00:00:00-03:00`);
  const to = new Date(
    `${ym}-${String(lastDay).padStart(2, "0")}T23:59:59.999-03:00`,
  );
  return { from, to };
}

/** Día civil en Argentina YYYY-MM-DD */
export function arDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Suma/resta días a un YYYY-MM-DD (civil). */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00-03:00`);
  d.setTime(d.getTime() + n * 24 * 60 * 60 * 1000);
  return arDay(d);
}

/** Días civiles entre dos YYYY-MM-DD (puede ser negativo). */
export function daysBetween(fromDay: string, toDay: string) {
  const a = new Date(`${fromDay}T12:00:00-03:00`).getTime();
  const b = new Date(`${toDay}T12:00:00-03:00`).getTime();
  return Math.round((b - a) / 86400000);
}

/** Días que MP retiene el fee, según la cuenta. */
export const FEE_RELEASE_DAYS = 18;

export function feeReleaseOn(paidDay: string) {
  return addDays(paidDay, FEE_RELEASE_DAYS);
}

export function isFeeReleased(paidDay: string, today = arDay()) {
  return feeReleaseOn(paidDay) <= today;
}

export function daysUntilFeeRelease(paidDay: string, today = arDay()) {
  return Math.max(0, daysBetween(today, feeReleaseOn(paidDay)));
}

export function formatArDay(day: string) {
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return `${Number(d)}/${Number(m)}/${y}`;
}

export type StatsPeriod = "today" | "week" | "month" | "year" | "all";

/** Período inmediatamente anterior, para comparar totales. */
export function previousPeriodBounds(
  period: StatsPeriod,
  monthYm = yearMonth(),
): { from: string; to: string } | null {
  if (period === "all") return null;
  if (period === "today") {
    const d = addDays(arDay(), -1);
    return { from: d, to: d };
  }
  if (period === "week") {
    const to = addDays(arDay(), -7);
    return { from: addDays(to, -6), to };
  }
  if (period === "month") {
    const prev = addMonthsYm(monthYm, -1);
    const { from, to } = monthBounds(prev);
    return { from: arDay(from), to: arDay(to) };
  }
  const y = Number(arDay().slice(0, 4)) - 1;
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export function periodBounds(
  period: StatsPeriod,
  monthYm = yearMonth(),
): { from: string | null; to: string | null; label: string } {
  const today = arDay();
  if (period === "today") {
    return { from: today, to: today, label: "Hoy" };
  }
  if (period === "week") {
    return { from: addDays(today, -6), to: today, label: "Últimos 7 días" };
  }
  if (period === "month") {
    const { from, to } = monthBounds(monthYm);
    return {
      from: arDay(from),
      to: arDay(to),
      label: monthYm,
    };
  }
  if (period === "year") {
    const y = today.slice(0, 4);
    return { from: `${y}-01-01`, to: today, label: `Año ${y}` };
  }
  return { from: null, to: null, label: "Todo" };
}

export function paymentsHref(opts: {
  from?: string | null;
  to?: string | null;
  status?: string;
  clientId?: string;
  appId?: string;
}) {
  const p = new URLSearchParams();
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  if (opts.status) p.set("status", opts.status);
  if (opts.clientId) p.set("clientId", opts.clientId);
  if (opts.appId) p.set("appId", opts.appId);
  const q = p.toString();
  return q ? `/payments?${q}` : "/payments";
}

export function subscriptionsHref(opts: {
  from?: string | null;
  to?: string | null;
  status?: string;
  clientId?: string;
  appId?: string;
  kind?: string;
}) {
  const p = new URLSearchParams();
  if (opts.from) p.set("from", opts.from);
  if (opts.to) p.set("to", opts.to);
  if (opts.status) p.set("status", opts.status);
  if (opts.clientId) p.set("clientId", opts.clientId);
  if (opts.appId) p.set("appId", opts.appId);
  if (opts.kind) p.set("kind", opts.kind);
  const q = p.toString();
  return q ? `/suscripciones?${q}` : "/suscripciones";
}

export { AR_TZ };
