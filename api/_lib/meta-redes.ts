/* eslint-disable @typescript-eslint/no-explicit-any */
// Instagram y Facebook de los clientes (solo lectura): con el mismo usuario del sistema de la pauta, el sistema ve las
// páginas que tiene asignadas Prodi en su Business Manager y el Instagram vinculado a cada una. Todos los días guarda
// una foto por cliente (seguidores de IG y FB, alcance y visitas al perfil del día) en `metricas_redes`, para mostrar
// el crecimiento ("tenías 1.240, hoy 3.480").
// Permisos del token: los de la pauta + instagram_basic, instagram_manage_insights, pages_read_engagement.

import crypto from "crypto";
import { adminDb } from "./db";
import { hoyAR, sumarDias } from "./fecha";

const VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";

function token(): { token: string; proof?: string } {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error("Falta META_ACCESS_TOKEN en Vercel (el mismo de la pauta)");
  const s = process.env.META_APP_SECRET?.replace(/[\s"']/g, "");
  return { token: t, proof: s ? crypto.createHmac("sha256", s).update(t).digest("hex") : undefined };
}

async function graph(path: string, params: Record<string, string> = {}): Promise<any> {
  const { token: t, proof } = token();
  const qs = new URLSearchParams({ ...params, access_token: t });
  if (proof) qs.set("appsecret_proof", proof);
  const r = await fetch(`https://graph.facebook.com/${VERSION()}/${path}${path.includes("?") ? "&" : "?"}${qs}`);
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `Meta respondió ${r.status}`);
  return j;
}

export interface PaginaMeta {
  id: string;
  nombre: string;
  usuario: string | null;
  seguidores: number | null;
  ig: { id: string; usuario: string | null; seguidores: number | null } | null;
}

/** Las páginas de Facebook que el usuario del sistema tiene asignadas (con su Instagram vinculado). */
export async function paginasAsignadas(): Promise<PaginaMeta[]> {
  const out: PaginaMeta[] = [];
  let siguiente: string | null = "me/accounts";
  let params: Record<string, string> = {
    fields: "id,name,username,followers_count,fan_count,instagram_business_account{id,username,followers_count}",
    limit: "100",
  };
  for (let i = 0; i < 10 && siguiente; i++) {
    const j: any = await graph(siguiente, params);
    for (const p of j?.data ?? []) {
      const ig = p.instagram_business_account;
      out.push({
        id: String(p.id),
        nombre: String(p.name ?? ""),
        usuario: p.username ?? null,
        seguidores: p.followers_count ?? p.fan_count ?? null,
        ig: ig ? { id: String(ig.id), usuario: ig.username ?? null, seguidores: ig.followers_count ?? null } : null,
      });
    }
    const after = j?.paging?.cursors?.after;
    siguiente = j?.paging?.next && after ? "me/accounts" : null;
    params = { ...params, after: after ?? "" };
  }
  return out;
}

const clave = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/[^a-z0-9]/g, "");

/** La página de un cliente: la que ya tiene cargada, la de su usuario de Instagram o la que se llama igual. */
function paginaDe(p: Record<string, any>, paginas: PaginaMeta[]): PaginaMeta | null {
  if (p.meta?.page_id) return paginas.find((x) => x.id === p.meta.page_id) ?? null;
  if (p.meta?.ig_user_id) return paginas.find((x) => x.ig?.id === p.meta.ig_user_id) ?? null;
  const ig = clave(p.redes?.instagram);
  if (ig) {
    const porIg = paginas.find((x) => clave(x.ig?.usuario) === ig);
    if (porIg) return porIg;
  }
  const n = clave(p.nombre);
  if (n.length < 3) return null;
  const iguales = paginas.filter((x) => clave(x.nombre) === n || clave(x.usuario) === n || clave(x.ig?.usuario) === n);
  if (iguales.length === 1) return iguales[0];
  const parecidas = paginas.filter((x) => clave(x.nombre).includes(n) || (clave(x.nombre).length >= 4 && n.includes(clave(x.nombre))));
  return parecidas.length === 1 ? parecidas[0] : null;
}

/** Las cuentas publicitarias que el usuario del sistema tiene asignadas. */
async function cuentasAsignadas(): Promise<{ id: string; nombre: string }[]> {
  const out: { id: string; nombre: string }[] = [];
  let params: Record<string, string> = { fields: "account_id,name", limit: "200" };
  for (let i = 0; i < 10; i++) {
    const j: any = await graph("me/adaccounts", params);
    for (const a of j?.data ?? []) out.push({ id: String(a.account_id ?? String(a.id ?? "").replace(/^act_/, "")), nombre: String(a.name ?? "") });
    const after = j?.paging?.cursors?.after;
    if (!j?.paging?.next || !after) break;
    params = { ...params, after };
  }
  return out;
}

/**
 * La cuenta publicitaria de un cliente: la que se llama como él, como su página o como su Instagram. Solo si hay
 * una sola que coincide (si hay dudas, se carga a mano en la ficha).
 */
function cuentaDe(p: Record<string, any>, pag: PaginaMeta | null, cuentas: { id: string; nombre: string }[]): { id: string; nombre: string } | null {
  const nombres = [p.nombre, pag?.nombre, pag?.usuario, pag?.ig?.usuario, p.redes?.instagram].map(clave).filter((n) => n.length >= 3);
  for (const n of nombres) {
    const iguales = cuentas.filter((c) => clave(c.nombre) === n);
    if (iguales.length === 1) return iguales[0];
  }
  for (const n of nombres) {
    const parecidas = cuentas.filter((c) => {
      const k = clave(c.nombre);
      return k.length >= 3 && (k.includes(n) || (k.length >= 4 && n.includes(k)));
    });
    if (parecidas.length === 1) return parecidas[0];
  }
  return null;
}

export type EstadoMeta = "ok" | "sin_ig" | "sin_acceso" | "error";
export interface ChequeoCliente {
  id: string;
  nombre: string;
  estado: EstadoMeta;
  detalle: string;
  pagina: string | null;
  ig: string | null;
  seguidores_ig: number | null;
  seguidores_fb: number | null;
  /** La cuenta publicitaria: la que encontró ahora, "cargada" si ya estaba o null si no hay. */
  cuenta: string | null;
}

/**
 * Revisa cliente por cliente si se puede leer su Instagram/Facebook. Si encuentra la página y la ficha no la tenía,
 * la completa (meta.page_id e ig_user_id). Además saca la foto del día de los que se pueden leer.
 */
export async function chequeoMeta(): Promise<{ clientes: ChequeoCliente[]; paginas: number }> {
  const db = adminDb();
  const paginas = await paginasAsignadas();
  // Si el token no tiene ads_read, sin cuentas (lo demás sigue igual).
  const cuentas = await cuentasAsignadas().catch(() => [] as { id: string; nombre: string }[]);
  const proyectos = (await db.collection("projects").get()).docs.filter((d) => d.data().enabled !== false);
  const out: ChequeoCliente[] = [];
  for (const d of proyectos) {
    const p = d.data();
    const pag = paginaDe(p, paginas);
    if (pag && (!p.meta?.page_id || (pag.ig && !p.meta?.ig_user_id))) {
      await d.ref.update({ "meta.page_id": pag.id, ...(pag.ig ? { "meta.ig_user_id": pag.ig.id } : {}) });
    }
    // La cuenta publicitaria (para la pauta de toda la cuenta), si todavía no la tiene cargada.
    const cuenta = p.meta?.ad_account_id ? null : cuentaDe(p, pag, cuentas);
    if (cuenta) await d.ref.update({ "meta.ad_account_id": cuenta.id });
    let estado: EstadoMeta = !pag ? "sin_acceso" : pag.ig ? "ok" : "sin_ig";
    let detalle =
      estado === "sin_acceso"
        ? "Prodi no tiene acceso a su página de Facebook (o se llama distinto: cargala en la ficha)."
        : estado === "sin_ig"
          ? "La página no tiene un Instagram profesional vinculado."
          : "Se lee todos los días.";
    if (estado === "ok") {
      try {
        await fotoCliente(d.id, pag!);
      } catch (err) {
        estado = "error";
        detalle = err instanceof Error ? err.message : "Meta no respondió";
      }
    }
    out.push({
      id: d.id,
      nombre: String(p.nombre ?? ""),
      estado,
      detalle,
      pagina: pag?.nombre ?? null,
      cuenta: cuenta?.nombre ?? (p.meta?.ad_account_id ? "cargada" : null),
      ig: pag?.ig?.usuario ?? null,
      seguidores_ig: pag?.ig?.seguidores ?? null,
      seguidores_fb: pag?.seguidores ?? null,
    });
  }
  const orden: Record<EstadoMeta, number> = { error: 0, sin_acceso: 1, sin_ig: 2, ok: 3 };
  out.sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre));
  return { clientes: out, paginas: paginas.length };
}

/** Alcance y visitas al perfil de ayer en Instagram (si Meta los da). */
async function insightsIgAyer(igId: string): Promise<{ alcance: number | null; visitas: number | null }> {
  try {
    const ayer = sumarDias(hoyAR(), -1);
    const desde = Math.floor(new Date(`${ayer}T00:00:00-03:00`).getTime() / 1000);
    const j = await graph(`${igId}/insights`, {
      metric: "reach,profile_views",
      period: "day",
      metric_type: "total_value",
      since: String(desde),
      until: String(desde + 86_400),
    });
    const val = (nombre: string) => {
      const m = (j?.data ?? []).find((x: any) => x.name === nombre);
      return m?.total_value?.value ?? m?.values?.[0]?.value ?? null;
    };
    return { alcance: val("reach"), visitas: val("profile_views") };
  } catch {
    return { alcance: null, visitas: null };
  }
}

/** La foto del día de un cliente (una por día: si ya hay, se actualiza). */
async function fotoCliente(pid: string, pag: PaginaMeta) {
  const db = adminDb();
  let igSeg = pag.ig?.seguidores ?? null;
  let fbSeg = pag.seguidores;
  // Si la lista vino sin números (pasa con algunas páginas), se piden de a uno.
  if (pag.ig && igSeg == null) igSeg = (await graph(pag.ig.id, { fields: "followers_count" }))?.followers_count ?? null;
  if (fbSeg == null) fbSeg = (await graph(pag.id, { fields: "followers_count,fan_count" }).catch(() => null))?.followers_count ?? null;
  const ins = pag.ig ? await insightsIgAyer(pag.ig.id) : { alcance: null, visitas: null };
  const fecha = hoyAR();
  // El alcance de cada día lo anota meta-cuenta.ts en el doc de ese día: acá queda el de ayer en el de ayer.
  if (ins.alcance != null) {
    await db.collection("metricas_redes").doc(`${pid}_${sumarDias(fecha, -1)}`).set({ proyecto_id: pid, fecha: sumarDias(fecha, -1), ig_alcance_dia: ins.alcance }, { merge: true });
  }
  await db
    .collection("metricas_redes")
    .doc(`${pid}_${fecha}`)
    .set({
      proyecto_id: pid,
      fecha,
      ig_usuario: pag.ig?.usuario ?? null,
      ig_seguidores: igSeg,
      fb_seguidores: fbSeg,
      ig_visitas_perfil_dia: ins.visitas,
      at: new Date().toISOString(),
    }, { merge: true });
}

/** Cron diario: la foto de todos los clientes que se pueden leer. */
export async function fotoRedesTodos(): Promise<string> {
  if (!process.env.META_ACCESS_TOKEN) return "sin token";
  const { clientes } = await chequeoMeta();
  const ok = clientes.filter((c) => c.estado === "ok").length;
  return `${ok} de ${clientes.length} clientes leídos`;
}

/**
 * La web que el cliente tiene puesta en su página de Facebook y en su Instagram (el campo "sitio web" del perfil).
 * La usa el catálogo del CRM para comprobar que una web es del cliente sin que nadie la apruebe a mano.
 */
export async function websEnMeta(p: Record<string, any>): Promise<string[]> {
  const out: string[] = [];
  const pedidos: Promise<void>[] = [];
  if (p.meta?.page_id)
    pedidos.push(
      graph(String(p.meta.page_id), { fields: "website" })
        .then((j) => void out.push(...String(j?.website ?? "").split(/\s+/)))
        .catch(() => undefined)
    );
  if (p.meta?.ig_user_id)
    pedidos.push(
      graph(String(p.meta.ig_user_id), { fields: "website" })
        .then((j) => void out.push(String(j?.website ?? "")))
        .catch(() => undefined)
    );
  await Promise.all(pedidos);
  return out.filter(Boolean);
}
