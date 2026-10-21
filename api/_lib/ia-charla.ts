/* eslint-disable @typescript-eslint/no-explicit-any */
// Charlar con la IA mientras planifica: el equipo le pide cambios ("más corto", "sin precios", "que sea para el Día
// de la Madre") o le pregunta cosas, y la IA contesta con el contexto del cliente. Si propone algo nuevo, lo devuelve
// para que la persona lo aplique con un toque. Si le cuentan un dato del cliente que sirve siempre, lo anota en su
// memoria (las indicaciones del equipo), así la próxima vez ya lo sabe.
//
// Sirve para: el plan del mes (ideas), el guion de un video, el texto del posteo, lo que el cliente tiene que tener
// listo para el rodaje y planificar una campaña (un día de rodaje con muchos videos que se reparten en varios meses).

import { adminDb } from "./db";
import { HttpError, type Caller } from "./http";
import { generarJSON } from "./ia";
import { estudiarWeb, linksEnTexto } from "./leer-web";

/** Páginas ya leídas (en esta instancia, 30 min): la charla sigue teniendo la web sin volver a bajarla en cada mensaje. */
const webLeidas = new Map<string, { at: number; r: Awaited<ReturnType<typeof estudiarWeb>> }>();
async function webDe(u: URL) {
  const k = u.toString();
  const c = webLeidas.get(k);
  if (c && Date.now() - c.at < 30 * 60_000) return c.r;
  const r = await estudiarWeb(u).catch(() => null);
  if (webLeidas.size > 50) webLeidas.clear();
  webLeidas.set(k, { at: Date.now(), r });
  return r;
}
import { marcaTexto } from "./marca";
import { comercialTexto, ideasDesdeIA, memoriaTexto, nombreMes, nuevoIdIdea, rangoMes, type MemoriaIA } from "./plan-mes";
import { fechaAR, sumarDias } from "./fecha";

export type TipoCharla = "plan" | "guion" | "copy" | "preparar" | "campania";

export interface PedidoCharla {
  tipo?: string;
  proyecto_id?: string;
  mes?: string;
  video_id?: string;
  video_ids?: string[];
  mensajes?: { rol?: string; texto?: string }[];
  /** Lo que está en pantalla ahora (puede tener cambios sin guardar). */
  actual?: unknown;
  /** Es una llamada de voz: la respuesta se escucha (corta y hablada). */
  voz?: boolean;
}

const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** En una llamada de voz: respuestas cortas y habladas. */
export const VOZ = `La respuesta se va a escuchar en voz alta en una llamada: contestá en 1 a 3 frases cortas, como hablando, sin viñetas, sin listas, sin símbolos ni emojis; los números dichos como se dicen ("cuatro con sesenta y cinco dólares"). Si hay que proponer algo largo, decí lo principal y avisá que lo dejás escrito en el chat.`;

/** Roles que pueden charlar con la IA en cada lugar (los mismos que pueden generar ahí). */
export const ROLES_CHARLA: Record<TipoCharla, string[]> = {
  plan: ["admin", "productor"],
  guion: ["admin", "productor"],
  preparar: ["admin", "productor"],
  copy: ["admin", "productor", "editor", "pauta", "diseno"],
  campania: ["admin", "productor"],
};

export const esTipoCharla = (x: unknown): x is TipoCharla =>
  x === "plan" || x === "guion" || x === "copy" || x === "preparar" || x === "campania";

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
  campania: {
    campania: { type: "STRING" },
    rodaje: { type: "STRING" },
    videos: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { titulo: { type: "STRING" }, idea: { type: "STRING" }, objetivo: { type: "STRING" }, porque: { type: "STRING" }, mes: { type: "STRING" } },
        required: ["titulo", "idea", "objetivo", "porque", "mes"],
      },
    },
  },
};

const QUE_ES: Record<TipoCharla, string> = {
  plan: `las ideas de videos del mes para este cliente. Si te piden cambios, devolvé en "ideas" la lista COMPLETA como tiene que quedar (las que no cambian, iguales; mismo orden y la misma cantidad salvo que te pidan agregar o sacar). Cada idea: titulo corto, idea (qué se ve y qué se dice, 2 a 4 frases), objetivo y porque (por qué le sirve al negocio).`,
  guion: `el guion de un video (Reel vertical de 20 a 45 segundos para pautar en Meta). Si te piden cambios, devolvé en "guion" SOLO las palabras que dice la persona a cámara, frases cortas una por renglón, sin escenas ni etiquetas ni comillas (50 a 110 palabras; la primera engancha y la última es el llamado a la acción), y en "tomas" la lista de planos para filmar (máximo 12).`,
  copy: `el texto que acompaña el video cuando se publica en Instagram y Facebook. Si te piden cambios o textos nuevos, devolvé en "opciones" de 1 a 3 textos completos (máximo 4 líneas cortas + hasta 5 hashtags, voseo, llamado a la acción concreto).`,
  preparar: `lo que el cliente tiene que tener listo para el día de rodaje (productos, personas, lugar, ropa, horarios). Si te piden cambios, devolvé en "texto" el mensaje completo, de 2 a 4 líneas, hablándole directo al cliente con voseo.`,
  campania: `planificar una CAMPAÑA: en un solo día de rodaje se filman muchos videos juntos (planificados antes), y después se publican repartidos en varios meses según los videos por mes que tiene el plan del cliente.
Cómo trabajás:
- Primero entendé la campaña. Si te falta algo importante, preguntá (máximo 3 preguntas cortas por vez): de qué se trata o qué se lanza, qué productos o servicios mostrar, cuándo es el rodaje, cuántos videos se filman o cuántos meses tiene que cubrir, y si hay fechas, promos o algo que no se puede mostrar.
- Cuando ya sabés lo suficiente (o te dicen "armalo", "dale", "proponé"), proponé los videos en "videos". Si te piden cambios sobre una propuesta, devolvé la lista COMPLETA como tiene que quedar.
- Cantidad: la que te digan; si no dicen, llená los lugares libres de los meses de abajo desde el primero, hasta un máximo de 12.
- "mes" de cada video (formato AAAA-MM): uno de los meses de abajo que tenga lugar, sin pasarte de los libres de cada mes. Lo que tiene que salir primero (el lanzamiento, lo más fuerte) va en el primer mes.
- Todos se filman el mismo día: tienen que poder grabarse en el mismo lugar en una jornada (variá formatos: producto, detrás de escena, testimonio, oferta, tendencia).
- Cada video: titulo corto (máx. 7 palabras), idea (qué se ve y qué se dice, 2 a 3 frases), objetivo y porque (para el equipo).
- "campania": nombre corto de la campaña. "rodaje": cuándo o cómo es el día de rodaje si lo sabés (ej. "jueves 12/11 en la fábrica"); si no, vacío.`,
};

/** Lugares libres de cada mes desde `mes` (los del plan del cliente, menos los videos y las ideas ya cargadas). */
export async function cuposDesde(pid: string, mes: string, cuantos = 6): Promise<{ mes: string; cupo: number; libres: number; bloqueado: boolean }[]> {
  const db = adminDb();
  const p = (await db.collection("projects").doc(pid).get()).data() ?? {};
  let incluidos = Number(p.plan_redes_override?.videos_mes ?? NaN);
  if (isNaN(incluidos) && p.plan_redes_id) {
    incluidos = Number((await db.collection("planes_redes").doc(p.plan_redes_id).get()).data()?.videos_mes ?? 0);
  }
  const videos = (await db.collection("videos").where("proyecto_id", "==", pid).get()).docs.map((d) => d.data());
  const [y, m] = mes.split("-").map(Number);
  const meses = Array.from({ length: cuantos }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const planes = await Promise.all(meses.map((x) => db.collection("planes_mes").doc(`${pid}_${x}`).get()));
  return meses.map((x, i) => {
    const cupo = (incluidos || 0) + Number(p.creditos_extra?.[x] ?? 0);
    const usados = videos.filter((v) => v.mes === x && v.extra !== true).length;
    const plan = planes[i].data();
    // Un plan ya mandado al cliente no se toca; uno en borrador ya ocupa lugares con sus ideas.
    const bloqueado = !!plan && plan.estado !== "borrador";
    const enBorrador = !plan || bloqueado ? 0 : (plan.ideas ?? []).filter((it: any) => !it?.video_id && !it?.descartada).length;
    return { mes: x, cupo, libres: bloqueado ? 0 : Math.max(0, cupo - usados - enBorrador), bloqueado };
  });
}

/** Acomoda cada video en un mes con lugar (si la IA eligió uno lleno o que no está, va al próximo con lugar). */
export function repartirEnMeses<T extends { mes: string }>(videos: T[], cupos: { mes: string; libres: number }[]): (T & { sin_lugar?: boolean })[] {
  const libres = new Map(cupos.map((c) => [c.mes, c.libres]));
  const orden = cupos.map((c) => c.mes);
  return videos.map((v) => {
    const desde = Math.max(0, orden.indexOf(v.mes));
    const destino = orden.slice(desde).find((x) => (libres.get(x) ?? 0) > 0) ?? orden.find((x) => (libres.get(x) ?? 0) > 0);
    if (!destino) return { ...v, mes: orden.includes(v.mes) ? v.mes : orden[orden.length - 1], sin_lugar: true };
    libres.set(destino, (libres.get(destino) ?? 0) - 1);
    return { ...v, mes: destino };
  });
}

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
  if (tipo === "campania") {
    const mes = t(b.mes, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new HttpError(400, "Falta el mes");
    const cupos = await cuposDesde(pid, mes);
    const lineas = cupos.map(
      (c) => `- ${c.mes} (${nombreMes(c.mes)}): ${c.bloqueado ? "plan ya mandado al cliente, no se puede sumar" : `${c.libres} libre${c.libres === 1 ? "" : "s"} de ${c.cupo}`}`
    );
    const actual = Array.isArray(b.actual) ? (b.actual as any[]) : [];
    const propuesta = actual.length
      ? `\n\nPropuesta actual en pantalla (${actual.length} videos):\n${actual.map((v, n) => `${n + 1}. [${t(v?.mes, 7)}] ${t(v?.titulo, 120)}: ${t(v?.idea, 400)}`).join("\n")}`
      : "";
    return { texto: `Videos por mes del plan y lugares libres:\n${lineas.join("\n")}${propuesta}`, mes };
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
  // Si en la charla pegaron el link de una página (la web del cliente, su tienda), se lee: productos, servicios y lo que dice.
  const urls = [...new Map(mensajes.filter((m) => m.rol === "yo").flatMap((m) => linksEnTexto(m.texto)).map((u) => [u.toString(), u])).values()].slice(-2);
  const webs = (await Promise.all(urls.map(webDe))).filter((w): w is NonNullable<typeof w> => !!w);
  const sinLeer = urls.filter((u) => !webs.some((w) => w.url.includes(u.hostname)));
  const webTexto = webs.length
    ? `Página web que te pasaron (la leíste recién; usala para conocer los productos, servicios, precios y cómo habla el negocio. No inventes lo que no diga):\n${webs.map((w) => w.texto).join("\n\n").slice(0, 24_000)}`
    : "";
  const rango: [string, string] =
    tipo === "copy"
      ? [fechaAR(new Date()), sumarDias(fechaAR(new Date()), 30)]
      : tipo === "campania"
        ? [rangoMes(ctx.mes)[0], sumarDias(rangoMes(ctx.mes)[0], 180)]
        : rangoMes(ctx.mes);

  const prompt = `Sos el asistente creativo de Prodi, una agencia argentina que hace videos comerciales y piezas gráficas con pauta en Meta para negocios. Estás ayudando al equipo con ${QUE_ES[tipo]}

Cómo responder:
- "respuesta": lo que le decís a la persona, corto y claro (1 a 4 frases), en español rioplatense con voseo. Si cambiaste algo, contá qué cambiaste. Si te pregunta algo, respondé la pregunta.
- Completá el contenido nuevo SOLO si te piden cambios o algo nuevo. Si es solo una pregunta o un comentario, dejalo vacío.
- "recordar": si la persona te cuenta un dato del cliente que sirve para siempre (ej. "no quiere mostrar precios", "el dueño no sale en cámara", "abren solo a la noche"), escribilo en una frase corta para anotarlo en su memoria. Si no, vacío.
- No inventes precios, promociones ni datos que no estén abajo o en la charla. Si te falta un dato para hacerlo bien, preguntalo en la respuesta.${webs.length ? `
- Te pasaron una página web: en "resumen_web" resumí en 3 a 6 frases qué vende el negocio (productos o servicios principales, precios si figuran, a quién le vende y cómo se presenta) para guardarlo en su memoria. En la respuesta contá brevemente que la leíste y qué encontraste.` : ""}${sinLeer.length ? `
- No pudiste abrir ${sinLeer.map((u) => u.hostname).join(", ")} (puede estar caída o armada de una forma que no se puede leer): decilo en la respuesta y pedí que te cuenten los productos o que peguen el texto.` : ""}

${marcaTexto(p)}

${comercialTexto(memoria?.comercial ?? null, rango, cfg.data()?.ia_enfoque ?? null)}

${memoriaTexto(memoria)}

Lo que se está trabajando:
${ctx.texto}
${webTexto ? `
${webTexto}
` : ""}
${b.voz ? `${VOZ}\n\n` : ""}Charla con la persona del equipo (lo último es lo que te pide ahora):
${mensajes.map((m) => `${m.rol === "yo" ? "Equipo" : "Vos"}: ${m.texto}`).join("\n")}`;

  const r = await generarJSON<Record<string, any>>(
    prompt,
    { type: "OBJECT", properties: { respuesta: { type: "STRING" }, recordar: { type: "STRING" }, resumen_web: { type: "STRING" }, ...ESQUEMAS[tipo] }, required: ["respuesta"] },
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
  } else if (tipo === "campania") {
    const cupos = await cuposDesde(pid, ctx.mes);
    const crudos = (Array.isArray(r.videos) ? r.videos : [])
      .map((x: any) => ({
        id: nuevoIdIdea(),
        titulo: t(x?.titulo, 120),
        idea: t(x?.idea, 1200),
        objetivo: t(x?.objetivo, 200) || null,
        porque: t(x?.porque, 300) || null,
        mes: /^\d{4}-\d{2}$/.test(t(x?.mes, 7)) ? t(x?.mes, 7) : ctx.mes,
      }))
      .filter((x: { titulo: string }) => x.titulo.length >= 3)
      .slice(0, 24);
    if (crudos.length) {
      propuesta = {
        campania: t(r.campania, 120) || "Campaña",
        rodaje: t(r.rodaje, 200) || null,
        videos: repartirEnMeses(crudos, cupos),
        cupos,
      };
    }
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
  // Lo que se sacó de la web queda en la memoria del cliente (como el contexto que pasa el equipo al armar el mes).
  const resumenWeb = t(r.resumen_web, 800);
  if (resumenWeb && webs.length) {
    const previos = (memoria?.contexto_equipo ?? []).filter((x) => !(x.archivos ?? []).some((a) => webs.some((w) => w.url === a))).slice(-19);
    await db
      .collection("ia_memoria")
      .doc(pid)
      .set(
        { contexto_equipo: [...previos, { texto: `Su página web: ${resumenWeb}`, at: fechaAR(new Date()), por: caller.uid, archivos: webs.map((w) => w.url) }] },
        { merge: true }
      )
      .catch((e) => console.warn("[charla] web en memoria", pid, e));
    recordado = recordado ?? "Lo que vende según su página web";
  }
  return { respuesta, propuesta, recordado };
}
