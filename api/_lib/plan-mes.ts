// "Armar el mes" con IA: lógica pura (sin Firebase) que usan el servidor y la demo.
//
// Flujo: la IA propone las ideas del mes → producción (Lucía) las revisa y edita →
// se mandan al cliente → el cliente marca OK o pide cambios → los OK se convierten en videos.
// En cada paso se guarda qué se cambió para que la IA aprenda de ese cliente (`ia_memoria/{proyecto}`).

export interface IdeaPlan {
  id: string;
  titulo: string;
  idea: string;
  objetivo: string | null;
  /** Por qué la propone la IA (solo lo ve el equipo). */
  porque?: string | null;
  origen: "ia" | "equipo";
  /** Respuesta del cliente. */
  respuesta?: { ok: boolean; comentario?: string | null } | null;
  /** Video creado a partir de esta idea. */
  video_id?: string | null;
  /** Producción la descartó después del pedido de cambio. */
  descartada?: boolean;
}

export type EstadoPlan = "borrador" | "enviado" | "respondido" | "cerrado";

export interface EjemploMemoria {
  mes: string;
  at: string;
  tipo: "equipo" | "cliente" | "ajuste";
  aprobadas?: string[];
  editadas?: { antes: string; despues: string }[];
  descartadas?: string[];
  agregadas?: string[];
  cliente_ok?: string[];
  cliente_cambios?: { titulo: string; comentario: string }[];
  nota_cliente?: string | null;
}

/** Dato del cliente que salió del chat (lo resume el cron diario o "@prodi acordate que …"). */
export interface NotaChat {
  texto: string;
  fuente: "chat";
  /** YYYY-MM-DD (AR) de cuándo se anotó. */
  at: string;
  chat_id: string;
  /** Quién lo pidió con "@prodi acordate" (null: lo sacó el resumen diario). */
  por?: string | null;
}

export interface MemoriaIA {
  resumen?: string;
  notas_equipo?: string;
  ejemplos?: EjemploMemoria[];
  actualizado_at?: string;
  comercial?: ContextoComercial;
  /** Lo aprendido de los chats del cliente (máx. 40, lo más nuevo al final). */
  chat_notas?: NotaChat[];
  /** Hasta qué mensaje se leyó cada chat: { chatId: ISO }. */
  chat_cursor?: Record<string, string>;
}

/** Datos del chat para el prompt (los más nuevos). */
export function notasChatTexto(notas: NotaChat[] | null | undefined, max = 25): string {
  const n = (notas ?? []).slice(-max);
  if (!n.length) return "";
  const corta = (f: string) => f.split("-").reverse().slice(0, 2).join("/");
  return `Datos y preferencias del cliente que salieron del chat con el equipo (tenelos en cuenta; lo más nuevo manda):\n${n
    .map((x) => `- ${x.texto} (${corta(x.at)})`)
    .join("\n")}`;
}

// ---------------------------------------------------------------------------
// Contexto comercial: lo que vende el cliente y cómo le conseguimos consultas.
// ---------------------------------------------------------------------------

export interface ProductoComercial {
  id: string;
  nombre: string;
  detalle?: string | null;
  /** Texto libre: "$18.900", "desde $50.000", "consultar". */
  precio?: string | null;
  /** Lo que más vende o lo que más le conviene empujar. */
  destacado?: boolean;
}

export interface TemporadaComercial {
  id: string;
  titulo: string;
  detalle?: string | null;
  /** YYYY-MM-DD. Sin fechas = vale siempre. */
  desde?: string | null;
  hasta?: string | null;
}

export interface ContextoComercial {
  /** A qué cliente final apunta y qué hace que compre / escriba. */
  enfoque?: string;
  /** Qué cuenta como resultado: mensajes por WhatsApp, reservas, visitas al local… */
  objetivo?: string;
  productos?: ProductoComercial[];
  temporadas?: TemporadaComercial[];
  actualizado_at?: string;
}

/** Cómo trabaja Prodi lo comercial (se puede cambiar en Ajustes). */
export const ENFOQUE_PRODI_DEFAULT = `Prodi se destaca por dar resultados comerciales: cada video y cada pieza tiene que traerle consultas y ventas al negocio (leads), sobre todo mensajes por WhatsApp.
- Mostrar un producto o servicio concreto con un beneficio claro, no solo "lindo contenido".
- Darle a la gente un motivo para escribir ahora: oferta, novedad, temporada, cupos o fecha límite.
- Cerrar siempre con un llamado a la acción directo (escribinos por WhatsApp, reservá, vení al local).
- Pensar en lo que pregunta el cliente final antes de comprar y responderlo en el contenido.`;

export function rangoMes(mes: string): [string, string] {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${mes}-01`, `${mes}-${String(ultimo).padStart(2, "0")}`];
}

/** Temporadas que se cruzan con el rango (las que no tienen fechas valen siempre). */
export function temporadasVigentes(c: ContextoComercial | null | undefined, desde: string, hasta: string): TemporadaComercial[] {
  return (c?.temporadas ?? []).filter((t) => (!t.desde || t.desde <= hasta) && (!t.hasta || t.hasta >= desde));
}

const fechaCorta = (f?: string | null) => (f ? f.split("-").reverse().slice(0, 2).join("/") : "");

/** Texto para el prompt: enfoque de Prodi + lo comercial del cliente vigente en esas fechas. */
export function comercialTexto(
  c: ContextoComercial | null | undefined,
  rango: [string, string],
  enfoqueProdi?: string | null
): string {
  const partes: string[] = [];
  const prodi = (enfoqueProdi ?? "").trim() || ENFOQUE_PRODI_DEFAULT;
  partes.push(`Cómo trabaja Prodi (enfoque comercial, respetalo siempre):\n${prodi}`);
  if (c?.objetivo) partes.push(`Resultado que busca este cliente: ${c.objetivo}`);
  if (c?.enfoque) partes.push(`Enfoque comercial de este cliente:\n${c.enfoque}`);
  const prods = [...(c?.productos ?? [])].sort((a, b) => Number(!!b.destacado) - Number(!!a.destacado)).slice(0, 25);
  if (prods.length) {
    partes.push(
      `Productos y servicios (los marcados con ★ son los que hay que empujar):\n${prods
        .map((p) => `- ${p.destacado ? "★ " : ""}${p.nombre}${p.precio ? ` (${p.precio})` : ""}${p.detalle ? `: ${p.detalle}` : ""}`)
        .join("\n")}`
    );
  }
  const temp = temporadasVigentes(c, rango[0], rango[1]);
  if (temp.length) {
    partes.push(
      `De temporada / promos vigentes en estas fechas (aprovechalas):\n${temp
        .map((t) => `- ${t.titulo}${t.desde || t.hasta ? ` (${t.desde ? `desde ${fechaCorta(t.desde)}` : ""}${t.hasta ? ` hasta ${fechaCorta(t.hasta)}` : ""})` : ""}${t.detalle ? `: ${t.detalle}` : ""}`)
        .join("\n")}`
    );
  }
  return partes.join("\n\n");
}

/** Limpia lo que manda el navegador. */
export function limpiarComercial(raw: unknown): ContextoComercial {
  const r = (raw ?? {}) as Record<string, unknown>;
  const fecha = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null);
  const id = (v: unknown) => t(v, 40) || nuevoIdIdea();
  return {
    enfoque: t(r.enfoque, 2000),
    objetivo: t(r.objetivo, 200),
    productos: (Array.isArray(r.productos) ? r.productos : [])
      .slice(0, 40)
      .map((x) => x as Record<string, unknown>)
      .filter((x) => t(x.nombre, 120))
      .map((x) => ({ id: id(x.id), nombre: t(x.nombre, 120), detalle: t(x.detalle, 400) || null, precio: t(x.precio, 60) || null, destacado: !!x.destacado })),
    temporadas: (Array.isArray(r.temporadas) ? r.temporadas : [])
      .slice(0, 30)
      .map((x) => x as Record<string, unknown>)
      .filter((x) => t(x.titulo, 120))
      .map((x) => ({ id: id(x.id), titulo: t(x.titulo, 120), detalle: t(x.detalle, 400) || null, desde: fecha(x.desde), hasta: fecha(x.hasta) })),
  };
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMes = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
};

const MAX_EJEMPLOS = 12;
const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
export const nuevoIdIdea = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Domingo número `n` del mes (para Día de la Madre, del Padre, de las Infancias). */
function domingo(mes: string, n: number): number {
  const [y, m] = mes.split("-").map(Number);
  const primero = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((7 - primero) % 7) + (n - 1) * 7;
}

/** Fechas comerciales de Argentina que pueden servir para ideas de ese mes. */
export function fechasDelMes(mes: string): string[] {
  const m = Number(mes.slice(5, 7));
  const f: Record<number, string[]> = {
    1: ["Reyes (6/1)", "vacaciones de verano"],
    2: ["San Valentín (14/2)", "Carnaval", "vuelta al cole a fin de mes"],
    3: ["Día de la Mujer (8/3)", "vuelta a clases", "arranca el otoño (21/3)"],
    4: ["Pascuas", "fin de semana largo"],
    5: ["Hot Sale (mediados de mayo)", "25 de Mayo (locro, empanadas)"],
    6: [`Día del Padre (domingo ${domingo(mes, 3)})`, "Día de la Bandera (20/6)", "llega el frío"],
    7: ["Día del Amigo (20/7)", "vacaciones de invierno", "9 de Julio"],
    8: [`Día de las Infancias (domingo ${domingo(mes, 3)})`],
    9: ["Día del Maestro (11/9)", "Día de la Primavera y del Estudiante (21/9)"],
    10: [`Día de la Madre (domingo ${domingo(mes, 3)})`, "Halloween (31/10)"],
    11: ["CyberMonday (principios de noviembre)", "Black Friday (fin de noviembre)"],
    12: ["Navidad", "Año Nuevo", "regalos de fin de año", "arranca el verano"],
  };
  return f[m] ?? [];
}

/** Lo aprendido de este cliente, para meter en el prompt. */
export function memoriaTexto(m: MemoriaIA | null | undefined): string {
  if (!m) return "";
  const partes: string[] = [];
  if (m.resumen) partes.push(`Lo que ya aprendiste de este cliente:\n${m.resumen}`);
  if (m.notas_equipo) partes.push(`Indicaciones del equipo de Prodi (respetalas siempre):\n${m.notas_equipo}`);
  const chat = notasChatTexto(m.chat_notas);
  if (chat) partes.push(chat);
  const ej = (m.ejemplos ?? []).slice(-6);
  if (ej.length) {
    const lineas: string[] = [];
    for (const e of ej) {
      const mes = nombreMes(e.mes);
      if (e.aprobadas?.length) lineas.push(`- ${mes}: el equipo dejó tal cual: ${e.aprobadas.map((x) => `"${x}"`).join(", ")}`);
      for (const x of e.editadas ?? []) lineas.push(`- ${mes}: el equipo cambió "${x.antes}" → "${x.despues}"`);
      if (e.descartadas?.length) lineas.push(`- ${mes}: el equipo descartó: ${e.descartadas.map((x) => `"${x}"`).join(", ")}`);
      if (e.agregadas?.length) lineas.push(`- ${mes}: el equipo agregó ideas propias: ${e.agregadas.map((x) => `"${x}"`).join(", ")}`);
      if (e.cliente_ok?.length) lineas.push(`- ${mes}: al cliente le gustaron: ${e.cliente_ok.map((x) => `"${x}"`).join(", ")}`);
      for (const x of e.cliente_cambios ?? []) lineas.push(`- ${mes}: el cliente pidió cambios en "${x.titulo}": ${x.comentario}`);
      if (e.nota_cliente) lineas.push(`- ${mes}: comentario general del cliente: ${e.nota_cliente}`);
    }
    if (lineas.length) partes.push(`Historial de revisiones (aprendé de esto):\n${lineas.slice(-30).join("\n")}`);
  }
  return partes.join("\n\n");
}

export interface ContextoPlan {
  marca: string;
  /** Enfoque de Prodi + productos y temporadas del cliente (ver comercialTexto). */
  comercial?: string;
  mes: string;
  cantidad: number;
  memoria?: MemoriaIA | null;
  /** Videos anteriores con sus resultados (mensajes) para saber qué rinde. */
  historial: { titulo: string; idea?: string | null; mensajes?: number | null; mes: string }[];
  /** Videos que ya existen para ese mes (pedidos del cliente, etc.). */
  yaEnElMes: string[];
  /** Ideas que no hay que repetir (las otras del plan, al regenerar una). */
  evitar?: string[];
  /** Pedido puntual de Lucía al regenerar ("más divertida", "sobre delivery"). */
  pista?: string | null;
}

export function promptPlan(c: ContextoPlan): string {
  const top = [...c.historial]
    .filter((v) => (v.mensajes ?? 0) > 0)
    .sort((a, b) => (b.mensajes ?? 0) - (a.mensajes ?? 0))
    .slice(0, 5);
  const recientes = c.historial.slice(0, 15).map((v) => `- ${v.titulo}`);
  const fechas = fechasDelMes(c.mes);
  const memoria = memoriaTexto(c.memoria);
  return `Sos el director creativo de Prodi, una agencia argentina que filma videos comerciales verticales (Reels de 20 a 45 segundos) para comercios y los pauta en Meta para conseguir mensajes por WhatsApp.
Armá ${c.cantidad === 1 ? "1 idea de video" : `${c.cantidad} ideas de video`} para ${nombreMes(c.mes)}.

Reglas:
- Cada idea tiene que poder filmarse en el comercio en una jornada, con un celular y una persona.
- Variedad: mezclá producto, detrás de escena, testimonio, oferta o fecha especial, humor o tendencia. No repitas formato.
- Pensá en lo que trae mensajes y ventas: un gancho fuerte en los primeros 3 segundos, un producto o beneficio concreto y un llamado a la acción claro.
- Si hay productos destacados o temporadas vigentes, la mayoría de las ideas tienen que salir de ahí.
- No inventes precios, promociones ni datos que no estén abajo. Si una idea necesita una promo, escribí "promo a definir con el cliente".
- Español rioplatense con voseo. Títulos cortos (máximo 7 palabras). Idea en 2 o 3 oraciones: qué se ve y qué se dice.
- objetivo: para qué sirve (ej. "conseguir pedidos por WhatsApp", "mostrar el local").
- porque: una oración para el equipo explicando por qué la proponés (dato, fecha, algo que aprendiste del cliente).
${memoria ? "- Lo más importante: respetá lo que aprendiste de este cliente y las indicaciones del equipo. No vuelvas a proponer cosas que se descartaron.\n" : ""}
${c.marca}

${c.comercial ? `${c.comercial}\n\n` : ""}${memoria ? `${memoria}\n\n` : ""}${top.length ? `Videos que más mensajes trajeron (inspirate en lo que funcionó, sin copiar):\n${top.map((v) => `- ${v.titulo}: ${v.mensajes} mensajes${v.idea ? ` (${String(v.idea).slice(0, 140)})` : ""}`).join("\n")}\n\n` : ""}${recientes.length ? `Videos que ya se hicieron (no los repitas):\n${recientes.join("\n")}\n\n` : ""}${c.yaEnElMes.length ? `Ya están confirmados para este mes (no los repitas):\n${c.yaEnElMes.map((x) => `- ${x}`).join("\n")}\n\n` : ""}${c.evitar?.length ? `Otras ideas de este mismo plan (proponé algo distinto):\n${c.evitar.map((x) => `- ${x}`).join("\n")}\n\n` : ""}${fechas.length ? `Fechas del mes que pueden servir (solo si le encajan al rubro): ${fechas.join(", ")}.\n\n` : ""}${c.pista ? `Pedido del equipo para esta idea: ${c.pista}\n` : ""}`.trim();
}

export const ESQUEMA_PLAN = {
  type: "OBJECT",
  properties: {
    ideas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          titulo: { type: "STRING" },
          idea: { type: "STRING" },
          objetivo: { type: "STRING" },
          porque: { type: "STRING" },
        },
        required: ["titulo", "idea", "objetivo", "porque"],
      },
    },
  },
  required: ["ideas"],
};

/** Normaliza lo que devuelve la IA. */
export function ideasDesdeIA(raw: unknown, cantidad: number): IdeaPlan[] {
  const lista = (raw as { ideas?: unknown[] })?.ideas ?? [];
  return lista
    .map((x) => x as Record<string, unknown>)
    .filter((x) => t(x.titulo, 120).length >= 3)
    .slice(0, cantidad)
    .map((x) => ({
      id: nuevoIdIdea(),
      titulo: t(x.titulo, 120),
      idea: t(x.idea, 1200),
      objetivo: t(x.objetivo, 200) || null,
      porque: t(x.porque, 300) || null,
      origen: "ia" as const,
    }));
}

/** Limpia las ideas que manda el navegador antes de guardarlas. */
export function limpiarIdeas(raw: unknown, max = 20): IdeaPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, max)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => t(x.titulo, 120).length > 0)
    .map((x) => ({
      id: t(x.id, 40) || nuevoIdIdea(),
      titulo: t(x.titulo, 120),
      idea: t(x.idea, 1200),
      objetivo: t(x.objetivo, 200) || null,
      porque: t(x.porque, 300) || null,
      origen: x.origen === "equipo" ? "equipo" : "ia",
    }));
}

const resumenIdea = (i: { titulo: string; idea?: string | null }) =>
  `${i.titulo}${i.idea ? `: ${String(i.idea).slice(0, 160)}` : ""}`;

/** Lo que hizo producción con la propuesta de la IA (se compara con lo que propuso la IA). */
export function aprendizajeEquipo(mes: string, propuestas: IdeaPlan[], finales: IdeaPlan[], descartadasAntes: string[]): EjemploMemoria {
  const porId = new Map(propuestas.map((i) => [i.id, i]));
  const aprobadas: string[] = [];
  const editadas: { antes: string; despues: string }[] = [];
  const agregadas: string[] = [];
  for (const f of finales) {
    const orig = porId.get(f.id);
    if (!orig) {
      agregadas.push(resumenIdea(f));
      continue;
    }
    const igual = orig.titulo.trim() === f.titulo.trim() && (orig.idea ?? "").trim() === (f.idea ?? "").trim();
    if (igual) aprobadas.push(f.titulo);
    else editadas.push({ antes: resumenIdea(orig), despues: resumenIdea(f) });
  }
  const ids = new Set(finales.map((f) => f.id));
  const descartadas = [...descartadasAntes, ...propuestas.filter((p) => !ids.has(p.id)).map((p) => p.titulo)];
  return {
    mes,
    at: new Date().toISOString(),
    tipo: "equipo",
    aprobadas,
    editadas: editadas.slice(0, 10),
    descartadas: Array.from(new Set(descartadas)).slice(0, 15),
    agregadas: agregadas.slice(0, 10),
  };
}

export function aprendizajeCliente(mes: string, ideas: IdeaPlan[], nota: string | null): EjemploMemoria {
  return {
    mes,
    at: new Date().toISOString(),
    tipo: "cliente",
    cliente_ok: ideas.filter((i) => i.respuesta?.ok).map((i) => i.titulo),
    cliente_cambios: ideas
      .filter((i) => i.respuesta && !i.respuesta.ok)
      .map((i) => ({ titulo: i.titulo, comentario: t(i.respuesta?.comentario, 300) || "sin detalle" })),
    nota_cliente: nota ? t(nota, 400) : null,
  };
}

/** Cómo quedó una idea que el cliente pidió cambiar, después del ajuste de producción. */
export function aprendizajeAjuste(mes: string, antes: IdeaPlan, despues: { titulo: string; idea?: string | null }, descartada: boolean): EjemploMemoria {
  return descartada
    ? { mes, at: new Date().toISOString(), tipo: "ajuste", descartadas: [antes.titulo] }
    : { mes, at: new Date().toISOString(), tipo: "ajuste", editadas: [{ antes: resumenIdea(antes), despues: resumenIdea(despues) }] };
}

export function sumarEjemplo(m: MemoriaIA | null | undefined, e: EjemploMemoria): EjemploMemoria[] {
  return [...(m?.ejemplos ?? []), e].slice(-MAX_EJEMPLOS);
}

export function promptResumen(marca: string, m: MemoriaIA): string {
  return `Sos el asistente creativo de Prodi (agencia argentina de videos comerciales para redes).
Con los datos de abajo, escribí lo que aprendiste sobre qué ideas de video le sirven a este cliente y cuáles no, para la próxima vez que armes su plan del mes.
- Máximo 8 líneas cortas, cada una empezando con "- ".
- Temas que gustan, temas o formatos que se descartan, cómo le gusta al cliente que se cuenten las cosas, cosas que siempre pide o corrige.
- Solo lo que se deduzca de los datos; si algo pasó una sola vez, decilo con cautela ("parece que…").
- Español rioplatense, concreto.

${marca}

${memoriaTexto({ ...m, chat_notas: undefined, resumen: m.resumen ? `(resumen anterior, actualizalo)\n${m.resumen}` : undefined })}`;
}

export const ESQUEMA_RESUMEN = {
  type: "OBJECT",
  properties: { resumen: { type: "STRING" } },
  required: ["resumen"],
};
