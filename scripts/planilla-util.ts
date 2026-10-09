// Funciones comunes de las cargas de planillas (scripts/importar-planilla*.ts): leer CSV de Google Sheets,
// montos "$1.234,56", fechas "10/2/2026", meses "enero" y nombres.

import fs from "fs";
import path from "path";

export function csv(carpeta: string, nombre: string): string[][] {
  const archivo = [nombre, nombre.toLowerCase()].map((n) => path.join(carpeta, n)).find((p) => fs.existsSync(p));
  if (!archivo) throw new Error(`Falta ${nombre} en ${carpeta}`);
  const txt = fs.readFileSync(archivo, "utf8").replace(/^﻿/, "");
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (comillas) {
      if (ch === '"' && txt[i + 1] === '"') (campo += '"'), i++;
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === ",") fila.push(campo), (campo = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && txt[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      (fila = []), (campo = "");
    } else campo += ch;
  }
  if (campo || fila.length) fila.push(campo), filas.push(fila);
  return filas;
}

/** " $5.558.580,34" → 5558580.34 */
export const plata = (s: string | undefined) => {
  const t = String(s ?? "").replace(/[$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
/** "10/2/2026" o "20/2/26" → "2026-02-10" */
export const fecha = (s: string | undefined): string | null => {
  const m = String(s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const mesDe = (s: string | undefined, anio: number): string | null => {
  const t = String(s ?? "").trim().toLowerCase();
  if (!t) return null;
  const i = MESES.findIndex((m) => m.startsWith(t.slice(0, 3)));
  return i < 0 ? null : `${anio}-${String(i + 1).padStart(2, "0")}`;
};
export const sumarMes = (f: string, n: number) => {
  const [y, m, d] = f.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const x = new Date(Date.UTC(y, m - 1 + n, Math.min(d, ultimo)));
  return x.toISOString().slice(0, 10);
};
export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
export const titulo = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase())
    .replace(/\bIibb\b/g, "IIBB")
    .replace(/\bIva\b/g, "IVA")
    .replace(/\bUva\b/g, "UVA")
    .replace(/\bOfi\b/g, "oficina");
export const ars = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
