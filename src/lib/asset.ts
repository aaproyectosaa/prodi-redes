/** Ruta a un archivo de /public respetando la base de la app. */
export const asset = (path: string) => {
  const clean = path.replace(/^\//, "");
  // La demo en un solo HTML trae las imágenes embebidas.
  const embebidas = (globalThis as { __PRODI_ASSETS__?: Record<string, string> }).__PRODI_ASSETS__;
  if (embebidas?.[clean]) return embebidas[clean];
  return `${import.meta.env.BASE_URL}${clean}`;
};
