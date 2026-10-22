// Módulo Web: reservas de la landing de la campaña «No empezamos de cero» (somosprodi.com).
// Públicos (los llama la landing, con CORS solo para somosprodi.com):
// POST /api/web/aplicar   { nombre, negocio, email, instagram, rubro, facturacion, …, inversion, … } → { id, califica }
// POST /api/web/reunion   { id }                                → pasa de "calificado" a "reunion_agendada"
// GET  /api/web/cupos                                           → { temporada, total, ocupados }
// Desde el panel (solo el super admin):
// POST /api/web/estado    { id, estado }                        → mueve la tarjeta (queda en el historial)
// POST /api/web/notas     { id, notas }
// POST /api/web/datos     { id, negocio?, nombre?, email?, telefono?, instagram?, ubicacion?, rubro? }  (completar o corregir)
// POST /api/web/config    { temporada?, cupos_total? }
// POST /api/web/seguimiento { id, texto, fecha }             → próximo paso (qué hacer y para cuándo)
// POST /api/web/actividad   { id, tipo, texto }               → llamada, WhatsApp, mail, reunión o nota (línea de tiempo)
// GET|POST /api/web/meta-webhook  (Meta: formularios de los anuncios de Prodi → leads)
// POST /api/web/meta-mensajes     (admin) { forzar? } trae los mensajes nuevos de IG y FB como leads
// POST /api/web/meta-conectar     (admin) suscribe la página de Prodi y trae los formularios de 30 días
// POST /api/web/manual    { negocio, nombre?, email?, telefono?, instagram?, ubicacion?, rubro?, fuente?, notas?, estado? } → { id }  (lead cargado a mano)
// Los leads se guardan en la colección `leads_web`; la configuración en `web_config/general`.

import { createHmac, randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { enTransaccion, getPool, guardarDoc, leerDoc } from "../_lib/db";
import { appUrl, body, HttpError, requireCaller, sendError } from "../_lib/http";
import { conectarFormularios, guardarTokenUsuario, estadoMeta, importarMensajes, recibirWebhook, verificarWebhook } from "../_lib/meta-leads";

const COL = "leads_web";
const CONFIG = { col: "web_config", id: "general" };
const POR_DEFECTO = { temporada: "Verano 2027", cupos_total: 5 };

const FACTURACION = ["lt5", "5-10", "10-30", "30-100", "gt100"];
const INVERSION = ["lt700", "700-1000", "1000-1500", "gt1500"];
const INVERSION_OK = ["700-1000", "1000-1500", "gt1500"];
const RUBROS = ["Comercio", "Industria / fábrica", "Gastronomía", "Servicios profesionales", "Salud y bienestar", "Otro"];
const YA_PAUTO = ["Sí, con una agencia", "Sí, por mi cuenta", "Nunca"];
const CUANDO = ["Lo antes posible", "Durante el verano 2027", "Más adelante"];
const ESTADOS = ["no_califica", "calificado", "reunion_agendada", "propuesta", "ganado", "perdido"];

// La landing en producción. Para probar desde otro lado: WEB_ORIGENES_EXTRA="http://localhost:3000,https://….vercel.app".
const ORIGENES = [
  "https://somosprodi.com",
  "https://www.somosprodi.com",
  ...(process.env.WEB_ORIGENES_EXTRA ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean),
];

function cors(req: VercelRequest, res: VercelResponse) {
  const origen = String(req.headers.origin ?? "");
  res.setHeader("Vary", "Origin");
  if (ORIGENES.includes(origen)) {
    res.setHeader("Access-Control-Allow-Origin", origen);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

// Sin caracteres de control (saltos de línea, tabs, …): todo en una línea.
const texto = (v: unknown, max: number) =>
  Array.from(String(v ?? ""), (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").trim().slice(0, max);

/** La IP no se guarda: solo una huella (HMAC) para el límite por hora. */
function huellaIp(req: VercelRequest): string {
  const fwd = String(req.headers["x-vercel-forwarded-for"] ?? req.headers["x-forwarded-for"] ?? req.headers["x-real-ip"] ?? "");
  const ip = fwd.split(",")[0].trim() || req.socket?.remoteAddress || "desconocida";
  return createHmac("sha256", process.env.TOKEN_ENCRYPTION_KEY || "prodi-web").update(ip).digest("hex").slice(0, 32);
}

async function leerConfig(): Promise<{ temporada: string; cupos_total: number }> {
  const d = await leerDoc(getPool(), CONFIG.col, CONFIG.id);
  const total = Number(d?.cupos_total);
  return {
    temporada: typeof d?.temporada === "string" && d.temporada.trim() ? d.temporada : POR_DEFECTO.temporada,
    cupos_total: Number.isInteger(total) && total > 0 ? total : POR_DEFECTO.cupos_total,
  };
}

async function cupos() {
  const { temporada, cupos_total } = await leerConfig();
  const r = await getPool().query(
    "select count(*)::int as n from documentos where coleccion = $1 and data->>'temporada' = $2 and data->>'estado' = 'ganado'",
    [COL, temporada]
  );
  return { temporada, total: cupos_total, ocupados: r.rows[0]?.n ?? 0 };
}

async function aplicar(req: VercelRequest) {
  const b = body<Record<string, unknown>>(req);
  const nombre = texto(b.nombre, 80);
  const negocio = texto(b.negocio, 80);
  const email = texto(b.email, 120).toLowerCase();
  const instagram = texto(b.instagram, 120);
  const rubro = texto(b.rubro, 60);
  const facturacion = texto(b.facturacion, 20);
  const ya_pauto = texto(b.ya_pauto, 60);
  const cuando = texto(b.cuando, 60);
  const inversion = texto(b.inversion, 20);
  if (nombre.length < 2 || negocio.length < 2) throw new HttpError(400, "Completá tu nombre y el de tu empresa");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Revisá el email");
  if (!RUBROS.includes(rubro) || !FACTURACION.includes(facturacion) || !YA_PAUTO.includes(ya_pauto) || !CUANDO.includes(cuando) || !INVERSION.includes(inversion)) {
    throw new HttpError(400, "Faltan respuestas");
  }

  // Lo calcula el servidor: no se confía en lo que manda el navegador.
  const califica = INVERSION_OK.includes(inversion);
  const dudoso = califica && (facturacion === "lt5" || facturacion === "5-10");

  // Anti-spam: hasta 5 por IP por hora y el mismo email no se repite en 10 minutos.
  const ip_hash = huellaIp(req);
  const ahora = Date.now();
  const pool = getPool();
  const spam = await pool.query(
    `select
       count(*) filter (where data->>'ip_hash' = $2 and data->>'created_at' > $3)::int as por_ip,
       count(*) filter (where data->>'email' = $4 and data->>'created_at' > $5)::int as por_email
     from documentos where coleccion = $1 and data->>'created_at' > $3`,
    [COL, ip_hash, new Date(ahora - 3_600_000).toISOString(), email, new Date(ahora - 600_000).toISOString()]
  );
  if ((spam.rows[0]?.por_ip ?? 0) >= 5) throw new HttpError(429, "Recibimos muchas aplicaciones desde tu conexión. Probá en un rato.");
  if ((spam.rows[0]?.por_email ?? 0) > 0) throw new HttpError(429, "Ya recibimos tu aplicación hace unos minutos.");

  const { temporada } = await leerConfig();
  const id = randomUUID();
  const at = new Date(ahora).toISOString();
  const estado = califica ? "calificado" : "no_califica";
  await guardarDoc(pool, COL, id, {
    created_at: at,
    updated_at: at,
    temporada,
    nombre,
    negocio,
    email,
    instagram,
    rubro,
    facturacion,
    facturacion_label: texto(b.facturacion_label, 60),
    ya_pauto,
    cuando,
    inversion,
    inversion_label: texto(b.inversion_label, 60),
    califica,
    dudoso,
    estado,
    notas: "",
    origen: texto(b.origen, 80),
    ip_hash,
    historial: [{ at, de: null, a: estado, por: null, por_nombre: "Web" }],
  });
  return { id, califica };
}

const ID_OK = /^[0-9a-f-]{36}$/i;

async function reunion(req: VercelRequest) {
  const id = texto(body<{ id?: string }>(req).id, 40);
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  await enTransaccion(async (cli) => {
    const d = await leerDoc(cli, COL, id, true);
    if (!d || d.estado !== "calificado") return;
    const at = new Date().toISOString();
    await guardarDoc(cli, COL, id, {
      ...d,
      estado: "reunion_agendada",
      updated_at: at,
      historial: [...(Array.isArray(d.historial) ? d.historial : []), { at, de: "calificado", a: "reunion_agendada", por: null, por_nombre: "Web" }].slice(-50),
    });
  });
  return { ok: true };
}

// ---- Panel ----

async function cambiar(req: VercelRequest, campo: "estado" | "notas") {
  const caller = await requireCaller(req, ["admin"]);
  const b = body<{ id?: string; estado?: string; notas?: string }>(req);
  const id = texto(b.id, 40);
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  const valor = campo === "estado" ? texto(b.estado, 30) : String(b.notas ?? "").slice(0, 4000);
  if (campo === "estado" && !ESTADOS.includes(valor)) throw new HttpError(400, "Estado inválido");
  return enTransaccion(async (cli) => {
    const d = await leerDoc(cli, COL, id, true);
    if (!d) throw new HttpError(404, "No encontramos esa aplicación");
    if (d[campo] === valor) return { ok: true };
    const at = new Date().toISOString();
    const nuevo = { ...d, [campo]: valor, updated_at: at, updated_by: caller.uid };
    if (campo === "estado") {
      nuevo.historial = [
        ...(Array.isArray(d.historial) ? d.historial : []),
        { at, de: d.estado ?? null, a: valor, por: caller.uid, por_nombre: caller.nombre || caller.email || "" },
      ].slice(-100);
      nuevo.ultimo_contacto_at = at;
    }
    await guardarDoc(cli, COL, id, nuevo);
    return { ok: true };
  });
}

/** Datos del lead que se completan o corrigen después (lo que faltó al cargarlo). Solo cambia los que vienen. */
const DATOS_EDITABLES: Record<string, number> = { negocio: 80, nombre: 80, email: 120, telefono: 40, instagram: 120, ubicacion: 300, rubro: 60 };
async function datos(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin"]);
  const b = body<Record<string, unknown>>(req);
  const id = texto(b.id, 40);
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  const cambios: Record<string, string> = {};
  for (const [k, max] of Object.entries(DATOS_EDITABLES)) if (k in b) cambios[k] = k === "email" ? texto(b[k], max).toLowerCase() : texto(b[k], max);
  if ("negocio" in cambios && cambios.negocio.length < 2) throw new HttpError(400, "Poné el nombre del negocio");
  if (cambios.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cambios.email)) throw new HttpError(400, "Revisá el email");
  return enTransaccion(async (cli) => {
    const d = await leerDoc(cli, COL, id, true);
    if (!d) throw new HttpError(404, "No encontramos ese lead");
    await guardarDoc(cli, COL, id, { ...d, ...cambios, updated_at: new Date().toISOString(), updated_by: caller.uid });
    return { ok: true };
  });
}

const TIPOS_ACTIVIDAD = ["llamada", "whatsapp", "email", "reunion", "nota", "presupuesto"];

/** Cambia un lead con un historial nuevo (todo en una transacción). */
async function conLead(id: string, cambio: (d: Record<string, unknown>) => Record<string, unknown>) {
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  return enTransaccion(async (cli) => {
    const d = await leerDoc(cli, COL, id, true);
    if (!d) throw new HttpError(404, "No encontramos ese lead");
    await guardarDoc(cli, COL, id, { ...d, ...cambio(d), updated_at: new Date().toISOString() });
    return { ok: true };
  });
}
const conHistorial = (d: Record<string, unknown>, e: Record<string, unknown>) => [...(Array.isArray(d.historial) ? d.historial : []), e].slice(-100);

/** Próximo paso: qué hay que hacer y para cuándo (sin fecha = sin recordatorio). */
async function seguimiento(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin"]);
  const b = body<{ id?: string; texto?: string; fecha?: string | null }>(req);
  const txt = texto(b.texto, 200);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha ?? "")) ? String(b.fecha) : null;
  const at = new Date().toISOString();
  return conLead(texto(b.id, 40), (d) => ({
    proximo_paso: txt ? { texto: txt, fecha, at, por: caller.uid } : null,
    historial: conHistorial(d, { at, tipo: "paso", texto: txt ? `Próximo paso: ${txt}${fecha ? ` (${fecha})` : ""}` : "Sacó el próximo paso", por: caller.uid, por_nombre: caller.nombre || caller.email || "" }),
  }));
}

/** Algo que pasó con el lead (llamada, WhatsApp, nota…): va a la línea de tiempo y cuenta como contacto. */
async function actividad(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin"]);
  const b = body<{ id?: string; tipo?: string; texto?: string; cumplido?: boolean }>(req);
  const tipo = texto(b.tipo, 20);
  if (!TIPOS_ACTIVIDAD.includes(tipo)) throw new HttpError(400, "Tipo inválido");
  const at = new Date().toISOString();
  return conLead(texto(b.id, 40), (d) => ({
    ultimo_contacto_at: at,
    // "Ya lo hice": el próximo paso queda cumplido.
    ...(b.cumplido ? { proximo_paso: null } : {}),
    historial: conHistorial(d, { at, tipo, texto: String(b.texto ?? "").trim().slice(0, 1000), por: caller.uid, por_nombre: caller.nombre || caller.email || "" }),
  }));
}

/** De dónde vino un lead cargado a mano. */
const FUENTES = ["Recomendación", "WhatsApp", "Instagram", "Llamada", "Evento", "Cliente actual", "Otro"];

/** Lead cargado a mano desde el panel (no pasó por el formulario de la web): entra al mismo tablero. */
async function manual(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin"]);
  const b = body<Record<string, unknown>>(req);
  const negocio = texto(b.negocio, 80);
  const nombre = texto(b.nombre, 80);
  const email = texto(b.email, 120).toLowerCase();
  const telefono = texto(b.telefono, 40);
  if (negocio.length < 2) throw new HttpError(400, "Poné el nombre del negocio");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Revisá el email");
  const fuente = FUENTES.includes(texto(b.fuente, 40)) ? texto(b.fuente, 40) : "Otro";
  const estado = ESTADOS.includes(texto(b.estado, 30)) && texto(b.estado, 30) !== "no_califica" ? texto(b.estado, 30) : "calificado";
  const { temporada } = await leerConfig();
  const id = randomUUID();
  const at = new Date().toISOString();
  await guardarDoc(getPool(), COL, id, {
    created_at: at,
    updated_at: at,
    temporada,
    nombre,
    negocio,
    email,
    telefono,
    instagram: texto(b.instagram, 120),
    ubicacion: texto(b.ubicacion, 300),
    rubro: texto(b.rubro, 60),
    califica: true,
    dudoso: false,
    estado,
    notas: String(b.notas ?? "").slice(0, 4000),
    manual: true,
    fuente,
    origen: `manual:${fuente}`,
    creado_por: caller.uid,
    historial: [{ at, de: null, a: estado, por: caller.uid, por_nombre: caller.nombre || caller.email || "" }],
  });
  return { id };
}

async function config(req: VercelRequest) {
  await requireCaller(req, ["admin"]);
  const b = body<{ temporada?: unknown; cupos_total?: unknown }>(req);
  const actual = await leerConfig();
  const temporada = b.temporada === undefined ? actual.temporada : texto(b.temporada, 40);
  const total = b.cupos_total === undefined ? actual.cupos_total : Number(b.cupos_total);
  if (temporada.length < 2) throw new HttpError(400, "Poné el nombre de la temporada");
  if (!Number.isInteger(total) || total < 1 || total > 50) throw new HttpError(400, "Los cupos van de 1 a 50");
  await guardarDoc(getPool(), CONFIG.col, CONFIG.id, { temporada, cupos_total: total, updated_at: new Date().toISOString() });
  return { temporada, cupos_total: total };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const accion = String(req.query.accion ?? "");
  res.setHeader("Cache-Control", "no-store");
  const publica = ["aplicar", "reunion", "cupos"].includes(accion);
  if (publica) cors(req, res);
  try {
    if (req.method === "OPTIONS" && publica) {
      res.status(204).end();
      return;
    }
    if (accion === "cupos" && req.method === "GET") {
      res.status(200).json(await cupos());
      return;
    }
    // Formularios de los anuncios de Prodi (api/_lib/meta-leads.ts): Meta verifica con GET y avisa con POST.
    if (accion === "meta-webhook") {
      if (req.method === "GET") res.status(200).setHeader("Content-Type", "text/plain").send(verificarWebhook(req.query as Record<string, unknown>));
      else res.status(200).json(await recibirWebhook(req.body, appUrl(req)));
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    if (accion === "aplicar") res.status(200).json(await aplicar(req));
    else if (accion === "reunion") res.status(200).json(await reunion(req));
    else if (accion === "estado") res.status(200).json(await cambiar(req, "estado"));
    else if (accion === "notas") res.status(200).json(await cambiar(req, "notas"));
    else if (accion === "config") res.status(200).json(await config(req));
    else if (accion === "manual") res.status(200).json(await manual(req));
    else if (accion === "seguimiento") res.status(200).json(await seguimiento(req));
    else if (accion === "actividad") res.status(200).json(await actividad(req));
    else if (accion === "datos") res.status(200).json(await datos(req));
    else if (accion === "meta-estado") {
      await requireCaller(req, ["admin"]);
      res.status(200).json(await estadoMeta());
    } else if (accion === "meta-mensajes") {
      await requireCaller(req, ["admin"]);
      res.status(200).json(await importarMensajes(appUrl(req), body<{ forzar?: boolean }>(req).forzar === true, body<{ forzar?: boolean }>(req).forzar === true));
    } else if (accion === "meta-token") {
      await requireCaller(req, ["admin"]);
      res.status(200).json(await guardarTokenUsuario(String(body<{ token?: string }>(req).token ?? ""), appUrl(req)));
    } else if (accion === "meta-conectar") {
      await requireCaller(req, ["admin"]);
      res.status(200).json(await conectarFormularios(appUrl(req)));
    }
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    sendError(res, err);
  }
}
