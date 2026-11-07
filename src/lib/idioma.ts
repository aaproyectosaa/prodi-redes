// Modo inglés, solo para grabar el video de la revisión de Meta (piden la interfaz en inglés).
// Se prende con ?lang=en en la dirección y se apaga con ?lang=es. Abarca el chat de los leads y la conexión con Meta.

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
