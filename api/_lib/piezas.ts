// Piezas gráficas: formatos, precios y armado del pedido (lo usan el servidor y la demo).
//
// El cliente pide la pieza (qué es, si es para vender o para comunicar, qué tiene que decir).
// Si entra en las piezas de su plan del mes se crea directo; si no, se paga con Mercado Pago.
// La diseñadora (rol "diseno") la arma con la IA o la sube, el cliente la aprueba o pide cambios.

export type Ratio = "1:1" | "4:5" | "9:16" | "16:9" | "2:3" | "3:4" | "21:9";

export const FORMATOS_PIEZA: Record<string, { label: string; ratio: Ratio; uso: string; impresion: boolean }> = {
  cuadrado: { label: "Posteo cuadrado", ratio: "1:1", uso: "posteo cuadrado de Instagram/Facebook", impresion: false },
  posteo_vertical: { label: "Posteo vertical", ratio: "4:5", uso: "posteo vertical de Instagram", impresion: false },
  vertical: { label: "Historia", ratio: "9:16", uso: "historia o reel de Instagram", impresion: false },
  horizontal: { label: "Pantalla o portada", ratio: "16:9", uso: "pantalla del local, portada o video horizontal", impresion: false },
  afiche: { label: "Afiche o flyer", ratio: "2:3", uso: "afiche o flyer impreso (A4/A3)", impresion: true },
  vidriera: { label: "Cartel o menú", ratio: "3:4", uso: "cartel de vidriera, mostrador o menú impreso", impresion: true },
  banner: { label: "Banner o lona", ratio: "21:9", uso: "banner, lona o marquesina para el frente del local", impresion: true },
};

export type EnfoquePieza = "comercial" | "institucional";

type AjusteFormato = { precio?: number | null; cupo?: number | null };
const ajusteDe = (settings: Record<string, unknown>, formato: string): AjusteFormato =>
  ((settings.formatos_pieza as Record<string, AjusteFormato> | undefined) ?? {})[formato] ?? {};

/** Precio fuera del plan: el de ese tipo de pieza (Ajustes) o, si no tiene, el general de redes / impresión. */
export function precioPieza(settings: Record<string, unknown>, formato: string): number {
  const propio = Number(ajusteDe(settings, formato).precio);
  if (propio > 0) return propio;
  const imp = FORMATOS_PIEZA[formato]?.impresion;
  const redes = Number(settings.precio_pieza_ia ?? 15000);
  return imp ? Number(settings.precio_pieza_impresion ?? redes) : redes;
}

/** Lo que entra en el plan, si no se cambió en Ajustes: los posteos e historias de Instagram y Facebook. */
export const EN_PLAN_DEFAULT = ["cuadrado", "posteo_vertical", "vertical"];

/**
 * Cuántas piezas del plan ocupa ese tipo (no es lo mismo un posteo que un banner). 0 = no entra en el plan,
 * se paga aparte (cartelería y otros diseños).
 */
export function cupoPieza(settings: Record<string, unknown>, formato: string): number {
  // Lo guardado antes de que existiera "0 = aparte" (versión 1) ponía 1 en todo: no se tiene en cuenta.
  const v = Number(settings.formatos_pieza_v) >= 2 ? ajusteDe(settings, formato).cupo : null;
  if (v == null || isNaN(Number(v))) return EN_PLAN_DEFAULT.includes(formato) ? 1 : 0;
  return Math.max(0, Math.round(Number(v)));
}

export interface PedidoPieza {
  formato: string;
  enfoque: EnfoquePieza;
  pedido: string;
  texto_en_pieza: string | null;
  producto: string | null;
  oferta: string | null;
  cta: string | null;
  fecha_deseada?: string | null;
}

const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Valida y limpia lo que manda el navegador. Devuelve un mensaje de error o el pedido. */
export function leerPedidoPieza(b: Record<string, unknown>): PedidoPieza | string {
  const formato = String(b.formato ?? "");
  if (!FORMATOS_PIEZA[formato]) return "Elegí qué pieza necesitás";
  const enfoque: EnfoquePieza = b.enfoque === "institucional" ? "institucional" : "comercial";
  const p: PedidoPieza = {
    formato,
    enfoque,
    pedido: t(b.pedido, 2000),
    texto_en_pieza: t(b.texto_en_pieza, 200) || null,
    producto: t(b.producto, 160) || null,
    oferta: t(b.oferta, 160) || null,
    cta: t(b.cta, 120) || null,
    fecha_deseada: /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha_deseada ?? "")) ? String(b.fecha_deseada) : null,
  };
  if (enfoque === "comercial" && !p.producto && p.pedido.length < 10) return "Contanos qué producto o servicio querés vender";
  if (enfoque === "institucional" && p.pedido.length < 10) return "Contanos qué querés comunicar";
  return p;
}

export function piezaDoc(proyectoId: string, by: string, mes: string, p: PedidoPieza, incluida: boolean, precio: number, cupo = 1) {
  const now = new Date().toISOString();
  return {
    proyecto_id: proyectoId,
    solicitado_por: by,
    ...p,
    mes,
    incluida,
    precio,
    // Piezas del plan que ocupa (las que entran en el plan).
    cupo_usado: incluida ? cupo : 0,
    estado: incluida ? "pagada" : "pendiente_pago",
    cobro_id: null,
    versiones: [],
    attachments_finalizado: [],
    version_aprobada_id: null,
    version_enviada_id: null,
    feedback_cliente: null,
    rondas: 0,
    nota_equipo: null,
    historial: [{ at: now, by, accion: incluida ? "Pedida (entra en el plan)" : "Pedida (falta el pago)", nota: null }],
    created_at: now,
    updated_at: now,
  };
}

/** Lo que la IA tiene que saber del pedido. */
export function briefPieza(pz: Record<string, unknown>): string {
  const lineas = [
    pz.enfoque === "institucional"
      ? "Enfoque: INSTITUCIONAL (comunicar algo de la marca: un saludo, una novedad, un horario, un aviso). Cálida, clara, sin precios ni urgencia de venta."
      : "Enfoque: COMERCIAL (tiene que vender o traer consultas). Producto o beneficio protagonista, la oferta bien visible y un llamado a la acción claro.",
    pz.producto && `Producto o servicio: ${pz.producto}`,
    pz.oferta && `Precio / promo: ${pz.oferta}`,
    pz.cta && `Llamado a la acción: ${pz.cta}`,
    pz.pedido && `Pedido del cliente: ${pz.pedido}`,
    pz.feedback_cliente && `Cambios que pidió el cliente sobre la versión anterior: ${pz.feedback_cliente}`,
  ];
  return lineas.filter(Boolean).join("\n");
}
