/* eslint-disable @typescript-eslint/no-explicit-any */
// Identidad de marca de un cliente: el texto que lee la IA (copys, piezas, plan, @prodi)
// y qué versión del logo conviene adjuntarle a una pieza.

type Archivo = { drive_file_id: string; name?: string };
type Variante = Archivo & { etiqueta?: string };

/** "#a28c77 (Marrón Nexo, títulos)": cada color con su nombre y uso si los cargaron. */
function coloresTexto(m: Record<string, any>): string {
  const paleta: string[] = Array.isArray(m.paleta) ? m.paleta : [];
  if (!paleta.length) return m.colores ? String(m.colores) : "";
  const info = (m.colores_info ?? {}) as Record<string, { nombre?: string; uso?: string }>;
  return paleta
    .map((hex, i) => {
      const d = info[hex] ?? {};
      const extra = [d.nombre, d.uso].filter(Boolean).join(", ");
      return `${hex}${i === 0 ? " (principal" + (extra ? `, ${extra}` : "") + ")" : extra ? ` (${extra})` : ""}`;
    })
    .join(", ");
}

export function marcaTexto(p: Record<string, any>): string {
  const m = p.marca ?? {};
  const a = p.marca_archivos ?? {};
  const variantes = ((a.variantes ?? []) as Variante[]).map((v) => v.etiqueta).filter(Boolean);
  const colores = coloresTexto(m);
  return [
    `Marca: ${p.nombre}`,
    m.rubro && `Rubro: ${m.rubro}`,
    m.publico && `Público: ${m.publico}`,
    m.descripcion && `Qué los hace distintos: ${m.descripcion}`,
    m.tono && `Tono: ${m.tono}`,
    colores && `Colores de marca: ${colores}`,
    m.tipografias && `Tipografías: ${m.tipografias}`,
    (a.logo || variantes.length) &&
      `Logo: ${a.logo ? "principal cargado" : "sin principal"}${variantes.length ? `; otras versiones: ${variantes.join(", ")}` : ""}`,
    a.manuales?.length && `Tiene manual de marca cargado (${a.manuales.length} archivo${a.manuales.length > 1 ? "s" : ""}).`,
    m.notas && `Reglas de uso de la marca: ${m.notas}`,
    p.redes?.instagram && `Instagram: ${p.redes.instagram}`,
    p.redes?.facebook && `Facebook: ${p.redes.facebook}`,
    p.redes?.tiktok && `TikTok: ${p.redes.tiktok}`,
    p.redes?.web && `Página web: ${p.redes.web}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const CLARA = /blanc|negativ|clar|white|para fondo oscuro/i;

/**
 * Logos para una pieza: el principal y, si hay, la versión para fondos oscuros (blanca / negativo),
 * así la IA elige la que contrasta con el fondo que arma.
 */
export function logosParaPieza(p: Record<string, any>): { principal?: Archivo; clara?: Variante } {
  const a = p.marca_archivos ?? {};
  const variantes = (a.variantes ?? []) as Variante[];
  const principal: Archivo | undefined = a.logo ?? variantes[0];
  const clara = variantes.find((v) => v.drive_file_id !== principal?.drive_file_id && CLARA.test(v.etiqueta ?? ""));
  return { principal, clara };
}
