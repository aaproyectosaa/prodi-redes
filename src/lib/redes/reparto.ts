// Reparto de lo cobrado por un extra (video extra, filmación de varios videos, pieza aparte o viáticos):
// cuánto entró de verdad (sin la comisión de Mercado Pago), cuánto son viáticos, cuánto le toca a cada uno del
// equipo (lo de su acuerdo por trabajo) y cuánto le queda a Prodi. La parte de cada uno se le paga recién cuando
// Mercado Pago libera la plata. Esos trabajos no cuentan en su pago del mes (se pagan acá, por separado).

import { acuerdoVigente, type ConfigPago } from "./facturacion";
import type { Cobro, PiezaIA, Video } from "./types";

/** Lo que guarda el servidor en el cobro al aprobarse (ver api/_lib/mercadopago.ts detalleDePago). */
export type CobroConMp = Cobro & {
  mp_neto?: number | null;
  mp_comision?: number | null;
  mp_libera_at?: string | null;
  mp_liberado?: boolean;
  pedido?: { viatico?: { monto?: number; estado?: string } | null } | null;
  detalle?: { viaje?: number; items?: { plan: boolean }[] } | null;
};

export type RolReparto = "productor" | "editor" | "pauta" | "diseno";
export const NOMBRE_ROL: Record<RolReparto, string> = { productor: "Producción", editor: "Edición", pauta: "Pauta", diseno: "Diseño" };

export interface ParteEquipo {
  /** Clave única (cobro + persona + trabajo), para marcarla pagada. */
  clave: string;
  uid: string | null;
  rol: RolReparto;
  trabajoId: string;
  titulo: string;
  monto: number;
  /** Por qué es 0: cobra un fijo por mes, o no tiene acuerdo por trabajo. */
  nota?: string;
}

export interface Reparto {
  cobro: CobroConMp;
  mes: string;
  bruto: number;
  comision: number;
  neto: number;
  /** Sin el dato de Mercado Pago todavía: el neto es estimado. */
  estimado: boolean;
  liberaAt: string | null;
  liberado: boolean;
  viaticos: number;
  equipo: ParteEquipo[];
  ganancia: number;
}

/** % de cada video extra para la editora y la productora (Ajustes → reparto_extras), sobre lo que entra sin comisión ni viáticos. */
export interface PctExtras {
  editor: number;
  productor: number;
}
export const leerPctExtras = (s: { reparto_extras?: Partial<PctExtras> } | null | undefined): PctExtras => ({
  editor: Math.max(0, Math.min(100, Number(s?.reparto_extras?.editor) || 0)),
  productor: Math.max(0, Math.min(100, Number(s?.reparto_extras?.productor) || 0)),
});

/** Tipos de cobro que se reparten (el abono mensual va por la facturación del mes). */
export const SE_REPARTE: Cobro["tipo"][] = ["video_extra", "jornada", "pieza_ia", "viatico"];

const mesDe = (c: Cobro) => (/^\d{4}-\d{2}$/.test(c.ref_id) ? c.ref_id : (c.pagado_at ?? c.created_at).slice(0, 7));

/** Los videos y piezas que pagó este cobro (solo los extra: en una filmación de varios, los que entraban en el plan no). */
export function trabajosDeCobro(c: CobroConMp, videos: Video[], piezas: PiezaIA[]): { videos: Video[]; piezas: PiezaIA[] } {
  if (c.tipo === "pieza_ia") return { videos: [], piezas: piezas.filter((p) => p.id === c.ref_id) };
  if (c.tipo === "video_extra") return { videos: videos.filter((v) => v.id === `pedido_${c.id}`), piezas: [] };
  if (c.tipo === "jornada") {
    const items = c.detalle?.items ?? [];
    return { videos: videos.filter((v) => items.some((it, i) => !it.plan && v.id === `pedido_${c.id}_${i}`)), piezas: [] };
  }
  return { videos: [], piezas: [] };
}

/** Ids de videos y piezas que se pagan como extra (no cuentan en el pago del mes). */
export function idsExtras(cobros: CobroConMp[], videos: Video[], piezas: PiezaIA[]): Set<string> {
  const ids = new Set<string>();
  for (const c of cobros) {
    if (c.estado !== "aprobado" || !SE_REPARTE.includes(c.tipo)) continue;
    const t = trabajosDeCobro(c, videos, piezas);
    t.videos.forEach((v) => ids.add(v.id));
    t.piezas.forEach((p) => ids.add(p.id));
  }
  return ids;
}

/** Cuánto le toca por un trabajo de ese cliente en ese mes, según su forma de pago. */
function porTrabajo(cfg: ConfigPago | undefined, proyectoId: string, mes: string): { monto: number; nota?: string } {
  if (!cfg) return { monto: 0, nota: "sin forma de pago cargada" };
  if (cfg.modo === "acuerdos") {
    const ac = acuerdoVigente(cfg.acuerdos, proyectoId, mes);
    const m = ac ? Number(ac.por_unidad) || 0 : Number(cfg.por_unidad) || 0;
    return m ? { monto: m } : { monto: 0, nota: ac ? "su acuerdo con este cliente es fijo" : "sin acuerdo con este cliente" };
  }
  if (cfg.modo === "por_unidad" || cfg.modo === "mixto") {
    const m = Number(cfg.por_unidad) || 0;
    return m ? { monto: m } : { monto: 0, nota: "sin monto por trabajo" };
  }
  return { monto: 0, nota: "cobra un fijo por mes" };
}

/** Quién hizo la pieza: la que se la mandó al cliente (o, si no, la diseñadora del cliente). */
const disenadoraDe = (p: PiezaIA, equipoDiseno: string[]) =>
  [...(p.historial ?? [])].reverse().find((h) => h.accion.startsWith("Enviada al cliente") || h.accion.includes("revisión interna"))?.by ?? equipoDiseno[0] ?? null;

export function repartoDe(
  c: CobroConMp,
  ctx: { videos: Video[]; piezas: PiezaIA[]; pagos: Record<string, ConfigPago>; equipoDiseno?: string[]; pct?: PctExtras }
): Reparto {
  const mes = mesDe(c);
  const bruto = Number(c.monto) || 0;
  const tieneMp = c.mp_neto != null;
  const comision = tieneMp ? Number(c.mp_comision) || Math.max(0, bruto - Number(c.mp_neto)) : 0;
  const neto = tieneMp ? Number(c.mp_neto) : bruto;
  const viaticos =
    c.tipo === "viatico"
      ? bruto
      : c.tipo === "jornada"
        ? Number(c.detalle?.viaje) || 0
        : c.tipo === "video_extra"
          ? Number(c.pedido?.viatico?.monto) || 0
          : 0;
  const { videos, piezas } = trabajosDeCobro(c, ctx.videos, ctx.piezas);
  const equipo: ParteEquipo[] = [];
  const sumar = (uid: string | null, rol: RolReparto, trabajoId: string, titulo: string, proyectoId: string) => {
    const p = uid ? porTrabajo(ctx.pagos[uid], proyectoId, mes) : { monto: 0, nota: "sin asignar" };
    equipo.push({ clave: `${c.id}_${uid ?? "nadie"}_${trabajoId}_${rol}`, uid, rol, trabajoId, titulo, ...p });
  };
  // Videos extra: la editora y la productora se llevan su % de lo que entra por cada video (sin comisión ni viáticos).
  const pct = ctx.pct ?? { editor: 0, productor: 0 };
  const basePorVideo = videos.length ? Math.max(0, neto - viaticos) / videos.length : 0;
  const porPct = (uid: string | null, rol: "editor" | "productor", v: Video) => {
    const p = pct[rol];
    equipo.push({
      clave: `${c.id}_${uid ?? "nadie"}_${v.id}_${rol}`,
      uid,
      rol,
      trabajoId: v.id,
      titulo: v.titulo,
      monto: uid ? Math.round((basePorVideo * p) / 100) : 0,
      nota: !uid ? "sin asignar" : !p ? "poné el % en Ajustes → Reparto de los videos extra" : `${p}% de ${formatoPesos(basePorVideo)}`,
    });
  };
  for (const v of videos) {
    // La productora cobra si lo filmamos nosotros (no si lo filma el cliente o se hace con material ya cargado).
    const filmado = !v.filma_cliente && v.material_base?.tipo !== "existente" && v.material_base?.tipo !== "cliente";
    if (filmado) porPct(v.productor_id, "productor", v);
    porPct(v.editor_id, "editor", v);
  }
  for (const p of piezas) sumar(disenadoraDe(p, ctx.equipoDiseno ?? []), "diseno", p.id, p.producto || p.pedido.slice(0, 60), p.proyecto_id);
  const aEquipo = equipo.reduce((a, e) => a + e.monto, 0);
  const liberaAt = c.mp_libera_at ?? null;
  return {
    cobro: c,
    mes,
    bruto,
    comision,
    neto,
    estimado: !tieneMp,
    liberaAt,
    liberado: !!c.mp_liberado || (!!liberaAt && new Date(liberaAt).getTime() <= Date.now()),
    viaticos,
    equipo,
    ganancia: Math.round((neto - viaticos - aEquipo) * 100) / 100,
  };
}

const formatoPesos = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
