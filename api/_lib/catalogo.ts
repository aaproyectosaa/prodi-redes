/* eslint-disable @typescript-eslint/no-explicit-any */
// Catálogo de productos de un negocio, para mandarlos desde el chat del CRM. El negocio pega el link de su web y se
// importan solos: Shopify (/products.json), WooCommerce (Store API) o cualquier otra (Tiendanube, webs a medida…)
// leyendo el mapa del sitio y los datos de producto que las tiendas publican para Google (JSON-LD / Open Graph).
// También se cargan a mano. Cada producto que se manda va con un link propio (/api/publico/ir?t=…) que avisa en la
// ficha cuando lo abren y lleva a la tienda.
// Negocio: "prodi" (el CRM de Prodi, solo admin) o el id del cliente (su CRM; el equipo y el cliente).
// Colecciones: catalogos/{negocio}, catalogo_productos/{id}, catalogo_links/{token}. Este archivo es el mismo en
// prodi-redes y en el CRM de clientes.

import crypto from "crypto";
import { adminDb, borrarDoc, getPool, guardarDoc, leerDoc } from "./db";
import { assertProjectAccess, HttpError, type Caller } from "./http";

export interface ProductoCatalogo {
  id: string;
  negocio: string;
  nombre: string;
  precio: number | null;
  moneda: string;
  foto: string | null;
  url: string | null;
  stock: boolean | null;
  descripcion: string;
  origen: "web" | "manual";
  actualizado_at: string;
}

const UA = "Mozilla/5.0 (compatible; ProdiCatalogo/1.0; +https://somosprodi.com)";
const MAX_PRODUCTOS = 200;
const limpio = (v: unknown, max: number) =>
  Array.from(String(v ?? ""), (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").replace(/\s+/g, " ").trim().slice(0, max);
const sinHtml = (v: unknown) => limpio(String(v ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), 400);
const idProducto = (negocio: string, clave: string) => `p_${crypto.createHash("sha1").update(`${negocio}|${clave}`).digest("hex").slice(0, 24)}`;
const httpsOk = (u: unknown) => (/^https?:\/\//i.test(String(u ?? "")) ? String(u).slice(0, 1000) : null);

/** El negocio es "prodi" (admin) o un cliente al que la persona tiene acceso. */
export async function permitirNegocio(caller: Caller, negocio: string) {
  if (!negocio) throw new HttpError(400, "Falta el negocio");
  if (negocio === "prodi") {
    if (!caller.roles?.includes("admin") && caller.role !== "admin") throw new HttpError(403, "Solo el admin");
    return;
  }
  if (!/^[\w-]{4,60}$/.test(negocio)) throw new HttpError(400, "Negocio inválido");
  await assertProjectAccess(caller, negocio);
}

async function traer(url: string, ms = 12_000): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(ms), redirect: "follow" });
  } catch {
    return null;
  }
}
async function json(url: string): Promise<any | null> {
  const r = await traer(url);
  if (!r?.ok || !/json/i.test(r.headers.get("content-type") ?? "")) return null;
  return r.json().catch(() => null);
}

type Bruto = Omit<ProductoCatalogo, "id" | "negocio" | "origen" | "actualizado_at">;

/** Shopify: lista pública /products.json. */
async function deShopify(origen: string): Promise<Bruto[] | null> {
  const out: Bruto[] = [];
  for (let page = 1; page <= 4 && out.length < MAX_PRODUCTOS; page++) {
    const d = await json(`${origen}/products.json?limit=250&page=${page}`);
    if (!d || !Array.isArray(d.products)) return page === 1 ? null : out;
    if (!d.products.length) break;
    for (const p of d.products) {
      const v = (p.variants ?? [])[0] ?? {};
      out.push({
        nombre: limpio(p.title, 160),
        precio: v.price != null ? Number(v.price) : null,
        moneda: "",
        foto: httpsOk(p.images?.[0]?.src ?? p.image?.src),
        url: `${origen}/products/${p.handle}`,
        stock: (p.variants ?? []).some((x: any) => x.available !== false),
        descripcion: sinHtml(p.body_html),
      });
    }
  }
  return out;
}

/** WooCommerce: Store API pública. */
async function deWoo(origen: string): Promise<Bruto[] | null> {
  const out: Bruto[] = [];
  for (let page = 1; page <= 4 && out.length < MAX_PRODUCTOS; page++) {
    const d = await json(`${origen}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!Array.isArray(d)) return page === 1 ? null : out;
    if (!d.length) break;
    for (const p of d) {
      const decimales = Number(p.prices?.currency_minor_unit ?? 0);
      const crudo = p.prices?.price;
      out.push({
        nombre: sinHtml(p.name),
        precio: crudo != null && crudo !== "" ? Number(crudo) / 10 ** decimales : null,
        moneda: limpio(p.prices?.currency_code, 5),
        foto: httpsOk(p.images?.[0]?.src),
        url: httpsOk(p.permalink),
        stock: typeof p.is_in_stock === "boolean" ? p.is_in_stock : null,
        descripcion: sinHtml(p.short_description || p.description),
      });
    }
  }
  return out;
}

/** Datos de producto de una página (JSON-LD de schema.org o Open Graph). */
function productoDePagina(html: string, url: string): Bruto | null {
  const bloques = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const productos: any[] = [];
  const juntar = (x: any) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(juntar);
    const tipo = ([] as string[]).concat(x["@type"] ?? []).map(String);
    if (tipo.includes("Product") || tipo.includes("ProductGroup")) productos.push(x);
    if (x["@graph"]) juntar(x["@graph"]);
  };
  for (const b of bloques) {
    try {
      juntar(JSON.parse(b.trim()));
    } catch {
      /* JSON-LD roto: se ignora */
    }
  }
  const p = productos[0];
  if (p) {
    const ofertas = ([] as any[]).concat(p.offers ?? p.hasVariant?.[0]?.offers ?? []);
    const o = ofertas[0]?.offers ? ([] as any[]).concat(ofertas[0].offers)[0] : ofertas[0] ?? {};
    const precio = o.price ?? o.lowPrice ?? o.priceSpecification?.price;
    const img = ([] as any[]).concat(p.image ?? [])[0];
    return {
      nombre: sinHtml(p.name),
      precio: precio != null && precio !== "" && !Number.isNaN(Number(precio)) ? Number(precio) : null,
      moneda: limpio(o.priceCurrency, 5),
      foto: httpsOk(typeof img === "string" ? img : img?.url ?? img?.contentUrl),
      url: httpsOk(p.url ?? o.url) ?? url,
      stock: o.availability ? /InStock|PreOrder|LimitedAvailability/i.test(String(o.availability)) : null,
      descripcion: sinHtml(p.description),
    };
  }
  // Sin JSON-LD: Open Graph de producto.
  const meta = (prop: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1];
  const precio = meta("product:price:amount") ?? meta("og:price:amount");
  if (!precio && meta("og:type") !== "product") return null;
  const nombre = meta("og:title");
  if (!nombre) return null;
  return {
    nombre: sinHtml(nombre),
    precio: precio && !Number.isNaN(Number(precio)) ? Number(precio) : null,
    moneda: limpio(meta("product:price:currency") ?? meta("og:price:currency"), 5),
    foto: httpsOk(meta("og:image")),
    url: httpsOk(meta("og:url")) ?? url,
    stock: null,
    descripcion: sinHtml(meta("og:description")),
  };
}

/** Las direcciones de producto del mapa del sitio (con mapas anidados). */
async function urlsDelSitemap(origen: string): Promise<string[]> {
  const vistos = new Set<string>();
  const urls: string[] = [];
  const pendientes = [`${origen}/sitemap.xml`, `${origen}/sitemap_index.xml`, `${origen}/product-sitemap.xml`];
  const robots = await traer(`${origen}/robots.txt`, 6000);
  if (robots?.ok) for (const m of (await robots.text()).matchAll(/^sitemap:\s*(\S+)/gim)) pendientes.unshift(m[1]);
  while (pendientes.length && vistos.size < 25 && urls.length < 600) {
    const u = pendientes.shift()!;
    if (vistos.has(u)) continue;
    vistos.add(u);
    const r = await traer(u, 10_000);
    if (!r?.ok) continue;
    const xml = await r.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(xml)) {
      // Primero los mapas de productos.
      locs.sort((a, b) => Number(/product|producto/i.test(b)) - Number(/product|producto/i.test(a)));
      pendientes.push(...locs);
    } else urls.push(...locs);
  }
  const deProducto = urls.filter((u) => /\/(productos?|products?|p|item|tienda|shop|store)\/[^/?#]+/i.test(u));
  return [...new Set(deProducto.length ? deProducto : urls)].slice(0, MAX_PRODUCTOS);
}

/** Cualquier web: mapa del sitio + datos de cada producto (de a 6 páginas a la vez, hasta 50 s). */
async function deSitio(origen: string): Promise<Bruto[]> {
  const urls = await urlsDelSitemap(origen);
  const out: Bruto[] = [];
  const hasta = Date.now() + 35_000;
  for (let i = 0; i < urls.length && Date.now() < hasta; i += 6) {
    const lote = await Promise.all(
      urls.slice(i, i + 6).map(async (u) => {
        const r = await traer(u, 10_000);
        if (!r?.ok || !/html/i.test(r.headers.get("content-type") ?? "")) return null;
        return productoDePagina(await r.text(), u);
      })
    );
    out.push(...(lote.filter(Boolean) as Bruto[]));
  }
  return out;
}

function origenDe(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const p = new URL(u);
    if (!/^https?:$/.test(p.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(p.hostname)) throw new Error();
    return `${p.protocol}//${p.host}`;
  } catch {
    throw new HttpError(400, "Pegá el link de la web (ej. mitienda.com.ar)");
  }
}

/** Importa (o vuelve a importar) el catálogo de la web del negocio. Los cargados a mano no se tocan. */
export async function conectarCatalogo(negocio: string, url: string) {
  const origen = origenDe(url);
  const pool = getPool();
  let plataforma = "shopify";
  let brutos = await deShopify(origen);
  if (!brutos?.length) {
    plataforma = "woocommerce";
    brutos = await deWoo(origen);
  }
  if (!brutos?.length) {
    plataforma = "web";
    brutos = await deSitio(origen);
  }
  const at = new Date().toISOString();
  if (!brutos.length) {
    await guardarDoc(pool, "catalogos", negocio, { negocio, url: origen, plataforma: null, cantidad: 0, actualizado_at: at, error: "No encontramos productos en esa web" });
    throw new HttpError(400, "No encontramos productos en esa web. Probá con el link de la tienda o cargalos a mano.");
  }
  const previos = await adminDb().collection("catalogo_productos").where("negocio", "==", negocio).get();
  const nuevos = new Set<string>();
  for (const b of brutos.slice(0, MAX_PRODUCTOS)) {
    if (!b.nombre) continue;
    const id = idProducto(negocio, b.url ?? b.nombre);
    if (nuevos.has(id)) continue;
    nuevos.add(id);
    await guardarDoc(pool, "catalogo_productos", id, { ...b, negocio, origen: "web", actualizado_at: at });
  }
  // Los de la web que ya no están se borran (los manuales quedan).
  for (const d of previos.docs) if (d.data().origen === "web" && !nuevos.has(d.id)) await borrarDoc(pool, "catalogo_productos", d.id);
  await guardarDoc(pool, "catalogos", negocio, { negocio, url: origen, plataforma, cantidad: nuevos.size, actualizado_at: at, error: null });
  return { plataforma, cantidad: nuevos.size };
}

/** El catálogo de un negocio: la conexión y sus productos. */
export async function verCatalogo(negocio: string) {
  const [conf, prods] = await Promise.all([leerDoc(getPool(), "catalogos", negocio), adminDb().collection("catalogo_productos").where("negocio", "==", negocio).get()]);
  const productos = prods.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, b: any) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  return { conexion: conf ?? null, productos };
}

/** Producto cargado a mano (o corrección de uno). */
export async function guardarProducto(negocio: string, p: any) {
  const nombre = limpio(p?.nombre, 160);
  if (nombre.length < 2) throw new HttpError(400, "Poné el nombre del producto");
  const id = p?.id && /^p_[0-9a-f]{24}$|^m_[0-9a-z]{10,30}$/.test(String(p.id)) ? String(p.id) : `m_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
  const pool = getPool();
  const previo = (await leerDoc(pool, "catalogo_productos", id)) as any;
  if (previo && previo.negocio !== negocio) throw new HttpError(403, "Ese producto es de otro negocio");
  const precio = p?.precio === "" || p?.precio == null ? null : Number(String(p.precio).replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
  await guardarDoc(pool, "catalogo_productos", id, {
    negocio,
    nombre,
    precio: precio != null && !Number.isNaN(precio) ? precio : null,
    moneda: limpio(p?.moneda, 5),
    foto: httpsOk(p?.foto),
    url: httpsOk(p?.url),
    stock: typeof p?.stock === "boolean" ? p.stock : null,
    descripcion: limpio(p?.descripcion, 400),
    origen: previo?.origen ?? "manual",
    actualizado_at: new Date().toISOString(),
  });
  return { ok: true, id };
}

export async function borrarProducto(negocio: string, id: string) {
  const pool = getPool();
  const d = (await leerDoc(pool, "catalogo_productos", id)) as any;
  if (!d || d.negocio !== negocio) throw new HttpError(404, "No encontramos ese producto");
  await borrarDoc(pool, "catalogo_productos", id);
  return { ok: true };
}

/** Precio lindo para el mensaje ("$ 12.500", "US$ 30"). */
export function precioTexto(p: { precio: number | null; moneda?: string }) {
  if (p.precio == null) return "";
  const m = (p.moneda ?? "").toUpperCase();
  const signo = m && m !== "ARS" ? (m === "USD" ? "US$" : m) : "$";
  return `${signo} ${p.precio.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}

/**
 * Links con aviso para mandar productos a un contacto: cada uno lleva a la tienda y anota en la ficha cuando lo abre.
 * `contacto`: dónde anotar (leads_web del CRM de Prodi o crm_contactos del de clientes).
 */
export async function linksParaMandar(base: string, negocio: string, ids: string[], contacto: { col: "leads_web" | "crm_contactos"; id: string }) {
  if (!/^[\w-]{4,60}$/.test(contacto.id)) throw new HttpError(400, "Contacto inválido");
  const pool = getPool();
  const out: (ProductoCatalogo & { link: string; precio_texto: string })[] = [];
  for (const id of ids.slice(0, 10)) {
    const p = (await leerDoc(pool, "catalogo_productos", id)) as any;
    if (!p || p.negocio !== negocio) continue;
    const token = crypto.randomBytes(9).toString("base64url");
    await guardarDoc(pool, "catalogo_links", token, { negocio, producto_id: id, nombre: p.nombre, url: p.url, contacto, creado_at: new Date().toISOString(), aperturas: 0 });
    out.push({ ...p, id, link: `${base}/api/publico/ir?t=${token}`, precio_texto: precioTexto(p) });
  }
  return out;
}

/** El contacto abrió el link: se cuenta, se anota en su ficha (la primera vez) y se lo lleva a la tienda. */
export async function abrirLink(token: string): Promise<string> {
  if (!/^[\w-]{8,20}$/.test(token)) return "https://somosprodi.com";
  const pool = getPool();
  const l = (await leerDoc(pool, "catalogo_links", token)) as any;
  if (!l) return "https://somosprodi.com";
  const at = new Date().toISOString();
  await guardarDoc(pool, "catalogo_links", token, { ...l, aperturas: Number(l.aperturas ?? 0) + 1, abierto_at: l.abierto_at ?? at, ultimo_at: at });
  if (!l.abierto_at && l.contacto?.col && l.contacto?.id) {
    const c = (await leerDoc(pool, l.contacto.col, l.contacto.id)) as any;
    if (c) {
      const evento =
        l.contacto.col === "leads_web"
          ? { at, tipo: "presupuesto", texto: `Abrió el link de ${l.nombre}`, por: null, por_nombre: "Catálogo" }
          : { at, tipo: "nota", texto: `Abrió el link de ${l.nombre}`, canal: "catalogo" };
      await guardarDoc(pool, l.contacto.col, l.contacto.id, { ...c, historial: [...(Array.isArray(c.historial) ? c.historial : []), evento].slice(-100), updated_at: at });
    }
  }
  return l.url || "https://somosprodi.com";
}

/** Para el cron diario: vuelve a importar los catálogos conectados a una web. */
export async function actualizarCatalogos() {
  const snap = await adminDb().collection("catalogos").get();
  let ok = 0;
  for (const d of snap.docs) {
    const c = d.data();
    if (!c.url) continue;
    try {
      await conectarCatalogo(d.id, c.url);
      ok++;
    } catch {
      /* el error queda guardado en el catálogo */
    }
  }
  return ok;
}
