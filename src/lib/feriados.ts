// Días especiales de Argentina para los calendarios: feriados nacionales y fechas comerciales (efemérides que
// sirven para planificar videos y piezas). Se calculan solos para cualquier año.
//
// Feriados: los inamovibles, Carnaval y Semana Santa (dependen de la Pascua) y los trasladables con la regla de
// la Ley 27.399 (martes y miércoles pasan al lunes anterior; jueves y viernes, al lunes siguiente). Los "días
// puente" que el Gobierno define cada año no se pueden calcular: no están.

export type TipoDia = "feriado" | "efemeride";
export interface DiaEspecial {
  /** YYYY-MM-DD */
  fecha: string;
  nombre: string;
  tipo: TipoDia;
  /** Idea corta para contenido (solo efemérides). */
  idea?: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fecha = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const masDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function pascua(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return fecha(y, mes, dia);
}

/** Feriado trasladable: martes/miércoles → lunes anterior; jueves/viernes → lunes siguiente. */
function trasladable(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 2) return masDias(d, -1);
  if (dow === 3) return masDias(d, -2);
  if (dow === 4) return masDias(d, 4);
  if (dow === 5) return masDias(d, 3);
  return d;
}

/** El n-ésimo día de la semana (0 = domingo) de un mes. */
function enesimo(y: number, m: number, dow: number, n: number): Date {
  const primero = fecha(y, m, 1);
  const delta = (dow - primero.getUTCDay() + 7) % 7;
  return masDias(primero, delta + (n - 1) * 7);
}

const cache = new Map<number, DiaEspecial[]>();

export function diasEspeciales(y: number): DiaEspecial[] {
  const hit = cache.get(y);
  if (hit) return hit;
  const p = pascua(y);
  const f = (d: Date, nombre: string): DiaEspecial => ({ fecha: iso(d), nombre, tipo: "feriado" });
  const e = (d: Date, nombre: string, idea: string): DiaEspecial => ({ fecha: iso(d), nombre, tipo: "efemeride", idea });
  // Black Friday: el viernes después del cuarto jueves de noviembre.
  const blackFriday = masDias(enesimo(y, 11, 4, 4), 1);
  const lista: DiaEspecial[] = [
    f(fecha(y, 1, 1), "Año Nuevo"),
    f(masDias(p, -48), "Carnaval"),
    f(masDias(p, -47), "Carnaval"),
    f(fecha(y, 3, 24), "Día de la Memoria"),
    f(fecha(y, 4, 2), "Malvinas"),
    f(masDias(p, -3), "Jueves Santo (no laborable)"),
    f(masDias(p, -2), "Viernes Santo"),
    f(fecha(y, 5, 1), "Día del Trabajador"),
    f(fecha(y, 5, 25), "Revolución de Mayo"),
    f(trasladable(fecha(y, 6, 17)), "Paso a la Inmortalidad de Güemes"),
    f(fecha(y, 6, 20), "Día de la Bandera"),
    f(fecha(y, 7, 9), "Día de la Independencia"),
    f(trasladable(fecha(y, 8, 17)), "Paso a la Inmortalidad de San Martín"),
    f(trasladable(fecha(y, 10, 12)), "Día de la Diversidad Cultural"),
    f(trasladable(fecha(y, 11, 20)), "Día de la Soberanía Nacional"),
    f(fecha(y, 12, 8), "Inmaculada Concepción"),
    f(fecha(y, 12, 25), "Navidad"),
    // Fechas comerciales (no son feriados): sirven para planificar contenido.
    e(fecha(y, 2, 14), "San Valentín", "Regalos, promos para parejas, cenas"),
    e(fecha(y, 3, 8), "Día de la Mujer", "Contenido de reconocimiento, sin vender de más"),
    e(p, "Pascuas", "Huevos, roscas, horarios del fin de semana largo"),
    e(enesimo(y, 6, 0, 3), "Día del Padre", "Regalos para papá, combos, promos"),
    e(fecha(y, 7, 20), "Día del Amigo", "Juntadas, combos para compartir, sorteos"),
    e(enesimo(y, 8, 0, 3), "Día del Niño", "Juguetes, salidas, promos familiares"),
    e(fecha(y, 9, 11), "Día del Maestro", "Saludo a docentes"),
    e(fecha(y, 9, 21), "Día de la Primavera y del Estudiante", "Salidas, colores, juventud"),
    e(enesimo(y, 10, 0, 3), "Día de la Madre", "La fecha más fuerte del año para regalos"),
    e(blackFriday, "Black Friday", "Descuentos fuertes por 1 o 3 días"),
    e(fecha(y, 12, 24), "Nochebuena", "Horarios, saludos, últimos regalos"),
    e(fecha(y, 12, 31), "Fin de año", "Saludo, balance del año, horarios"),
  ];
  lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
  cache.set(y, lista);
  return lista;
}

/** Días especiales de una fecha (puede haber más de uno). */
export function especialesDe(fechaISO: string): DiaEspecial[] {
  return diasEspeciales(Number(fechaISO.slice(0, 4))).filter((d) => d.fecha === fechaISO);
}
