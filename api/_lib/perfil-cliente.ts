// Perfil del cliente: qué tiene completo (logo, colores, rubro, público, tono, Instagram, productos, negocio).
// Lo usan el panel del cliente (anillo "Completá tu perfil") y el servidor (para dejarle cargar su inversión en
// publicidad solo con el perfil completo: sin eso la IA no puede sugerirle bien ni armar buenos anuncios).

export interface ItemPerfilBase {
  clave: string;
  titulo: string;
  para: string;
  listo: boolean;
}

type Datos = Record<string, unknown> | null | undefined;
const lleno = (v: unknown, min = 2) => typeof v === "string" && v.trim().length >= min;

/** `proyecto`: el doc del cliente; `comercial`: ia_memoria/{cliente}.comercial (productos, enfoque, objetivo). */
export function itemsPerfil(proyecto: Datos, comercial: Datos): ItemPerfilBase[] {
  const p = proyecto ?? {};
  const m = (p.marca ?? {}) as Record<string, unknown>;
  const redes = (p.redes ?? {}) as Record<string, unknown>;
  const archivos = (p.marca_archivos ?? {}) as Record<string, unknown>;
  const c = comercial ?? {};
  return [
    { clave: "logo", titulo: "Tu logo", para: "Para que las piezas y los videos lleven tu marca", listo: !!archivos.logo },
    { clave: "colores", titulo: "Tus colores", para: "Así todo sale con tu identidad", listo: (Array.isArray(m.paleta) && m.paleta.length > 0) || lleno(m.colores) },
    { clave: "rubro", titulo: "A qué te dedicás", para: "Qué vendés y qué te hace distinto", listo: lleno(m.rubro) && lleno(m.descripcion, 10) },
    { clave: "publico", titulo: "A quién le vendés", para: "Para hablarle a la gente correcta", listo: lleno(m.publico) },
    { clave: "tono", titulo: "Cómo hablás", para: "Formal, cercano, con humor…", listo: lleno(m.tono) },
    { clave: "instagram", titulo: "Tu Instagram", para: "Para mirar lo que ya publicaste", listo: lleno(redes.instagram) },
    { clave: "productos", titulo: "Tus productos o servicios", para: "Los videos muestran lo que vendés de verdad", listo: Array.isArray(c.productos) && c.productos.length > 0 },
    { clave: "negocio", titulo: "Tu negocio en pocas palabras", para: "Qué querés lograr con las redes", listo: lleno(c.enfoque, 5) || lleno(c.objetivo, 5) },
  ];
}

export const perfilCompleto = (proyecto: Datos, comercial: Datos) => itemsPerfil(proyecto, comercial).every((i) => i.listo);
