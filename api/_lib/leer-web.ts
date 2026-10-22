// Leer la página web de un cliente para darle contexto a la IA: el texto de la portada y de hasta 6 páginas de
// productos, servicios o tienda que enlaza (más los productos que publica en JSON-LD). Solo sitios públicos, con
// tiempo corto y sin seguir redirecciones a otros lados (una página podría mandar a una dirección interna).

import { hostPublicoDNS } from "./url-segura";

const MAX_TEXTO = 18_000;
const MAX_PAGINAS = 6;
const PRODUCTOS = /(producto|product|tienda|shop|store|catalog|categor|collection|coleccion|servicio|service|menu|carta|precio|price|item)/i;

/** Hosts que no se leen nunca (el servidor por dentro, redes locales). */
function hostPublico(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(h)) return false;
  if (/\.(local|internal|localhost)$/.test(h) || /(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me)$/.test(h)) return false;
  return h.includes(".");
}

/** Mismo sitio (con o sin www). */
const mismoSitio = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");

/** Baja el HTML. Sigue hasta 3 redirecciones, solo dentro del mismo sitio (http→https, con o sin www, /es/…). */
async function bajarHtml(u: URL): Promise<{ html: string; url: URL } | null> {
  let actual = u;
  for (let i = 0; i < 4; i++) {
    if (!hostPublico(actual) || !(await hostPublicoDNS(actual.hostname))) return null;
    const r = await fetch(actual.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Prodi/1.0)", Accept: "text/html" },
    }).catch(() => null);
    if (!r) return null;
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return null;
      const sig = new URL(loc, actual);
      if (!mismoSitio(sig, u)) return null;
      actual = sig;
      continue;
    }
    if (!r.ok || !String(r.headers.get("content-type") ?? "").includes("text/html")) return null;
    return { html: (await r.text()).slice(0, 600_000), url: actual };
  }
  return null;
}

const entidades = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Texto legible de la página (sin scripts, estilos ni menús repetidos). */
function textoDe(html: string): string {
  const titulo = html.match(/<title[^>]*>([^<]{2,200})<\/title>/i)?.[1] ?? "";
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{3,400})["']/i)?.[1] ?? "";
  const cuerpo = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lineas = entidades(cuerpo)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2 && !/(data-[\w-]+=|aria-[\w-]+=|class=|=\s*["']\s*["']|^["'>])/.test(l));
  // Sin líneas repetidas (menús y pies que aparecen en todas las páginas).
  const vistas = new Set<string>();
  const unicas = lineas.filter((l) => (vistas.has(l) ? false : (vistas.add(l), true)));
  return [entidades(titulo).trim(), entidades(desc).trim(), ...unicas].filter(Boolean).join("\n");
}

/** Productos que el sitio publica en JSON-LD (nombre, precio, descripción). */
function productosJsonLd(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const datos = JSON.parse(m[1]);
      const lista = (Array.isArray(datos) ? datos : [datos]).flatMap((d) => (Array.isArray(d?.["@graph"]) ? d["@graph"] : [d]));
      for (const d of lista) {
        const tipo = String(d?.["@type"] ?? "");
        if (!/Product|Offer|Service|MenuItem/i.test(tipo)) continue;
        const oferta = Array.isArray(d.offers) ? d.offers[0] : d.offers;
        const precio = oferta?.price ? ` · ${oferta.priceCurrency ?? ""} ${oferta.price}` : "";
        out.push(`${String(d.name ?? "").slice(0, 120)}${precio}${d.description ? ` — ${String(d.description).slice(0, 200)}` : ""}`);
      }
    } catch {
      /* JSON-LD roto: se ignora */
    }
  }
  return out.slice(0, 60);
}

/** Links internos que parecen de productos, servicios o tienda. */
function linksDeProductos(html: string, base: URL): URL[] {
  const vistos = new Set<string>();
  const out: URL[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    if (!mismoSitio(u, base) || /\.(jpg|jpeg|png|webp|gif|pdf|zip|mp4)$/i.test(u.pathname)) continue;
    const texto = m[2].replace(/<[^>]+>/g, " ");
    if (!PRODUCTOS.test(u.pathname) && !PRODUCTOS.test(texto)) continue;
    const clave = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
    if (vistos.has(clave) || clave === `${base.hostname.replace(/^www\./, "")}${base.pathname.replace(/\/$/, "")}`) continue;
    vistos.add(clave);
    out.push(u);
    if (out.length >= MAX_PAGINAS) break;
  }
  return out;
}

/** Links de páginas web en un texto ("https://…" o "www.…"). */
export function linksEnTexto(texto: string): URL[] {
  const out: URL[] = [];
  for (const m of texto.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi)) {
    try {
      const u = new URL(/^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`);
      if (hostPublico(u) && !/(instagram|facebook|tiktok|youtube|youtu\.be|wa\.me|whatsapp|drive\.google|docs\.google)/i.test(u.hostname)) out.push(u);
    } catch {
      /* no es un link */
    }
  }
  return out.slice(0, 2);
}

/**
 * Lo que dice la web (portada + páginas de productos), listo para el prompt. null si no se pudo leer
 * (sitio caído, bloqueado o hecho todo con JavaScript).
 */
export async function estudiarWeb(u: URL): Promise<{ url: string; texto: string; paginas: number } | null> {
  const portada = await bajarHtml(u);
  if (!portada) return null;
  const partes = [`== ${portada.url.toString()} ==\n${textoDe(portada.html)}`];
  const productos = productosJsonLd(portada.html);
  const internas = await Promise.all(linksDeProductos(portada.html, portada.url).map((l) => bajarHtml(l)));
  for (const p of internas) {
    if (!p) continue;
    partes.push(`== ${p.url.toString()} ==\n${textoDe(p.html)}`);
    productos.push(...productosJsonLd(p.html));
  }
  let texto = partes.join("\n\n");
  if (productos.length) texto = `Productos que publica el sitio:\n${[...new Set(productos)].map((x) => `- ${x}`).join("\n")}\n\n${texto}`;
  texto = texto.slice(0, MAX_TEXTO);
  if (texto.replace(/\s/g, "").length < 80) return null;
  return { url: portada.url.toString(), texto, paginas: 1 + internas.filter(Boolean).length };
}
