// Genera los íconos de "Prodi Chat" (globo de chat violeta con el isotipo de Prodi en blanco) a partir de
// public/icons/icon-512.png. Solo usa módulos de Node (zlib): lee y escribe PNG RGBA de 8 bits a mano.
// Uso: node scripts/iconos-chat.mjs
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONOS = path.join(RAIZ, "public", "icons");
const VIOLETA = [0x6f, 0x40, 0xfc];
const FONDO = [0, 0, 0];

// ---- PNG ----
function leerPng(archivo) {
  const buf = fs.readFileSync(archivo);
  let p = 8;
  let ancho = 0, alto = 0;
  const idat = [];
  while (p < buf.length) {
    const largo = buf.readUInt32BE(p);
    const tipo = buf.toString("ascii", p + 4, p + 8);
    const datos = buf.subarray(p + 8, p + 8 + largo);
    if (tipo === "IHDR") {
      ancho = datos.readUInt32BE(0);
      alto = datos.readUInt32BE(4);
      if (datos[8] !== 8 || datos[9] !== 6 || datos[12] !== 0) throw new Error("Solo PNG RGBA 8 bits sin entrelazar");
    } else if (tipo === "IDAT") idat.push(datos);
    p += 12 + largo;
  }
  const crudo = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, fila = ancho * bpp;
  const px = Buffer.alloc(alto * fila);
  for (let y = 0; y < alto; y++) {
    const f = crudo[y * (fila + 1)];
    const src = crudo.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1));
    for (let x = 0; x < fila; x++) {
      const a = x >= bpp ? px[y * fila + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * fila + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * fila + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * fila + x] = v & 255;
    }
  }
  return { ancho, alto, px };
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(tipo, datos) {
  const t = Buffer.from(tipo, "ascii");
  const out = Buffer.alloc(12 + datos.length);
  out.writeUInt32BE(datos.length, 0);
  t.copy(out, 4);
  datos.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([t, datos])), 8 + datos.length);
  return out;
}
function escribirPng(archivo, tam, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const crudo = Buffer.alloc(tam * (tam * 4 + 1));
  for (let y = 0; y < tam; y++) px.copy(crudo, y * (tam * 4 + 1) + 1, y * tam * 4, (y + 1) * tam * 4);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(crudo, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(archivo, png);
}

// ---- Isotipo: máscara (0..1) sacada del ícono original (violeta sobre negro) ----
const fuente = leerPng(path.join(ICONOS, "icon-512.png"));
const mascara = new Float32Array(fuente.ancho * fuente.alto);
let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
for (let i = 0; i < mascara.length; i++) {
  const v = Math.min(1, fuente.px[i * 4 + 2] / VIOLETA[2]) * (fuente.px[i * 4 + 3] / 255);
  mascara[i] = v;
  if (v > 0.5) {
    const x = i % fuente.ancho, y = Math.floor(i / fuente.ancho);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
}
function muestraMascara(x, y) {
  // Bilineal en coordenadas de la fuente.
  const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
  const g = (a, b) => (a < 0 || b < 0 || a >= fuente.ancho || b >= fuente.alto ? 0 : mascara[b * fuente.ancho + a]);
  return (g(fx, fy) * (1 - tx) + g(fx + 1, fy) * tx) * (1 - ty) + (g(fx, fy + 1) * (1 - tx) + g(fx + 1, fy + 1) * tx) * ty;
}

// ---- Globo de chat en coordenadas 0..1 (centrado en 0.5, se escala para el ícono "maskable") ----
function dentroGlobo(u, v) {
  const [l, t, r, b, rad] = [0.12, 0.15, 0.88, 0.75, 0.17];
  const cx = Math.min(Math.max(u, l + rad), r - rad), cy = Math.min(Math.max(v, t + rad), b - rad);
  if (u >= l && u <= r && v >= t && v <= b && (u - cx) ** 2 + (v - cy) ** 2 <= rad * rad) return true;
  // Colita abajo a la izquierda.
  const [ax, ay, bx, by, px, py] = [0.24, 0.7, 0.44, 0.74, 0.19, 0.89];
  const s = (x1, y1, x2, y2) => (u - x2) * (y1 - y2) - (x1 - x2) * (v - y2);
  const d1 = s(ax, ay, bx, by), d2 = s(bx, by, px, py), d3 = s(px, py, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function dibujar(tam, escala) {
  const px = Buffer.alloc(tam * tam * 4);
  const SS = 4;
  // El isotipo va centrado en el cuerpo del globo, en blanco.
  const altoMarca = 0.4, centroU = 0.5, centroV = 0.45;
  const srcAlto = y1 - y0 + 1, srcCx = (x0 + x1) / 2, srcCy = (y0 + y1) / 2;
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      let globo = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / tam - 0.5) / escala + 0.5;
          const v = ((y + (sy + 0.5) / SS) / tam - 0.5) / escala + 0.5;
          if (dentroGlobo(u, v)) globo++;
        }
      globo /= SS * SS;
      const u = ((x + 0.5) / tam - 0.5) / escala + 0.5;
      const v = ((y + 0.5) / tam - 0.5) / escala + 0.5;
      const k = srcAlto / altoMarca;
      const marca = globo > 0 ? muestraMascara(srcCx + (u - centroU) * k, srcCy + (v - centroV) * k) * globo : 0;
      const i = (y * tam + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = FONDO[c] * (1 - globo) + VIOLETA[c] * globo;
        px[i + c] = Math.round(base * (1 - marca) + 255 * marca);
      }
      px[i + 3] = 255;
    }
  }
  return px;
}

const salidas = [
  ["icon-chat-192.png", 192, 1],
  ["icon-chat-512.png", 512, 1],
  ["icon-chat-maskable-512.png", 512, 0.74],
  ["apple-touch-icon-chat.png", 180, 0.9],
];
for (const [nombre, tam, escala] of salidas) {
  escribirPng(path.join(ICONOS, nombre), tam, dibujar(tam, escala));
  console.log("ok", nombre);
}
