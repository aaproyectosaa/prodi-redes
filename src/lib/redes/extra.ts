import type { Video } from "./types";

/**
 * ¿Es un video extra (pagado aparte, fuera del plan)? Los nuevos traen la marca; los pagados antes de la marca se
 * reconocen por su historial ("video extra").
 */
export const esExtra = (v: Pick<Video, "extra" | "extra_pagado" | "historial">) =>
  !!v.extra || !!v.extra_pagado || (v.historial ?? []).some((h) => /\(video extra\)/i.test(h.accion));

/** Lo sube el cliente: no lo publicamos ni pautamos nosotros (al aprobarlo se le entrega). */
export const loSubeElCliente = (v: Pick<Video, "sube_cliente" | "publicacion">) => !!v.sube_cliente || !!v.publicacion?.sube_cliente;
