import type { Project } from "@/integrations/firebase/types";
import type { PlanRedes, Video } from "./types";

export const PLANES = "planes_redes";

export interface PlanEfectivo {
  plan: PlanRedes | null;
  nombre: string;
  videosMes: number;
  precioMensual: number;
  precioVideoExtra: number;
}

/** Plan del cliente con los ajustes puntuales aplicados. */
export function planDe(project: Project | undefined, planes: PlanRedes[]): PlanEfectivo {
  const plan = planes.find((p) => p.id === project?.plan_redes_id) ?? null;
  const o = project?.plan_redes_override ?? {};
  return {
    plan,
    nombre: plan?.nombre ?? "Sin plan",
    videosMes: o.videos_mes ?? plan?.videos_mes ?? 0,
    precioMensual: o.precio_mensual ?? plan?.precio_mensual ?? 0,
    precioVideoExtra: o.precio_video_extra ?? plan?.precio_video_extra ?? 0,
  };
}

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
