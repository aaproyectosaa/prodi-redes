/* eslint-disable @typescript-eslint/no-explicit-any */
// Pauta de toda la cuenta publicitaria y el Instagram de cada cliente, día por día (solo lectura).
// Con el mismo token de usuario del sistema de la pauta (META_ACCESS_TOKEN, ver docs/META.md):
//   · meta_pauta_diaria/{pid}_{fecha}_{campaña}: gasto, alcance, clics, mensajes, compras, leads… por campaña y día.
//   · metricas_redes/{pid}_{fecha}: se le suman alcance, visualizaciones e interacciones del día en Instagram
//     (los seguidores los sigue anotando la foto diaria de meta-redes.ts).
// El cron diario trae los últimos 3 días (Meta corrige los números recientes); "Traer historial" hasta 90.
// El token nunca se loguea ni sale del servidor.

import crypto from "crypto";
import { adminDb } from "./db";
import { hoyAR, sumarDias } from "./fecha";

const VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";
// Errores de Meta por límite de uso: se espera y se reintenta.
const LIMITE = new Set([4, 17, 613, 80004]);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(url: string): Promise<any> {
  for (let intento = 0; ; intento++) {
    const r = await fetch(url);
    const j: any = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const code = Number(j?.error?.code);
    if (LIMITE.has(code) && intento < 3) {
      await esperar(2000 * 2 ** intento);
      continue;
    }
    throw new Error(enCriollo(code, j?.error?.message ?? `Meta respondió ${r.status}`));
  }
}

function urlDe(path: string, params: Record<string, string>): string {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("Falta META_ACCESS_TOKEN en Vercel");
  const qs = new URLSearchParams({ ...params, access_token: token });
  const secret = process.env.META_APP_SECRET;
  if (secret) qs.set("appsecret_proof", crypto.createHmac("sha256", secret).update(token).digest("hex"));
  return `https://graph.facebook.com/${VERSION()}/${path}?${qs}`;
}

/** Todas las páginas de resultados (sigue `paging.next`). */
async function graphTodo(path: string, params: Record<string, string>): Promise<any[]> {
  const out: any[] = [];
  let url: string | null = urlDe(path, params);
  for (let i = 0; i < 50 && url; i++) {
    const j: any = await graph(url);
    out.push(...(j?.data ?? []));
    url = j?.paging?.next ?? null;
  }
  return out;
}

function enCriollo(code: number, msg: string): string {
  if (code === 190) return "El token de Meta venció o no es válido: hay que generarlo de nuevo.";
  if (code === 10 || code === 200 || /permission/i.test(msg)) return "Prodi no tiene permiso para leer esto en Meta (falta asignar el activo o un permiso del token).";
  if (code === 100 && /does not exist|Unsupported get request/i.test(msg)) return "Ese ID no existe o Prodi no tiene acceso.";
  if (LIMITE.has(code)) return "Meta está limitando las consultas: probá en un rato.";
  return `Meta: ${msg}`;
}

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const dec = (v: unknown) => (v == null || v === "" ? null : Math.round(Number(v) * 100) / 100);

function accion(lista: any[] | undefined, ...tipos: string[]): number {
  for (const t of tipos) {
    const a = (lista ?? []).find((x: any) => x.action_type === t);
    if (a) return num(a.value);
  }
  return 0;
}

/** Tramos de hasta 30 días entre dos fechas (inclusive). */
function tramos(desde: string, hasta: string): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 30)) {
    const fin = sumarDias(d, 29);
    out.push({ since: d, until: fin < hasta ? fin : hasta });
  }
  return out;
}

/** Pauta de la cuenta publicitaria por campaña y día. */
async function pautaCuenta(pid: string, cuenta: string, desde: string, hasta: string): Promise<number> {
  const db = adminDb();
  let filas = 0;
  for (const t of tramos(desde, hasta)) {
    const data = await graphTodo(`act_${cuenta}/insights`, {
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify(t),
      fields:
        "campaign_id,campaign_name,objective,spend,account_currency,impressions,reach,clicks,inline_link_clicks,ctr,cpm,cpc,actions,action_values,video_thruplay_watched_actions",
      limit: "500",
    });
    const lote = db.batch();
    for (const d of data) {
      const fecha = String(d.date_start);
      const camp = String(d.campaign_id);
      lote.set(db.collection("meta_pauta_diaria").doc(`${pid}_${fecha}_${camp}`), {
        proyecto_id: pid,
        fecha,
        campaign_id: camp,
        campaign_name: d.campaign_name ?? null,
        objetivo: d.objective ?? null,
        gasto: dec(d.spend) ?? 0,
        moneda: d.account_currency ?? null,
        impresiones: num(d.impressions),
        alcance: num(d.reach),
        clics: num(d.inline_link_clicks ?? d.clicks),
        ctr: dec(d.ctr),
        cpm: dec(d.cpm),
        cpc: dec(d.cpc),
        mensajes: accion(d.actions, "onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"),
        compras: accion(d.actions, "purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"),
        valor_compras: dec(accion(d.action_values, "purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase")) ?? 0,
        leads: accion(d.actions, "lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"),
        reproducciones_3s: accion(d.actions, "video_view"),
        thruplays: accion(d.video_thruplay_watched_actions, "video_view"),
        acciones_raw: d.actions ?? [],
        at: new Date().toISOString(),
      });
      filas++;
    }
    if (data.length) await lote.commit();
  }
  return filas;
}

/** Alcance, visualizaciones e interacciones de Instagram de cada día (se suman a la foto del día). */
async function igDias(pid: string, igId: string, desde: string, hasta: string): Promise<number> {
  const db = adminDb();
  const dias: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  let ok = 0;
  // De a 5 en paralelo: Meta da estos totales de a un día por consulta.
  for (let i = 0; i < dias.length; i += 5) {
    await Promise.all(
      dias.slice(i, i + 5).map(async (fecha) => {
        const desdeTs = Math.floor(new Date(`${fecha}T00:00:00-03:00`).getTime() / 1000);
        const val: Record<string, number | null> = { reach: null, views: null, total_interactions: null };
        // Cada métrica por separado: si una no está disponible para la cuenta, las otras igual se guardan.
        for (const m of Object.keys(val)) {
          try {
            const j = await graph(urlDe(`${igId}/insights`, { metric: m, period: "day", metric_type: "total_value", since: String(desdeTs), until: String(desdeTs + 86_400) }));
            const x = (j?.data ?? [])[0];
            val[m] = x?.total_value?.value ?? x?.values?.[0]?.value ?? null;
          } catch (err) {
            if (err instanceof Error && /token|permiso/i.test(err.message)) throw err;
          }
        }
        if (val.reach == null && val.views == null && val.total_interactions == null) return;
        await db
          .collection("metricas_redes")
          .doc(`${pid}_${fecha}`)
          .set({ proyecto_id: pid, fecha, ig_alcance_dia: val.reach, ig_vistas_dia: val.views, ig_interacciones_dia: val.total_interactions }, { merge: true });
        ok++;
      })
    );
  }
  return ok;
}

export interface ResultadoSync {
  ok: boolean;
  detalle: string;
}

/** Trae los últimos `dias` días de pauta e Instagram de un cliente y anota cómo salió (`meta_sync` en la ficha). */
export async function sincronizarCuentaMeta(pid: string, dias = 3): Promise<ResultadoSync> {
  const db = adminDb();
  const ref = db.collection("projects").doc(pid);
  const p = (await ref.get()).data();
  if (!p) throw new Error("Cliente no encontrado");
  const cuenta = String(p.meta?.ad_account_id ?? "").trim().replace(/^act_/, "");
  const ig = String(p.meta?.ig_user_id ?? "").trim();
  if (!cuenta && !ig) return { ok: false, detalle: "No tiene cargada la cuenta publicitaria ni el Instagram." };
  const hasta = hoyAR();
  const desde = sumarDias(hasta, -(Math.min(Math.max(dias, 1), 90) - 1));
  const partes: string[] = [];
  let ok = true;
  if (cuenta) {
    try {
      const n = await pautaCuenta(pid, cuenta, desde, hasta);
      partes.push(`Pauta: ${n} ${n === 1 ? "registro" : "registros"}`);
    } catch (err) {
      ok = false;
      partes.push(`Pauta: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  if (ig) {
    try {
      const n = await igDias(pid, ig, desde, hasta);
      // Seguidores: foto del día (Meta no da el histórico).
      const perfil = await graph(urlDe(ig, { fields: "followers_count,username" }));
      if (perfil?.followers_count != null) {
        await db
          .collection("metricas_redes")
          .doc(`${pid}_${hasta}`)
          .set({ proyecto_id: pid, fecha: hasta, ig_seguidores: Number(perfil.followers_count), ig_usuario: perfil.username ?? null }, { merge: true });
      }
      partes.push(`Instagram: ${n} ${n === 1 ? "día" : "días"}${perfil?.followers_count != null ? ` · ${perfil.followers_count} seguidores` : " · sin seguidores"}`);
    } catch (err) {
      ok = false;
      partes.push(`Instagram: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  const detalle = partes.join(" · ");
  // Historial completo: ya se trajeron 90 días con estos IDs (si cambian los IDs, se vuelve a traer).
  const historial = p.meta_sync?.ids === idsDe(p) && p.meta_sync?.historial ? true : ok && dias >= 90;
  await ref.update({ meta_sync: { at: new Date().toISOString(), ok, detalle, desde, hasta, historial, ids: idsDe(p) } });
  return { ok, detalle };
}

const idsDe = (p: Record<string, any>) => `${String(p.meta?.ad_account_id ?? "").replace(/^act_/, "").trim()}|${String(p.meta?.ig_user_id ?? "").trim()}`;

/** ¿Le falta traer el historial (90 días)? La primera vez o si le cambiaron los IDs de Meta. */
const faltaHistorial = (p: Record<string, any>) => !p.meta_sync?.historial || p.meta_sync?.ids !== idsDe(p);

const CADA = 3 * 3600_000; // Al abrir la pantalla: si lo último tiene más de 3 horas, se vuelve a buscar.

/**
 * Lo que se trae solo: el historial de 90 días la primera vez (o si cambiaron los IDs) y después los últimos 3 días.
 * Sin `forzar` (al abrir la pantalla), no hace nada si se actualizó hace menos de 3 horas.
 */
export async function sincronizarAuto(pid: string, forzar = false): Promise<ResultadoSync & { saltado?: boolean }> {
  const p = (await adminDb().collection("projects").doc(pid).get()).data();
  if (!p) throw new Error("Cliente no encontrado");
  if (!p.meta?.ad_account_id && !p.meta?.ig_user_id) return { ok: false, detalle: "Sin IDs de Meta", saltado: true };
  const historia = faltaHistorial(p);
  const reciente = p.meta_sync?.at && Date.now() - new Date(p.meta_sync.at).getTime() < CADA;
  if (!forzar && !historia && reciente) return { ok: true, detalle: p.meta_sync.detalle ?? "", saltado: true };
  return sincronizarCuentaMeta(pid, historia ? 90 : 3);
}

/** Cron diario: los últimos 3 días de cada cliente, de a uno; si uno falla, sigue con el próximo. */
export async function sincronizarCuentasTodos(): Promise<string> {
  if (!process.env.META_ACCESS_TOKEN) return "sin token";
  const proyectos = (await adminDb().collection("projects").get()).docs.filter((d) => {
    const p = d.data();
    return p.enabled !== false && !p.demo_ejemplo && (p.meta?.ad_account_id || p.meta?.ig_user_id);
  });
  let bien = 0;
  let historiales = 0;
  for (const d of proyectos) {
    try {
      // El historial tarda más: hasta 2 por corrida (el resto, al otro día o cuando alguien abre su pantalla).
      if (faltaHistorial(d.data())) {
        if (historiales >= 2) continue;
        historiales++;
      }
      if ((await sincronizarAuto(d.id, true)).ok) bien++;
    } catch (err) {
      console.warn("[meta-cuenta]", d.id, err instanceof Error ? err.message : err);
    }
  }
  return `${bien} de ${proyectos.length} clientes al día`;
}
