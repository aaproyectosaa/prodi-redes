// Fotos en el navegador: abrir cualquier imagen (también HEIC si el navegador la entiende, como Safari),
// recortarla en cuadrado y achicarla antes de guardarla o subirla.

export type Fuente = ImageBitmap | HTMLImageElement;

const esHeic = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

export const dimensiones = (img: Fuente) =>
  "naturalWidth" in img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height };

function conImg(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

/** Abre la imagen (respeta la rotación de las fotos del celular). Si no se puede, explica por qué. */
export async function abrirImagen(file: File): Promise<Fuente> {
  if (!file.type.startsWith("image/") && !esHeic(file) && !/\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(file.name)) {
    throw new Error("Eso no es una imagen. Elegí una foto (JPG, PNG, WebP, HEIC…).");
  }
  try {
    if (typeof createImageBitmap === "function") return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    /* algunos navegadores no aceptan opciones o el formato: se prueba con <img> */
  }
  try {
    return await conImg(file);
  } catch {
    throw new Error(
      esHeic(file)
        ? "Este navegador no puede abrir fotos HEIC del iPhone. Probá desde el celular (Safari) o pasala a JPG."
        : "No se pudo abrir esa imagen. Probá con otra (JPG, PNG o WebP)."
    );
  }
}

function lienzo(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

export interface Encuadre {
  /** 1 = el lado corto entra justo; más = acercar. */
  zoom: number;
  /** Corrimiento del centro, en fracción del recorte (-0.5…0.5 aprox). */
  x: number;
  y: number;
}

/** Zona de la imagen original que queda dentro del cuadrado. */
export function zonaRecorte(img: Fuente, e: Encuadre) {
  const { w, h } = dimensiones(img);
  const lado = Math.min(w, h) / Math.max(1, e.zoom);
  const cx = Math.min(w - lado / 2, Math.max(lado / 2, w / 2 + e.x * lado));
  const cy = Math.min(h - lado / 2, Math.max(lado / 2, h / 2 + e.y * lado));
  return { sx: cx - lado / 2, sy: cy - lado / 2, lado };
}

/** Lleva el corrimiento a lo que permite la imagen (para que el arrastre no "se pase"). */
export function limitarEncuadre(img: Fuente, e: Encuadre): Encuadre {
  const { w, h } = dimensiones(img);
  const { sx, sy, lado } = zonaRecorte(img, e);
  return { zoom: e.zoom, x: (sx + lado / 2 - w / 2) / lado, y: (sy + lado / 2 - h / 2) / lado };
}

/**
 * Recorte cuadrado como JPEG en data URL, chico para guardarlo en el documento.
 * Baja la calidad (y si hace falta el tamaño) hasta que entra en `maxChars`.
 */
export function recorteCuadrado(img: Fuente, e: Encuadre = { zoom: 1, x: 0, y: 0 }, lado = 256, maxChars = 60_000): string {
  const { sx, sy, lado: l } = zonaRecorte(img, e);
  let tam = lado;
  for (let intento = 0; intento < 6; intento++) {
    const { c, ctx } = lienzo(tam, tam);
    // Fondo blanco: los PNG con transparencia no quedan negros en JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tam, tam);
    ctx.drawImage(img, sx, sy, l, l, 0, 0, tam, tam);
    for (const q of [0.86, 0.78, 0.68, 0.58]) {
      const url = c.toDataURL("image/jpeg", q);
      if (url.length <= maxChars) return url;
    }
    tam = Math.round(tam * 0.8);
  }
  throw new Error("No se pudo achicar la imagen");
}

/**
 * Fotos grandes (cámara del celular): las achica a `maxLado` px en JPEG para que suban rápido.
 * Si ya es chica, o no es una foto que convenga tocar (GIF, PNG con transparencia, SVG), la deja igual.
 */
export async function comprimirFoto(file: File, maxLado = 2560, calidad = 0.85): Promise<File> {
  if (!file.type.startsWith("image/") || /gif|svg|png/i.test(file.type)) return file;
  let img: Fuente;
  try {
    img = await abrirImagen(file);
  } catch {
    return file;
  }
  const { w, h } = dimensiones(img);
  const escala = Math.min(1, maxLado / Math.max(w, h));
  if (escala === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const { c, ctx } = lienzo(Math.round(w * escala), Math.round(h * escala));
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", calidad));
  if (!blob || blob.size >= file.size) return file;
  const nombre = (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], nombre, { type: "image/jpeg", lastModified: Date.now() });
}

/** Nombre de archivo para una foto o video sacado con la cámara. */
export function nombreCaptura(tipo: "foto" | "video", ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${tipo === "foto" ? "Foto" : "Video"} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.${ext}`;
}
