// Foto de perfil del cliente armada a partir de su logo: se recortan los márgenes vacíos, el logo queda
// centrado y lo más grande posible dentro del círculo, y el fondo contrasta (blanco, u oscuro si el logo es claro).
// Se guarda chica (JPEG) en el cliente: marca_archivos.avatar = { img, de } (de = el logo del que salió).

import type { Project } from "@/integrations/firebase/types";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import { callApi } from "@/lib/redes/api";

const LADO = 192;
const OSCURO = "#1f1f1f";

type RGB = [number, number, number];
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luz = ([r, g, b]: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** JPEG cuadrado (data URL) con el logo centrado. */
export async function avatarDesdeLogo(fuente: Blob): Promise<string> {
  const bmp = await createImageBitmap(fuente);
  const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const lienzo = document.createElement("canvas");
  lienzo.width = w;
  lienzo.height = h;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number) => (y * w + x) * 4;

  // Fondo: si las cuatro esquinas son opacas y del mismo color, el logo viene sobre ese fondo.
  const esquinas = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2],
  ].map(([x, y]) => at(Math.max(0, x), Math.max(0, y)));
  const opacas = esquinas.every((i) => px[i + 3] > 200);
  const colores = esquinas.map((i) => [px[i], px[i + 1], px[i + 2]] as RGB);
  const fondo: RGB | null = opacas && colores.every((c) => dist(c, colores[0]) < 30) ? colores[0] : null;

  // Caja del contenido y cuánto del logo es casi blanco.
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1,
    total = 0,
    blancos = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (px[i + 3] < 40) continue;
      const c: RGB = [px[i], px[i + 1], px[i + 2]];
      if (fondo && dist(c, fondo) < 48) continue;
      total++;
      if (luz(c) > 0.88 && Math.max(...c) - Math.min(...c) < 30) blancos++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) {
    // Imagen vacía o de un solo color: se usa entera.
    x0 = 0;
    y0 = 0;
    x1 = w - 1;
    y1 = h - 1;
  }
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  // Fondo del avatar: el que traía el logo; si no traía, blanco (u oscuro si el logo es claro, ej. letras blancas).
  const relleno = fondo ? `rgb(${fondo.join(",")})` : total && blancos / total > 0.25 ? OSCURO : "#ffffff";

  // Lo más grande posible sin salirse del círculo (con un poco de aire): la diagonal del logo entra en el 90 % del diámetro.
  const escala = (LADO * 0.9) / Math.hypot(cw, ch);
  const dw = cw * escala;
  const dh = ch * escala;
  const out = document.createElement("canvas");
  out.width = LADO;
  out.height = LADO;
  const o = out.getContext("2d")!;
  o.fillStyle = relleno;
  o.fillRect(0, 0, LADO, LADO);
  o.imageSmoothingQuality = "high";
  o.drawImage(lienzo, x0, y0, cw, ch, (LADO - dw) / 2, (LADO - dh) / 2, dw, dh);
  return out.toDataURL("image/jpeg", 0.9);
}

/** ¿La foto de perfil está hecha con el logo actual? */
export const avatarAlDia = (c: Pick<Project, "marca_archivos">) => {
  const a = c.marca_archivos;
  return !a?.logo || (!!a.avatar?.img && a.avatar.de === a.logo.drive_file_id);
};

const intentados = new Set<string>();

/** Arma la foto de perfil con el archivo del logo (recién subido) y la guarda. */
export async function guardarAvatar(proyectoId: string, logoId: string, archivo: Blob): Promise<void> {
  intentados.add(`${proyectoId}:${logoId}`);
  const img = await avatarDesdeLogo(archivo);
  await callApi("/api/ia/marca-avatar", { proyecto_id: proyectoId, de: logoId, img });
}

/** Arma y guarda la foto de perfil si falta o es de un logo anterior (una vez por logo y por sesión). */
export async function asegurarAvatar(c: Pick<Project, "id" | "marca_archivos">, archivo?: Blob): Promise<void> {
  const logo = c.marca_archivos?.logo?.drive_file_id;
  if (!logo || avatarAlDia(c) || logo.startsWith("demo/") || logo.startsWith("blob:")) return;
  const clave = `${c.id}:${logo}`;
  if (intentados.has(clave)) return;
  intentados.add(clave);
  try {
    const fuente = archivo ?? (await (await fetch(await getDriveMediaPlayUrl(logo))).blob());
    const img = await avatarDesdeLogo(fuente);
    await callApi("/api/ia/marca-avatar", { proyecto_id: c.id, de: logo, img });
  } catch (err) {
    console.warn("[marca] no se pudo armar la foto de perfil", c.id, err);
  }
}
