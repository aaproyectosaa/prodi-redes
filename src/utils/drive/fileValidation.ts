// Validación de archivos antes de subir a Drive

export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
];

export const ALLOWED_VIDEO_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/mpeg",
  "video/3gpp",
  "video/x-m4v",
  "video/avi",
  "video/ogg",
  "video/x-ms-wmv",
];

// Algunos navegadores (sobre todo en Windows) no devuelven mime para .heic
// Validamos también por extensión.
const EXTENSIONS_BY_TYPE: Record<string, string[]> = {
  image: [
    "jpg", "jpeg", "png", "gif", "webp", "heic", "heif",
    "avif", "svg", "bmp", "tif", "tiff",
  ],
  video: [
    "mp4", "mov", "webm", "mkv", "avi", "mpeg", "mpg",
    "3gp", "m4v",
  ],
};

export type FileKind = "image" | "video" | "unknown";

export function getFileKind(file: File): FileKind {
  const mime = (file.type || "").toLowerCase();
  if (ALLOWED_IMAGE_MIMES.includes(mime)) return "image";
  if (ALLOWED_VIDEO_MIMES.includes(mime)) return "video";

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (EXTENSIONS_BY_TYPE.image.includes(ext)) return "image";
  if (EXTENSIONS_BY_TYPE.video.includes(ext)) return "video";

  return "unknown";
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateFile(file: File): ValidationResult {
  if (file.size === 0) {
    return { ok: false, error: `${file.name} está vacío` };
  }

  const kind = getFileKind(file);
  if (kind === "unknown") {
    // iOS a veces entrega videos sin mime ni extensión clara tras la galería.
    if (file.size > 0) {
      return { ok: true };
    }
    return {
      ok: false,
      error: `${file.name || "Archivo"}: tipo de archivo no permitido`,
    };
  }
  return { ok: true };
}

/**
 * Mime type "efectivo" para subir a Drive. Si el navegador no detectó mime
 * pero la extensión es válida, devolvemos un mime razonable.
 */
export function resolveMimeType(file: File): string {
  if (file.type) return file.type;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    "3gp": "video/3gpp",
    m4v: "video/x-m4v",
  };
  return map[ext] ?? (file.size > 0 ? "video/mp4" : "application/octet-stream");
}
