#!/usr/bin/env node
/**
 * Migración al modelo Prodi Redes (videos comerciales + pauta).
 *
 * Qué hace:
 *  1. Crea 3 planes de ejemplo en `planes_redes` si no hay ninguno.
 *  2. Lista los usuarios con roles viejos (CM, PM, Diseñador) para reasignarlos.
 *  3. Copia los videos en curso del sistema anterior (`tasks` tipo Reel /
 *     Historia Audiovisual, no publicados, de los últimos 2 meses) a `videos`.
 *     Las tareas viejas NO se borran ni se modifican.
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/migrar-redes.mjs          (simulación)
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/migrar-redes.mjs --aplicar
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APLICAR = process.argv.includes("--aplicar");
initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const now = new Date().toISOString();

function mesDe(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const ETAPA = {
  "Sin Iniciar": (t) => ((t.attachments_crudo ?? []).length ? "edicion" : "planificado"),
  "En Producción": (t) => ((t.attachments_crudo ?? []).length ? "edicion" : "planificado"),
  "Producido sin Aprobar": () => "revision_interna",
  "Para Publicar": () => "para_publicar",
};

async function main() {
  console.log(APLICAR ? "== APLICANDO CAMBIOS ==" : "== SIMULACIÓN (agregá --aplicar para guardar) ==");

  // 1) Planes
  const planes = await db.collection("planes_redes").limit(1).get();
  if (planes.empty) {
    const base = [
      { nombre: "Inicial", videos_mes: 4, precio_mensual: 0, precio_video_extra: 0, orden: 0 },
      { nombre: "Crecimiento", videos_mes: 8, precio_mensual: 0, precio_video_extra: 0, orden: 1 },
      { nombre: "Full", videos_mes: 12, precio_mensual: 0, precio_video_extra: 0, orden: 2 },
    ];
    console.log(`Planes: se crean ${base.length} planes de ejemplo (precios en 0, completalos en Ajustes).`);
    if (APLICAR) for (const p of base) await db.collection("planes_redes").add({ ...p, descripcion: "", activo: true });
  } else {
    console.log("Planes: ya existen, no se tocan.");
  }

  // 2) Roles viejos
  const perfiles = await db.collection("profiles").get();
  const viejos = perfiles.docs.filter((d) => ["cm", "pm", "disenador"].includes(d.data().role));
  console.log(`\nUsuarios con rol viejo (quedan bloqueados hasta que les asignes uno nuevo en Equipo): ${viejos.length}`);
  viejos.forEach((d) => console.log(`  - ${d.data().nombre} <${d.data().email}> · ${d.data().role}`));

  // 3) Videos en curso
  const desde = mesDe(new Date(Date.now() - 62 * 86400000).toISOString());
  const tasks = await db.collection("tasks").get();
  const proyectos = new Map((await db.collection("projects").get()).docs.map((d) => [d.id, d.data()]));
  const ya = new Set((await db.collection("videos").where("migrado_de", "!=", null).get()).docs.map((d) => d.data().migrado_de));
  let n = 0;
  for (const d of tasks.docs) {
    const t = d.data();
    if (t.is_raw_material_task) continue;
    if (!["Reel", "Historia Audiovisual"].includes(t.tipo)) continue;
    const etapaFn = ETAPA[t.estado];
    if (!etapaFn || !t.proyecto_id || ya.has(d.id)) continue;
    const mes = mesDe(t.fecha || t.created_at);
    if (mes < desde) continue;
    const p = proyectos.get(t.proyecto_id) ?? {};
    const team = p.team_roles ?? {};
    const etapa = etapaFn(t);
    const video = {
      proyecto_id: t.proyecto_id,
      titulo: t.titulo ?? "Video",
      idea: t.descripcion ?? null,
      objetivo: null,
      referencias: null,
      mes,
      extra: false,
      etapa,
      etapa_desde: t.last_edited_at ?? now,
      rodaje_id: null,
      productor_id: team.productor?.[0] ?? null,
      editor_id: team.editor?.[0] ?? null,
      pauta_id: team.pauta?.[0] ?? null,
      attachments_crudo: t.attachments_crudo ?? [],
      attachments_finalizado: t.attachments_finalizado ?? [],
      copy: t.notas ?? null,
      feedback_interno: t.feedback_pm ?? null,
      feedback_cliente: t.feedback_cliente ?? null,
      rondas: 0,
      cliente_rating: t.client_rating ?? null,
      publicacion: null,
      pauta: null,
      resultados: null,
      meta: null,
      historial: [{ at: now, by: "migracion", accion: `Migrado del sistema anterior (${t.estado})`, nota: null }],
      created_at: t.created_at ?? now,
      created_by: "migracion",
      updated_at: now,
      migrado_de: d.id,
    };
    n++;
    console.log(`  + ${p.nombre ?? t.proyecto_id} · ${video.titulo} → ${etapa} (${mes})`);
    if (APLICAR) await db.collection("videos").add(video);
  }
  console.log(`\nVideos a migrar: ${n}`);
  console.log(APLICAR ? "Listo." : "Nada se guardó. Corré con --aplicar.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
