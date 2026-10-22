/* eslint-disable @typescript-eslint/no-explicit-any */
// Formularios de los anuncios de Prodi en Meta (Lead Ads) → leads del tablero (colección `leads_web`).
// · Meta avisa cada formulario nuevo al webhook /api/web/meta-webhook (campo "leadgen" de la página de Prodi). No se
//   confía en lo que llega: con el id se le pide el formulario a Meta con nuestro token, y si no existe no se guarda.
// · "Conectar formularios" (Leads → Temporada y cupos) suscribe la app a la página y trae los de los últimos 30 días.
// Cada formulario entra una sola vez (el id del lead sale del id de Meta). Avisa a los admins.
// Variables: META_ACCESS_TOKEN (usuario del sistema con leads_retrieval, pages_manage_metadata, pages_show_list,
// pages_read_engagement y la página de Prodi asignada), META_APP_SECRET, META_PRODI_PAGE_ID, META_WEBHOOK_TOKEN.

import crypto from "crypto";
import { getPool, guardarDoc, leerDoc } from "./db";
import { HttpError } from "./http";
import { adminDb } from "./db";
import { enviarAviso } from "./notify";
import { decrypt, encrypt, type EncryptedPayload } from "./crypto";

const VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";
const COL = "leads_web";

function prueba(token: string) {
  const s = process.env.META_APP_SECRET;
  return s ? crypto.createHmac("sha256", s).update(token).digest("hex") : undefined;
}

async function graph(ruta: string, params: Record<string, string> = {}, token = process.env.META_ACCESS_TOKEN ?? "", metodo: "GET" | "POST" = "GET"): Promise<any> {
  if (!token) throw new HttpError(500, "Falta META_ACCESS_TOKEN en Vercel");
  const qs = new URLSearchParams({ ...params, access_token: token });
  const p = prueba(token);
  if (p) qs.set("appsecret_proof", p);
  const r = await fetch(`https://graph.facebook.com/${VERSION()}/${ruta}${metodo === "GET" ? `?${qs}` : ""}`, metodo === "POST" ? { method: "POST", body: qs } : undefined);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new HttpError(502, `Meta: ${j?.error?.message ?? r.status}`);
  return j;
}

/** El mismo lead de Meta siempre da el mismo id (así no entra dos veces). */
const idDeLead = (leadgenId: string) => {
  const h = crypto.createHash("sha256").update(`meta-lead:${leadgenId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

// Sin caracteres de control: todo en una línea.
const limpio = (v: unknown, max: number) =>
  Array.from(String(v ?? ""), (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").trim().slice(0, max);

/** Las respuestas del formulario: lo conocido a su campo, el resto a las notas. */
function respuestas(campos: { name: string; values?: string[] }[]) {
  const m = new Map(campos.map((c) => [c.name.toLowerCase(), (c.values ?? []).join(", ")]));
  const tomar = (...claves: string[]) => {
    for (const k of claves) {
      const v = m.get(k);
      if (v) {
        m.delete(k);
        return v;
      }
    }
    return "";
  };
  const nombre = tomar("full_name", "nombre_completo", "nombre") || [tomar("first_name"), tomar("last_name")].filter(Boolean).join(" ");
  const telefono = tomar("phone_number", "telefono", "teléfono", "whatsapp");
  const email = tomar("email", "correo");
  const negocio = tomar("company_name", "empresa", "negocio", "nombre_del_negocio");
  const ciudad = tomar("city", "ciudad", "localidad");
  const instagram = tomar("instagram", "usuario_de_instagram");
  const otras = [...m.entries()].filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ").replace(/\?$/, "")}: ${v}`);
  return { nombre, telefono, email, negocio, ciudad, instagram, otras };
}

async function temporadaActual(): Promise<string> {
  const d = await leerDoc(getPool(), "web_config", "general");
  return typeof d?.temporada === "string" && d.temporada.trim() ? d.temporada : "Verano 2027";
}

/** Guarda un formulario de Meta como lead (si ya estaba, no hace nada). Devuelve true si es nuevo. */
async function guardarLead(lead: any, temporada: string, base: string): Promise<boolean> {
  const id = idDeLead(String(lead.id));
  const pool = getPool();
  if (await leerDoc(pool, COL, id)) return false;
  const r = respuestas(Array.isArray(lead.field_data) ? lead.field_data : []);
  const at = lead.created_time ? new Date(lead.created_time).toISOString() : new Date().toISOString();
  const plataforma = String(lead.platform ?? "").toLowerCase() === "ig" ? "Instagram" : "Facebook";
  const negocio = limpio(r.negocio || r.nombre || "Formulario de Meta", 80);
  const notas = [
    `Formulario de ${plataforma}${lead.form_name ? ` «${lead.form_name}»` : ""}${lead.ad_name ? ` · anuncio «${lead.ad_name}»` : ""}${lead.campaign_name ? ` · campaña «${lead.campaign_name}»` : ""}`,
    ...r.otras,
  ].join("\n");
  await guardarDoc(pool, COL, id, {
    created_at: at,
    updated_at: new Date().toISOString(),
    temporada,
    nombre: limpio(r.nombre, 80),
    negocio,
    email: limpio(r.email, 120).toLowerCase(),
    telefono: limpio(r.telefono, 40),
    instagram: limpio(r.instagram, 120),
    ubicacion: limpio(r.ciudad, 300),
    rubro: "",
    califica: true,
    dudoso: false,
    estado: "calificado",
    notas: notas.slice(0, 4000),
    manual: true,
    fuente: `Formulario ${plataforma}`,
    origen: "meta:leadgen",
    meta: { leadgen_id: String(lead.id), form_id: lead.form_id ?? null, ad_id: lead.ad_id ?? null, campaign_name: lead.campaign_name ?? null, ad_name: lead.ad_name ?? null },
    historial: [{ at, de: null, a: "calificado", por: null, por_nombre: `Formulario de ${plataforma}` }],
  });
  const admins = (await adminDb().collection("profiles").where("role", "==", "admin").get()).docs.filter((d) => d.data().activo !== false).map((d) => d.id);
  await enviarAviso(
    {
      destinatarios: admins,
      titulo: `📥 Nuevo lead: ${negocio}`,
      cuerpo: `Llenó el formulario de ${plataforma}${r.telefono ? ` · ${r.telefono}` : ""}. Escribile mientras está caliente.`,
      link: "/web",
      clave: `lead-meta:${lead.id}`,
    },
    base
  ).catch(() => undefined);
  return true;
}

const CAMPOS_LEAD = "id,created_time,field_data,form_id,ad_id,ad_name,campaign_name,platform";

// Token de página guardado desde el panel (cifrado). Sale de un token de usuario de un admin de la página con
// leads_retrieval: el usuario del sistema no siempre puede tener ese permiso. Canjeado a largo plazo, no vence.
const SECRETO = { col: "secretos", id: "meta_leads" };
const APP_ID = () => (process.env.META_APP_ID ?? "1702831641421860").trim();

async function tokenGuardado(): Promise<{ id: string; nombre: string; token: string } | null> {
  const d = await leerDoc(getPool(), SECRETO.col, SECRETO.id);
  if (!d?.cifrado) return null;
  try {
    return { id: String(d.pagina_id), nombre: String(d.pagina ?? "Prodi"), token: decrypt(d.cifrado as EncryptedPayload) };
  } catch {
    return null;
  }
}

/** Guarda el token de la página a partir del token de usuario que pegó el admin (lo canjea por uno que no vence). */
export async function guardarTokenUsuario(tokenUsuario: string, base: string) {
  const corto = tokenUsuario.trim();
  if (!/^EAA[\w-]{20,}$/.test(corto)) throw new HttpError(400, "Pegá el identificador completo (empieza con EAA)");
  // Token de usuario de 60 días: las páginas que salen de él no vencen. Con la clave secreta de la app se canjea acá;
  // sin ella, tiene que venir ya ampliado (Depurador de tokens de Meta → "Ampliar token de acceso").
  const secret = process.env.META_APP_SECRET;
  let largo: any = { access_token: corto };
  if (secret) {
    largo = await fetch(
      `https://graph.facebook.com/${VERSION()}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: APP_ID(), client_secret: secret, fb_exchange_token: corto })}`
    ).then((r) => r.json() as Promise<any>);
    if (!largo?.access_token) throw new HttpError(400, `Meta: ${largo?.error?.message ?? "no aceptó el identificador"}`);
  }
  const id = (process.env.META_PRODI_PAGE_ID ?? "").trim();
  const cuentas = (await graph("me/accounts", { fields: "id,name,access_token", limit: "100" }, largo.access_token)).data ?? [];
  const pagina = cuentas.find((p: any) => p.id === id) ?? (id ? null : cuentas[0]);
  if (!pagina?.access_token) throw new HttpError(400, "Ese usuario no administra la página de Prodi (o no la eligió al dar permisos)");
  await guardarDoc(getPool(), SECRETO.col, SECRETO.id, { pagina_id: pagina.id, pagina: pagina.name, cifrado: encrypt(pagina.access_token), updated_at: new Date().toISOString() });
  return conectarFormularios(base);
}

/** Token de la página de Prodi (para suscribirla y leer sus formularios). */
async function tokenPagina(): Promise<{ id: string; nombre: string; token: string }> {
  const guardado = await tokenGuardado();
  if (guardado) return guardado;
  const id = (process.env.META_PRODI_PAGE_ID ?? "").trim();
  if (!id) throw new HttpError(400, "Falta META_PRODI_PAGE_ID en Vercel (el id de la página de Facebook de Prodi)");
  const p = await graph(id, { fields: "name,access_token" });
  if (!p.access_token) throw new HttpError(400, "El usuario del sistema no tiene acceso completo a la página de Prodi");
  return { id, nombre: p.name ?? "Prodi", token: p.access_token };
}

/** GET del webhook: Meta verifica que la URL es nuestra. */
export function verificarWebhook(q: Record<string, unknown>): string {
  const esperado = (process.env.META_WEBHOOK_TOKEN ?? "").trim();
  if (q["hub.mode"] === "subscribe" && esperado && q["hub.verify_token"] === esperado) return String(q["hub.challenge"] ?? "");
  throw new HttpError(403, "Token de verificación incorrecto");
}

/** POST del webhook: formularios nuevos. */
export async function recibirWebhook(b: any, base: string) {
  const ids: string[] = [];
  for (const e of Array.isArray(b?.entry) ? b.entry : [])
    for (const c of Array.isArray(e?.changes) ? e.changes : []) if (c?.field === "leadgen" && c.value?.leadgen_id) ids.push(String(c.value.leadgen_id));
  if (!ids.length) return { ok: true, nuevos: 0 };
  const temporada = await temporadaActual();
  let token = process.env.META_ACCESS_TOKEN ?? "";
  try {
    token = (await tokenPagina()).token;
  } catch {
    /* con el del sistema */
  }
  let nuevos = 0;
  for (const id of ids.slice(0, 20)) {
    try {
      const lead = await graph(/^\d+$/.test(id) ? id : "x", { fields: CAMPOS_LEAD }, token);
      if (await guardarLead(lead, temporada, base)) nuevos++;
    } catch (err) {
      console.error(`[meta-leads] no se pudo traer el lead ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { ok: true, nuevos };
}

/** Conecta la página de Prodi (suscribe la app a sus formularios) y trae los de los últimos 30 días. */
export async function conectarFormularios(base: string) {
  const pagina = await tokenPagina();
  try {
    await graph(`${pagina.id}/subscribed_apps`, { subscribed_fields: "leadgen" }, pagina.token, "POST");
  } catch (err) {
    // Para saber qué arreglar en Meta: qué permisos tiene de verdad el token que está en Vercel.
    const t = process.env.META_ACCESS_TOKEN ?? "";
    const permisos = await graph("debug_token", { input_token: t }, t)
      .then((d) => (d?.data?.scopes ?? []).join(", ") || "ninguno")
      .catch(() => "no se pudo ver");
    throw new HttpError(502, `${err instanceof Error ? err.message : "Meta rechazó la conexión"} · El token de Vercel tiene: ${permisos}`);
  }
  const desde = Math.floor(Date.now() / 1000) - 30 * 86400;
  const formularios = (await graph(`${pagina.id}/leadgen_forms`, { fields: "id,name,status", limit: "50" }, pagina.token)).data ?? [];
  const temporada = await temporadaActual();
  let nuevos = 0;
  for (const f of formularios) {
    const leads = (
      await graph(`${f.id}/leads`, { fields: CAMPOS_LEAD, limit: "100", filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desde }]) }, pagina.token).catch(
        () => ({ data: [] })
      )
    ).data;
    for (const l of leads ?? []) if (await guardarLead({ ...l, form_name: f.name }, temporada, base)) nuevos++;
  }
  return { pagina: pagina.nombre, formularios: formularios.length, nuevos };
}
