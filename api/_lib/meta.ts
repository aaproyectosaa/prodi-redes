/* eslint-disable @typescript-eslint/no-explicit-any */
// Resultados de pauta desde Meta (Marketing API, solo lectura).
// Necesita un token de usuario del sistema del Business Manager de Prodi con permiso ads_read
// sobre las cuentas publicitarias de los clientes. Ver docs/META.md.

import crypto from "crypto";
import { adminDb } from "./db";

const VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";

function credenciales(): { token: string; proof?: string } {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("Falta META_ACCESS_TOKEN en Vercel");
  const secret = process.env.META_APP_SECRET;
  return { token, proof: secret ? crypto.createHmac("sha256", secret).update(token).digest("hex") : undefined };
}

export interface ResultadosMeta {
  alcance: number | null;
  impresiones: number | null;
  reproducciones: number | null;
  interacciones: number | null;
  mensajes: number | null;
  clics: number | null;
  gasto: number | null;
}

const n = (v: unknown) => (v == null || v === "" ? null : Math.round(Number(v) * 100) / 100);

/** Insights de un anuncio, conjunto o campaña (desde que empezó). Null si todavía no tiene datos. */
export async function insightsMeta(objetoId: string, cuentaEsperada?: string | null): Promise<ResultadosMeta | null> {
  const { token, proof } = credenciales();
  const qs = new URLSearchParams({
    fields: "spend,reach,impressions,clicks,inline_link_clicks,actions,account_id,account_currency",
    date_preset: "maximum",
    access_token: token,
  });
  if (proof) qs.set("appsecret_proof", proof);
  const r = await fetch(`https://graph.facebook.com/${VERSION()}/${encodeURIComponent(objetoId)}/insights?${qs}`);
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta: ${json?.error?.message ?? r.status}`);
  const d = json?.data?.[0];
  if (!d) return null; // Sin entrega todavía (o sin datos): no se pisa lo que haya.
  // El anuncio tiene que ser de la cuenta publicitaria del cliente (si está cargada).
  const esperada = String(cuentaEsperada ?? "").replace(/^act_/, "");
  if (esperada && d.account_id && String(d.account_id) !== esperada) {
    throw new Error("Ese anuncio no es de la cuenta publicitaria de este cliente");
  }
  if (d.account_currency && d.account_currency !== "ARS") {
    throw new Error(`La cuenta publicitaria está en ${d.account_currency}: la inversión tiene que estar en pesos`);
  }
  const accion = (...tipos: string[]) => {
    const a = (d.actions ?? []).find((x: any) => tipos.includes(x.action_type));
    return a ? n(a.value) : null;
  };
  return {
    alcance: n(d.reach),
    impresiones: n(d.impressions),
    reproducciones: accion("video_view"),
    interacciones: accion("post_engagement", "page_engagement"),
    mensajes: accion("onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"),
    clics: n(d.inline_link_clicks ?? d.clicks),
    gasto: n(d.spend),
  };
}

/** Trae los resultados de Meta y los guarda en el video. */
export async function sincronizarVideoMeta(videoId: string): Promise<ResultadosMeta | null> {
  const db = adminDb();
  const ref = db.collection("videos").doc(videoId);
  const v = (await ref.get()).data();
  const objeto = v?.meta?.ad_id || v?.meta?.campaign_id;
  if (!objeto) throw new Error("Este video no tiene el ID del anuncio de Meta");
  const p = (await db.collection("projects").doc(v!.proyecto_id).get()).data();
  const r = await insightsMeta(String(objeto), p?.meta?.ad_account_id ?? null);
  if (!r) return null;
  await ref.update({
    resultados: { ...r, actualizado_at: new Date().toISOString(), actualizado_por: "meta" },
    updated_at: new Date().toISOString(),
  });
  return r;
}

/** Sincroniza todos los videos publicados con anuncio de Meta y pauta reciente. */
export async function sincronizarTodoMeta(): Promise<{ ok: number; error: number }> {
  if (!process.env.META_ACCESS_TOKEN) return { ok: 0, error: 0 };
  const snap = await adminDb().collection("videos").where("etapa", "==", "publicado").get();
  const limite = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  // Pautas que terminaron hace poco (los números de Meta se siguen ajustando unos días) o sin fecha de fin
  // pero publicadas hace poco. Lo viejo no se vuelve a consultar.
  const ids = snap.docs
    .filter((d) => {
      const v = d.data();
      if (v.demo_ejemplo || (!v.meta?.ad_id && !v.meta?.campaign_id)) return false;
      const ref = v.pauta?.fin || v.publicacion?.publicado_at?.slice(0, 10) || "";
      return !!ref && ref >= limite;
    })
    .map((d) => d.id);
  let ok = 0;
  let error = 0;
  // De a 4 en paralelo para no pasarse del tiempo de la función.
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(
      ids.slice(i, i + 4).map(async (id) => {
        try {
          await sincronizarVideoMeta(id);
          ok++;
        } catch (err) {
          error++;
          console.warn("[meta] no se pudo sincronizar", id, err);
        }
      })
    );
  }
  return { ok, error };
}
