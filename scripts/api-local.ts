// Corre las funciones de /api fuera de Vercel: arma req/res como los de @vercel/node.
// Lo usan `pnpm dev` (plugin de Vite, todo en el 8080) y `pnpm local` (scripts/servidor-local.ts).
import type http from "http";
import fs from "fs";
import path from "path";

type Funcion = (req: unknown, res: unknown) => Promise<void>;
/** Carga el módulo de una función (con import() o con ssrLoadModule de Vite). */
export type Cargar = (archivo: string) => Promise<{ default?: Funcion | { default?: Funcion } }>;

/** /api/pagos/emitir → api/pagos/[accion].ts con accion=emitir (como en Vercel). */
function resolverApi(raiz: string, segs: string[]): { archivo: string; params: Record<string, string> } | null {
  const api = path.join(raiz, "api");
  if (segs.some((s) => s.startsWith("_") || s.includes(".."))) return null;
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

/** Atiende una request a /api/…; devuelve false si la URL no es de la API. */
export async function manejarApi(raiz: string, req: http.IncomingMessage, res: http.ServerResponse, cargar: Cargar): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (!url.pathname.startsWith("/api/")) return false;
  // Con extensión es un archivo (en `pnpm dev`, Vite sirve api/_lib/*.ts que importa la app), no una función.
  if (/\.[A-Za-z0-9]+$/.test(url.pathname)) return false;
  try {
    const r = resolverApi(raiz, url.pathname.slice(5).split("/").filter(Boolean));
    if (!r) {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "No existe" }));
      return true;
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
    const mod = await cargar(r.archivo);
    const fn = ((mod.default as { default?: Funcion })?.default ?? mod.default) as Funcion;
    await fn(vreq, vres);
    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error("[api]", err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Error" }));
  }
  return true;
}
