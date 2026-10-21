/* eslint-disable @typescript-eslint/no-explicit-any */
// Propuesta comercial de Prodi (el formato de los presupuestos que manda Lucas): encabezado con el cliente, número,
// lugar, fecha y validez; un párrafo de presentación; y secciones numeradas:
//   · "detalle": qué se hace (una tarjeta por comercio o servicio, con su resumen y viñetas)
//   · "inversion": tabla concepto / detalle / valor (el valor es texto libre: "$220.000", "4% por venta",
//     "$100.000 / mes") con un total destacado opcional y una nota abajo
//   · "condiciones": pago, alcance, desarrollo, baja… (título en negrita + texto)
//   · "texto": un párrafo suelto
// Los precios los pone siempre la persona (la IA deja el valor vacío). Puro: lo usan el servidor y la pantalla.
// En los textos, **así** es negrita.

export interface TarjetaPropuesta {
  id: string;
  titulo: string;
  resumen: string;
  vinetas: string[];
}
export interface FilaInversion {
  id: string;
  concepto: string;
  detalle: string;
  /** Texto libre ("$220.000", "4% por venta"). Vacío: falta poner el precio. */
  valor: string;
}
export interface CondicionPropuesta {
  id: string;
  titulo: string;
  texto: string;
}
export interface SeccionPropuesta {
  id: string;
  tipo: "detalle" | "inversion" | "condiciones" | "texto";
  titulo: string;
  tarjetas?: TarjetaPropuesta[];
  /** Encabezado de la columna de valores ("MENSUAL", "RETRIBUCIÓN", "TOTAL"). */
  columna?: string;
  filas?: FilaInversion[];
  total?: { etiqueta: string; detalle: string; valor: string } | null;
  nota?: string;
  items?: CondicionPropuesta[];
  texto?: string;
}
export interface Propuesta {
  /** Arriba del título, en violeta (ej. "Propuesta resumida · Contenido, pauta y plataformas"). */
  etiqueta: string;
  titulo: string;
  /** "2026-09-AL08". */
  codigo: string;
  lugar: string;
  /** YYYY-MM-DD */
  fecha: string;
  intro: string;
  secciones: SeccionPropuesta[];
  contacto: string;
  /** Fondo negro (como los PDF) o blanco. */
  tema?: "oscuro" | "claro";
}

export const nuevoIdP = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const CONTACTO_PRODI = "Contacto: Lucas Paulón · WhatsApp +54 9 3482 25-6152 · somosprodi.com · @prodisolo";

/** Condiciones de siempre (se editan en cada propuesta). */
export const CONDICIONES_BASE: Omit<CondicionPropuesta, "id">[] = [
  { titulo: "Pago", texto: "Honorarios y abonos por adelantado, del 1 al 10 de cada mes. Pesos argentinos, sin IVA; con factura A se adiciona el 21%." },
  { titulo: "Alcance", texto: "No incluye historias ni piezas gráficas salvo que se indique. Responder mensajes queda a cargo del comercio; Prodi no hace community management." },
  { titulo: "Baja y actualización", texto: "Sin permanencia: aviso de 15 días. Honorarios y abonos se actualizan por IPC del INDEC cada trimestre, con aviso." },
];

/** Una propuesta nueva con la estructura de siempre, para completar. */
export function plantillaPropuesta(empresa = "", fecha = new Date().toISOString().slice(0, 10)): Propuesta {
  return {
    etiqueta: "Propuesta comercial",
    titulo: empresa,
    codigo: "",
    lugar: "Reconquista, Santa Fe",
    fecha,
    intro: "",
    secciones: [
      { id: nuevoIdP(), tipo: "detalle", titulo: "Qué hacemos", tarjetas: [] },
      { id: nuevoIdP(), tipo: "inversion", titulo: "Inversión", columna: "MENSUAL", filas: [], total: null, nota: "" },
      { id: nuevoIdP(), tipo: "condiciones", titulo: "Condiciones esenciales", items: CONDICIONES_BASE.map((c) => ({ ...c, id: nuevoIdP() })) },
    ],
    contacto: CONTACTO_PRODI,
  };
}

const s = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const TIPOS = ["detalle", "inversion", "condiciones", "texto"];

/** Limpia una propuesta que viene del navegador o de la IA (tamaños, tipos e ids). */
export function limpiarPropuesta(raw: unknown): Propuesta {
  const r = (raw ?? {}) as any;
  const secciones = (Array.isArray(r.secciones) ? r.secciones : []).slice(0, 12).map((x: any): SeccionPropuesta => {
    const tipo = TIPOS.includes(x?.tipo) ? x.tipo : "texto";
    const base = { id: s(x?.id, 40) || nuevoIdP(), tipo, titulo: s(x?.titulo, 120) } as SeccionPropuesta;
    if (tipo === "detalle")
      base.tarjetas = (Array.isArray(x?.tarjetas) ? x.tarjetas : []).slice(0, 12).map((c: any) => ({
        id: s(c?.id, 40) || nuevoIdP(),
        titulo: s(c?.titulo, 160),
        resumen: s(c?.resumen, 600),
        vinetas: (Array.isArray(c?.vinetas) ? c.vinetas : []).slice(0, 12).map((v: unknown) => s(v, 500)),
      }));
    if (tipo === "inversion") {
      base.columna = s(x?.columna, 30) || "MENSUAL";
      base.filas = (Array.isArray(x?.filas) ? x.filas : []).slice(0, 20).map((f: any) => ({
        id: s(f?.id, 40) || nuevoIdP(),
        concepto: s(f?.concepto, 160),
        detalle: s(f?.detalle, 300),
        valor: s(f?.valor, 60),
      }));
      base.total = x?.total && (x.total.etiqueta || x.total.valor) ? { etiqueta: s(x.total.etiqueta, 120), detalle: s(x.total.detalle, 300), valor: s(x.total.valor, 60) } : null;
      base.nota = s(x?.nota, 1500);
    }
    if (tipo === "condiciones")
      base.items = (Array.isArray(x?.items) ? x.items : []).slice(0, 12).map((c: any) => ({ id: s(c?.id, 40) || nuevoIdP(), titulo: s(c?.titulo, 80), texto: s(c?.texto, 800) }));
    if (tipo === "texto") base.texto = s(x?.texto, 2000);
    return base;
  });
  return {
    etiqueta: s(r.etiqueta, 120),
    titulo: s(r.titulo, 160),
    codigo: s(r.codigo, 40),
    lugar: s(r.lugar, 80),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha)) ? String(r.fecha) : new Date().toISOString().slice(0, 10),
    intro: s(r.intro, 2000),
    secciones,
    contacto: s(r.contacto, 300),
    tema: r.tema === "claro" ? "claro" : "oscuro",
  };
}

/** Valores de precio que faltan (para avisar antes de mandarla). */
export function preciosFaltantes(p: Propuesta): number {
  return p.secciones.reduce((n, x) => n + (x.tipo === "inversion" ? (x.filas ?? []).filter((f) => f.concepto.trim() && !f.valor.trim()).length : 0), 0);
}
