// Servidor local: la app ya compilada (dist/) + las funciones de /api, contra la base de DATABASE_URL.
// Sirve para probar todo en la compu igual que en Vercel.
// Para desarrollar alcanza con `pnpm dev` (app y /api en el 8080). Esto es para probar la versión compilada.
// Uso: pnpm build && pnpm local   → http://localhost:3001  (lee .env y encima .env.local; también se pueden pasar DATABASE_URL=… AUTH_SECRET=… a mano)
import http from "http";
import fs from "fs";
import path from "path";
import { URL, fileURLToPath } from "url";
import { manejarApi } from "./api-local";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(RAIZ, process.env.DIST_DIR || "dist");
const PUERTO = Number(process.env.PORT || 3001);
const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};


const servidor = http.createServer(async (req, res) => {
  try {
    if (await manejarApi(RAIZ, req, res, (archivo) => import(archivo))) return;
    // Archivos de la app; cualquier otra ruta es la app (index.html), como en vercel.json.
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let archivo = path.join(DIST, decodeURIComponent(url.pathname));
    if (!archivo.startsWith(DIST) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) archivo = path.join(DIST, "index.html");
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "application/octet-stream" });
    fs.createReadStream(archivo).pipe(res);
  } catch (err) {
    console.error("[local]", err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Error" }));
  }
});

servidor.listen(PUERTO, () => console.log(`Prodi Redes local en http://localhost:${PUERTO}`));
