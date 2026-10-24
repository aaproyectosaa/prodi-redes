/** Claro, oscuro y "violeta" (oscuro con el violeta de Prodi: usa las mismas reglas de oscuro y cambia los colores). */
export type Tema = "light" | "dark" | "violeta";

export const CLAVE_TEMA = "ui-theme";

/** El tema que se eligió en este dispositivo (o null si nunca se eligió). Manda sobre el del perfil. */
export function temaElegido(storageKey = CLAVE_TEMA): Tema | null {
  try {
    const t = localStorage.getItem(storageKey);
    return t === "light" || t === "dark" || t === "violeta" ? t : null;
  } catch {
    return null;
  }
}
