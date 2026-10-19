/* eslint-disable @typescript-eslint/no-explicit-any */
// Rubros y zonas para comparar la pauta entre clientes (puro: lo usan el servidor y la ficha del cliente).

export const RUBROS_PAUTA: { k: string; label: string; claves: RegExp }[] = [
  { k: "gastronomia", label: "Gastronomía", claves: /pizz|resto|restaur|bar\b|caf[eé]|helad|comida|gastr|panad|parrill|sushi|burger|hamburg|delivery|cervec/i },
  { k: "automotor", label: "Automotor", claves: /auto|concesion|moto|taller|neum|repuest|lubric|agencia de autos/i },
  { k: "salud_estetica", label: "Salud y estética", claves: /salud|est[eé]tic|odont|dent|m[eé]dic|cl[ií]nic|nutri|farmac|[oó]ptic|kine|psic|spa|peluq|belleza|u[ñn]as|derma/i },
  { k: "indumentaria", label: "Indumentaria y retail", claves: /ropa|indument|calzad|zapat|tienda|boutique|moda|accesori|perfum|joyer|lencer|retail|shopping/i },
  { k: "construccion_industria", label: "Construcción e industria", claves: /constru|ingenier|materiales|ferret|industri|metal|f[aá]brica|corral[oó]n|sanitari|electric|agro|maquin|hornos/i },
  { k: "servicios", label: "Servicios profesionales", claves: /estudio|abogad|contad|seguro|consultor|inmobil|servicio|marketing|software|financ/i },
  { k: "educacion", label: "Educación", claves: /escuel|colegio|educa|curso|academ|instituto|capacit|idioma/i },
  { k: "fitness", label: "Fitness y deporte", claves: /gimnas|gym|fitness|pilates|yoga|crossfit|deport|entrenam/i },
  { k: "hogar", label: "Hogar y deco", claves: /mueble|deco|hogar|colch|cocina|jard[ií]n|vivero|bazar/i },
  { k: "otro", label: "Otro", claves: /$^/ },
];

export const ZONAS_PAUTA: { k: "chica" | "grande" | "nacional"; label: string }[] = [
  { k: "chica", label: "Ciudad chica o pueblo" },
  { k: "grande", label: "Ciudad grande" },
  { k: "nacional", label: "Todo el país" },
];

/** El rubro del cliente: el elegido en su ficha o, si no, el que se deduce de su rubro escrito y su nombre. */
export function rubroPauta(p: Record<string, any>): string {
  const elegido = String(p.meta?.rubro_pauta ?? "");
  if (RUBROS_PAUTA.some((r) => r.k === elegido)) return elegido;
  const texto = `${p.marca?.rubro ?? ""} ${p.nombre ?? ""}`;
  return RUBROS_PAUTA.find((r) => r.claves.test(texto))?.k ?? "otro";
}
export const zonaPauta = (p: Record<string, any>): string | null => (["chica", "grande", "nacional"].includes(p.meta?.zona_pauta) ? p.meta.zona_pauta : null);
export const labelRubro = (k: string) => RUBROS_PAUTA.find((r) => r.k === k)?.label ?? k;
export const labelZona = (k: string | null) => ZONAS_PAUTA.find((z) => z.k === k)?.label ?? "zona sin cargar";
