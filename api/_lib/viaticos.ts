// Viáticos de filmación: si se filma fuera de Reconquista, se cobra el viaje por zona (precio fijo).
// Lo usan el servidor (cobra) y las pantallas (muestran el total antes de pagar): la cuenta es la misma.
//
// - Reconquista y alrededores (hasta 15 km: Avellaneda, Puerto Reconquista): sin cargo.
// - Hasta 100 km (Santa Fe): cada localidad tiene su precio = salida + $ por km (redondeado a $500), o el que se le
//   ponga a mano en Ajustes (app_settings/redes.viaticos). Sin nada cargado, se usa el sugerido.
// - Más lejos, del otro lado del río (Corrientes) o una localidad que no está en la lista: se coordina aparte.
// Se cobra por jornada: si ya está pago el viaje a esa localidad para un video que todavía no se filmó, no se vuelve a cobrar.

import { LOCALIDADES, RECONQUISTA, type LocalidadViatico } from "./localidades";

export { LOCALIDADES, RECONQUISTA, type LocalidadViatico };

export const SIN_CARGO_KM = 15;
export const LOCALIDAD_BASE = "Reconquista";

export type ZonaViatico = "sin_cargo" | "hasta_80" | "hasta_100" | "cotizar";

export const ZONA_TEXTO: Record<ZonaViatico, string> = {
  sin_cargo: "Reconquista y alrededores",
  hasta_80: "Hasta 80 km",
  hasta_100: "Hasta 100 km",
  cotizar: "Más lejos o cruzando el río",
};

/** Cómo se cobra el viaje (Ajustes → Viáticos). */
export interface MontosViatico {
  /** Lo fijo por salir a filmar fuera de Reconquista. */
  salida?: number | null;
  /** Lo que se suma por cada km de distancia (cubre ida y vuelta y el tiempo del equipo). */
  por_km?: number | null;
  /** Precio puesto a mano para una localidad (pisa la cuenta). */
  por_localidad?: Record<string, number> | null;
}

/** Sugerido de arranque (Prodi, oct. 2026): salida $10.000 + $600 por km. Se cambia en Ajustes. */
export const VIATICO_SUGERIDO = { salida: 10_000, por_km: 600 };

/** Precio por distancia: salida + $ por km, redondeado a $500. */
export function precioPorDistancia(montos: MontosViatico | null | undefined, km: number): number {
  const salida = Number(montos?.salida ?? VIATICO_SUGERIDO.salida) || 0;
  const porKm = Number(montos?.por_km ?? VIATICO_SUGERIDO.por_km) || 0;
  return Math.max(0, Math.round((salida + porKm * km) / 500) * 500);
}

/** Cómo queda el viático de un video. */
export interface ViaticoVideo {
  localidad: string;
  km: number | null;
  zona: ZonaViatico;
  /** Lo que se cobra (0 sin cargo; null = se coordina aparte). */
  monto: number | null;
  /**
   * sin_cargo · cubierto (ya está pago el viaje a esa localidad para la misma jornada) · pendiente (falta pagarlo) ·
   * pagado · cotizar (lo arregla producción con el cliente).
   */
  estado: "sin_cargo" | "cubierto" | "pendiente" | "pagado" | "cotizar";
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function buscarLocalidad(nombre: string | null | undefined): LocalidadViatico | null {
  const q = norm(String(nombre ?? ""));
  if (!q) return null;
  return LOCALIDADES.find((l) => norm(l.n) === q) ?? null;
}

export function zonaDe(l: LocalidadViatico | null): ZonaViatico {
  if (!l || l.p !== "Santa Fe") return "cotizar";
  if (l.km <= SIN_CARGO_KM) return "sin_cargo";
  if (l.km <= 80) return "hasta_80";
  if (l.km <= 100) return "hasta_100";
  return "cotizar";
}

/** Videos (de este cliente) con el viaje a esa localidad ya pago y todavía sin filmar: van en la misma jornada. */
export function viajeYaPago(
  videos: { proyecto_id?: unknown; etapa?: unknown; viatico?: { localidad?: unknown; estado?: unknown } | null }[],
  proyectoId: string,
  localidad: string
): boolean {
  const q = norm(localidad);
  return videos.some(
    (v) =>
      v.proyecto_id === proyectoId &&
      (v.etapa === "planificado" || v.etapa === "agendado") &&
      v.viatico?.estado === "pagado" &&
      norm(String(v.viatico.localidad ?? "")) === q
  );
}

/** El viático de filmar en esa localidad (sin contar si ya está pago). */
export function viaticoDe(montos: MontosViatico | null | undefined, localidad: string | null | undefined): ViaticoVideo {
  const nombre = String(localidad ?? "").trim().slice(0, 80) || LOCALIDAD_BASE;
  const l = buscarLocalidad(nombre);
  const zona = zonaDe(l);
  const base = { localidad: l?.n ?? nombre, km: l?.km ?? null, zona };
  if (!l || l.n === LOCALIDAD_BASE) return l ? { ...base, monto: 0, estado: "sin_cargo" } : { ...base, monto: null, estado: "cotizar" };
  // Precio puesto a mano para esa localidad: manda (también en los alrededores o cruzando el río).
  const propio = Number(montos?.por_localidad?.[l.n]);
  if (propio > 0) return { ...base, monto: Math.round(propio), estado: "pendiente" };
  if (zona === "sin_cargo") return { ...base, monto: 0, estado: "sin_cargo" };
  if (zona === "cotizar") return { ...base, monto: null, estado: "cotizar" };
  const monto = precioPorDistancia(montos, l.km);
  return monto > 0 ? { ...base, monto, estado: "pendiente" } : { ...base, monto: null, estado: "cotizar" };
}
