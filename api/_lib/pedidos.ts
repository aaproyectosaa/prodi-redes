// Pedido de video del cliente: si entra en el plan del mes se crea directo;
// si se pasa del límite se cotiza y se cobra con Mercado Pago (el video se crea al acreditarse el pago).

export interface PedidoVideo {
  titulo: string;
  idea: string | null;
  objetivo: string | null;
  /** Para cuándo lo quiere publicado (YYYY-MM-DD) o null si no tiene fecha. */
  fecha_deseada?: string | null;
  pedido_por: string;
}

/** Documento del video nuevo, igual que lo crea producción al planificar. */
export function videoDesdePedido(proyectoId: string, team: Record<string, string[]>, mes: string, p: PedidoVideo, nota: string) {
  const ts = new Date().toISOString();
  return {
    proyecto_id: proyectoId,
    titulo: p.titulo,
    idea: p.idea,
    objetivo: p.objetivo,
    referencias: null,
    mes,
    extra: false,
    etapa: "planificado",
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
    historial: [{ at: ts, by: p.pedido_por, accion: nota, nota: null }],
    created_at: ts,
    created_by: p.pedido_por,
    updated_at: ts,
  };
}
