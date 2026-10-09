import type { Project } from "@/integrations/firebase/types";
import type { PlanRedes, Video } from "./types";

export const PLANES = "planes_redes";

/** Para dónde es un video extra: el precio cambia (reel de Instagram/Facebook, TikTok o YouTube). */
export type PlataformaExtra = "meta" | "tiktok" | "youtube";
export const PLATAFORMAS_EXTRA: { v: PlataformaExtra; label: string }[] = [
  { v: "meta", label: "Instagram / Facebook" },
  { v: "tiktok", label: "TikTok" },
  { v: "youtube", label: "YouTube" },
];

export const REDES_PLAN = [
  { k: "instagram", label: "Instagram" },
  { k: "facebook", label: "Facebook" },
  { k: "tiktok", label: "TikTok" },
  { k: "youtube", label: "YouTube" },
] as const;

export interface PlanEfectivo {
  plan: PlanRedes | null;
  nombre: string;
  videosMes: number;
  precioMensual: number;
  /** Video extra de Instagram/Facebook (el de siempre). */
  precioVideoExtra: number;
  /** Video extra por plataforma (TikTok y YouTube caen al de Instagram/Facebook si no tienen uno propio). */
  precioExtra: Record<PlataformaExtra, number>;
  /** Redes en las que trabajamos (nombres). */
  redes: string[];
  pauta: { incluida: boolean; monto: number | null } | null;
  administracionRedes: boolean;
}

/** Plan del cliente con los ajustes puntuales aplicados. */
export function planDe(project: Project | undefined, planes: PlanRedes[]): PlanEfectivo {
  const plan = planes.find((p) => p.id === project?.plan_redes_id) ?? null;
  const o = project?.plan_redes_override ?? {};
  const meta = o.precio_video_extra ?? plan?.precio_video_extra ?? 0;
  return {
    plan,
    // Sin plan de la lista pero con lo suyo cargado (videos, abono…): es un plan a medida.
    nombre: plan?.nombre ?? ([o.videos_mes, o.precio_mensual, o.piezas_mes, o.precio_video_extra].some((v) => v != null) ? "Personalizado" : "Sin plan"),
    videosMes: o.videos_mes ?? plan?.videos_mes ?? 0,
    precioMensual: o.precio_mensual ?? plan?.precio_mensual ?? 0,
    precioVideoExtra: meta,
    precioExtra: { meta, tiktok: o.precio_extra_tiktok ?? meta, youtube: o.precio_extra_youtube ?? meta },
    redes: REDES_PLAN.filter((r) => o.redes?.[r.k]).map((r) => r.label),
    pauta: o.pauta || project?.produccion?.servicio === "solo_pauta" ? { incluida: !!o.pauta?.incluida || project?.produccion?.servicio === "solo_pauta", monto: o.pauta?.monto ?? null } : null,
    administracionRedes: !!o.administracion_redes,
  };
}

/** ¿Los precios del video extra cambian según la plataforma? (si no, no hace falta preguntar). */
export const extraPorPlataforma = (p: PlanEfectivo) => new Set(Object.values(p.precioExtra)).size > 1;

export interface UsoPlan {
  /** Videos que incluye el plan este mes + extras comprados. */
  cupo: number;
  incluidos: number;
  creditosExtra: number;
  /** Videos del mes que descuentan del cupo. */
  usados: number;
  publicados: number;
  disponibles: number;
  excedido: number;
  pct: number;
}

export function usoPlan(
  project: Project | undefined,
  planes: PlanRedes[],
  videos: Video[],
  mes: string
): UsoPlan {
  const { videosMes } = planDe(project, planes);
  const creditosExtra = project?.creditos_extra?.[mes] ?? 0;
  const delMes = videos.filter((v) => v.proyecto_id === project?.id && v.mes === mes);
  const usados = delMes.filter((v) => !v.extra).length;
  const cupo = videosMes + creditosExtra;
  return {
    cupo,
    incluidos: videosMes,
    creditosExtra,
    usados,
    publicados: delMes.filter((v) => v.etapa === "publicado").length,
    disponibles: Math.max(0, cupo - usados),
    excedido: Math.max(0, usados - cupo),
    pct: cupo > 0 ? Math.min(100, Math.round((usados / cupo) * 100)) : usados > 0 ? 100 : 0,
  };
}
