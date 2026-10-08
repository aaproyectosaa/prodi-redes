/* eslint-disable @typescript-eslint/no-explicit-any */
// Carga de una vez la identidad de marca de varios clientes: logo principal, versiones del logo,
// manuales, colores (con nombre y uso), tipografías y reglas de uso.
//
// Lee marcas/marcas.json (carpeta que no va al repo) y, por cada cliente, los archivos de marcas/<carpeta>/.
// SOLO AGREGA: no cambia un logo principal que ya esté cargado, no repite versiones ni manuales con el mismo
// nombre, suma los colores que falten (sin borrar los que ya había) y no pisa tipografías ni notas.
//
// Uso:
//   pnpm exec tsx --env-file=.env.local scripts/cargar-marcas.ts                      → simula contra la base local
//   pnpm exec tsx --env-file=.env scripts/cargar-marcas.ts --aplicar --produccion     → carga en producción
// Los archivos se suben al Drive conectado en esa base (carpeta <cliente>/Marca), igual que desde la ficha.

import fs from "fs";
import path from "path";
import { adminDb } from "../api/_lib/db";
import { uploadBufferToDrive } from "../api/_lib/drive-server";

type Par = [archivo: string, etiqueta: string];
interface Marca {
  carpeta: string;
  id: string;
  logo?: string;
  variantes?: Par[];
  manuales?: Par[];
  colores?: [hex: string, nombre: string, uso: string][];
  tipografias?: string;
  notas?: string;
}

const APLICAR = process.argv.includes("--aplicar");
const PRODUCCION = process.argv.includes("--produccion");
const url = process.env.DATABASE_URL ?? "";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
if (!url) throw new Error("Falta DATABASE_URL");
if (APLICAR && !local && !PRODUCCION) {
  console.error("La base no es local. Para cargar en producción agregá --produccion.");
  process.exit(1);
}

const DIR = path.resolve("marcas");
const marcas = JSON.parse(fs.readFileSync(path.join(DIR, "marcas.json"), "utf8")) as Marca[];
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "application/pdf" };
const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

console.log(`Destino: ${local ? "base LOCAL" : "base NO local (producción)"}`);
console.log(APLICAR ? "Cargando…" : "SIMULACIÓN (no se sube ni se escribe nada). Para cargar: --aplicar");

const db = adminDb();
let subidos = 0;
for (const m of marcas) {
  const ref = db.collection("projects").doc(m.id);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`\n✗ ${m.carpeta}: no existe el cliente ${m.id}`);
    continue;
  }
  const p = snap.data() ?? {};
  const nombre = String(p.nombre ?? m.carpeta);
  const archivos = { ...(p.marca_archivos ?? {}) } as Record<string, any>;
  const marca = { ...(p.marca ?? {}) } as Record<string, any>;
  const cambios: string[] = [];

  const archivo = (f: string) => {
    const ruta = path.join(DIR, m.carpeta, f);
    if (!fs.existsSync(ruta)) throw new Error(`${m.carpeta}: falta el archivo ${f}`);
    const mime = MIME[path.extname(f).toLowerCase()];
    if (!mime) throw new Error(`${m.carpeta}: tipo de archivo no soportado (${f})`);
    return { data: fs.readFileSync(ruta), mime, ext: path.extname(f).slice(1).toLowerCase() };
  };
  const subir = async (f: string, nombreDrive: string) => {
    const a = archivo(f);
    if (!APLICAR) return null;
    const up = await uploadBufferToDrive({ path: [nombre, "Marca"], name: `${nombreDrive}.${a.ext}`, mime: a.mime, data: a.data });
    subidos++;
    return { ...up, size: a.data.length, uploaded_at: new Date().toISOString(), uploaded_by: "carga-marcas", folder_path: `Progreso/${nombre}/Marca` };
  };

  if (m.logo) {
    if (archivos.logo) archivo(m.logo);
    else {
      cambios.push(`logo principal (${m.logo})`);
      const att = await subir(m.logo, "logo");
      if (att) archivos.logo = att;
    }
  }
  const variantes = [...((archivos.variantes ?? []) as { etiqueta: string }[])];
  for (const [f, etiqueta] of m.variantes ?? []) {
    if (variantes.some((v) => v.etiqueta === etiqueta)) continue;
    cambios.push(`versión «${etiqueta}»`);
    const att = await subir(f, `logo-${slug(etiqueta)}`);
    if (att) variantes.push({ ...att, etiqueta });
  }
  if (variantes.length > 30) throw new Error(`${m.carpeta}: más de 30 versiones del logo`);
  archivos.variantes = variantes;
  const manuales = [...((archivos.manuales ?? []) as { name: string }[])];
  for (const [f, titulo] of m.manuales ?? []) {
    if (manuales.some((x) => x.name === titulo)) continue;
    cambios.push(`manual «${titulo}»`);
    const att = await subir(f, `manual-${slug(titulo)}`);
    if (att) manuales.push({ ...att, name: titulo });
  }
  archivos.manuales = manuales;

  // Colores: se suman los que falten (el primero cargado sigue siendo el principal) y se completan nombre y uso.
  const paleta: string[] = Array.isArray(marca.paleta) ? [...marca.paleta] : [];
  const info: Record<string, { nombre?: string; uso?: string }> = { ...(marca.colores_info ?? {}) };
  for (const [hexRaw, n, uso] of m.colores ?? []) {
    const hex = hexRaw.toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error(`${m.carpeta}: color inválido ${hexRaw}`);
    if (!paleta.includes(hex) && paleta.length < 12) {
      paleta.push(hex);
      cambios.push(`color ${hex} ${n}`);
    }
    if (!info[hex]) info[hex] = { nombre: n, uso };
  }
  marca.paleta = paleta;
  marca.colores = paleta.join(", ");
  marca.colores_info = info;
  if (m.tipografias && !marca.tipografias) {
    marca.tipografias = m.tipografias;
    cambios.push("tipografías");
  }
  if (m.notas && !String(marca.notas ?? "").includes(m.notas)) {
    marca.notas = [marca.notas, m.notas].filter(Boolean).join("\n");
    cambios.push("reglas de uso");
  }

  console.log(`\n${cambios.length ? "•" : "="} ${nombre}${cambios.length ? "" : ": ya estaba todo"}`);
  for (const c of cambios) console.log(`    + ${c}`);
  if (APLICAR && cambios.length) await ref.update({ marca_archivos: archivos, marca });
}
console.log(APLICAR ? `\nListo: ${subidos} archivos subidos.` : "\nFin de la simulación: no se subió ni se escribió nada.");
process.exit(0);
