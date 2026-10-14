// Revisión SOLO LECTURA: qué videos tienen IDs de Meta cargados, si ya tienen resultados guardados
// y qué contesta Meta hoy para cada uno (no guarda nada).
// Uso: pnpm exec tsx --env-file=.env scripts/meta-revisar.ts
import { adminDb } from "../api/_lib/db";
import { insightsMeta } from "../api/_lib/meta";

const db = adminDb();
console.log("META_ACCESS_TOKEN cargado:", process.env.META_ACCESS_TOKEN ? "sí" : "NO");
const snap = await db.collection("videos").get();
const proys = new Map<string, Record<string, any>>();
const filas: Record<string, unknown>[] = [];
for (const d of snap.docs) {
  const v: any = d.data();
  const id = v.meta?.ad_id || v.meta?.campaign_id;
  if (!v.meta || (!id && !v.meta.post_id)) continue;
  if (!proys.has(v.proyecto_id)) proys.set(v.proyecto_id, (await db.collection("projects").doc(v.proyecto_id).get()).data() ?? {});
  const p = proys.get(v.proyecto_id)!;
  const r = v.resultados ?? null;
  let meta_hoy = "-";
  if (!id) meta_hoy = "solo post_id: no alcanza (falta ID de anuncio o campaña)";
  else if (process.env.META_ACCESS_TOKEN) {
    try {
      const x = await insightsMeta(String(id), p.meta?.ad_account_id ?? null);
      meta_hoy = x ? `OK gasto=${x.gasto ?? "-"} alcance=${x.alcance ?? "-"}` : "sin datos todavía";
    } catch (err) {
      meta_hoy = `ERROR: ${err instanceof Error ? err.message : err}`.slice(0, 90);
    }
  }
  filas.push({
    cliente: String(p.nombre ?? "").slice(0, 20),
    video: String(v.titulo ?? "").slice(0, 26),
    etapa: v.etapa,
    ids: [v.meta.ad_id && "anuncio", v.meta.campaign_id && "campaña", v.meta.post_id && "post"].filter(Boolean).join("+"),
    publicado: v.publicacion?.publicado_at?.slice(0, 10) ?? "-",
    guardado: r ? `${r.actualizado_por ?? "?"} ${String(r.actualizado_at ?? "").slice(0, 10)}` : "NADA",
    meta_hoy,
  });
}
console.table(filas);
if (!filas.length) console.log("Ningún video tiene IDs de Meta cargados.");
process.exit(0);
