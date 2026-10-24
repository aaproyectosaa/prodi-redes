/* eslint-disable @typescript-eslint/no-explicit-any */
// Catálogo de productos de un negocio, para mandarlos desde el chat del CRM. El negocio conecta SU web y los productos
// se importan solos: Shopify (/products.json), WooCommerce (Store API) o cualquier otra (Tiendanube, webs a medida…)
// leyendo el mapa del sitio y los datos de producto que las tiendas publican para Google (JSON-LD / Open Graph).
// También se cargan a mano. Cada producto que se manda va con un link propio (/api/publico/ir?t=…) que avisa en la
// ficha cuando lo abren y lleva a la tienda.
//
// Solo se lee la web propia del negocio (traer fotos y precios de una web ajena no se puede). Se comprueba sola:
//   1. Es la web de su ficha (redes.web, la carga el equipo, no el cliente), la que tiene en el perfil de su Instagram
//      o su página de Facebook, o la del mail con el que entra (juan@mitienda.com.ar).
//   2. Si no: se le da un código (prodi-XXXXXX) para poner en cualquier parte visible de su web; el sistema lo busca y,
//      si está, la web es suya (solo puede ponerlo quien la maneja).
//   3. Si no puede: se lo pide a Prodi y el admin la aprueba o la rechaza (último recurso).
// Queda anotado quién la conectó, cuándo y cómo se comprobó (catalogos/{negocio}.web_verificada).
// Y el servidor solo pide páginas de ESE dominio (cada pedido y cada redirección se revisan, también que no apunte a
// una dirección interna): no se puede usar para leer otras webs ni la red de adentro.
//
// Negocio: "prodi" (el CRM de Prodi, solo admin) o el id del cliente (su CRM, con el CRM prendido; el equipo y el
// cliente). Colecciones (solo las escribe el servidor): catalogos/{negocio}, catalogo_productos/{id},
// catalogo_links/{token}.

import crypto from "crypto";
import { adminDb, borrarDoc, FieldValue, getPool, guardarDoc, leerDoc } from "./db";
import { assertProjectAccess, HttpError, type Caller } from "./http";
import { hostPublicoDNS } from "./url-segura";
import { enviarAviso } from "./notify";
import { websEnMeta } from "./meta-redes";

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
/** Lo más que se lee de cada respuesta (una página, un JSON o un mapa del sitio). */
const MAX_BYTES = 3 * 1024 * 1024;
/** Una actualización a mano cada tanto (cada una lee hasta 200 páginas de la tienda). */
const ESPERA_MANUAL_MS = 5 * 60_000;
/** Al abrir el catálogo se actualiza solo si pasó un día. */
const VIEJO_MS = 20 * 3_600_000;

const limpio = (v: unknown, max: number) =>
  Array.from(String(v ?? ""), (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").replace(/\s+/g, " ").trim().slice(0, max);
const sinHtml = (v: unknown) => limpio(String(v ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), 400);
const idProducto = (negocio: string, clave: string) => `p_${crypto.createHash("sha1").update(`${negocio}|${clave}`).digest("hex").slice(0, 24)}`;
const httpsOk = (u: unknown) => (/^https?:\/\//i.test(String(u ?? "")) ? String(u).slice(0, 1000) : null);
const esAdmin = (c: Caller) => c.role === "admin" || !!c.roles?.includes("admin");

/** "https://www.MiTienda.com.ar/algo" → "mitienda.com.ar" (sin www, en minúscula). null si no es un link válido. */
export function hostDe(url: unknown): string | null {
  let u = String(url ?? "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const p = new URL(u);
    if (!/^https?:$/.test(p.protocol) || p.username || p.password || !p.hostname.includes(".")) return null;
    return p.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** El negocio es "prodi" (admin) o un cliente al que la persona tiene acceso y que tiene el CRM prendido. */
export async function permitirNegocio(caller: Caller, negocio: string) {
  if (!negocio) throw new HttpError(400, "Falta el negocio");
  if (negocio === "prodi") {
    if (!esAdmin(caller)) throw new HttpError(403, "Solo el admin");
    return;
  }
  if (!/^[\w-]{1,60}$/.test(negocio)) throw new HttpError(400, "Negocio inválido");
  await assertProjectAccess(caller, negocio);
  const p = (await adminDb().collection("projects").doc(negocio).get()).data();
  if (!p?.crm_activo) throw new HttpError(403, "El CRM no está activo para este cliente");
}

/** Las webs que este negocio puede importar: la de su ficha (la carga Prodi) y la que aprobó el admin. */
async function websPermitidas(negocio: string): Promise<{ ficha: string | null; aprobada: string | null }> {
  if (negocio === "prodi") return { ficha: null, aprobada: null };
  const [p, conf] = await Promise.all([adminDb().collection("projects").doc(negocio).get(), leerDoc(getPool(), "catalogos", negocio)]);
  return { ficha: hostDe(p.data()?.redes?.web), aprobada: hostDe((conf as any)?.web_aprobada) };
}

// --- Pedidos a la web del negocio: solo a su dominio y nunca a una dirección interna -------------------------------

interface Sitio {
  /** El dominio del negocio (sin www). Se aceptan también www. y subdominios (tienda.midominio.com). */
  host: string;
  origen: string;
}
const delSitio = (s: Sitio, hostname: string) => {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return h === s.host || h.endsWith(`.${s.host}`);
};

/** Lee el cuerpo hasta MAX_BYTES (una página gigante no tumba la función). */
async function leerTexto(r: Response): Promise<string> {
  if (!r.body) return "";
  const lector = r.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await lector.cancel().catch(() => undefined);
      break;
    }
    partes.push(value);
  }
  return Buffer.concat(partes.map((p) => Buffer.from(p))).toString("utf8");
}

/** GET a una página del negocio. Las redirecciones se siguen a mano (hasta 3) y solo dentro del mismo dominio. */
async function traer(s: Sitio, url: string, ms = 12_000): Promise<{ ok: boolean; tipo: string; texto: () => Promise<string> } | null> {
  let actual = url;
  for (let salto = 0; salto < 4; salto++) {
    let u: URL;
    try {
      u = new URL(actual);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !delSitio(s, u.hostname)) return null;
    if (!(await hostPublicoDNS(u.hostname))) return null;
    let r: Response;
    try {
      r = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(ms), redirect: "manual" });
    } catch {
      return null;
    }
    if (r.status >= 300 && r.status < 400) {
      const destino = r.headers.get("location");
      await r.body?.cancel().catch(() => undefined);
      if (!destino) return null;
      actual = new URL(destino, u).toString();
      continue;
    }
    return { ok: r.ok, tipo: r.headers.get("content-type") ?? "", texto: () => leerTexto(r) };
  }
  return null;
}
async function json(s: Sitio, url: string): Promise<any | null> {
  const r = await traer(s, url);
  if (!r?.ok || !/json/i.test(r.tipo)) return null;
  try {
    return JSON.parse(await r.texto());
  } catch {
    return null;
  }
}

type Bruto = Omit<ProductoCatalogo, "id" | "negocio" | "origen" | "actualizado_at">;

/** Link de producto: solo si es del mismo dominio (si no, el de la página). */
const linkDelSitio = (s: Sitio, u: unknown, porDefecto: string | null) => {
  const ok = httpsOk(u);
  if (!ok) return porDefecto;
  try {
    return delSitio(s, new URL(ok).hostname) ? ok : porDefecto;
  } catch {
    return porDefecto;
  }
};

/** Shopify: lista pública /products.json. */
async function deShopify(s: Sitio): Promise<Bruto[] | null> {
  const out: Bruto[] = [];
  for (let page = 1; page <= 4 && out.length < MAX_PRODUCTOS; page++) {
    const d = await json(s, `${s.origen}/products.json?limit=250&page=${page}`);
    if (!d || !Array.isArray(d.products)) return page === 1 ? null : out;
    if (!d.products.length) break;
    for (const p of d.products) {
      const v = (p.variants ?? [])[0] ?? {};
      out.push({
        nombre: limpio(p.title, 160),
        precio: v.price != null && !Number.isNaN(Number(v.price)) ? Number(v.price) : null,
        moneda: "",
        foto: httpsOk(p.images?.[0]?.src ?? p.image?.src),
        url: `${s.origen}/products/${encodeURIComponent(String(p.handle ?? ""))}`,
        stock: (p.variants ?? []).some((x: any) => x.available !== false),
        descripcion: sinHtml(p.body_html),
      });
    }
  }
  return out;
}

/** WooCommerce: Store API pública. */
async function deWoo(s: Sitio): Promise<Bruto[] | null> {
  const out: Bruto[] = [];
  for (let page = 1; page <= 4 && out.length < MAX_PRODUCTOS; page++) {
    const d = await json(s, `${s.origen}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!Array.isArray(d)) return page === 1 ? null : out;
    if (!d.length) break;
    for (const p of d) {
      const decimales = Number(p.prices?.currency_minor_unit ?? 0);
      const crudo = p.prices?.price;
      out.push({
        nombre: sinHtml(p.name),
        precio: crudo != null && crudo !== "" && !Number.isNaN(Number(crudo)) ? Number(crudo) / 10 ** decimales : null,
        moneda: limpio(p.prices?.currency_code, 5),
        foto: httpsOk(p.images?.[0]?.src),
        url: linkDelSitio(s, p.permalink, null),
        stock: typeof p.is_in_stock === "boolean" ? p.is_in_stock : null,
        descripcion: sinHtml(p.short_description || p.description),
      });
    }
  }
  return out;
}

/** Datos de producto de una página (JSON-LD de schema.org o Open Graph). */
function productoDePagina(s: Sitio, html: string, url: string): Bruto | null {
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
      url: linkDelSitio(s, p.url ?? o.url, url),
      stock: o.availability ? /InStock|PreOrder|LimitedAvailability/i.test(String(o.availability)) : null,
      descripcion: sinHtml(p.description),
    };
  }
  // Sin JSON-LD: Open Graph de producto.
  const meta = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1];
  const precio = meta("product:price:amount") ?? meta("og:price:amount");
  if (!precio && meta("og:type") !== "product") return null;
  const nombre = meta("og:title");
  if (!nombre) return null;
  return {
    nombre: sinHtml(nombre),
    precio: precio && !Number.isNaN(Number(precio)) ? Number(precio) : null,
    moneda: limpio(meta("product:price:currency") ?? meta("og:price:currency"), 5),
    foto: httpsOk(meta("og:image")),
    url: linkDelSitio(s, meta("og:url"), url),
    stock: null,
    descripcion: sinHtml(meta("og:description")),
  };
}

/** Las direcciones de producto del mapa del sitio (con mapas anidados), solo del mismo dominio. */
async function urlsDelSitemap(s: Sitio, soloProductos = true): Promise<string[]> {
  const vistos = new Set<string>();
  const urls: string[] = [];
  const pendientes = [`${s.origen}/sitemap.xml`, `${s.origen}/sitemap_index.xml`, `${s.origen}/product-sitemap.xml`];
  const robots = await traer(s, `${s.origen}/robots.txt`, 6000);
  if (robots?.ok) for (const m of (await robots.texto()).matchAll(/^sitemap:\s*(\S+)/gim)) pendientes.unshift(m[1]);
  const propia = (u: string) => {
    try {
      return delSitio(s, new URL(u).hostname);
    } catch {
      return false;
    }
  };
  while (pendientes.length && vistos.size < 25 && urls.length < 600) {
    const u = pendientes.shift()!;
    if (vistos.has(u) || !propia(u)) continue;
    vistos.add(u);
    const r = await traer(s, u, 10_000);
    if (!r?.ok) continue;
    const xml = await r.texto();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&")).filter(propia);
    if (/<sitemapindex/i.test(xml)) {
      // Primero los mapas de productos.
      locs.sort((a, b) => Number(/product|producto/i.test(b)) - Number(/product|producto/i.test(a)));
      pendientes.push(...locs);
    } else urls.push(...locs);
  }
  if (!soloProductos) return [...new Set(urls)].slice(0, MAX_PRODUCTOS);
  const deProducto = urls.filter((u) => /\/(productos?|products?|p|item|tienda|shop|store)\/[^/?#]+/i.test(u));
  return [...new Set(deProducto.length ? deProducto : urls)].slice(0, MAX_PRODUCTOS);
}

/** Cualquier web: mapa del sitio + datos de cada producto (de a 6 páginas a la vez, hasta 35 s). */
async function deSitio(s: Sitio): Promise<Bruto[]> {
  const urls = await urlsDelSitemap(s);
  const out: Bruto[] = [];
  const hasta = Date.now() + 35_000;
  for (let i = 0; i < urls.length && Date.now() < hasta; i += 6) {
    const lote = await Promise.all(
      urls.slice(i, i + 6).map(async (u) => {
        const r = await traer(s, u, 10_000);
        if (!r?.ok || !/html/i.test(r.tipo)) return null;
        return productoDePagina(s, await r.texto(), u);
      })
    );
    out.push(...(lote.filter(Boolean) as Bruto[]));
  }
  return out;
}

/** Lee la tienda y guarda sus productos. Los cargados a mano no se tocan. */
async function importar(negocio: string, host: string) {
  const pool = getPool();
  const s: Sitio = { host, origen: `https://${host}` };
  // Si la web responde solo con www, se usa esa.
  if (!(await traer(s, `${s.origen}/`, 8000))?.ok && (await traer(s, `https://www.${host}/`, 8000))?.ok) s.origen = `https://www.${host}`;
  let plataforma = "shopify";
  let brutos = await deShopify(s);
  if (!brutos?.length) {
    plataforma = "woocommerce";
    brutos = await deWoo(s);
  }
  if (!brutos?.length) {
    plataforma = "web";
    brutos = await deSitio(s);
  }
  const at = new Date().toISOString();
  if (!brutos.length) {
    await adminDb().collection("catalogos").doc(negocio).set({ negocio, url: s.origen, plataforma: null, cantidad: 0, actualizado_at: at, error: "No encontramos productos en esa web" }, { merge: true });
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
  await adminDb().collection("catalogos").doc(negocio).set({ negocio, url: s.origen, plataforma, cantidad: nuevos.size, actualizado_at: at, error: null }, { merge: true });
  return { plataforma, cantidad: nuevos.size };
}

// --- Comprobar que la web es del negocio ---------------------------------------------------------------------------

/** Mails gratis: que alguien entre con @gmail.com no prueba que gmail.com sea su web. */
const MAIL_GRATIS = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|zoho|yandex|mail)\./;

type Metodo = "ficha" | "meta" | "mail" | "codigo" | "admin";
const METODO_TEXTO: Record<Metodo, string> = {
  ficha: "es la web de su ficha",
  meta: "es la web de su Instagram o Facebook",
  mail: "es el dominio de su mail",
  codigo: "puso el código en su web",
  admin: "la aprobó Prodi",
};

/** Sin que el cliente haga nada: su Instagram o Facebook dicen esa web, o su mail es de ese dominio. */
async function comprobarSola(caller: Caller, negocio: string, host: string): Promise<Metodo | null> {
  const dominioMail = String(caller.email ?? "").toLowerCase().split("@")[1] ?? "";
  if (dominioMail && !MAIL_GRATIS.test(dominioMail) && (dominioMail === host || dominioMail.endsWith(`.${host}`) || host.endsWith(`.${dominioMail}`))) return "mail";
  const p = (await adminDb().collection("projects").doc(negocio).get()).data() ?? {};
  const webs = await websEnMeta(p).catch(() => [] as string[]);
  return webs.map(hostDe).includes(host) ? "meta" : null;
}

/** El código para poner en la web: siempre el mismo para ese negocio y esa web, y nadie más lo puede adivinar. */
export function codigoDe(negocio: string, host: string): string {
  const secreto = process.env.AUTH_SECRET || process.env.TOKEN_ENCRYPTION_KEY || "prodi-local";
  const h = crypto.createHmac("sha256", secreto).update(`catalogo:${negocio}:${host}`).digest();
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `prodi-${Array.from(h.subarray(0, 6), (b) => letras[b % letras.length]).join("")}`;
}

/** Busca el código en la web: la portada y las primeras páginas del mapa del sitio (hasta 25 s). */
async function codigoEnLaWeb(host: string, codigo: string): Promise<boolean> {
  const s: Sitio = { host, origen: `https://${host}` };
  const tiene = async (u: string) => {
    const r = await traer(s, u, 8000);
    return !!r?.ok && (await r.texto()).toLowerCase().includes(codigo.toLowerCase());
  };
  if ((await tiene(`https://${host}/`)) || (await tiene(`https://www.${host}/`))) return true;
  const hasta = Date.now() + 25_000;
  const urls = await urlsDelSitemap(s, false);
  for (let i = 0; i < Math.min(urls.length, 30) && Date.now() < hasta; i += 5) {
    const lote = await Promise.all(urls.slice(i, i + 5).map(tiene));
    if (lote.some(Boolean)) return true;
  }
  return false;
}

/** Deja la web aprobada y anota cómo se comprobó. */
async function aprobarWeb(caller: Caller, negocio: string, host: string, metodo: Metodo) {
  const at = new Date().toISOString();
  await adminDb()
    .collection("catalogos")
    .doc(negocio)
    .set({ negocio, web_aprobada: host, web_verificada: { host, metodo, detalle: METODO_TEXTO[metodo], por: caller.uid, por_nombre: caller.nombre ?? "", at }, pendiente: null }, { merge: true });
}

/**
 * Conectar (o volver a leer) la web del catálogo. Solo la web propia del negocio: la de su ficha o una aprobada por el
 * admin. Si el cliente pega otra, queda pendiente para que el admin la confirme (y se le avisa).
 * `auto`: lo pide la pantalla al abrir el catálogo; solo se lee si pasó un día.
 */
export async function conectarCatalogo(caller: Caller, negocio: string, url: string, opciones: { declaro?: boolean; auto?: boolean; base?: string } = {}) {
  const pool = getPool();
  const conf = (await leerDoc(pool, "catalogos", negocio)) as any;
  const ultima = conf?.actualizado_at ? Date.parse(conf.actualizado_at) : 0;
  if (opciones.auto) {
    if (!conf?.url || Date.now() - ultima < VIEJO_MS) return { omitido: true };
    url = conf.url;
  } else if (!esAdmin(caller) && Date.now() - ultima < ESPERA_MANUAL_MS && hostDe(url) === hostDe(conf?.url)) {
    throw new HttpError(429, "Se actualizó hace un rato. Probá de nuevo en unos minutos.");
  }

  const host = hostDe(url);
  if (!host) throw new HttpError(400, "Pegá el link de tu web (ej. mitienda.com.ar)");
  if (!(await hostPublicoDNS(host))) throw new HttpError(400, "No encontramos esa web. Revisá el link.");

  if (negocio !== "prodi") {
    const { ficha, aprobada } = await websPermitidas(negocio);
    if (host === ficha && host !== aprobada) await aprobarWeb(caller, negocio, host, "ficha");
    if (host !== ficha && host !== aprobada) {
      const sola = esAdmin(caller) ? "admin" : await comprobarSola(caller, negocio, host);
      if (sola) await aprobarWeb(caller, negocio, host, sola);
      else if (!opciones.declaro) {
        // Que ponga el código en su web y toque "Ya lo puse" (o que se lo pida a Prodi).
        return { verificar: true, host, codigo: codigoDe(negocio, host) };
      } else {
        const pendiente = { host, url: `https://${host}`, por: caller.uid, por_nombre: caller.nombre ?? "", at: new Date().toISOString(), declaro: true };
        await adminDb().collection("catalogos").doc(negocio).set({ negocio, pendiente }, { merge: true });
        if (opciones.base) {
          const p = (await adminDb().collection("projects").doc(negocio).get()).data() ?? {};
          const admins = await adminDb().collection("profiles").where("role", "==", "admin").get();
          await enviarAviso(
            {
              destinatarios: admins.docs.map((d) => d.id),
              titulo: `${p.nombre ?? "Un cliente"} quiere conectar su web al catálogo`,
              cuerpo: `${host} · confirmá que es suya en la ficha del cliente.`,
              link: `/clientes/${negocio}`,
              clave: `catalogo:${negocio}:${host}`,
              proyectoId: negocio,
            },
            opciones.base
          ).catch(() => undefined);
        }
        return { pendiente: true, host };
      }
    }
  }
  return importar(negocio, host);
}

/** "Ya lo puse": busca el código en la web; si está, la web queda aprobada y se traen los productos. */
export async function verificarWeb(caller: Caller, negocio: string, url: string) {
  const host = hostDe(url);
  if (!host || negocio === "prodi") throw new HttpError(400, "Pegá el link de tu web");
  if (!(await hostPublicoDNS(host))) throw new HttpError(400, "No encontramos esa web. Revisá el link.");
  const codigo = codigoDe(negocio, host);
  if (!(await codigoEnLaWeb(host, codigo))) {
    throw new HttpError(400, `No encontramos ${codigo} en ${host}. Fijate que esté publicado (a veces tarda unos minutos) y probá de nuevo.`);
  }
  await aprobarWeb(caller, negocio, host, "codigo");
  return importar(negocio, host);
}

/** El admin aprueba (y se importa) o rechaza la web que pidió conectar el cliente. */
export async function resolverWeb(caller: Caller, negocio: string, aprobar: boolean) {
  if (!esAdmin(caller)) throw new HttpError(403, "Solo el admin");
  const conf = (await leerDoc(getPool(), "catalogos", negocio)) as any;
  const host = hostDe(conf?.pendiente?.host);
  if (!host) throw new HttpError(404, "No hay ninguna web pendiente");
  if (!aprobar) {
    await adminDb().collection("catalogos").doc(negocio).set({ pendiente: null, rechazada: { host, por: caller.uid, at: new Date().toISOString() } }, { merge: true });
    return { ok: true };
  }
  await aprobarWeb(caller, negocio, host, "admin");
  return importar(negocio, host);
}

/** El catálogo de un negocio: la conexión, sus productos y la web que tiene cargada en la ficha (para sugerirla). */
export async function verCatalogo(negocio: string) {
  const [conf, prods, webs] = await Promise.all([leerDoc(getPool(), "catalogos", negocio), adminDb().collection("catalogo_productos").where("negocio", "==", negocio).get(), websPermitidas(negocio)]);
  const productos = prods.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, b: any) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  return { conexion: conf ?? null, productos, web_ficha: webs.ficha, web_aprobada: webs.aprobada };
}

/** "12.500" → 12500 · "12500,50" → 12500.5 · "12.5" → 12.5 · "1,250.00" → 1250. */
export function leerPrecio(v: unknown): number | null {
  const t = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!t) return null;
  let n: number;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) n = Number(t.replace(/,/g, ""));
  else n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Producto cargado a mano (o corrección de uno). Foto y link, solo de la web propia del negocio. */
export async function guardarProducto(negocio: string, p: any) {
  const nombre = limpio(p?.nombre, 160);
  if (nombre.length < 2) throw new HttpError(400, "Poné el nombre del producto");
  const id = p?.id && /^p_[0-9a-f]{24}$|^m_[0-9a-z]{10,30}$/.test(String(p.id)) ? String(p.id) : `m_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
  const pool = getPool();
  const previo = (await leerDoc(pool, "catalogo_productos", id)) as any;
  if (previo && previo.negocio !== negocio) throw new HttpError(403, "Ese producto es de otro negocio");
  const { ficha, aprobada } = await websPermitidas(negocio);
  const permitidos = [ficha, aprobada].filter(Boolean) as string[];
  const propia = (u: unknown) => {
    const ok = httpsOk(u);
    if (!ok || negocio === "prodi") return ok;
    // Una foto que vino de la web ya importada (CDN de la tienda) se deja como estaba.
    if (previo && (ok === previo.foto || ok === previo.url)) return ok;
    const h = hostDe(ok);
    return h && permitidos.some((x) => h === x || h.endsWith(`.${x}`)) ? ok : null;
  };
  const foto = propia(p?.foto);
  const link = propia(p?.url);
  if ((p?.foto && !foto) || (p?.url && !link)) {
    // Una foto o un link de otra web no se guardan: no son del negocio.
    throw new HttpError(400, "La foto y el link tienen que ser de tu web. Si no tenés web, mandá la foto desde «Fotos y videos».");
  }
  await guardarDoc(pool, "catalogo_productos", id, {
    negocio,
    nombre,
    precio: leerPrecio(p?.precio),
    moneda: limpio(p?.moneda, 5),
    foto,
    url: link,
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
  if (!/^[\w-]{1,60}$/.test(contacto.id)) throw new HttpError(400, "Contacto inválido");
  const pool = getPool();
  const out: (ProductoCatalogo & { link: string; precio_texto: string })[] = [];
  for (const id of ids.slice(0, 10)) {
    const p = (await leerDoc(pool, "catalogo_productos", id)) as any;
    if (!p || p.negocio !== negocio) continue;
    // Sin link a la tienda no hay a dónde llevarlo: va el nombre y el precio solos.
    if (!p.url) {
      out.push({ ...p, id, link: "", precio_texto: precioTexto(p) });
      continue;
    }
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
  const primera = !l.abierto_at;
  // Cambios puntuales (no se reescribe el documento entero: si justo alguien lo está tocando, no se pisa).
  await adminDb()
    .collection("catalogo_links")
    .doc(token)
    .update({ aperturas: FieldValue.increment(1), ultimo_at: at, ...(primera ? { abierto_at: at } : {}) })
    .catch(() => undefined);
  if (primera && (l.contacto?.col === "leads_web" || l.contacto?.col === "crm_contactos") && /^[\w-]{1,60}$/.test(String(l.contacto?.id ?? ""))) {
    const ref = adminDb().collection(l.contacto.col).doc(l.contacto.id);
    if ((await ref.get()).exists) {
      const evento =
        l.contacto.col === "leads_web"
          ? { at, tipo: "presupuesto", texto: `Abrió el link de ${l.nombre}`, por: null, por_nombre: "Catálogo" }
          : { at, tipo: "nota", texto: `Abrió el link de ${l.nombre}` };
      await ref
        .update({ historial: FieldValue.arrayUnion(evento), ...(l.contacto.col === "leads_web" ? { updated_at: at } : { actualizado_at: at }) })
        .catch(() => undefined);
    }
  }
  return httpsOk(l.url) ?? "https://somosprodi.com";
}

/**
 * Para el cron diario: vuelve a leer los catálogos conectados que tienen más de un día (hasta 45 s en total; lo que
 * no entra se actualiza al día siguiente o al abrir el catálogo). De un cliente, solo su web ya comprobada.
 */
export async function actualizarCatalogos() {
  const snap = await adminDb().collection("catalogos").get();
  const hasta = Date.now() + 45_000;
  let ok = 0;
  for (const d of snap.docs) {
    if (Date.now() > hasta) break;
    const c = d.data();
    const host = d.id === "prodi" ? hostDe(c.url) : hostDe(c.web_aprobada);
    if (!host || (c.actualizado_at && Date.now() - Date.parse(String(c.actualizado_at)) < VIEJO_MS)) continue;
    try {
      await importar(d.id, host);
      ok++;
    } catch {
      /* el error queda guardado en el catálogo */
    }
  }
  return ok;
}
