// Pedido de video del cliente: si entra en el plan del mes se crea directo;
// si se pasa del límite se cotiza y se cobra con Mercado Pago (el video se crea al acreditarse el pago).

import type { Data } from "./db";

export interface PedidoVideo {
  titulo: string;
  idea: string | null;
  objetivo: string | null;
  /** Para cuándo lo quiere publicado (YYYY-MM-DD) o null si no tiene fecha. */
  fecha_deseada?: string | null;
  pedido_por: string;
  /** Lo filma el cliente y nos manda el material: arranca esperando su material (sin rodaje). */
  filma_cliente?: boolean;
}

export type QuienFilma = "prodi" | "cliente" | "ambos";

/** Quién filma los videos del cliente (projects.produccion.filma, por defecto Prodi). */
export function quienFilma(proyecto: Data | undefined | null): QuienFilma {
  const f = (proyecto?.produccion as { filma?: unknown } | undefined)?.filma;
  return f === "cliente" || f === "ambos" ? f : "prodi";
}

/**
 * ¿Este video lo filma el cliente? Si filma siempre él, sí; si filman los dos, lo que eligió
 * (sin elección, lo filmamos nosotros); si filma Prodi, no.
 */
export function filmaElCliente(proyecto: Data | undefined | null, eleccion?: boolean | null): boolean {
  const f = quienFilma(proyecto);
  return f === "cliente" || (f === "ambos" && eleccion === true);
}

/** Hasta edición el cliente puede mandar material (después ya está editado). Igual en src/lib/redes/etapas.ts. */
export const ETAPAS_CON_MATERIAL = ["planificado", "agendado", "material_cliente", "edicion"];

/** ¿El cliente puede subir material a este video? */
export function aceptaMaterialCliente(video: Data, proyecto: Data | undefined | null): boolean {
  if (!ETAPAS_CON_MATERIAL.includes(String(video.etapa))) return false;
  return video.filma_cliente === true || video.etapa === "material_cliente" || quienFilma(proyecto) !== "prodi";
}

/** Documento del video nuevo, igual que lo crea producción al planificar. */
export function videoDesdePedido(proyectoId: string, team: Record<string, string[]>, mes: string, p: PedidoVideo, nota: string) {
  const ts = new Date().toISOString();
  const filma = p.filma_cliente === true;
  return {
    proyecto_id: proyectoId,
    titulo: p.titulo,
    idea: p.idea,
    objetivo: p.objetivo,
    referencias: null,
    mes,
    extra: false,
    // Lo filma el cliente: no lleva rodaje, espera su material.
    etapa: filma ? "material_cliente" : "planificado",
    etapa_desde: ts,
    rodaje_id: null,
    productor_id: team.productor?.[0] ?? null,
    editor_id: team.editor?.[0] ?? null,
    pauta_id: team.pauta?.[0] ?? null,
    attachments_crudo: [],
    attachments_finalizado: [],
    copy: null,
    feedback_interno: null,
    feedback_cliente: null,
    rondas: 0,
    cliente_rating: null,
    publicacion: null,
    pauta: null,
    resultados: null,
    meta: null,
    pedido_cliente: true,
    fecha_deseada: p.fecha_deseada ?? null,
    filma_cliente: filma,
    historial: [{ at: ts, by: p.pedido_por, accion: filma ? `${nota} · lo filma el cliente` : nota, nota: null }],
    created_at: ts,
    created_by: p.pedido_por,
    updated_at: ts,
  };
}
