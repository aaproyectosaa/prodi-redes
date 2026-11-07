// Modo inglés, para grabar el video de la revisión de Meta (piden la interfaz en inglés).
// Se cambia con el botón del menú de la persona (o en el ingreso), o con ?lang=en / ?lang=es en la dirección.
// Abarca lo que se ve en el video: el ingreso, el menú, los leads con su chat y la conexión con Meta; el resto sigue
// en castellano, y en inglés no salen los avisos al entrar.

const CLAVE = "prodi-idioma";

function leer(): boolean {
  try {
    const p = new URLSearchParams(window.location.search).get("lang");
    if (p === "en" || p === "es") localStorage.setItem(CLAVE, p);
    return localStorage.getItem(CLAVE) === "en";
  } catch {
    return false;
  }
}

export const enIngles = typeof window !== "undefined" && leer();

/** El texto en castellano, o en inglés si está prendido el modo inglés. */
export const tr = (es: string, en: string) => (enIngles ? en : es);

/** Cambia el idioma y recarga (en inglés va directo a los leads). */
export function cambiarIdioma(ingles: boolean) {
  try {
    localStorage.setItem(CLAVE, ingles ? "en" : "es");
  } catch {
    /* sin almacenamiento: no se puede cambiar */
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("lang");
  if (ingles && url.pathname !== "/auth") url.pathname = "/web";
  window.location.assign(url.toString());
}

/** "5 min ago", "3 h ago", "2 days ago". */
export function haceEn(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
