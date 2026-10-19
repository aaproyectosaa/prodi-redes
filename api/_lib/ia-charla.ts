/* eslint-disable @typescript-eslint/no-explicit-any */
// Charlar con la IA mientras planifica: el equipo le pide cambios ("más corto", "sin precios", "que sea para el Día
// de la Madre") o le pregunta cosas, y la IA contesta con el contexto del cliente. Si propone algo nuevo, lo devuelve
// para que la persona lo aplique con un toque. Si le cuentan un dato del cliente que sirve siempre, lo anota en su
// memoria (las indicaciones del equipo), así la próxima vez ya lo sabe.
//
// Sirve para: el plan del mes (ideas), el guion de un video, el texto del posteo y lo que el cliente tiene que tener
// listo para el rodaje.

import { adminDb } from "./db";
import { HttpError, type Caller } from "./http";
import { generarJSON } from "./ia";
import { marcaTexto } from "./marca";
import { comercialTexto, ideasDesdeIA, memoriaTexto, nombreMes, rangoMes, type MemoriaIA } from "./plan-mes";
import { fechaAR, sumarDias } from "./fecha";

export type TipoCharla = "plan" | "guion" | "copy" | "preparar";

export interface PedidoCharla {
  tipo?: string;
  proyecto_id?: string;
  mes?: string;
  video_id?: string;
  video_ids?: string[];
  mensajes?: { rol?: string; texto?: string }[];
  /** Lo que está en pantalla ahora (puede tener cambios sin guardar). */
  actual?: unknown;
}

const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Roles que pueden charlar con la IA en cada lugar (los mismos que pueden generar ahí). */
export const ROLES_CHARLA: Record<TipoCharla, string[]> = {
  plan: ["admin", "productor"],
  guion: ["admin", "productor"],
  preparar: ["admin", "productor"],
  copy: ["admin", "productor", "editor", "pauta", "diseno"],
};

export const esTipoCharla = (x: unknown): x is TipoCharla => x === "plan" || x === "guion" || x === "copy" || x === "preparar";

const ESQUEMAS: Record<TipoCharla, Record<string, unknown>> = {
  plan: {
    ideas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { titulo: { type: "STRING" }, idea: { type: "STRING" }, objetivo: { type: "STRING" }, porque: { type: "STRING" } },
        required: ["titulo", "idea", "objetivo", "porque"],
      },
    },
  },
  guion: { guion: { type: "STRING" }, tomas: { type: "ARRAY", items: { type: "STRING" } } },
  copy: { opciones: { type: "ARRAY", items: { type: "STRING" } } },
  preparar: { texto: { type: "STRING" } },
};

const QUE_ES: Record<TipoCharla, string> = {
  plan: `las ideas de videos del mes para este cliente. Si te piden cambios, devolvé en "ideas" la lista COMPLETA como tiene que quedar (las que no cambian, iguales; mismo orden y la misma cantidad salvo que te pidan agregar o sacar). Cada idea: titulo corto, idea (qué se ve y qué se dice, 2 a 4 frases), objetivo y porque (por qué le sirve al negocio).`,
  guion: `el guion de un video (Reel vertical de 20 a 45 segundos para pautar en Meta). Si te piden cambios, devolvé en "guion" SOLO las palabras que dice la persona a cámara, frases cortas una por renglón, sin escenas ni etiquetas ni comillas (50 a 110 palabras; la primera engancha y la última es el llamado a la acción), y en "tomas" la lista de planos para filmar (máximo 12).`,
  copy: `el texto que acompaña el video cuando se publica en Instagram y Facebook. Si te piden cambios o textos nuevos, devolvé en "opciones" de 1 a 3 textos completos (máximo 4 líneas cortas + hasta 5 hashtags, voseo, llamado a la acción concreto).`,
  preparar: `lo que el cliente tiene que tener listo para el día de rodaje (productos, personas, lugar, ropa, horarios). Si te piden cambios, devolvé en "texto" el mensaje completo, de 2 a 4 líneas, hablándole directo al cliente con voseo.`,
};

/** El contexto de lo que se está trabajando (con lo que está en pantalla, aunque no esté guardado). */
async function contextoDe(tipo: TipoCharla, b: PedidoCharla, pid: string): Promise<{ texto: string; mes: string; videoMes?: string }> {
  const db = adminDb();
  if (tipo === "plan") {
    const mes = t(b.mes, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new HttpError(400, "Falta el mes");
    const plan = (await db.collection("planes_mes").doc(`${pid}_${mes}`).get()).data();
    const ideas = Array.isArray(b.actual) ? (b.actual as any[]) : (plan?.ideas ?? []);
    const lista = ideas
      .filter((i) => !i?.descartada)
      .map((i, n) => `${n + 1}. ${t(i?.titulo, 120)}: ${t(i?.idea, 600)}${i?.objetivo ? ` (objetivo: ${t(i.objetivo, 120)})` : ""}`)
      .join("\n");
    return { texto: `Plan de ${nombreMes(mes)} (${ideas.length} ideas):\n${lista || "(todavía sin ideas)"}`, mes };
  }
  if (tipo === "preparar") {
    const ids = (b.video_ids ?? []).slice(0, 10).map(String);
    const vids = await Promise.all(ids.map((id) => db.collection("videos").doc(id).get()));
    const lista = vids
      .map((v) => v.data())
      .filter((v) => v && v.proyecto_id === pid)
      .map((v) => `- ${v!.titulo}${v!.idea ? `: ${v!.idea}` : ""}${v!.tomas?.length ? ` (tomas: ${v!.tomas.join("; ")})` : ""}`)
      .join("\n");
    return { texto: `Videos que se filman:\n${lista || "- (sin detalle)"}\n\nTexto actual para el cliente:\n${t(b.actual, 1500) || "(vacío)"}`, mes: fechaAR(new Date()).slice(0, 7) };
  }
  const vid = t(b.video_id, 200);
  if (!vid) throw new HttpError(400, "Falta el video");
  const v = (await db.collection("videos").doc(vid).get()).data();
  if (!v || v.proyecto_id !== pid) throw new HttpError(404, "Video no encontrado");
  const base = [
    `Video: ${v.titulo}`,
    v.idea ? `Idea acordada con el cliente: ${v.idea}` : "",
    v.objetivo ? `Objetivo: ${v.objetivo}` : "",
    v.referencias ? `Referencias: ${v.referencias}` : "",
  ].filter(Boolean);
  const a = (b.actual ?? {}) as Record<string, unknown>;
  if (tipo === "guion") {
    const guion = t(a.guion ?? v.guion, 3000);
    const tomas = Array.isArray(a.tomas) ? (a.tomas as unknown[]).map((x) => t(x, 200)).filter(Boolean) : (v.tomas ?? []);
    base.push(`Guion actual:\n${guion || "(todavía sin guion)"}`, `Tomas actuales:\n${tomas.length ? tomas.map((x: string) => `- ${x}`).join("\n") : "(sin tomas)"}`);
  } else {
    base.push(`Texto actual del posteo:\n${t(a.texto ?? v.copy, 2000) || "(vacío)"}`);
  }
  return { texto: base.join("\n"), mes: String(v.mes ?? fechaAR(new Date()).slice(0, 7)), videoMes: String(v.mes ?? "") };
}

export async function charlarIA(caller: Caller, b: PedidoCharla): Promise<{ respuesta: string; propuesta: Record<string, unknown> | null; recordado: string | null }> {
  if (!esTipoCharla(b.tipo)) throw new HttpError(400, "Tipo inválido");
  const tipo = b.tipo;
  const pid = t(b.proyecto_id, 200);
  if (!pid) throw new HttpError(400, "Falta el cliente");
  const mensajes = (b.mensajes ?? [])
    .map((m) => ({ rol: m.rol === "ia" ? "ia" : "yo", texto: t(m.texto, 1500) }))
    .filter((m) => m.texto)
    .slice(-12);
  if (!mensajes.length || mensajes[mensajes.length - 1].rol !== "yo") throw new HttpError(400, "Escribí qué querés pedirle");

  const db = adminDb();
  const [proj, mem, cfg] = await Promise.all([
    db.collection("projects").doc(pid).get(),
    db.collection("ia_memoria").doc(pid).get(),
    db.collection("app_settings").doc("redes").get(),
  ]);
  const p = proj.data() ?? {};
  const memoria = (mem.data() ?? null) as MemoriaIA | null;
  const ctx = await contextoDe(tipo, b, pid);
  const rango: [string, string] = tipo === "copy" ? [fechaAR(new Date()), sumarDias(fechaAR(new Date()), 30)] : rangoMes(ctx.mes);

  const prompt = `Sos el asistente creativo de Prodi, una agencia argentina que hace videos comerciales y piezas gráficas con pauta en Meta para negocios. Estás ayudando al equipo con ${QUE_ES[tipo]}

Cómo responder:
- "respuesta": lo que le decís a la persona, corto y claro (1 a 4 frases), en español rioplatense con voseo. Si cambiaste algo, contá qué cambiaste. Si te pregunta algo, respondé la pregunta.
- Completá el contenido nuevo SOLO si te piden cambios o algo nuevo. Si es solo una pregunta o un comentario, dejalo vacío.
- "recordar": si la persona te cuenta un dato del cliente que sirve para siempre (ej. "no quiere mostrar precios", "el dueño no sale en cámara", "abren solo a la noche"), escribilo en una frase corta para anotarlo en su memoria. Si no, vacío.
- No inventes precios, promociones ni datos que no estén abajo o en la charla. Si te falta un dato para hacerlo bien, preguntalo en la respuesta.

${marcaTexto(p)}

${comercialTexto(memoria?.comercial ?? null, rango, cfg.data()?.ia_enfoque ?? null)}

${memoriaTexto(memoria)}

Lo que se está trabajando:
${ctx.texto}

Charla con la persona del equipo (lo último es lo que te pide ahora):
${mensajes.map((m) => `${m.rol === "yo" ? "Equipo" : "Vos"}: ${m.texto}`).join("\n")}`;

  const r = await generarJSON<Record<string, any>>(
    prompt,
    { type: "OBJECT", properties: { respuesta: { type: "STRING" }, recordar: { type: "STRING" }, ...ESQUEMAS[tipo] }, required: ["respuesta"] },
    0.7
  );

  const respuesta = t(r.respuesta, 1500) || "Listo.";
  let propuesta: Record<string, unknown> | null = null;
  if (tipo === "plan") {
    const ideas = ideasDesdeIA({ ideas: r.ideas ?? [] }, 20);
    if (ideas.length) propuesta = { ideas };
  } else if (tipo === "guion") {
    const guion = t(r.guion, 3000);
    const tomas = (Array.isArray(r.tomas) ? r.tomas : []).map((x: unknown) => t(x, 200)).filter(Boolean).slice(0, 15);
    if (guion || tomas.length) propuesta = { guion, tomas };
  } else if (tipo === "copy") {
    const opciones = (Array.isArray(r.opciones) ? r.opciones : []).map((x: unknown) => t(x, 1500)).filter(Boolean).slice(0, 3);
    if (opciones.length) propuesta = { opciones };
  } else {
    const texto = t(r.texto, 1200);
    if (texto) propuesta = { texto };
  }

  // Un dato que sirve siempre: a las indicaciones del equipo (las lee la IA en todo lo de este cliente).
  let recordado: string | null = null;
  const nuevo = t(r.recordar, 200);
  const puedeAnotar = caller.role === "admin" || caller.roles.includes("productor");
  if (nuevo && puedeAnotar) {
    const previas = String(memoria?.notas_equipo ?? "");
    if (!previas.toLowerCase().includes(nuevo.toLowerCase())) {
      const notas = `${previas ? `${previas}\n` : ""}- ${nuevo}`.slice(-1500);
      await db
        .collection("ia_memoria")
        .doc(pid)
        .set({ proyecto_id: pid, notas_equipo: notas, notas_at: new Date().toISOString(), notas_por: caller.uid }, { merge: true });
      recordado = nuevo;
    }
  }
  return { respuesta, propuesta, recordado };
}
