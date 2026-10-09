/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/ia/copy   { video_id }              → { opciones: string[] }
// POST /api/ia/pieza  { pieza_id, ajustes? }    → genera una versión y la guarda en Drive
// POST /api/ia/pieza-editar { pieza_id, version_id, instruccion, formato? } → edita esa versión con IA (queda como versión nueva)
// POST /api/ia/pieza-compartir { pieza_id, version_id, chat_id, texto? } → manda esa versión a un chat (imagen + tarjeta)
// POST /api/ia/guion  { video_id }              → guion y lista de tomas del video
// POST /api/ia/preparar { proyecto_id, video_ids } → qué tiene que tener listo el cliente para el rodaje
// POST /api/ia/marca-subir  { proyecto_id, tipo: "logo"|"variante"|"manual"|"referencia", etiqueta?, nombre, mime, data(base64) }
// POST /api/ia/marca-quitar { proyecto_id, tipo, drive_file_id }
// POST /api/ia/marca-avatar  { proyecto_id, de, img } → foto de perfil (JPEG chico) armada en el navegador con el logo
// POST /api/ia/marca-variante { proyecto_id, drive_file_id, etiqueta?, principal? } → renombra o la hace el logo principal
// POST /api/ia/marca-colores { proyecto_id, paleta: ["#rrggbb", …], info?: { "#rrggbb": { nombre, uso } } }  (también el cliente)
// POST /api/ia/marca-info   { proyecto_id, rubro, descripcion, publico?, colores?, instagram?, tono? }  (también el cliente)
// Plan del mes con IA (ver api/_lib/plan-mes.ts):
// POST /api/ia/plan-mes      { proyecto_id, mes, idea_id?, pista? }  → arma el borrador (o rehace una idea)
// POST /api/ia/plan-enviar   { proyecto_id, mes, ideas, nota_equipo } → producción lo revisó: va al cliente
// POST /api/ia/plan-responder { proyecto_id, mes, respuestas, nota }  (cliente) → los OK pasan a ser videos
// POST /api/ia/plan-ajustar  { proyecto_id, mes, idea_id, accion: "crear"|"descartar", titulo?, idea?, objetivo? }
// POST /api/ia/memoria-notas { proyecto_id, notas } → indicaciones fijas del equipo para la IA
// POST /api/ia/comercial-guardar { proyecto_id, comercial } → enfoque, productos y temporadas del cliente (también el cliente)
// POST /api/ia/comercial-ver { proyecto_id } → solo el contexto comercial (para el panel del cliente)
// POST /api/ia/chat-asistente { chat_id, mensaje_id } → @prodi en el chat (ver api/_lib/chat-asistente.ts)
// POST /api/ia/dueno { mensajes } (super admin) → asistente del dueño, ve todo (ver api/_lib/dueno.ts)
// POST /api/ia/links-chat { chat_id, mensaje_id } → links del mensaje: a la ficha del cliente y a la memoria de la IA
// POST /api/ia/memoria-chat-quitar { proyecto_id, texto } → saca un dato que la IA aprendió del chat
// POST /api/ia/estado (admin) → qué claves de IA están cargadas (sí/no, nunca la clave) y con qué modelo de Claude
// POST /api/ia/tarea-chat { chat_id, mensaje_id, titulo, asignados, vence? } → tarea a partir de un mensaje del chat (sin IA)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "../_lib/db";
import { adminDb } from "../_lib/db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, sendError } from "../_lib/http";
import { generarImagen, generarJSON, generarMinutaIA, generarTextos } from "../_lib/ia";
import { descargarDrive } from "../_lib/drive-stream";
import { getAppDriveAccessToken } from "../_lib/drive-connection";
import { uploadBufferToDrive } from "../_lib/drive-server";
import { briefPieza, FORMATOS_PIEZA } from "../_lib/piezas";
import { enviarAviso } from "../_lib/notify";
import { filmaElCliente, videoDesdePedido } from "../_lib/pedidos";
import { fechaAR, sumarDias } from "../_lib/fecha";
import { atenderMencion } from "../_lib/chat-asistente";
import { avisarMensaje, chatDeMiembro, publicarEnChat } from "../_lib/chat-server";
import { asistenteDueno } from "../_lib/dueno";
import { linksDeMensaje } from "../_lib/chat-links";
import { crearTarea } from "../_lib/tareas";
import { logosParaPieza, marcaTexto } from "../_lib/marca";
import {
  comercialTexto,
  limpiarComercial,
  rangoMes,
  aprendizajeAjuste,
  aprendizajeCliente,
  aprendizajeEquipo,
  ESQUEMA_PLAN,
  ESQUEMA_RESUMEN,
  ideasDesdeIA,
  notasChatTexto,
  limpiarIdeas,
  nombreMes,
  promptPlan,
  promptResumen,
  sumarEjemplo,
  type EjemploMemoria,
  type IdeaPlan,
  type MemoriaIA,
} from "../_lib/plan-mes";

// Las minutas de reuniones largas pueden tardar: hasta 5 minutos.
export const config = { maxDuration: 300 };

/**
 * Enfoque comercial de Prodi + productos y temporadas del cliente vigentes en esas fechas
 * + lo que se aprendió de su chat (el plan del mes ya lo lee con la memoria: `conChat = false`).
 */
async function contextoComercial(pid: string, rango: [string, string], conChat = true): Promise<string> {
  const db = adminDb();
  const [m, cfg] = await Promise.all([
    db.collection("ia_memoria").doc(pid).get(),
    db.collection("app_settings").doc("redes").get(),
  ]);
  const base = comercialTexto(m.data()?.comercial ?? null, rango, cfg.data()?.ia_enfoque ?? null);
  const chat = conChat ? notasChatTexto(m.data()?.chat_notas, 15) : "";
  return chat ? `${base}\n\n${chat}` : base;
}
const proximos30 = (desde: Date | string = new Date()): [string, string] => {
  const d = fechaAR(desde) || fechaAR(new Date());
  return [d, sumarDias(d, 30)];
};

async function copy(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno"]);
  const { video_id } = body<{ video_id?: string }>(req);
  if (!video_id) throw new HttpError(400, "Falta video_id");
  const db = adminDb();
  const v = await db.collection("videos").doc(video_id).get();
  if (!v.exists) throw new HttpError(404, "Video no encontrado");
  const video = v.data()!;
  await assertProjectAccess(caller, video.proyecto_id);
  const p = (await db.collection("projects").doc(video.proyecto_id).get()).data() ?? {};

  const prompt = `Sos redactor de una agencia argentina que hace videos comerciales con pauta en Meta (Instagram y Facebook).
Escribí 3 opciones de texto para acompañar este video. Reglas:
- Español rioplatense con voseo, natural, sin sonar a robot ni a vendedor exagerado.
- No prometas resultados ni inventes precios, promociones o datos que no estén abajo.
- Empezá con una frase que enganche en la primera línea.
- Cerrá con un llamado a la acción concreto (escribinos por WhatsApp, vení al local, etc.).
- Máximo 4 líneas cortas + hasta 5 hashtags relevantes y locales. Emojis con moderación.
- Cada opción con un enfoque distinto (directa, emocional, informativa).

${marcaTexto(p)}

${await contextoComercial(video.proyecto_id, proximos30())}

Video: ${video.titulo}
${video.idea ? `Idea / guion: ${video.idea}` : ""}
${video.objetivo ? `Objetivo del video: ${video.objetivo}` : ""}`;

  const opciones = await generarTextos(prompt, 3);
  return { opciones };
}

/**
 * Una sola generación o edición a la vez por pieza (un doble toque no paga dos imágenes). El turno se libera
 * al guardar la versión; si algo falla, vence solo a los 2 minutos.
 */
async function tomarTurnoPieza(piezaId: string) {
  const ref = adminDb().collection("piezas_ia").doc(piezaId);
  const libre = await adminDb().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() ?? {};
    const desde = d.generando_at ? new Date(String(d.generando_at)).getTime() : 0;
    if (Date.now() - desde < 120_000) return false;
    tx.update(ref, { generando_at: new Date().toISOString() });
    return true;
  });
  if (!libre) throw new HttpError(409, "Ya se está haciendo una versión de esta pieza. Esperá a que termine (≈30 s).");
}

/**
 * Mandar una versión de una pieza a un chat (una persona, un grupo o el del cliente): llega la imagen con la
 * tarjeta de la pieza. Lo publica el servidor porque los mensajes con archivo dan acceso al archivo a todo el chat.
 */
async function piezaCompartir(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "administracion"]);
  const { pieza_id, version_id, chat_id, texto } = body<{ pieza_id?: string; version_id?: string; chat_id?: string; texto?: string }>(req);
  if (!pieza_id || !version_id || !chat_id) throw new HttpError(400, "Faltan datos");
  const db = adminDb();
  const pz = (await db.collection("piezas_ia").doc(pieza_id).get()).data();
  if (!pz) throw new HttpError(404, "Pieza no encontrada");
  await assertProjectAccess(caller, pz.proyecto_id);
  const chat = await chatDeMiembro(chat_id, caller.uid);
  const v = ((pz.versiones ?? []) as { id: string; drive_file_id: string; name?: string; mime_type?: string; size?: number }[]).find((x) => x.id === version_id);
  if (!v) throw new HttpError(404, "Versión no encontrada");
  const p = (await db.collection("projects").doc(pz.proyecto_id).get()).data() ?? {};
  const fmt = FORMATOS_PIEZA[pz.formato] ?? FORMATOS_PIEZA.cuadrado;
  const leyenda = String(texto ?? "").trim().slice(0, 1000);
  const mime = v.mime_type || "image/png";
  const resumen = `📷 ${p.nombre ?? "Pieza"} · ${fmt.label}${leyenda ? ` · ${leyenda}` : ""}`;
  const nombre = caller.nombre ?? "";
  const { id } = await publicarEnChat(String(chat_id), {
    texto: resumen,
    leyenda: leyenda || null,
    by: caller.uid,
    by_nombre: nombre,
    at: new Date().toISOString(),
    tipo: "archivo",
    link: null,
    reunion_id: null,
    archivo: { drive_file_id: v.drive_file_id, name: v.name || `pieza.${mime.includes("jpeg") ? "jpg" : "png"}`, mime_type: mime, size: Number(v.size ?? 0) },
    referencia: {
      tipo: "pieza",
      id: pieza_id,
      titulo: [fmt.label, pz.producto, p.nombre].filter(Boolean).join(" · "),
      detalle: pz.estado === "entregada" ? "Entregada" : pz.estado === "para_aprobar" ? "Esperando al cliente" : "En diseño",
      correccion: null,
    },
  });
  await avisarMensaje(String(chat_id), chat, caller.uid, nombre, resumen, appUrl(req)).catch((err) => console.warn("[pieza-compartir] aviso", err));
  return { ok: true, mensaje_id: id };
}

/** Si la generación falla en cualquier paso, la pieza queda libre al toque para reintentar (y el error sigue). */
async function liberarTurnoPieza(req: VercelRequest, err: unknown): Promise<never> {
  const id = (req.body as { pieza_id?: unknown } | undefined)?.pieza_id;
  if (typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id) && !(err instanceof HttpError && err.status === 409)) {
    await adminDb().collection("piezas_ia").doc(id).update({ generando_at: null }).catch(() => undefined);
  }
  throw err;
}

async function pieza(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "diseno"]);
  const { pieza_id, ajustes } = body<{ pieza_id?: string; ajustes?: string | null }>(req);
  if (!pieza_id) throw new HttpError(400, "Falta pieza_id");
  const db = adminDb();
  const ref = db.collection("piezas_ia").doc(pieza_id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Pieza no encontrada");
  const pz = snap.data()!;
  await assertProjectAccess(caller, pz.proyecto_id);
  if (!["pagada", "en_proceso"].includes(pz.estado)) {
    throw new HttpError(409, "La pieza tiene que estar pagada para generarla");
  }
  await tomarTurnoPieza(pieza_id);
  const p = (await db.collection("projects").doc(pz.proyecto_id).get()).data() ?? {};

  const fmt = FORMATOS_PIEZA[pz.formato] ?? FORMATOS_PIEZA.cuadrado;
  const comercial = pz.enfoque === "institucional" ? "" : await contextoComercial(pz.proyecto_id, proximos30(new Date(pz.created_at ?? Date.now())));
  const prompt = `Diseño gráfico publicitario profesional de un comercio argentino. Uso: ${fmt.uso}.
${marcaTexto(p)}
${comercial ? `\n${comercial}\n` : ""}
${briefPieza(pz)}
${pz.texto_en_pieza ? `Texto que debe aparecer, escrito exactamente así y bien legible: "${pz.texto_en_pieza}"` : "No agregues textos largos; como mucho un titular corto en español."}
${ajustes ? `Ajustes pedidos por el equipo: ${ajustes}` : ""}

${
    fmt.impresion
      ? "Estilo: pieza para imprimir. Tipografía grande y legible a varios metros, alto contraste, márgenes de seguridad (nada importante pegado al borde), fondo plano o simple, sin mockups ni fotos del cartel colgado: solo el diseño de frente."
      : "Estilo: limpio, moderno, alto contraste, composición clara con un solo mensaje principal, pensado para verse en el celular."
  }
Usá los colores de la marca si están indicados. No inventes logos de otras marcas ni datos de contacto.`;

  // Logo y piezas de referencia de la marca (si las cargaron).
  const archivos = (p.marca_archivos ?? {}) as { referencias?: { drive_file_id: string }[] };
  const imagenes: { data: Buffer; mime: string }[] = [];
  let guia = "";
  // Logo principal y, si hay, la versión para fondos oscuros: la IA usa la que contraste con el fondo.
  const logos = logosParaPieza(p);
  const [logo, logoClaro] = await Promise.all([
    logos.principal ? descargarDrive(logos.principal.drive_file_id).catch(() => null) : null,
    logos.clara ? descargarDrive(logos.clara.drive_file_id).catch(() => null) : null,
  ]);
  if (logo && logoClaro) {
    imagenes.push(logo, logoClaro);
    guia += `\nLas dos primeras imágenes adjuntas son el LOGO de la marca: la primera es la versión principal y la segunda la versión "${logos.clara?.etiqueta}" para fondos oscuros. Usá UNA sola, la que mejor contraste con el fondo de la pieza, tal cual: sin redibujarla, deformarla ni cambiarle los colores, en un lugar visible y prolijo.`;
  } else if (logo) {
    imagenes.push(logo);
    guia += "\nLa primera imagen adjunta es el LOGO de la marca: incluilo tal cual, sin redibujarlo, deformarlo ni cambiarle los colores, en un lugar visible y prolijo.";
  }
  // Fotos que cargó el equipo con el pedido (el producto, el local, la persona): se usan tal cual en la pieza.
  const fotos = (
    await Promise.all(
      ((pz.attachments_crudo ?? []) as { drive_file_id: string; mime_type?: string }[])
        .filter((f) => !f.mime_type || f.mime_type.startsWith("image/"))
        .slice(0, 4)
        .map((f) => descargarDrive(f.drive_file_id, 12 * 1024 * 1024).catch(() => null))
    )
  ).filter(Boolean) as { data: Buffer; mime: string }[];
  if (fotos.length) {
    const desde = imagenes.length + 1;
    imagenes.push(...fotos);
    guia += `\nLas imágenes ${desde}${fotos.length > 1 ? ` a ${desde + fotos.length - 1}` : ""} son FOTOS REALES para usar en la pieza (producto, local o persona): usalas como protagonistas, sin cambiarlas ni inventar otro producto. Podés recortarlas, iluminarlas y armar el diseño alrededor.`;
  }
  const refs = await Promise.all(
    (archivos.referencias ?? []).slice(0, 3).map((r) => descargarDrive(r.drive_file_id).catch(() => null))
  );
  const refsOk = refs.filter(Boolean) as { data: Buffer; mime: string }[];
  if (refsOk.length) {
    imagenes.push(...refsOk);
    guia += `\n${imagenes.length > refsOk.length ? (refsOk.length === 1 ? "La última imagen es una pieza anterior" : `Las últimas ${refsOk.length} imágenes son piezas anteriores`) : "Las imágenes adjuntas son piezas anteriores"} de la marca: seguí su estilo (colores, tipografías, tipo de fotos y composición) sin copiarlas.`;
  }

  // Opus hace de director de arte: mira la marca, el logo, las piezas anteriores y el pedido, y le escribe a
  // Gemini un brief visual concreto (composición, fondo, foto o ilustración, jerarquía, dónde va el logo).
  // Si falla, Gemini trabaja con el pedido tal cual.
  let final = prompt + guia;
  try {
    const paraClaude = imagenes
      .filter((i) => /^image\/(jpeg|png|gif|webp)$/.test(i.mime) && i.data.length < 4_500_000)
      .map((i) => ({ data: i.data, mime: i.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp" }));
    const r = await generarJSON<{ brief?: string }>(
      `Sos director de arte de una agencia argentina de redes. Un generador de imágenes (Gemini) va a diseñar esta pieza y necesita un brief visual preciso.
Escribí el brief: qué se ve (foto realista, ilustración o composición gráfica), escena y producto, fondo, paleta exacta con los colores de la marca, tipografía (estilo), jerarquía del texto, dónde va el logo y con cuánto aire, y qué evitar.
- Respetá TODO lo pedido abajo (enfoque, producto, oferta, texto exacto, cambios del cliente, ajustes del equipo). No inventes precios, datos de contacto ni textos que no estén.
- Si hay texto que debe aparecer, copialo entre comillas exactamente igual.
- Las imágenes adjuntas son el logo y piezas anteriores de la marca: describí cómo seguir su estilo sin copiarlas.
- Formato ${fmt.ratio}. Máximo 180 palabras, en español, directo (sin saludos ni explicaciones).

${prompt}${guia}`,
      { type: "OBJECT", properties: { brief: { type: "STRING" } }, required: ["brief"] },
      0.6,
      paraClaude
    );
    const brief = String(r.brief ?? "").trim();
    if (brief.length > 40) final = `${brief}\n\n${pz.texto_en_pieza ? `Texto exacto que debe aparecer, bien legible: "${pz.texto_en_pieza}"\n` : ""}${guia.trim()}\nNo inventes logos de otras marcas ni datos de contacto.`;
  } catch (err) {
    console.warn("[pieza] brief de Claude", err);
  }

  const img = await generarImagen(final, fmt.ratio, imagenes).catch(async (err) => {
    await ref.update({ generando_at: null }).catch(() => undefined);
    throw err;
  });
  const n = (pz.versiones?.length ?? 0) + 1;
  const ext = img.mime.includes("jpeg") ? "jpg" : "png";
  const up = await uploadBufferToDrive({
    path: [String(p.nombre ?? "Cliente"), "Piezas IA"],
    name: `pieza-${pieza_id.slice(0, 6)}-v${n}.${ext}`,
    mime: img.mime,
    data: img.data,
  });
  const now = new Date().toISOString();
  await ref.update({
    estado: "en_proceso",
    generando_at: null,
    updated_at: now,
    versiones: FieldValue.arrayUnion({
      id: `v${n}_${Date.now()}`,
      ...up,
      prompt: ajustes ? `${pz.pedido} · ajustes: ${ajustes}` : pz.pedido,
      created_at: now,
      created_by: caller.uid,
    }),
  });
  return { ok: true };
}

/**
 * Editar una versión con IA: "cambiá el fondo", "más luz", "pasalo a historia"… Claude convierte el pedido en
 * una instrucción precisa (mirando la imagen y la marca) y Gemini edita sobre esa misma imagen. Queda como
 * versión nueva; la original no se toca.
 */
async function piezaEditar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "diseno"]);
  const { pieza_id, version_id, instruccion, formato, zona, marcada } = body<{
    pieza_id?: string;
    version_id?: string;
    instruccion?: string;
    formato?: string;
    /** Zona marcada en el editor (fracciones 0 a 1 de la imagen): solo se cambia ahí. */
    zona?: { x?: number; y?: number; w?: number; h?: number } | null;
    /** La misma imagen con la zona pintada en rojo (JPEG en base64), para que Gemini vea dónde. */
    marcada?: string | null;
  }>(req);
  const pedido = String(instruccion ?? "").trim().slice(0, 600);
  if (!pieza_id || !version_id || pedido.length < 3) throw new HttpError(400, "Contá qué le querés cambiar");
  const db = adminDb();
  const ref = db.collection("piezas_ia").doc(pieza_id);
  const pz = (await ref.get()).data();
  if (!pz) throw new HttpError(404, "Pieza no encontrada");
  await assertProjectAccess(caller, pz.proyecto_id);
  if (["cancelada", "rechazada", "pendiente_pago"].includes(pz.estado)) throw new HttpError(409, "Esta pieza no se puede editar");
  await tomarTurnoPieza(pieza_id);
  const v = ((pz.versiones ?? []) as { id: string; drive_file_id: string; mime_type?: string }[]).find((x) => x.id === version_id);
  if (!v) throw new HttpError(404, "Versión no encontrada");
  if (v.mime_type === "application/pdf") throw new HttpError(409, "Los PDF no se editan con IA");
  const p = (await db.collection("projects").doc(pz.proyecto_id).get()).data() ?? {};
  const base = FORMATOS_PIEZA[pz.formato] ?? FORMATOS_PIEZA.cuadrado;
  const destino = formato && FORMATOS_PIEZA[formato] ? FORMATOS_PIEZA[formato] : base;
  const original = await descargarDrive(v.drive_file_id, 15 * 1024 * 1024);
  const fr = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
  const z = zona && fr(zona.w) > 0.01 && fr(zona.h) > 0.01 ? { x: fr(zona.x), y: fr(zona.y), w: fr(zona.w), h: fr(zona.h) } : null;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const dondeTexto = z
    ? `SOLO en la zona marcada: empieza a ${pct(z.x)} desde la izquierda y ${pct(z.y)} desde arriba, mide ${pct(z.w)} de ancho y ${pct(z.h)} de alto. Fuera de esa zona no cambies nada.`
    : "";
  const marca = typeof marcada === "string" && /^[A-Za-z0-9+/=]+$/.test(marcada) && marcada.length < 4_000_000 ? Buffer.from(marcada, "base64") : null;

  // Claude: el pedido suelto → instrucción de edición concreta, cuidando la marca y lo que no hay que tocar.
  let instr = `Editá esta imagen: ${pedido}. ${dondeTexto} Mantené todo lo demás igual (textos, logo, colores y composición), salvo lo que se pide cambiar.`;
  try {
    const ver = /^image\/(jpeg|png|gif|webp)$/.test(original.mime) && original.data.length < 4_500_000;
    const r = await generarJSON<{ instruccion?: string }>(
      `Sos director de arte. Hay que editar la pieza adjunta con un editor de imágenes IA (Gemini).
Pedido del equipo: "${pedido}"${dondeTexto ? `\nDónde: ${dondeTexto}` : ""}${destino !== base ? `\nAdemás hay que adaptarla al formato ${destino.ratio} (${destino.uso}): reacomodá la composición sin cortar textos ni el logo.` : ""}
${marcaTexto(p)}
Escribí UNA instrucción de edición precisa (máximo 90 palabras): qué cambiar exactamente y qué dejar igual (textos tal cual, logo intacto sin redibujar, colores de marca). No agregues textos nuevos salvo que el pedido lo diga.`,
      { type: "OBJECT", properties: { instruccion: { type: "STRING" } }, required: ["instruccion"] },
      0.3,
      ver ? [{ data: original.data, mime: original.mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp" }] : []
    );
    if (String(r.instruccion ?? "").trim().length > 20) instr = String(r.instruccion).trim();
  } catch (err) {
    console.warn("[pieza-editar] instrucción de Claude", err);
  }

  const img = await generarImagen(
    `${instr}\nLa primera imagen adjunta es la pieza a editar: trabajá sobre ella.${
      marca
        ? "\nLa segunda imagen es la misma pieza con un recuadro ROJO que marca la zona a cambiar: cambiá solo esa zona y entregá la pieza SIN el recuadro rojo."
        : z
          ? `\n${dondeTexto}`
          : ""
    }`,
    destino.ratio,
    marca ? [original, { data: marca, mime: "image/jpeg" }] : [original]
  ).catch(async (err) => {
    await ref.update({ generando_at: null }).catch(() => undefined);
    throw err;
  });
  const n = (pz.versiones?.length ?? 0) + 1;
  const ext = img.mime.includes("jpeg") ? "jpg" : "png";
  const up = await uploadBufferToDrive({
    path: [String(p.nombre ?? "Cliente"), "Piezas IA"],
    name: `pieza-${pieza_id.slice(0, 6)}-v${n}.${ext}`,
    mime: img.mime,
    data: img.data,
  });
  const now = new Date().toISOString();
  const id = `v${n}_${Date.now()}`;
  await ref.update({
    ...(pz.estado === "pagada" ? { estado: "en_proceso" } : {}),
    generando_at: null,
    updated_at: now,
    versiones: FieldValue.arrayUnion({ id, ...up, prompt: `Edición${z ? " (zona marcada)" : ""}: ${pedido}`, edita_a: version_id, created_at: now, created_by: caller.uid }),
  });
  return { ok: true, version_id: id };
}

async function minuta(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno"]);
  const { reunion_id, usar } = body<{ reunion_id?: string; usar?: "audio" | "notas" }>(req);
  if (!reunion_id) throw new HttpError(400, "Falta reunion_id");
  const db = adminDb();
  const ref = db.collection("reuniones").doc(reunion_id);
  const r = (await ref.get()).data();
  if (!r) throw new HttpError(404, "Reunión no encontrada");
  if (r.proyecto_id) await assertProjectAccess(caller, r.proyecto_id);
  else if (caller.role !== "admin" && !(r.participantes ?? []).includes(caller.uid)) throw new HttpError(403, "No participaste de esta reunión");

  const perfiles = await Promise.all(
    (r.participantes ?? []).map((id: string) => db.collection("profiles").doc(id).get())
  );
  const nombres = perfiles.map((p) => p.data()?.nombre).filter(Boolean).join(", ");
  const cliente = r.proyecto_id ? (await db.collection("projects").doc(r.proyecto_id).get()).data()?.nombre : null;

  const prompt = `Sos el asistente de una agencia argentina que hace videos comerciales con pauta en redes (Prodi).
Armá la minuta de esta reunión en español rioplatense, clara y concreta.
- resumen: 2 a 4 oraciones con lo más importante.
- temas: los temas tratados, cortos.
- acuerdos: decisiones tomadas (si no hubo, lista vacía).
- tareas: cosas concretas que alguien tiene que hacer; responsable con el nombre de la persona si se menciona; fecha si se menciona (texto libre, ej. "viernes").
No inventes nada que no se haya dicho.

Reunión: ${r.titulo}
${cliente ? `Cliente: ${cliente}` : "Reunión interna del equipo"}
Participantes: ${nombres || "sin datos"}
${r.notas ? `Notas tomadas durante la reunión:\n${r.notas}` : ""}`;

  const grabaciones = (r.attachments_crudo ?? []) as { drive_file_id: string; mime_type: string; size: number }[];
  let audio: { data: Buffer; mime: string } | undefined;
  if (usar !== "notas" && grabaciones.length) {
    const g = grabaciones[grabaciones.length - 1];
    if (g.size > 200 * 1024 * 1024) throw new HttpError(413, "La grabación es muy larga. Subila en partes de menos de 3 horas.");
    const { accessToken } = await getAppDriveAccessToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(g.drive_file_id)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new HttpError(502, `No se pudo leer la grabación de Drive (${res.status})`);
    const largo = Number(res.headers.get("content-length") ?? 0);
    if (largo > 200 * 1024 * 1024) throw new HttpError(413, "La grabación es muy larga. Subila en partes de menos de 3 horas.");
    audio = { data: Buffer.from(await res.arrayBuffer()), mime: g.mime_type || "audio/webm" };
  } else if (!r.notas) {
    throw new HttpError(409, "No hay grabación ni notas para armar la minuta");
  }

  const m = await generarMinutaIA(prompt, audio);
  await ref.update({
    minuta: { ...m, generado_at: new Date().toISOString(), fuente: audio ? "audio" : "notas" },
    estado: "realizada",
  });
  return { ok: true };
}


async function guion(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor"]);
  const { video_id } = body<{ video_id?: string }>(req);
  if (!video_id) throw new HttpError(400, "Falta video_id");
  const db = adminDb();
  const ref = db.collection("videos").doc(video_id);
  const video = (await ref.get()).data();
  if (!video) throw new HttpError(404, "Video no encontrado");
  await assertProjectAccess(caller, video.proyecto_id);
  const p = (await db.collection("projects").doc(video.proyecto_id).get()).data() ?? {};

  const prompt = `Sos director creativo de una agencia argentina que filma videos comerciales verticales (Reels) de 20 a 45 segundos para pautar en Meta.
Armá el guion de este video y la lista de tomas para el día de rodaje.
- guion: por escenas cortas, con lo que se ve y lo que se dice (texto en pantalla o voz). Primeros 3 segundos con un gancho fuerte. Cierre con llamado a la acción.
- tomas: lista concreta de planos para filmar (qué, cómo y dónde), en el orden más práctico para el rodaje. Máximo 12.
Español rioplatense con voseo. No inventes precios, promociones ni datos que no estén abajo. Que se pueda filmar con un celular y una persona.

${marcaTexto(p)}

${await contextoComercial(video.proyecto_id, rangoMes(String(video.mes)))}

Video: ${video.titulo}
${video.idea ? `Idea acordada con el cliente: ${video.idea}` : ""}
${video.objetivo ? `Objetivo: ${video.objetivo}` : ""}
${video.referencias ? `Referencias: ${video.referencias}` : ""}`;

  const r = await generarJSON<{ guion?: string; tomas?: string[] }>(prompt, {
    type: "OBJECT",
    properties: { guion: { type: "STRING" }, tomas: { type: "ARRAY", items: { type: "STRING" } } },
    required: ["guion", "tomas"],
  });
  const out = {
    guion: String(r.guion ?? "").trim(),
    tomas: (r.tomas ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 15),
  };
  await ref.update({ ...out, updated_at: new Date().toISOString() });
  return out;
}

async function preparar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor"]);
  const { proyecto_id, video_ids } = body<{ proyecto_id?: string; video_ids?: string[] }>(req);
  if (!proyecto_id) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, proyecto_id);
  const db = adminDb();
  const p = (await db.collection("projects").doc(proyecto_id).get()).data() ?? {};
  const vids = await Promise.all((video_ids ?? []).slice(0, 10).map((id) => db.collection("videos").doc(String(id)).get()));
  const lista = vids
    .map((v) => v.data())
    .filter((v) => v && v.proyecto_id === proyecto_id)
    .map((v) => `- ${v!.titulo}${v!.idea ? `: ${v!.idea}` : ""}${v!.tomas?.length ? ` (tomas: ${v!.tomas.join("; ")})` : ""}`)
    .join("\n");
  const prompt = `Sos productor de una agencia argentina de videos comerciales. Mañana se filman estos videos en el comercio del cliente.
Escribí en 2 a 4 líneas cortas qué tiene que tener listo el cliente (productos, personas, lugar ordenado, ropa, horarios, etc.).
Hablale directo al cliente, con voseo, amable y concreto. Sin saludos ni despedidas. Solo lo necesario para estos videos.

${marcaTexto(p)}

Videos:
${lista || "- (sin detalle)"}`;
  const r = await generarJSON<{ texto?: string }>(prompt, {
    type: "OBJECT",
    properties: { texto: { type: "STRING" } },
    required: ["texto"],
  });
  return { texto: String(r.texto ?? "").trim() };
}

const MIME_IMG = ["image/png", "image/jpeg", "image/webp"];
/** Roles que cargan la marca de un cliente (además, tienen que tener acceso a ese cliente). */
const ROLES_MARCA = ["admin", "productor", "diseno", "cliente"];
/** Listas de la marca y cuántos archivos entran en cada una. */
const LISTAS_MARCA = { variante: ["variantes", 30], manual: ["manuales", 8], referencia: ["referencias", 4] } as const;
type ListaMarca = keyof typeof LISTAS_MARCA;
const etiquetaLimpia = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
const slug = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function marcaSubir(req: VercelRequest) {
  const caller = await requireCaller(req, ROLES_MARCA);
  const b = body<{ proyecto_id?: string; tipo?: string; etiqueta?: string; nombre?: string; mime?: string; data?: string }>(req);
  if (!b.proyecto_id || !b.data) throw new HttpError(400, "Faltan datos");
  await assertProjectAccess(caller, b.proyecto_id);
  const tipo: "logo" | ListaMarca = b.tipo === "logo" || b.tipo === "variante" || b.tipo === "manual" ? b.tipo : "referencia";
  const data = Buffer.from(String(b.data), "base64");
  if (data.length > 3 * 1024 * 1024) throw new HttpError(413, "El archivo es muy pesado (máximo 3 MB)");
  // Se verifica que de verdad sea una imagen (o un PDF en los manuales) por la firma del archivo, no solo lo que dice el navegador.
  const esPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const esJpg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const esWebp = data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP";
  const esPdf = tipo === "manual" && data.subarray(0, 5).toString() === "%PDF-";
  if (!(esPng || esJpg || esWebp || esPdf)) {
    throw new HttpError(400, tipo === "manual" ? "Subí un PDF o una imagen (PNG, JPG o WEBP)" : "Subí una imagen PNG, JPG o WEBP");
  }
  const mimeReal = esPdf ? "application/pdf" : esPng ? "image/png" : esJpg ? "image/jpeg" : "image/webp";
  const ext = esPdf ? "pdf" : esPng ? "png" : esWebp ? "webp" : "jpg";
  const etiqueta = etiquetaLimpia(b.etiqueta);
  if (tipo === "variante" && !etiqueta) throw new HttpError(400, "Poné qué versión del logo es (ej. Blanco, Horizontal)");

  const db = adminDb();
  const ref = db.collection("projects").doc(b.proyecto_id);
  const p = (await ref.get()).data() ?? {};
  if (tipo !== "logo") {
    const [campo, max] = LISTAS_MARCA[tipo];
    if (((p.marca_archivos?.[campo] ?? []) as unknown[]).length >= max) throw new HttpError(409, `Ya hay ${max}. Quitá uno para subir otro.`);
  }

  // Nombre legible en Drive: "logo-blanco.png", "manual-identidad.pdf".
  const base = String(b.nombre ?? "").replace(/\.[a-z0-9]+$/i, "").trim();
  const nombre =
    tipo === "logo"
      ? `logo.${ext}`
      : tipo === "variante"
        ? `logo-${slug(etiqueta) || Date.now()}.${ext}`
        : tipo === "manual"
          ? `manual-${slug(base) || Date.now()}.${ext}`
          : `referencia-${Date.now()}.${ext}`;
  const up = await uploadBufferToDrive({ path: [String(p.nombre ?? "Cliente"), "Marca"], name: nombre, mime: mimeReal, data });
  const att = {
    ...up,
    ...(tipo === "variante" ? { etiqueta } : {}),
    // El manual se muestra con el nombre que tenía el archivo.
    ...(tipo === "manual" && base ? { name: base.slice(0, 80) } : {}),
    size: data.length,
    uploaded_at: new Date().toISOString(),
    uploaded_by: caller.uid,
    folder_path: `Progreso/${p.nombre ?? "Cliente"}/Marca`,
  };
  if (tipo === "logo") {
    await ref.update({ "marca_archivos.logo": att });
  } else {
    // El tope se vuelve a controlar dentro de la transacción (dos subidas a la vez).
    const [campo, max] = LISTAS_MARCA[tipo];
    await db.runTransaction(async (tx) => {
      const lista = ((await tx.get(ref)).data()?.marca_archivos?.[campo] ?? []) as unknown[];
      if (lista.length >= max) throw new HttpError(409, `Ya hay ${max}. Quitá uno para subir otro.`);
      tx.update(ref, { [`marca_archivos.${campo}`]: [...lista, att] });
    });
  }
  return { ok: true, archivo: att };
}

/** Foto de perfil del cliente: el navegador la arma con el logo (centrado y sin márgenes) y acá se guarda. */
async function marcaAvatar(req: VercelRequest) {
  const caller = await requireCaller(req, ROLES_MARCA);
  const b = body<{ proyecto_id?: string; de?: string; img?: string }>(req);
  if (!b.proyecto_id || !b.de || typeof b.img !== "string") throw new HttpError(400, "Faltan datos");
  await assertProjectAccess(caller, b.proyecto_id);
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.img) || b.img.length > 120_000) throw new HttpError(400, "Imagen inválida");
  const db = adminDb();
  const ref = db.collection("projects").doc(b.proyecto_id);
  await db.runTransaction(async (tx) => {
    // Solo si sigue siendo el logo principal (si lo cambiaron mientras tanto, se arma de nuevo con el nuevo).
    const logo = (await tx.get(ref)).data()?.marca_archivos?.logo?.drive_file_id;
    if (logo !== b.de) throw new HttpError(409, "El logo cambió");
    tx.update(ref, { "marca_archivos.avatar": { img: b.img, de: b.de } });
  });
  return { ok: true };
}

/** Renombra una versión del logo o la hace el logo principal (el principal anterior pasa a ser una versión más). */
async function marcaVariante(req: VercelRequest) {
  const caller = await requireCaller(req, ROLES_MARCA);
  const b = body<{ proyecto_id?: string; drive_file_id?: string; etiqueta?: string; principal?: boolean }>(req);
  if (!b.proyecto_id || !b.drive_file_id) throw new HttpError(400, "Faltan datos");
  await assertProjectAccess(caller, b.proyecto_id);
  const db = adminDb();
  const ref = db.collection("projects").doc(b.proyecto_id);
  await db.runTransaction(async (tx) => {
    const a = ((await tx.get(ref)).data()?.marca_archivos ?? {}) as Record<string, any>;
    let variantes = (a.variantes ?? []) as Record<string, any>[];
    const i = variantes.findIndex((v) => v.drive_file_id === b.drive_file_id);
    if (i < 0) throw new HttpError(404, "No encontré esa versión del logo");
    const etiqueta = etiquetaLimpia(b.etiqueta);
    if (etiqueta) variantes = variantes.map((v, j) => (j === i ? { ...v, etiqueta } : v));
    const patch: Record<string, unknown> = {};
    if (b.principal) {
      const { etiqueta: _sinEtiqueta, ...nuevo } = variantes[i];
      void _sinEtiqueta;
      variantes = variantes.filter((_, j) => j !== i);
      if (a.logo) variantes = [{ ...a.logo, etiqueta: "Logo anterior" }, ...variantes];
      patch["marca_archivos.logo"] = nuevo;
    }
    patch["marca_archivos.variantes"] = variantes;
    tx.update(ref, patch);
  });
  return { ok: true };
}

async function marcaInfo(req: VercelRequest) {
  const caller = await requireCaller(req, ROLES_MARCA);
  const b = body<{ proyecto_id?: string; rubro?: string; descripcion?: string; publico?: string; colores?: string; instagram?: string; tono?: string }>(req);
  if (!b.proyecto_id) throw new HttpError(400, "Faltan datos");
  await assertProjectAccess(caller, b.proyecto_id);
  const t = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const rubro = t(b.rubro, 120);
  const descripcion = t(b.descripcion, 600);
  if (rubro.length < 3 || descripcion.length < 10) throw new HttpError(400, "Contanos a qué se dedica tu negocio y qué lo hace distinto");
  const datos: Record<string, string> = { "marca.rubro": rubro, "marca.descripcion": descripcion };
  if (t(b.publico, 200)) datos["marca.publico"] = t(b.publico, 200);
  if (t(b.tono, 200)) datos["marca.tono"] = t(b.tono, 200);
  if (t(b.colores, 120)) datos["marca.colores"] = t(b.colores, 120);
  if (t(b.instagram, 60)) datos["redes.instagram"] = t(b.instagram, 60);
  await adminDb().collection("projects").doc(b.proyecto_id).update(datos);
  return { ok: true };
}

/** Colores de la marca (los elige el cliente o el equipo con el selector de color). */
async function marcaColores(req: VercelRequest) {
  const caller = await requireCaller(req, ROLES_MARCA);
  const b = body<{ proyecto_id?: string; paleta?: unknown; info?: unknown }>(req);
  if (!b.proyecto_id) throw new HttpError(400, "Faltan datos");
  await assertProjectAccess(caller, b.proyecto_id);
  const paleta = (Array.isArray(b.paleta) ? b.paleta : [])
    .map((c) => String(c).trim().toLowerCase())
    .filter((c) => /^#[0-9a-f]{6}$/.test(c))
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, 12);
  const datos: Record<string, unknown> = { "marca.paleta": paleta, "marca.colores": paleta.join(", ") };
  // Nombre y uso de cada color (opcional: el panel del cliente manda solo la paleta y no los toca).
  if (b.info && typeof b.info === "object" && !Array.isArray(b.info)) {
    const dados = b.info as Record<string, { nombre?: unknown; uso?: unknown } | null>;
    const info: Record<string, { nombre?: string; uso?: string }> = {};
    for (const hex of paleta) {
      const d = Object.hasOwn(dados, hex) ? dados[hex] : null;
      const nombre = String(d?.nombre ?? "").trim().slice(0, 40);
      const uso = String(d?.uso ?? "").trim().slice(0, 80);
      if (nombre || uso) info[hex] = { ...(nombre ? { nombre } : {}), ...(uso ? { uso } : {}) };
    }
    datos["marca.colores_info"] = info;
  }
  await adminDb().collection("projects").doc(b.proyecto_id).update(datos);
  return { ok: true, paleta };
}

async function marcaQuitar(req: VercelRequest) {
  const caller = await requireCaller(req, ROLES_MARCA);
  const b = body<{ proyecto_id?: string; tipo?: string; drive_file_id?: string }>(req);
  if (!b.proyecto_id) throw new HttpError(400, "Faltan datos");
  await assertProjectAccess(caller, b.proyecto_id);
  const ref = adminDb().collection("projects").doc(b.proyecto_id);
  if (b.tipo === "logo") {
    await ref.update({ "marca_archivos.logo": FieldValue.delete() });
  } else {
    const tipo: ListaMarca = b.tipo === "variante" || b.tipo === "manual" ? b.tipo : "referencia";
    const [campo] = LISTAS_MARCA[tipo];
    const p = (await ref.get()).data() ?? {};
    const lista = ((p.marca_archivos?.[campo] ?? []) as { drive_file_id: string }[]).filter((r) => r.drive_file_id !== b.drive_file_id);
    await ref.update({ [`marca_archivos.${campo}`]: lista });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Plan del mes con IA
// ---------------------------------------------------------------------------

const MES_RE = /^\d{4}-\d{2}$/;
const planId = (pid: string, mes: string) => `${pid}_${mes}`;

/** Videos del plan que quedan libres ese mes (los extra no cuentan). */
async function lugaresDelMes(pid: string, mes: string, proj: Record<string, any>) {
  const db = adminDb();
  let incluidos = Number(proj.plan_redes_override?.videos_mes ?? NaN);
  if (isNaN(incluidos) && proj.plan_redes_id) {
    incluidos = Number((await db.collection("planes_redes").doc(proj.plan_redes_id).get()).data()?.videos_mes ?? 0);
  }
  const cupo = (incluidos || 0) + Number(proj.creditos_extra?.[mes] ?? 0);
  const todos = await db.collection("videos").where("proyecto_id", "==", pid).get();
  const videos = todos.docs.map((d) => d.data());
  const delMes = videos.filter((v) => v.mes === mes && v.extra !== true);
  return { cupo, libres: Math.max(0, cupo - delMes.length), videos, delMes };
}

/** Guarda lo aprendido y (si se puede) actualiza el resumen que lee la IA la próxima vez. */
async function aprender(pid: string, proj: Record<string, any>, ejemplo: EjemploMemoria, resumir = true) {
  const db = adminDb();
  const ref = db.collection("ia_memoria").doc(pid);
  const m = ((await ref.get()).data() ?? {}) as MemoriaIA;
  const ejemplos = sumarEjemplo(m, ejemplo);
  let resumen = m.resumen ?? "";
  if (resumir) {
    try {
      const r = await generarJSON<{ resumen?: string }>(promptResumen(marcaTexto(proj), { ...m, ejemplos }), ESQUEMA_RESUMEN, 0.3);
      resumen = String(r.resumen ?? "").trim().slice(0, 1500) || resumen;
    } catch (err) {
      console.warn("[plan] no se pudo actualizar el resumen", err);
    }
  }
  await ref.set({ proyecto_id: pid, ejemplos, resumen, actualizado_at: new Date().toISOString() }, { merge: true });
}

async function planMes(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor"]);
  const b = body<{ proyecto_id?: string; mes?: string; idea_id?: string; pista?: string }>(req);
  if (!b.proyecto_id || !MES_RE.test(String(b.mes))) throw new HttpError(400, "Elegí el cliente y el mes");
  await assertProjectAccess(caller, b.proyecto_id);
  const pid = b.proyecto_id;
  const mes = String(b.mes);
  const db = adminDb();
  const proj = (await db.collection("projects").doc(pid).get()).data() ?? {};
  const ref = db.collection("planes_mes").doc(planId(pid, mes));
  const plan = (await ref.get()).data();
  if (plan && plan.estado !== "borrador") throw new HttpError(409, "Este plan ya se mandó al cliente");
  const memoria = ((await db.collection("ia_memoria").doc(pid).get()).data() ?? null) as MemoriaIA | null;
  const { libres, videos, delMes } = await lugaresDelMes(pid, mes, proj);
  const historial = videos
    .filter((v) => v.mes !== mes)
    .sort((a, c) => String(c.mes).localeCompare(String(a.mes)))
    .slice(0, 40)
    .map((v) => ({ titulo: v.titulo, idea: v.idea, mensajes: v.resultados?.mensajes ?? null, mes: v.mes }));
  const ctx = {
    marca: marcaTexto(proj),
    comercial: await contextoComercial(pid, rangoMes(mes), false),
    mes,
    memoria,
    historial,
    yaEnElMes: delMes.map((v) => v.titulo),
  };
  const now = new Date().toISOString();
  const pista = String(b.pista ?? "").trim().slice(0, 300) || null;

  // Rehacer una sola idea.
  if (b.idea_id) {
    if (!plan) throw new HttpError(404, "Primero armá el plan");
    const ideas = (plan.ideas ?? []) as IdeaPlan[];
    const vieja = ideas.find((i) => i.id === b.idea_id);
    if (!vieja) throw new HttpError(404, "Esa idea ya no está");
    const otras = ideas.filter((i) => i.id !== vieja.id).map((i) => i.titulo);
    const r = await generarJSON(promptPlan({ ...ctx, cantidad: 1, evitar: [...otras, vieja.titulo], pista }), ESQUEMA_PLAN, 0.9);
    const [nueva] = ideasDesdeIA(r, 1);
    if (!nueva) throw new HttpError(502, "La IA no devolvió una idea. Probá de nuevo.");
    await ref.update({
      ideas: ideas.map((i) => (i.id === vieja.id ? nueva : i)),
      ideas_ia: [...(plan.ideas_ia ?? []), nueva],
      descartadas: vieja.origen === "ia" ? FieldValue.arrayUnion(vieja.titulo) : plan.descartadas ?? [],
      updated_at: now,
    });
    return { ok: true, idea: nueva };
  }

  if (libres <= 0) throw new HttpError(409, `El plan de ${nombreMes(mes)} ya tiene todos sus videos cargados`);
  const r = await generarJSON(promptPlan({ ...ctx, cantidad: libres, pista }), ESQUEMA_PLAN, 0.85);
  const ideas = ideasDesdeIA(r, libres);
  if (!ideas.length) throw new HttpError(502, "La IA no devolvió ideas. Probá de nuevo.");
  // Si rehace todo, las ideas anteriores de la IA cuentan como descartadas.
  const antes = ((plan?.ideas ?? []) as IdeaPlan[]).filter((i) => i.origen === "ia").map((i) => i.titulo);
  await ref.set({
    proyecto_id: pid,
    mes,
    estado: "borrador",
    ideas,
    ideas_ia: ideas,
    descartadas: Array.from(new Set([...(plan?.descartadas ?? []), ...antes])).slice(-30),
    cupo: libres,
    nota_equipo: plan?.nota_equipo ?? null,
    generado_at: now,
    generado_por: caller.uid,
    updated_at: now,
  });
  return { ok: true, ideas };
}

async function planEnviar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor"]);
  const b = body<{ proyecto_id?: string; mes?: string; ideas?: unknown; nota_equipo?: string }>(req);
  if (!b.proyecto_id || !MES_RE.test(String(b.mes))) throw new HttpError(400, "Datos incompletos");
  await assertProjectAccess(caller, b.proyecto_id);
  const pid = b.proyecto_id;
  const mes = String(b.mes);
  const db = adminDb();
  const ref = db.collection("planes_mes").doc(planId(pid, mes));
  const ideas = limpiarIdeas(b.ideas).map((i) => ({ ...i, respuesta: null, video_id: null }));
  if (!ideas.length) throw new HttpError(400, "El plan no tiene ideas");
  if (ideas.some((i) => i.idea.length < 10)) throw new HttpError(400, "Completá la descripción de cada idea");
  const nota = String(b.nota_equipo ?? "").trim().slice(0, 600) || null;

  const plan = await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p) throw new HttpError(404, "Primero armá el plan");
    if (p.estado !== "borrador") throw new HttpError(409, "Este plan ya se mandó al cliente");
    tx.update(ref, {
      ideas,
      nota_equipo: nota,
      estado: "enviado",
      enviado_at: new Date().toISOString(),
      enviado_por: caller.uid,
      recordatorios: 0,
      updated_at: new Date().toISOString(),
    });
    return p;
  });

  const proj = (await db.collection("projects").doc(pid).get()).data() ?? {};
  await aprender(pid, proj, aprendizajeEquipo(mes, plan.ideas_ia ?? [], ideas, plan.descartadas ?? []));
  const team = (proj.team_roles ?? {}) as Record<string, string[]>;
  await enviarAviso(
    {
      destinatarios: team.cliente ?? [],
      titulo: `Tus videos de ${nombreMes(mes).split(" ")[0]} 🎬`,
      cuerpo: `Te armamos ${ideas.length} idea${ideas.length === 1 ? "" : "s"} para este mes. Miralas y decinos cuáles van.`,
      link: `/cliente?plan=${mes}`,
      clave: `plan_mes:${planId(pid, mes)}`,
      proyectoId: pid,
    },
    appUrl(req)
  );
  return { ok: true };
}

async function planResponder(req: VercelRequest) {
  const caller = await requireCaller(req, ["cliente", "admin"]);
  const b = body<{ proyecto_id?: string; mes?: string; respuestas?: { id?: string; ok?: boolean; comentario?: string }[]; nota?: string }>(req);
  if (!b.proyecto_id || !MES_RE.test(String(b.mes))) throw new HttpError(400, "Datos incompletos");
  await assertProjectAccess(caller, b.proyecto_id);
  const pid = b.proyecto_id;
  const mes = String(b.mes);
  const db = adminDb();
  const ref = db.collection("planes_mes").doc(planId(pid, mes));
  const proj = (await db.collection("projects").doc(pid).get()).data() ?? {};
  const team = (proj.team_roles ?? {}) as Record<string, string[]>;
  const resp = new Map((b.respuestas ?? []).map((r) => [String(r.id ?? ""), r]));
  const nota = String(b.nota ?? "").trim().slice(0, 600) || null;

  const final = await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p) throw new HttpError(404, "No encontramos el plan");
    if (p.estado !== "enviado") throw new HttpError(409, "Este plan ya fue respondido");
    const ideas = (p.ideas ?? []) as IdeaPlan[];
    const out: IdeaPlan[] = [];
    for (const i of ideas) {
      const r = resp.get(i.id);
      if (!r || typeof r.ok !== "boolean") throw new HttpError(400, "Decinos qué te parece cada idea");
      const comentario = String(r.comentario ?? "").trim().slice(0, 600) || null;
      if (!r.ok && !comentario) throw new HttpError(400, `Contanos qué cambiarías de “${i.titulo}”`);
      let video_id: string | null = null;
      if (r.ok) {
        const vRef = db.collection("videos").doc();
        video_id = vRef.id;
        tx.set(vRef, {
          ...videoDesdePedido(
            pid,
            team,
            mes,
            { titulo: i.titulo, idea: i.idea, objetivo: i.objetivo, pedido_por: caller.uid, filma_cliente: filmaElCliente(proj) },
            "Idea del plan del mes aprobada por el cliente"
          ),
          pedido_cliente: false,
          plan_idea_id: i.id,
          ...(p.demo_ejemplo ? { demo_ejemplo: true } : {}),
        });
      }
      out.push({ ...i, respuesta: { ok: r.ok, comentario }, video_id });
    }
    const cambios = out.filter((i) => !i.respuesta?.ok).length;
    tx.update(ref, {
      ideas: out,
      estado: cambios ? "respondido" : "cerrado",
      nota_cliente: nota,
      respondido_at: new Date().toISOString(),
      respondido_por: caller.uid,
      updated_at: new Date().toISOString(),
    });
    return out;
  });

  await aprender(pid, proj, aprendizajeCliente(mes, final, nota));
  const ok = final.filter((i) => i.respuesta?.ok).length;
  const cambios = final.length - ok;
  await enviarAviso(
    {
      destinatarios: team.productor ?? [],
      titulo: cambios ? `${proj.nombre ?? "El cliente"} pidió cambios en el plan` : `${proj.nombre ?? "El cliente"} aprobó el plan`,
      cuerpo: `${ok} idea${ok === 1 ? "" : "s"} aprobada${ok === 1 ? "" : "s"}${cambios ? ` y ${cambios} con cambios para ajustar` : ""}${nota ? ` · “${nota.slice(0, 100)}”` : ""}`,
      link: `/videos?plan=${planId(pid, mes)}`,
      clave: `plan_respuesta:${planId(pid, mes)}`,
      proyectoId: pid,
    },
    appUrl(req)
  );
  return { ok: true, aprobadas: ok, cambios };
}

async function planAjustar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor"]);
  const b = body<{ proyecto_id?: string; mes?: string; idea_id?: string; accion?: string; titulo?: string; idea?: string; objetivo?: string }>(req);
  if (!b.proyecto_id || !MES_RE.test(String(b.mes)) || !b.idea_id) throw new HttpError(400, "Datos incompletos");
  await assertProjectAccess(caller, b.proyecto_id);
  const pid = b.proyecto_id;
  const mes = String(b.mes);
  const db = adminDb();
  const ref = db.collection("planes_mes").doc(planId(pid, mes));
  const proj = (await db.collection("projects").doc(pid).get()).data() ?? {};
  const team = (proj.team_roles ?? {}) as Record<string, string[]>;
  const descartar = b.accion === "descartar";
  const titulo = String(b.titulo ?? "").trim().slice(0, 120);
  const texto = String(b.idea ?? "").trim().slice(0, 1200);
  if (!descartar && titulo.length < 3) throw new HttpError(400, "Poné un título");

  const { antes, videoId } = await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p || p.estado !== "respondido") throw new HttpError(409, "Este plan no tiene cambios pendientes");
    const ideas = (p.ideas ?? []) as IdeaPlan[];
    const i = ideas.find((x) => x.id === b.idea_id);
    if (!i || i.respuesta?.ok !== false || i.video_id || i.descartada) throw new HttpError(409, "Esta idea ya se resolvió");
    let video_id: string | null = null;
    if (!descartar) {
      const vRef = db.collection("videos").doc();
      video_id = vRef.id;
      const v = videoDesdePedido(
        pid,
        team,
        mes,
        { titulo, idea: texto || null, objetivo: String(b.objetivo ?? "").trim().slice(0, 200) || i.objetivo, pedido_por: caller.uid, filma_cliente: filmaElCliente(proj) },
        "Idea del plan ajustada con el pedido del cliente"
      );
      (v.historial[0] as { nota: string | null }).nota = i.respuesta?.comentario ?? null;
      tx.set(vRef, { ...v, pedido_cliente: false, plan_idea_id: i.id, ...(p.demo_ejemplo ? { demo_ejemplo: true } : {}) });
    }
    const nuevas = ideas.map((x) =>
      x.id === i.id ? (descartar ? { ...x, descartada: true } : { ...x, titulo, idea: texto, video_id }) : x
    );
    const pendientes = nuevas.filter((x) => x.respuesta?.ok === false && !x.video_id && !x.descartada).length;
    tx.update(ref, { ideas: nuevas, estado: pendientes ? "respondido" : "cerrado", updated_at: new Date().toISOString() });
    return { antes: i, videoId: video_id };
  });

  await aprender(pid, proj, aprendizajeAjuste(mes, antes, { titulo, idea: texto }, descartar), false);
  return { ok: true, video_id: videoId };
}

async function comercialGuardar(req: VercelRequest) {
  // El cliente también carga lo que vende desde su panel.
  const caller = await requireCaller(req, ["admin", "productor", "cliente"]);
  const b = body<{ proyecto_id?: string; comercial?: unknown }>(req);
  if (!b.proyecto_id) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, b.proyecto_id);
  const comercial = { ...limpiarComercial(b.comercial), actualizado_at: new Date().toISOString(), actualizado_por: caller.uid };
  await adminDb().collection("ia_memoria").doc(b.proyecto_id).set({ proyecto_id: b.proyecto_id, comercial }, { merge: true });
  return { ok: true, comercial };
}

/** Solo la parte comercial (el cliente no ve lo que aprendió la IA ni las notas del equipo). */
async function comercialVer(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "diseno", "cliente"]);
  const b = body<{ proyecto_id?: string }>(req);
  if (!b.proyecto_id) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, b.proyecto_id);
  const m = (await adminDb().collection("ia_memoria").doc(b.proyecto_id).get()).data();
  return { comercial: m?.comercial ?? {} };
}

async function memoriaNotas(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor"]);
  const b = body<{ proyecto_id?: string; notas?: string }>(req);
  if (!b.proyecto_id) throw new HttpError(400, "Falta el cliente");
  await assertProjectAccess(caller, b.proyecto_id);
  await adminDb()
    .collection("ia_memoria")
    .doc(b.proyecto_id)
    .set(
      { proyecto_id: b.proyecto_id, notas_equipo: String(b.notas ?? "").trim().slice(0, 1500), notas_at: new Date().toISOString(), notas_por: caller.uid },
      { merge: true }
    );
  return { ok: true };
}

/** @prodi en el chat: el pedido lo valida y lo ejecuta el servidor. */
// Links de un mensaje: contexto para la IA y, si son de un cliente, a su ficha. Ver api/_lib/chat-links.ts.
async function linksChat(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"]);
  const b = body<{ chat_id?: string; mensaje_id?: string }>(req);
  return linksDeMensaje(caller, b.chat_id, b.mensaje_id);
}

// Solo el super admin (el dueño): ve todo, también la plata. Ver api/_lib/dueno.ts.
async function dueno(req: VercelRequest) {
  await requireCaller(req, ["admin"]);
  return asistenteDueno(body<{ mensajes?: unknown }>(req).mensajes);
}

async function chatAsistente(req: VercelRequest) {
  // Contacto (solo chat): @prodi le contesta y le deja tareas a gente del chat; reuniones y "recordar" no (ver chat-asistente.ts).
  const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente", "contacto"]);
  const b = body<{ chat_id?: string; mensaje_id?: string }>(req);
  return atenderMencion(caller, b.chat_id, b.mensaje_id, appUrl(req));
}

/** Saca un dato aprendido del chat (si quedó mal o ya no vale). */
async function memoriaChatQuitar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor"]);
  const b = body<{ proyecto_id?: string; texto?: string }>(req);
  if (!b.proyecto_id || !b.texto) throw new HttpError(400, "Faltan datos");
  await assertProjectAccess(caller, b.proyecto_id);
  const ref = adminDb().collection("ia_memoria").doc(b.proyecto_id);
  await adminDb().runTransaction(async (tx) => {
    const m = (await tx.get(ref)).data() ?? {};
    const notas = ((m.chat_notas ?? []) as { texto: string }[]).filter((n) => n.texto !== b.texto);
    tx.set(ref, { chat_notas: notas }, { merge: true });
  });
  return { ok: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const accion = String(req.query.accion ?? "");
    if (accion === "copy") res.status(200).json(await copy(req));
    else if (accion === "pieza") res.status(200).json(await pieza(req).catch((e) => liberarTurnoPieza(req, e)));
    else if (accion === "pieza-editar") res.status(200).json(await piezaEditar(req).catch((e) => liberarTurnoPieza(req, e)));
    else if (accion === "pieza-compartir") res.status(200).json(await piezaCompartir(req));
    else if (accion === "minuta") res.status(200).json(await minuta(req));
    else if (accion === "guion") res.status(200).json(await guion(req));
    else if (accion === "preparar") res.status(200).json(await preparar(req));
    else if (accion === "marca-subir") res.status(200).json(await marcaSubir(req));
    else if (accion === "marca-quitar") res.status(200).json(await marcaQuitar(req));
    else if (accion === "marca-info") res.status(200).json(await marcaInfo(req));
    else if (accion === "marca-avatar") res.status(200).json(await marcaAvatar(req));
    else if (accion === "marca-variante") res.status(200).json(await marcaVariante(req));
    else if (accion === "plan-mes") res.status(200).json(await planMes(req));
    else if (accion === "plan-enviar") res.status(200).json(await planEnviar(req));
    else if (accion === "plan-responder") res.status(200).json(await planResponder(req));
    else if (accion === "plan-ajustar") res.status(200).json(await planAjustar(req));
    else if (accion === "memoria-notas") res.status(200).json(await memoriaNotas(req));
    else if (accion === "comercial-guardar") res.status(200).json(await comercialGuardar(req));
    else if (accion === "marca-colores") res.status(200).json(await marcaColores(req));
    else if (accion === "comercial-ver") res.status(200).json(await comercialVer(req));
    else if (accion === "chat-asistente") res.status(200).json(await chatAsistente(req));
    else if (accion === "dueno") res.status(200).json(await dueno(req));
    else if (accion === "links-chat") res.status(200).json(await linksChat(req));
    else if (accion === "memoria-chat-quitar") res.status(200).json(await memoriaChatQuitar(req));
    else if (accion === "estado") res.status(200).json(await estadoIA(req));
    else if (accion === "tarea-chat") res.status(200).json(await tareaChat(req));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    sendError(res, err);
  }
}

/** Para Ajustes: qué claves de IA hay cargadas en Vercel (solo sí/no). */
async function estadoIA(req: VercelRequest) {
  await requireCaller(req, ["admin"]);
  const hay = (k: string) => !!process.env[k]?.trim();
  return {
    claude: hay("ANTHROPIC_API_KEY"),
    gemini: hay("GEMINI_API_KEY"),
    modelo_claude: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  };
}

/**
 * "Hacer tarea" sobre un mensaje del chat: la tarea queda para gente del chat (con aviso y, si tiene
 * fecha, en Calendar), y en el chat aparece una línea de sistema para que todos sepan.
 */
async function tareaChat(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente", "contacto"]);
  const b = body<{ chat_id?: string; mensaje_id?: string; titulo?: string; asignados?: unknown; vence?: string | null }>(req);
  const db = adminDb();
  if (!b.chat_id || !b.mensaje_id || b.chat_id.includes("/") || b.mensaje_id.includes("/")) throw new HttpError(400, "Faltan datos");
  const [chatSnap, msgSnap] = await Promise.all([db.collection("chats").doc(b.chat_id).get(), db.collection(`chats/${b.chat_id}/mensajes`).doc(b.mensaje_id).get()]);
  const chat = chatSnap.data();
  const miembros: string[] = Array.isArray(chat?.miembros) ? chat!.miembros : [];
  if (!chat || !msgSnap.exists || (!miembros.includes(caller.uid) && caller.role !== "admin")) throw new HttpError(403, "No sos parte de este chat");
  const titulo = String(b.titulo ?? "").trim().slice(0, 200);
  if (titulo.length < 3) throw new HttpError(400, "Escribí qué hay que hacer");
  const pedidos = Array.isArray(b.asignados) ? b.asignados.filter((x): x is string => typeof x === "string") : [];
  const asignados = [...new Set(pedidos.filter((u) => miembros.includes(u)))];
  if (!asignados.length) throw new HttpError(400, "Elegí a quién se la asignás");
  const hoy = fechaAR();
  const vence = typeof b.vence === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.vence) && b.vence >= hoy ? b.vence : null;
  const base = appUrl(req);
  const nombres = (chat.nombres ?? {}) as Record<string, string>;
  const perfil = (await db.collection("profiles").doc(caller.uid).get()).data() ?? {};
  const yo = String(perfil.nombre ?? caller.nombre ?? "Alguien");
  const id = await crearTarea(
    { titulo, asignados, vence, creada_por: caller.uid, creada_por_nombre: yo, chat_id: b.chat_id, proyecto_id: typeof chat.proyecto_id === "string" ? chat.proyecto_id : null },
    base
  );
  // Línea en el chat (la app antepone el nombre de quien la creó): "Lucas le dejó una tarea a Nati: …".
  const primer = (u: string) => String(nombres[u] ?? "alguien").split(" ")[0];
  const solo = asignados.length === 1 && asignados[0] === caller.uid;
  const para = asignados.map(primer).join(", ");
  const dia = vence ? ` · para el ${Number(vence.slice(8, 10))}/${Number(vence.slice(5, 7))}` : "";
  const at = new Date().toISOString();
  await db.collection(`chats/${b.chat_id}/mensajes`).add({
    texto: `${solo ? "se anotó una tarea" : `le dejó una tarea a ${para}`}: “${titulo}”${dia} 📌`,
    by: caller.uid,
    at,
    tipo: "sistema",
    tarea_id: id,
  });
  return { ok: true, tarea_id: id };
}
