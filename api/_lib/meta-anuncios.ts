/* eslint-disable @typescript-eslint/no-explicit-any */
// Pauta por anuncio (level=ad), además de la de campaña de meta-cuenta.ts. Para "Tu anuncio que más vendió":
//   · meta_anuncios_diaria/{pid}_{fecha}_{anuncio}: gasto, impresiones, compras, mensajes, leads… por anuncio y día.
//   · meta_anuncios/{pid}_{anuncio}: nombre y miniatura del anuncio (la imagen del creative o del post) y a qué post
//     apunta, para enlazarlo con el video del gestor. Se refresca en cada sync (las miniaturas de Meta vencen).
// Va en la misma sync diaria; la primera vez (o si cambian los IDs) trae 90 días.

import { adminDb } from "./db";
import { hoyAR, sumarDias } from "./fecha";
import { accion, dec, graph, graphTodo, num, tramos, urlDe } from "./meta-cuenta";

const COMPRAS = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
const MENSAJES = ["onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.total_messaging_connection"];
const LEADS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

/** Métricas por anuncio y día entre dos fechas. Devuelve los anuncios que tuvieron gasto. */
async function pautaAnuncios(pid: string, cuenta: string, desde: string, hasta: string): Promise<{ filas: number; anuncios: Set<string> }> {
  const db = adminDb();
  let filas = 0;
  const anuncios = new Set<string>();
  for (const t of tramos(desde, hasta)) {
    const data = await graphTodo(`act_${cuenta}/insights`, {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify(t),
      fields: "ad_id,ad_name,campaign_id,campaign_name,objective,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values",
      limit: "500",
    });
    // De a 400 por lote (el límite de escrituras por lote es 500).
    for (let i = 0; i < data.length; i += 400) {
      const lote = db.batch();
      for (const d of data.slice(i, i + 400)) {
        const fecha = String(d.date_start);
        const ad = String(d.ad_id);
        const gasto = dec(d.spend) ?? 0;
        if (gasto > 0) anuncios.add(ad);
        lote.set(db.collection("meta_anuncios_diaria").doc(`${pid}_${fecha}_${ad}`), {
          proyecto_id: pid,
          fecha,
          ad_id: ad,
          ad_name: d.ad_name ?? null,
          campaign_id: d.campaign_id ? String(d.campaign_id) : null,
          campaign_name: d.campaign_name ?? null,
          objetivo: d.objective ?? null,
          gasto,
          impresiones: num(d.impressions),
          alcance: num(d.reach),
          clics: num(d.inline_link_clicks ?? d.clicks),
          mensajes: accion(d.actions, ...MENSAJES),
          compras: accion(d.actions, ...COMPRAS),
          valor_compras: dec(accion(d.action_values, ...COMPRAS)) ?? 0,
          leads: accion(d.actions, ...LEADS),
          at: new Date().toISOString(),
        });
        filas++;
      }
      await lote.commit();
    }
  }
  return { filas, anuncios };
}

/** Nombre, miniatura y post de cada anuncio (de a 50 por consulta). */
async function creativos(pid: string, anuncios: string[]): Promise<number> {
  const db = adminDb();
  let ok = 0;
  for (let i = 0; i < anuncios.length; i += 50) {
    const ids = anuncios.slice(i, i + 50);
    const ads: Record<string, any> = await graph(urlDe("", { ids: ids.join(","), fields: "name,creative{id}" }));
    const cre = [...new Set(Object.values(ads).map((a: any) => a?.creative?.id).filter(Boolean))] as string[];
    // Miniatura grande (la de por defecto es de 64 px).
    const cres: Record<string, any> = cre.length
      ? await graph(
          urlDe("", {
            ids: cre.join(","),
            fields: "thumbnail_url,image_url,effective_object_story_id,effective_instagram_media_id,instagram_permalink_url",
            thumbnail_width: "600",
            thumbnail_height: "600",
          })
        )
      : {};
    const lote = db.batch();
    for (const id of ids) {
      const a = ads[id];
      if (!a) continue;
      const c = cres[a.creative?.id] ?? {};
      lote.set(
        db.collection("meta_anuncios").doc(`${pid}_${id}`),
        {
          proyecto_id: pid,
          ad_id: id,
          nombre: a.name ?? null,
          miniatura: c.image_url || c.thumbnail_url || null,
          post_id: c.effective_object_story_id ?? null,
          ig_media_id: c.effective_instagram_media_id ?? null,
          permalink: c.instagram_permalink_url ?? null,
          at: new Date().toISOString(),
        },
        { merge: true }
      );
      ok++;
    }
    await lote.commit();
  }
  return ok;
}

/**
 * Trae la pauta por anuncio de un cliente. La primera vez (o si cambió la cuenta) 90 días; después los últimos `dias`.
 * Queda anotado en `meta_anuncios_sync` de la ficha. Nunca tira error: devuelve el detalle.
 */
export async function sincronizarAnuncios(pid: string, dias = 3): Promise<string> {
  const db = adminDb();
  const ref = db.collection("projects").doc(pid);
  const p = (await ref.get()).data();
  const cuenta = String(p?.meta?.ad_account_id ?? "").trim().replace(/^act_/, "");
  if (!p || !cuenta) return "sin cuenta publicitaria";
  const historia = !p.meta_anuncios_sync?.historial || p.meta_anuncios_sync?.cuenta !== cuenta;
  const hasta = hoyAR();
  const desde = sumarDias(hasta, -((historia ? 90 : Math.min(Math.max(dias, 1), 90)) - 1));
  try {
    const { filas, anuncios } = await pautaAnuncios(pid, cuenta, desde, hasta);
    const conCreativo = await creativos(pid, [...anuncios]).catch((err) => {
      console.warn("[meta-anuncios] creativos", pid, err instanceof Error ? err.message : err);
      return 0;
    });
    const detalle = `Anuncios: ${filas} registros, ${conCreativo} con miniatura`;
    await ref.update({ meta_anuncios_sync: { at: new Date().toISOString(), ok: true, detalle, cuenta, historial: historia ? true : !!p.meta_anuncios_sync?.historial } });
    return detalle;
  } catch (err) {
    const detalle = `Anuncios: ${err instanceof Error ? err.message : "error"}`;
    await ref.update({ meta_anuncios_sync: { ...(p.meta_anuncios_sync ?? {}), at: new Date().toISOString(), ok: false, detalle, cuenta: p.meta_anuncios_sync?.cuenta ?? null } });
    return detalle;
  }
}
