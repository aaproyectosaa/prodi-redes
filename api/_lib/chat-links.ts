// Links que se pasan en los chats: Prodi los usa como contexto y, si son de un cliente, los guarda en su ficha.
//
// POST /api/ia/links-chat { chat_id, mensaje_id } (lo llama la app después de mandar un mensaje con un link).
// - De quién es: en el grupo de un cliente, de ese cliente; en otros chats, del cliente cuyo nombre está en el
//   dominio o en la cuenta (alfonsinaresto.com.ar → Alfonsina) o, si no, del único cliente nombrado en los
//   últimos mensajes ("La de Alfonsina" → el link).
// - Instagram, Facebook y TikTok van a sus redes; el resto (salvo WhatsApp, Drive, Meet, etc.) es la página web.
//   Solo se completa lo que está vacío: nunca se pisa lo que cargó alguien.
// - Cada link queda además como dato en la memoria del cliente (ia_memoria.chat_notas), con el título y la
//   descripción de la página si se pueden leer: lo usan el plan del mes, los copys, los guiones y @prodi.

import { adminDb, type Data } from "./db";
import { HttpError, type Caller } from "./http";
import { chatDeMiembro, mensajeProdi, PRODI_ID } from "./chat-server";
import { guardarNotasChat, normalizar } from "./chat-memoria";
import { clientesNombrados, type Proyecto } from "./chat-contexto";

export const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\b(?:www\.)[^\s<>"')\]]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|com\.ar|ar|net|org|shop|store|app|io)(?:\/[^\s<>"')\]]*)?/gi;
/** Links que no son de la marca del cliente (herramientas, chats, archivos). */
const NO_SON_DE_MARCA = /(^|\.)(wa\.me|whatsapp\.com|google\.com|goo\.gl|youtube\.com|youtu\.be|meet\.jit\.si|zoom\.us|vercel\.app|canva\.com|dropbox\.com|wetransfer\.com|mercadopago\.com|mercadolibre\.com|linktr\.ee|gmail\.com|hotmail\.com|outlook\.com|yahoo\.com(\.ar)?)$/i;

type Tipo = "instagram" | "facebook" | "tiktok" | "web";

export function normalizarUrl(s: string): URL | null {
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u;
  } catch {
    return null;
  }
}

export function clasificar(u: URL): { tipo: Tipo; valor: string } | null {
  const host = u.hostname.replace(/^(www|m)\./, "").toLowerCase();
  const primero = u.pathname.split("/").filter(Boolean)[0] ?? "";
  if (host === "instagram.com") return primero && !["p", "reel", "reels", "stories", "explore"].includes(primero) ? { tipo: "instagram", valor: `@${primero}` } : null;
  if (host === "facebook.com" || host === "fb.com") return primero && !["share", "watch", "photo", "events", "groups"].includes(primero) ? { tipo: "facebook", valor: `https://facebook.com/${primero}` } : null;
  if (host === "tiktok.com") return primero.startsWith("@") ? { tipo: "tiktok", valor: primero } : null;
  if (NO_SON_DE_MARCA.test(host) || /^(docs|drive|maps)\./.test(host)) return null;
  return { tipo: "web", valor: `${u.protocol}//${u.hostname}${u.pathname === "/" ? "" : u.pathname}` };
}

/** Palabras del dominio o la cuenta: "alfonsinaresto.com.ar" → "alfonsinaresto". */
export const claveDe = (u: URL, c: { tipo: Tipo; valor: string }) =>
  normalizar(c.tipo === "web" ? u.hostname.replace(/^www\./, "").split(".")[0] : c.valor.replace(/^@|https:\/\/facebook\.com\//, "")).replace(/ /g, "");

/** El cliente cuyo nombre está en el dominio o la cuenta (sin espacios, palabras de 4+ letras). */
export function clientePorNombre(clave: string, proyectos: Proyecto[]): Proyecto | null {
  const hay = proyectos.filter((p) => {
    const palabras = normalizar(p.nombre).split(" ").filter((w) => w.length >= 4);
    const junto = normalizar(p.nombre).replace(/ /g, "");
    return (junto.length >= 4 && clave.includes(junto)) || palabras.some((w) => clave.includes(w));
  });
  return hay.length === 1 ? hay[0] : null;
}

/** Título y descripción de la página (para el contexto de la IA). Solo hosts públicos, rápido y sin seguir a otros lados. */
export async function leerPagina(u: URL): Promise<string | null> {
  if (/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname) || /\.(local|internal)$/i.test(u.hostname)) return null;
  try {
    const r = await fetch(u.toString(), { redirect: "follow", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0 (Prodi)" } });
    if (!r.ok || !String(r.headers.get("content-type") ?? "").includes("text/html")) return null;
    const html = (await r.text()).slice(0, 200_000);
    const meta = (n: string) =>
      html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]+content=["']([^"']{3,300})["']`, "i"))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']{3,300})["'][^>]+(?:name|property)=["']${n}["']`, "i"))?.[1];
    const titulo = meta("og:title") ?? html.match(/<title[^>]*>([^<]{3,200})<\/title>/i)?.[1];
    const desc = meta("og:description") ?? meta("description");
    const limpio = (s?: string) => s?.replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    const t = [limpio(titulo), limpio(desc)].filter(Boolean).join(" — ");
    return t ? t.slice(0, 220) : null;
  } catch {
    return null;
  }
}

const NOMBRE: Record<Tipo, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", web: "página web" };

export async function linksDeMensaje(caller: Caller, chatId: unknown, mensajeId: unknown): Promise<{ guardados: number }> {
  const chat = await chatDeMiembro(chatId, caller.uid);
  const cid = String(chatId);
  if (typeof mensajeId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(mensajeId)) throw new HttpError(400, "Mensaje inválido");
  if (!["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"].includes(caller.role)) return { guardados: 0 };
  const db = adminDb();
  const msg = (await db.collection(`chats/${cid}/mensajes`).doc(mensajeId).get()).data();
  if (!msg || msg.by !== caller.uid || msg.by === PRODI_ID) throw new HttpError(403, "Ese mensaje no es tuyo");
  const texto = String(msg.texto ?? msg.leyenda ?? "");
  // Sin la parte de un mail ("lucas@gmail.com" no es una web).
  const encontrados = [...texto.matchAll(URL_RE)].filter((m) => texto[(m.index ?? 0) - 1] !== "@").map((m) => m[0].replace(/[.,;:!?]+$/, ""));
  const urls = [...new Set(encontrados)]
    .map(normalizarUrl)
    .filter((u): u is URL => !!u)
    .slice(0, 5);
  if (!urls.length) return { guardados: 0 };

  const proyectos = (await db.collection("projects").get()).docs
    .map((d) => ({ id: d.id, ...(d.data() ?? {}) }) as Proyecto)
    .filter((p) => p.enabled !== false && typeof p.nombre === "string");
  // Un cliente solo puede cargar links de su propio grupo.
  const delChat = typeof chat.proyecto_id === "string" ? proyectos.find((p) => p.id === chat.proyecto_id) ?? null : null;
  if (caller.role === "cliente" && !delChat) return { guardados: 0 };

  // Si no se deduce del link: el único cliente nombrado en los últimos mensajes de este chat.
  let nombradoAntes: Proyecto | null | undefined;
  const porContexto = async () => {
    if (nombradoAntes !== undefined) return nombradoAntes;
    const prev = await db.collection(`chats/${cid}/mensajes`).orderBy("at", "desc").limit(8).get();
    const charla = prev.docs.map((d) => String(d.data()?.texto ?? "")).join("\n");
    const n = clientesNombrados(charla, proyectos);
    nombradoAntes = n.length === 1 ? n[0] : null;
    return nombradoAntes;
  };

  const avisos: string[] = [];
  let guardados = 0;
  for (const u of urls) {
    const c = clasificar(u);
    if (!c) continue;
    const cliente = delChat ?? clientePorNombre(claveDe(u, c), proyectos) ?? (await porContexto());
    if (!cliente) continue;
    const redes = (cliente.redes ?? {}) as Record<string, string>;
    // A la ficha, solo si estaba vacío (no se pisa lo que cargó alguien).
    if (!String(redes[c.tipo] ?? "").trim()) {
      await db.collection("projects").doc(cliente.id).update({ [`redes.${c.tipo}`]: c.valor });
      redes[c.tipo] = c.valor;
      cliente.redes = redes as Data;
      avisos.push(`Guardé ${c.tipo === "web" ? "la" : "su"} ${NOMBRE[c.tipo]} en la ficha de ${cliente.nombre}: ${c.valor}`);
    }
    // A la memoria del cliente (contexto para la IA), con lo que dice la página si se puede leer.
    const pagina = c.tipo === "web" ? await leerPagina(u) : null;
    guardados += await guardarNotasChat(
      cliente.id,
      cid,
      [`${NOMBRE[c.tipo][0].toUpperCase()}${NOMBRE[c.tipo].slice(1)} de ${cliente.nombre}: ${c.valor}${pagina ? ` (${pagina})` : ""}`],
      caller.uid
    );
  }
  if (avisos.length) await mensajeProdi(cid, avisos.join("\n"));
  return { guardados };
}
