// Lo que @prodi sabe del sistema cuando le escribe alguien del equipo: clientes, equipo de cada uno,
// videos en curso, tareas pendientes y la marca de los clientes que se nombran.
// Plata (abonos, facturas, sueldos, gastos) solo para administración: al resto no se le pasa.

import { adminDb, type Data } from "./db";
import { normalizar } from "./chat-memoria";
import { fechaAR } from "./fecha";
import { marcaTexto } from "./marca";

const ETAPA: Record<string, string> = {
  planificado: "planificado",
  agendado: "rodaje agendado",
  material_cliente: "esperando material del cliente",
  edicion: "en edición",
  revision_interna: "revisión interna",
  revision_cliente: "esperando aprobación del cliente",
  para_publicar: "para subir y pautar",
  publicado: "publicado",
};

export type Proyecto = Data & { id: string; nombre: string };

const dias = (iso: unknown) => (typeof iso === "string" ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);

/** Clientes nombrados en el texto (por nombre completo o una palabra distintiva de 4+ letras). */
export function clientesNombrados(texto: string, proyectos: Proyecto[]): Proyecto[] {
  const t = ` ${normalizar(texto).replace(/[^a-z0-9]+/g, " ")} `;
  return proyectos.filter((p) => {
    const n = normalizar(p.nombre).replace(/[^a-z0-9]+/g, " ").trim();
    if (!n) return false;
    if (t.includes(` ${n} `)) return true;
    return n.split(" ").some((w) => w.length >= 4 && !["nutri", "automotores", "prodi"].includes(w) && t.includes(` ${w} `));
  });
}

export async function contextoSistema(opts: { finanzas: boolean; texto: string; proyectoChat: string | null }): Promise<{ texto: string; proyectos: Proyecto[] }> {
  const db = adminDb();
  const [pSnap, perfSnap, vSnap, tSnap, pzSnap] = await Promise.all([
    db.collection("projects").get(),
    db.collection("profiles").get(),
    db.collection("videos").where("etapa", "!=", "publicado").get(),
    db.collection("tareas").where("hecha", "==", false).get(),
    db.collection("piezas_ia").where("estado", "in", ["pagada", "en_proceso", "para_aprobar"]).get(),
  ]);
  const proyectos = pSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() ?? {}) }) as Proyecto)
    .filter((p) => p.enabled !== false && typeof p.nombre === "string" && !/^(test|ds)$/i.test(p.nombre.trim()));
  const nombre = new Map(perfSnap.docs.map((d) => [d.id, String(d.data()?.nombre ?? "").trim() || "?"]));
  const quien = (ids: unknown) => (Array.isArray(ids) ? ids.map((x) => nombre.get(String(x)) ?? "?").join(", ") : "");
  const deProyecto = new Map(proyectos.map((p) => [p.id, p.nombre]));
  const videos = vSnap.docs.map((d) => ({ id: d.id, ...(d.data() ?? {}) }) as Data & { id: string }).filter((v) => deProyecto.has(String(v.proyecto_id)));

  const clientes = proyectos
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map((p) => {
      const tr = (p.team_roles ?? {}) as Record<string, string[]>;
      const prod = (p.produccion ?? {}) as Record<string, string>;
      const m = (p.marca ?? {}) as Record<string, string>;
      const suyos = videos.filter((v) => v.proyecto_id === p.id);
      const porEtapa = Object.entries(suyos.reduce<Record<string, number>>((a, v) => ((a[String(v.etapa)] = (a[String(v.etapa)] ?? 0) + 1), a), {}))
        .map(([e, n]) => `${n} ${ETAPA[e] ?? e}`)
        .join(", ");
      const ov = (p.plan_redes_override ?? {}) as Data;
      const abono = opts.finanzas ? Number(ov.precio_mensual ?? 0) : 0;
      const redesPlan = Object.entries((ov.redes ?? {}) as Record<string, boolean>).filter(([, v]) => v).map(([k]) => k);
      const pautaPlan = (ov.pauta ?? null) as { incluida?: boolean; monto?: number | null } | null;
      const incluye = [
        redesPlan.length ? `redes: ${redesPlan.join(", ")}` : null,
        pautaPlan?.incluida ? `con pauta${opts.finanzas && pautaPlan.monto ? ` ($${Number(pautaPlan.monto).toLocaleString("es-AR")}/mes)` : ""}` : null,
        ov.administracion_redes ? "administración de redes (sin responder mensajes)" : null,
      ].filter(Boolean);
      return [
        `- ${p.nombre} [link /clientes/${p.id}]`,
        m.rubro && `rubro: ${m.rubro}`,
        prod.servicio === "solo_pauta" ? "solo pauta" : null,
        prod.filma && prod.filma !== "prodi" ? `filma: ${prod.filma === "cliente" ? "el cliente" : "los dos"}` : null,
        tr.productor?.length && `producción: ${quien(tr.productor)}`,
        tr.editor?.length && `edición: ${quien(tr.editor)}`,
        tr.pauta?.length && `pauta: ${quien(tr.pauta)}`,
        tr.diseno?.length && `diseño: ${quien(tr.diseno)}`,
        tr.cliente?.length && `usuarios del cliente: ${quien(tr.cliente)}`,
        incluye.length ? `incluye ${incluye.join(", ")}` : null,
        porEtapa && `videos en curso: ${porEtapa}`,
        abono ? `abono: $${abono.toLocaleString("es-AR")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    });

  const enCurso = videos
    .sort((a, b) => String(a.etapa_desde).localeCompare(String(b.etapa_desde)))
    .slice(0, 120)
    .map((v) => {
      const resp = [v.productor_id && `prod. ${nombre.get(String(v.productor_id))}`, v.editor_id && `edita ${nombre.get(String(v.editor_id))}`].filter(Boolean).join(", ");
      return `- ${deProyecto.get(String(v.proyecto_id))} · "${String(v.titulo ?? "").slice(0, 80)}" · ${ETAPA[String(v.etapa)] ?? v.etapa} hace ${dias(v.etapa_desde)} días${v.entrega_edicion ? ` · entrega ${v.entrega_edicion}` : ""}${resp ? ` · ${resp}` : ""} [link /videos?video=${v.id}]`;
    });

  const ESTADO_PIEZA: Record<string, string> = { pagada: "para hacer", en_proceso: "diseñando", para_aprobar: "esperando al cliente" };
  const piezas = pzSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() ?? {}) }) as Data & { id: string })
    .filter((x) => deProyecto.has(String(x.proyecto_id)))
    .slice(0, 60)
    .map((x) => `- ${deProyecto.get(String(x.proyecto_id))} · "${String(x.producto || x.pedido || "pieza").slice(0, 70)}" · ${ESTADO_PIEZA[String(x.estado)] ?? x.estado} [link /piezas?pieza=${x.id}]`);

  const hoy = fechaAR();
  const tareas = tSnap.docs
    .map((d) => d.data() ?? {})
    .sort((a, b) => String(a.vence ?? "9999").localeCompare(String(b.vence ?? "9999")))
    .slice(0, 80)
    .map(
      (t) =>
        `- "${String(t.titulo ?? "").slice(0, 100)}" · para ${quien(t.asignados) || "?"}${t.vence ? ` · vence ${t.vence}${t.vence < hoy ? " (vencida)" : ""}` : ""}${t.proyecto_id && deProyecto.has(String(t.proyecto_id)) ? ` · ${deProyecto.get(String(t.proyecto_id))}` : ""}`
    );

  const marcas = [
    ...new Map(
      [...(opts.proyectoChat ? proyectos.filter((p) => p.id === opts.proyectoChat) : []), ...clientesNombrados(opts.texto, proyectos)].map((p) => [p.id, p])
    ).values(),
  ].slice(0, 3);

  const texto = `
DATOS DEL SISTEMA (hoy ${hoy}). Usalos para contestar; si algo no está acá, decí que no lo tenés.
Cada cliente, video y pieza tiene su [link /ruta]. Cuando nombres uno en tu respuesta, ponelo como link así: [nombre](/ruta) (ej. [¿Qué bolsa necesitás?](/videos?video=abc123)), con la ruta exacta de acá; nunca inventes rutas. Así se abre con un toque.
Clientes activos (${clientes.length}):
${clientes.join("\n")}

Videos en curso (${enCurso.length}${videos.length > enCurso.length ? ` de ${videos.length}` : ""}):
${enCurso.join("\n") || "- ninguno"}

Piezas gráficas en curso (${piezas.length}):
${piezas.join("\n") || "- ninguna"}

Tareas pendientes (${tareas.length}):
${tareas.join("\n") || "- ninguna"}
${marcas.map((p) => `\nIdentidad de marca:\n${marcaTexto(p)}`).join("\n")}
${
  opts.finanzas
    ? "\nQuien te escribe es de administración: puede ver montos (abonos)."
    : "\nIMPORTANTE: quien te escribe NO es de administración. No tenés ni das datos de plata: precios, abonos, facturación, cobros, deudas, sueldos, pagos, gastos o ganancias. Si te los piden, respondé que eso lo ve solo administración."
}`;
  return { texto, proyectos };
}
