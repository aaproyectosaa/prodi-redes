// Servidor local: la app ya compilada (dist/) + las funciones de /api, contra la base de DATABASE_URL.
// Sirve para probar todo en la compu igual que en Vercel.
// Uso: npm run build && DATABASE_URL=… AUTH_SECRET=… npm run local   → http://localhost:3001
import http from "http";
import fs from "fs";
import path from "path";
import { URL, fileURLToPath } from "url";

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

const cache = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
async function funcion(archivo: string) {
  if (!cache.has(archivo)) {
    const mod = await import(archivo);
    cache.set(archivo, (mod.default?.default ?? mod.default) as (req: unknown, res: unknown) => Promise<void>);
  }
  return cache.get(archivo)!;
}

/** /api/pagos/emitir → api/pagos/[accion].ts con accion=emitir (como en Vercel). */
function resolverApi(segs: string[]): { archivo: string; params: Record<string, string> } | null {
  const api = path.join(RAIZ, "api");
  const directo = path.join(api, ...segs) + ".ts";
  if (fs.existsSync(directo)) return { archivo: directo, params: {} };
  if (segs.length === 2) {
    const din = path.join(api, segs[0], "[accion].ts");
    if (fs.existsSync(din)) return { archivo: din, params: { accion: segs[1] } };
  }
  return null;
}

function leerCuerpo(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((ok, mal) => {
    const partes: Buffer[] = [];
    req.on("data", (c) => partes.push(c));
    req.on("end", () => ok(Buffer.concat(partes)));
    req.on("error", mal);
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const r = resolverApi(url.pathname.slice(5).split("/").filter(Boolean));
      if (!r) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "No existe" }));
        return;
      }
      const crudo = await leerCuerpo(req);
      const vreq = req as http.IncomingMessage & { query: Record<string, string>; body: unknown; cookies: Record<string, string> };
      vreq.query = { ...Object.fromEntries(url.searchParams), ...r.params };
      const tipo = String(req.headers["content-type"] || "");
      vreq.body = tipo.includes("application/json") && crudo.length ? JSON.parse(crudo.toString()) : crudo.toString();
      vreq.cookies = {};
      const vres = res as http.ServerResponse & Record<string, unknown>;
      vres.status = (c: number) => ((res.statusCode = c), vres);
      vres.json = (o: unknown) => {
        if (!res.headersSent) res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(o));
        return vres;
      };
      vres.send = (o: unknown) => {
        if (typeof o === "object" && o !== null && !Buffer.isBuffer(o)) return (vres.json as (x: unknown) => unknown)(o);
        res.end(o as string);
        return vres;
      };
      vres.redirect = (a: number | string, b?: string) => {
        res.statusCode = typeof a === "number" ? a : 302;
        res.setHeader("Location", typeof a === "number" ? b! : a);
        res.end();
        return vres;
      };
      const fn = await funcion(r.archivo);
      await fn(vreq, vres);
      if (!res.writableEnded) res.end();
      return;
    }
    // Archivos de la app; cualquier otra ruta es la app (index.html), como en vercel.json.
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
