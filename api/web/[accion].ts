// Módulo Web: reservas de la landing de la campaña «No empezamos de cero» (somosprodi.com).
// Públicos (los llama la landing, con CORS solo para somosprodi.com):
// POST /api/web/aplicar   { nombre, negocio, email, telefono, instagram, rubro, facturacion, …, inversion, …, plan?, ref? } → { id, califica }
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
// POST /api/web/meta-conversacion { id } · meta-responder { id, texto }  (admin) chat del lead por Instagram/Messenger
// POST /api/web/meta-productos { id, ids }  (admin) manda productos del catálogo de Prodi como tarjetas
// POST /api/web/unir { id, otro } · foto { id, foto (data URL, vacía = sacar) }  (admin)
// POST /api/web/wa-estado · wa-config { config_id } · wa-conectar { code, waba_id, phone_number_id }  (admin) WhatsApp de Prodi → leads
// POST /api/web/meta-mensajes     (admin) { forzar? } trae los mensajes nuevos de IG y FB como leads
// POST /api/web/meta-conectar     (admin) suscribe la página de Prodi y trae los formularios de 30 días
// POST /api/web/manual    { negocio, nombre?, email?, telefono?, instagram?, ubicacion?, rubro?, fuente?, notas?, estado? } → { id }  (lead cargado a mano)
// POST /api/web/crm-espera { nombre, negocio, email, telefono?, plan, rubro? } → { ok }  (pública: lista de espera del CRM en somosprodi.com)
// GET  /api/web/precios   → { planes: [con factura], sin_factura: [sin IVA] } con { id, nombre, neto, iva, comision, monto, … }
// POST /api/web/comprar   { plan, factura (true/false), nombre, negocio, email, email_mp?, telefono, instagram?, cuit?, ref? } → { init_point }
//      (pública: compra de un plan con débito automático; el alta del cliente la hace el webhook, ver api/_lib/alta-web.ts)
// Socios comerciales (ver api/_lib/socios.ts):
// POST /api/web/aplicar acepta `ref` (código del socio que guardó la landing): el lead entra con origen "socio".
// POST /api/web/socio-panel                  (socio) → { codigo, link, leads[] } solo los suyos, sin notas internas
// POST /api/web/socio-cargar { negocio, nombre?, rubro?, telefono?, nota? }  (socio) → { id } | { repetido: true }
// POST /api/web/socio-ganancias { meses? }   (socio) → comisión de los últimos meses (lo cobrado de sus clientes)
// POST /api/web/socio-asignar { id, socio_id|null }  (admin) → "Traído por" de un lead
// POST /api/web/socio-alta { lead_id, proyecto_id }  (admin) → el cliente nuevo queda con el socio del lead y la fecha
// POST /api/web/socio-cliente { proyecto_id, socio_id|null }  (admin) → "Traído por" de un cliente
// POST /api/web/socio-resumen { mes }        (admin) → por socio: leads, ganados, clientes, facturado y comisión
// Postulantes de somosprodi.com/sumate (colección `postulantes_web`, aparte de los leads):
// POST /api/web/sumate { tipo: "trabajo" | "creador" | "franquicia", nombre, telefono, email, ciudad, … } → { ok }  (pública)
// POST /api/web/postulante-estado { id, estado?, notas? }  (admin) → nuevo, contactado, aceptado o descartado
// Los leads se guardan en la colección `leads_web`; la configuración en `web_config/general`.

import { createHmac, randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { borrarDoc, enTransaccion, getPool, guardarDoc, leerDoc } from "../_lib/db";
import { appUrl, body, HttpError, requireCaller, sendError, tieneRol, type Caller } from "../_lib/http";
import { duenoLead } from "../_lib/reglas";
import { adminDb } from "../_lib/db";
import { avisarAdmin, avisarEstadoAlSocio, comisionEstandar, comisionesDelMes, guardarEstandar, listarSocios, resumenSocios, socioPorCodigo, sumarMeses } from "../_lib/socios";
import { claveTelefono } from "../_lib/leads-unir";
import { PLANES_WEB, precioPlanWeb } from "../_lib/alta-web";
import { crearSuscripcion } from "../_lib/mercadopago";

/** Trabajan los leads de Prodi: el admin y quien tenga el rol Ventas. */
const VENTAS = ["admin", "ventas"];
import { fotoManual, unirLeads } from "../_lib/leads-unir";
import { linksParaMandar } from "../_lib/catalogo";

import { conectarWhatsApp, estadoWhatsApp, guardarConfigWhatsApp, recibirWhatsApp } from "../_lib/meta-whatsapp";
import { conectarFormularios, guardarTokenUsuario, conversacionLead, enviarProductos, estadoMeta, guardarRespuestas, sugerirRespuestas, importarMensajes, recibirWebhook, responderLead, verificarWebhook } from "../_lib/meta-leads";

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
// Planes de Redes que se muestran en somosprodi.com (el formulario manda cuál eligió, si eligió uno).
const PLANES_REDES: Record<string, string> = { esencial: "Esencial ($450.000)", crecimiento: "Crecimiento ($600.000)", completa: "Campaña completa ($750.000)" };

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
  const telefono = texto(b.telefono, 40);
  const rubro = texto(b.rubro, 60);
  const facturacion = texto(b.facturacion, 20);
  const ya_pauto = texto(b.ya_pauto, 60);
  const cuando = texto(b.cuando, 60);
  const inversion = texto(b.inversion, 20);
  if (nombre.length < 2 || negocio.length < 2) throw new HttpError(400, "Completá tu nombre y el de tu empresa");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Revisá el email");
  if (telefono.replace(/\D/g, "").length < 8) throw new HttpError(400, "Revisá tu WhatsApp (con característica)");
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
  // Vino por el link de un socio (?ref=CODIGO, lo guarda la landing 60 días). Si ese empresario ya era lead, queda
  // para quien lo trajo primero (y se avisa al admin).
  const socio = b.ref ? await socioPorCodigo(texto(b.ref, 40)) : null;
  let socioDelLead: { uid: string; nombre: string } | null = socio;
  if (socio) {
    const previo = await leadExistente(email, "");
    if (previo) {
      socioDelLead = previo.data.socio_id ? { uid: String(previo.data.socio_id), nombre: String(previo.data.socio_nombre ?? "") } : null;
      if (previo.data.socio_id !== socio.uid)
        await avisarAdmin(
          `Lead repetido: ${negocio}`,
          `${socio.nombre} lo trajo por su link, pero ya era lead${previo.data.socio_id ? ` de ${previo.data.socio_nombre || "otro vendedor"}` : ""}. Queda para quien lo trajo primero.`,
          `/web?lead=${previo.id}`,
          `socio-repetido:${id}`,
          appUrl(req)
        );
    }
  }
  await guardarDoc(pool, COL, id, {
    created_at: at,
    updated_at: at,
    temporada,
    nombre,
    negocio,
    email,
    telefono,
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
    // Plan que eligió en somosprodi.com antes de completar el formulario (si vino de una tarjeta de plan).
    notas: PLANES_REDES[texto(b.plan, 20)] ? `Le interesa el plan ${PLANES_REDES[texto(b.plan, 20)]}.` : "",
    ...(PLANES_REDES[texto(b.plan, 20)] ? { plan_interes: texto(b.plan, 20) } : {}),
    origen: socio ? "socio" : texto(b.origen, 80),
    ...(socioDelLead ? { socio_id: socioDelLead.uid, socio_nombre: socioDelLead.nombre } : {}),
    ...(socio ? { ref: socio.uid } : {}),
    ip_hash,
    historial: [{ at, de: null, a: estado, por: null, por_nombre: socio ? `Web · link de ${socio.nombre}` : "Web" }],
  });
  if (socioDelLead) await avisarEstadoAlSocio({ negocio, socio_id: socioDelLead.uid }, id, estado, appUrl(req));
  return { id, califica };
}

const ID_OK = /^[0-9a-f-]{36}$/i;

async function reunion(req: VercelRequest) {
  const id = texto(body<{ id?: string }>(req).id, 40);
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  let delSocio: Record<string, unknown> | null = null;
  await enTransaccion(async (cli) => {
    const d = await leerDoc(cli, COL, id, true);
    if (!d || d.estado !== "calificado") return;
    if (d.socio_id) delSocio = d;
    const at = new Date().toISOString();
    await guardarDoc(cli, COL, id, {
      ...d,
      estado: "reunion_agendada",
      updated_at: at,
      historial: [...(Array.isArray(d.historial) ? d.historial : []), { at, de: "calificado", a: "reunion_agendada", por: null, por_nombre: "Web" }].slice(-50),
    });
  });
  if (delSocio) await avisarEstadoAlSocio(delSocio, id, "reunion_agendada", appUrl(req));
  return { ok: true };
}

// ---- Panel ----

async function cambiar(req: VercelRequest, campo: "estado" | "notas") {
  const r = await cambiarLead(req, campo);
  if (r.avisar) await avisarEstadoAlSocio(r.avisar.lead, r.avisar.id, r.avisar.estado, appUrl(req));
  return { ok: true };
}

async function cambiarLead(req: VercelRequest, campo: "estado" | "notas"): Promise<{ avisar?: { lead: Record<string, unknown>; id: string; estado: string } }> {
  const caller = await requireCaller(req, VENTAS);
  const b = body<{ id?: string; estado?: string; notas?: string }>(req);
  const id = texto(b.id, 40);
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  const valor = campo === "estado" ? texto(b.estado, 30) : String(b.notas ?? "").slice(0, 4000);
  if (campo === "estado" && !ESTADOS.includes(valor)) throw new HttpError(400, "Estado inválido");
  return enTransaccion(async (cli) => {
    const d = await leerDoc(cli, COL, id, true);
    if (!d) throw new HttpError(404, "No encontramos esa aplicación");
    if (d[campo] === valor) return {};
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
    return campo === "estado" && d.socio_id ? { avisar: { lead: d, id, estado: valor } } : {};
  });
}

/** Datos del lead que se completan o corrigen después (lo que faltó al cargarlo). Solo cambia los que vienen. */
const DATOS_EDITABLES: Record<string, number> = { negocio: 80, nombre: 80, email: 120, telefono: 40, instagram: 120, ubicacion: 300, rubro: 60 };
async function datos(req: VercelRequest) {
  const caller = await requireCaller(req, VENTAS);
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

/**
 * Borrar un lead (solo admin: duplicados, pruebas). Queda una marca en leads_web_borrados para que los de Meta
 * (formularios y mensajes) no vuelvan a entrar solos con la próxima revisión; si la persona escribe de nuevo, sí.
 * El que ya es cliente no se borra.
 */
async function borrarLead(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin"]);
  const id = texto(body<{ id?: string }>(req).id, 40);
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  return enTransaccion(async (cli) => {
    const d = await leerDoc(cli, COL, id, true);
    if (!d) throw new HttpError(404, "No encontramos ese lead");
    if (d.cliente_id) throw new HttpError(400, "Este lead ya es cliente: no se puede borrar");
    await guardarDoc(cli, "leads_web_borrados", id, { borrado_at: new Date().toISOString(), negocio: d.negocio ?? "", por: caller.uid });
    await borrarDoc(cli, COL, id);
    return { ok: true };
  });
}

/** Próximo paso: qué hay que hacer y para cuándo (sin fecha = sin recordatorio). */
async function seguimiento(req: VercelRequest) {
  const caller = await requireCaller(req, VENTAS);
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
  const caller = await requireCaller(req, VENTAS);
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

/** Alguien del equipo abrió el lead: deja de figurar "sin leer". No toca updated_at (no cambia el orden del tablero). */
async function visto(req: VercelRequest) {
  await requireCaller(req, VENTAS);
  const id = texto(body<{ id?: string }>(req).id, 40);
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  return enTransaccion(async (cli) => {
    const d = await leerDoc(cli, COL, id, true);
    if (!d) throw new HttpError(404, "No encontramos ese lead");
    await guardarDoc(cli, COL, id, { ...d, leido_at: new Date().toISOString() });
    return { ok: true };
  });
}

/** De dónde vino un lead cargado a mano. */
const FUENTES = ["Recomendación", "WhatsApp", "Instagram", "Llamada", "Evento", "Cliente actual", "Lista de espera CRM", "Otro"];

// Planes del CRM que se muestran en somosprodi.com (acceso anticipado).
const PLANES_CRM: Record<string, string> = {
  inicial: "Inicial · USD 19 · hasta 2 personas",
  equipo: "Equipo · USD 39 · hasta 5 personas",
  empresa: "Empresa · USD 69 · hasta 15 personas",
  medida: "A medida (integración con su ERP o sistema: armar presupuesto)",
};

/** Precios de los planes que se compran en la web, con y sin factura: neto + IVA + comisión del débito automático. */
async function precios() {
  const ids = Object.keys(PLANES_WEB).filter((id) => !PLANES_WEB[id].oculto);
  const [con, sin] = await Promise.all([Promise.all(ids.map((id) => precioPlanWeb(id, true))), Promise.all(ids.map((id) => precioPlanWeb(id, false)))]);
  return { planes: con.filter(Boolean), sin_factura: sin.filter(Boolean) };
}

/**
 * Compra de un plan desde somosprodi.com (ver api/_lib/alta-web.ts): chequea cupos, deja la compra pendiente con su
 * lead y crea la suscripción de Mercado Pago. Devuelve el link para que el cliente autorice el débito automático.
 */
async function comprar(req: VercelRequest) {
  const b = body<Record<string, unknown>>(req);
  const planId = texto(b.plan, 20);
  const nombre = texto(b.nombre, 80);
  const negocio = texto(b.negocio, 80);
  const email = texto(b.email, 120).toLowerCase();
  const emailMp = texto(b.email_mp, 120).toLowerCase();
  const telefono = texto(b.telefono, 40);
  const cuit = texto(b.cuit, 20).replace(/[^0-9]/g, "");
  const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  // Con factura (por defecto) se suma el IVA; sin factura va como boleta, sin IVA.
  const factura = b.factura !== false;
  const precio = await precioPlanWeb(planId, factura);
  if (!precio) throw new HttpError(400, "Elegí un plan");
  if (nombre.length < 2 || negocio.length < 2) throw new HttpError(400, "Completá tu nombre y el de tu negocio");
  if (!MAIL.test(email)) throw new HttpError(400, "Revisá el email");
  if (emailMp && !MAIL.test(emailMp)) throw new HttpError(400, "Revisá el email de Mercado Pago");
  if (telefono.replace(/\D/g, "").length < 8) throw new HttpError(400, "Revisá el teléfono");
  if (cuit && cuit.length !== 11) throw new HttpError(400, "El CUIT tiene 11 números");
  if (!(precio.monto > 0)) throw new HttpError(500, "El plan no tiene precio cargado");

  // Cupos de la temporada: si están completos no se vende.
  const c = await cupos();
  if (c.ocupados >= c.total) throw new HttpError(409, "Los cupos de esta temporada están completos. Escribinos para la próxima.");

  // Anti-spam: hasta 5 compras empezadas por IP por hora.
  const ip_hash = huellaIp(req);
  const ahora = new Date();
  const pool = getPool();
  const r = await pool.query(
    "select count(*)::int as n from documentos where coleccion = 'altas_web' and data->>'ip_hash' = $1 and data->>'created_at' > $2",
    [ip_hash, new Date(ahora.getTime() - 3_600_000).toISOString()]
  );
  if ((r.rows[0]?.n ?? 0) >= 5) throw new HttpError(429, "Recibimos muchos pedidos desde tu conexión. Probá en un rato.");

  // El lead: si ya existía (por mail o teléfono) se usa ese; si no, se crea. Vendedor por su link (?ref=).
  const at = ahora.toISOString();
  const socio = b.ref ? await socioPorCodigo(texto(b.ref, 40)) : null;
  const previo = await leadExistente(email, telefono);
  let leadId: string;
  if (previo) {
    leadId = previo.id;
    await conLead(leadId, (d) => ({
      plan_interes: planId,
      ...(d.telefono ? {} : { telefono }),
      ...(d.estado === "no_califica" || d.estado === "perdido" ? { estado: "calificado" } : {}),
      historial: conHistorial(d, { at, tipo: "nota", texto: `Empezó a comprar el plan ${precio.nombre} en la web`, por: null, por_nombre: "Web" }),
    }));
  } else {
    leadId = randomUUID();
    const { temporada } = await leerConfig();
    await guardarDoc(pool, COL, leadId, {
      created_at: at,
      updated_at: at,
      temporada,
      nombre,
      negocio,
      email,
      telefono,
      instagram: texto(b.instagram, 120),
      califica: true,
      dudoso: false,
      estado: "calificado",
      notas: `Empezó a comprar el plan ${precio.nombre} en la web.`,
      plan_interes: planId,
      fuente: "Compra web",
      origen: socio ? "socio" : "somosprodi.com:compra",
      ...(socio ? { socio_id: socio.uid, socio_nombre: socio.nombre, ref: socio.uid } : {}),
      ip_hash,
      historial: [{ at, de: null, a: "calificado", por: null, por_nombre: socio ? `Web · link de ${socio.nombre}` : "Web · compra" }],
    });
  }

  // La compra pendiente y la suscripción de Mercado Pago (débito automático desde el primer mes).
  const altaId = randomUUID();
  const s = await crearSuscripcion({
    titulo: `Prodi · Plan ${precio.nombre} · ${negocio}`,
    monto: precio.monto,
    email: emailMp || email,
    externalReference: `alta:${altaId}`,
    backUrl: `https://somosprodi.com/gracias?plan=${planId}`,
  });
  await guardarDoc(pool, "altas_web", altaId, {
    created_at: at,
    updated_at: at,
    estado: "pendiente",
    plan: planId,
    nombre,
    negocio,
    email,
    ...(emailMp ? { email_mp: emailMp } : {}),
    telefono,
    instagram: texto(b.instagram, 120),
    factura,
    ...(cuit && factura ? { cuit } : {}),
    lead_id: leadId,
    neto: precio.neto,
    iva: precio.iva,
    total: precio.total,
    comision: precio.comision,
    comision_pct: precio.comision_pct,
    monto: precio.monto,
    mp_preapproval_id: s.id,
    ip_hash,
  });
  return { init_point: s.init_point, monto: precio.monto };
}

/** Lista de espera del CRM (somosprodi.com): entra al mismo tablero de leads, con su fuente, y avisa al admin. */
async function crmEspera(req: VercelRequest) {
  const b = body<Record<string, unknown>>(req);
  const nombre = texto(b.nombre, 80);
  const negocio = texto(b.negocio, 80);
  const email = texto(b.email, 120).toLowerCase();
  const telefono = texto(b.telefono, 40);
  const plan = texto(b.plan, 20);
  if (nombre.length < 2 || negocio.length < 2) throw new HttpError(400, "Completá tu nombre y el de tu empresa");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Revisá el email");
  if (!PLANES_CRM[plan]) throw new HttpError(400, "Elegí un plan");

  // Mismo anti-spam que el formulario de la temporada.
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
  if ((spam.rows[0]?.por_ip ?? 0) >= 5) throw new HttpError(429, "Recibimos muchos pedidos desde tu conexión. Probá en un rato.");
  if ((spam.rows[0]?.por_email ?? 0) > 0) return { ok: true };

  const { temporada } = await leerConfig();
  const id = randomUUID();
  const at = new Date(ahora).toISOString();
  const fuente = "Lista de espera CRM";
  await guardarDoc(pool, COL, id, {
    created_at: at,
    updated_at: at,
    temporada,
    nombre,
    negocio,
    email,
    telefono,
    rubro: texto(b.rubro, 60),
    califica: true,
    dudoso: false,
    estado: "calificado",
    notas: `Quiere el CRM (acceso anticipado). Plan: ${PLANES_CRM[plan]}.`,
    interes: "crm",
    plan_crm: plan,
    fuente,
    origen: "somosprodi.com:crm",
    ip_hash,
    historial: [{ at, de: null, a: "calificado", por: null, por_nombre: "Web · lista de espera CRM" }],
  });
  await avisarAdmin(`Lista de espera del CRM: ${negocio}`, `${nombre} quiere el plan ${PLANES_CRM[plan]}.`, `/web?lead=${id}`, `crm-espera:${id}`, appUrl(req)).catch(() => undefined);
  return { ok: true };
}

/** Quien se postula desde somosprodi.com/sumate: trabajar con Prodi, ser creador con referidos o llevar Prodi a su ciudad.
 *  Va a `postulantes_web` (no al tablero de leads) y avisa al admin. */
const POSTULANTES = "postulantes_web";
const TIPOS_POSTULANTE: Record<string, string> = { trabajo: "Trabajar con Prodi", creador: "Creador con referidos", franquicia: "Llevar Prodi a su ciudad" };
const ESTADOS_POSTULANTE = ["nuevo", "contactado", "aceptado", "descartado"];
const lista = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => texto(x, 40)).filter(Boolean).slice(0, max) : []);

async function sumate(req: VercelRequest) {
  const b = body<Record<string, unknown>>(req);
  const tipo = texto(b.tipo, 20);
  const nombre = texto(b.nombre, 80);
  const email = texto(b.email, 120).toLowerCase();
  const telefono = texto(b.telefono, 40);
  const ciudad = texto(b.ciudad, 80);
  if (!TIPOS_POSTULANTE[tipo]) throw new HttpError(400, "Elegí cómo querés sumarte");
  if (nombre.length < 2) throw new HttpError(400, "Completá tu nombre");
  if (telefono.replace(/\D/g, "").length < 8) throw new HttpError(400, "Revisá tu WhatsApp (con característica)");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Revisá el email");
  if (ciudad.length < 2) throw new HttpError(400, "Contanos en qué ciudad estás");

  const ip_hash = huellaIp(req);
  const ahora = Date.now();
  const pool = getPool();
  const spam = await pool.query(
    `select
       count(*) filter (where data->>'ip_hash' = $2 and data->>'created_at' > $3)::int as por_ip,
       count(*) filter (where data->>'email' = $4 and data->>'created_at' > $5)::int as por_email
     from documentos where coleccion = $1 and data->>'created_at' > $3`,
    [POSTULANTES, ip_hash, new Date(ahora - 3_600_000).toISOString(), email, new Date(ahora - 600_000).toISOString()]
  );
  if ((spam.rows[0]?.por_ip ?? 0) >= 5) throw new HttpError(429, "Recibimos muchos envíos desde tu conexión. Probá en un rato.");
  if ((spam.rows[0]?.por_email ?? 0) > 0) return { ok: true };

  const id = randomUUID();
  const at = new Date(ahora).toISOString();
  const datosTipo =
    tipo === "trabajo"
      ? {
          rol: texto(b.rol, 40),
          experiencia: texto(b.experiencia, 40),
          herramientas: lista(b.herramientas, 20),
          equipo: lista(b.equipo, 10),
          movilidad: texto(b.movilidad, 60),
          dedicacion: texto(b.dedicacion, 40),
          portfolio: texto(b.portfolio, 300),
          cv: texto(b.cv, 300),
          instagram: texto(b.instagram, 120),
          tiktok: texto(b.tiktok, 200),
          linkedin: texto(b.linkedin, 300),
          edad: texto(b.edad, 10),
          estudios: texto(b.estudios, 60),
          inicio: texto(b.inicio, 40),
          pretension: texto(b.pretension, 120),
          porque: texto(b.porque, 1500),
        }
      : tipo === "creador"
        ? { redes: texto(b.redes, 200), seguidores: texto(b.seguidores, 40), tema: texto(b.tema, 120), porque: texto(b.porque, 1500) }
        : { mensaje: texto(b.mensaje, 1500) };
  await guardarDoc(pool, POSTULANTES, id, {
    created_at: at,
    updated_at: at,
    tipo,
    nombre,
    email,
    telefono,
    ciudad,
    ...datosTipo,
    estado: "nuevo",
    notas: "",
    ip_hash,
  });
  await avisarAdmin(`${TIPOS_POSTULANTE[tipo]}: ${nombre}`, `${nombre}, de ${ciudad}, se postuló desde somosprodi.com/sumate.`, `/postulantes?id=${id}`, `sumate:${id}`, appUrl(req)).catch(() => undefined);
  return { ok: true };
}

async function postulanteEstado(req: VercelRequest) {
  await requireCaller(req, ["admin"]);
  const b = body<{ id?: string; estado?: string; notas?: string }>(req);
  const id = texto(b.id, 40);
  if (!ID_OK.test(id)) throw new HttpError(400, "Falta el id");
  return enTransaccion(async (cli) => {
    const d = await leerDoc(cli, POSTULANTES, id, true);
    if (!d) throw new HttpError(404, "No encontramos esa postulación");
    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.estado !== undefined) {
      if (!ESTADOS_POSTULANTE.includes(String(b.estado))) throw new HttpError(400, "Estado inválido");
      cambios.estado = b.estado;
    }
    if (b.notas !== undefined) cambios.notas = texto(b.notas, 3000);
    await guardarDoc(cli, POSTULANTES, id, { ...d, ...cambios });
    return { ok: true };
  });
}

const LEAD_DE_VENTAS = ["estado", "notas", "seguimiento", "actividad", "datos", "meta-productos", "unir", "foto", "meta-sugerir", "meta-conversacion", "meta-responder"];

/** Si quien llama es de ventas (y no admin), el lead (y el otro, al unir) tiene que ser suyo. */
async function soloSuLead(req: VercelRequest) {
  const caller = await requireCaller(req, VENTAS);
  if (tieneRol(caller, "admin")) return;
  const b = body<{ id?: string; otro?: string }>(req);
  for (const id of [b.id, b.otro].filter(Boolean).map((x) => texto(x, 40))) {
    const d = ID_OK.test(id) ? await leerDoc(getPool(), COL, id) : null;
    if (!d || duenoLead(d) !== caller.uid) throw new HttpError(403, "Ese lead no es tuyo");
  }
}

/** Quién atiende el lead (admin): esa persona de ventas lo ve y lo trabaja; sin nadie, solo el admin. */
async function asignarVendedor(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin"]);
  const b = body<{ id?: string; vendedor_id?: string | null }>(req);
  const vendedor = b.vendedor_id ? texto(b.vendedor_id, 128) : null;
  const at = new Date().toISOString();
  return conLead(texto(b.id, 40), (d) => ({
    vendedor_id: vendedor,
    historial: conHistorial(d, { at, tipo: "nota", texto: vendedor ? "Se lo asignó a ventas" : "Lo atiende Prodi (sin vendedor)", por: caller.uid, por_nombre: caller.nombre || caller.email || "" }),
  }));
}

/** Lead cargado a mano desde el panel (no pasó por el formulario de la web): entra al mismo tablero. */
async function manual(req: VercelRequest) {
  const caller = await requireCaller(req, VENTAS);
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

// ---- Socios comerciales ----

/** Un lead que ya existe con ese email o teléfono (el más viejo: el primero que llegó). */
async function leadExistente(email: string, telefono: string): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const tel = claveTelefono(telefono);
  if (!email && !tel) return null;
  const r = await getPool().query(
    `select id, data from documentos where coleccion = $1 and (($2 <> '' and lower(data->>'email') = $2) or ($3 <> '' and right(regexp_replace(coalesce(data->>'telefono', ''), '[^0-9]', '', 'g'), 10) = $3))
      order by data->>'created_at' limit 1`,
    [COL, email, tel]
  );
  const row = r.rows[0] as { id: string; data: Record<string, unknown> } | undefined;
  return row ?? null;
}

/** Lo que el socio ve de cada lead suyo: nada de notas internas, conversación de Meta ni datos de contacto de más. */
function leadParaSocio(id: string, d: Record<string, unknown>) {
  return {
    id,
    negocio: String(d.negocio ?? ""),
    nombre: String(d.nombre ?? ""),
    rubro: String(d.rubro ?? ""),
    estado: String(d.estado ?? "calificado"),
    created_at: String(d.created_at ?? ""),
    updated_at: String(d.updated_at ?? d.created_at ?? ""),
    por_link: d.origen === "socio",
  };
}

async function socioPanel(caller: Caller, req: VercelRequest) {
  const perfil = (await adminDb().collection("profiles").doc(caller.uid).get()).data() ?? {};
  const cfg = (perfil.socio ?? null) as { codigo?: string } | null;
  const r = await getPool().query("select id, data from documentos where coleccion = $1 and data->>'socio_id' = $2 order by data->>'created_at' desc", [COL, caller.uid]);
  const leads = (r.rows as { id: string; data: Record<string, unknown> }[]).map((x) => leadParaSocio(x.id, x.data));
  const base = (process.env.WEB_SOCIO_URL || "https://somosprodi.com").replace(/\/$/, "");
  // Lo que ganó en el año (comisión de lo cobrado de sus clientes), para el resumen de una línea.
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
  const meses = Array.from({ length: 12 }, (_, i) => sumarMeses(hoy, -i));
  const comisiones = await Promise.all(meses.map(async (m) => (await comisionesDelMes(m, caller.uid))[0] ?? null));
  const ganado = comisiones.reduce((a, c) => a + (c?.total ?? 0), 0);
  const vigente = comisiones[0]?.vigente ?? null;
  return { codigo: cfg?.codigo ?? null, link: cfg?.codigo ? `${base}/?ref=${encodeURIComponent(cfg.codigo)}` : null, leads, ganado, comision: vigente, app: appUrl(req) };
}

/** El socio carga un empresario que entrevistó. Si ya existía (mismo teléfono), queda para quien lo trajo primero. */
async function socioCargar(caller: Caller, req: VercelRequest) {
  const b = body<Record<string, unknown>>(req);
  const negocio = texto(b.negocio, 80);
  const nombre = texto(b.nombre, 80);
  const telefono = texto(b.telefono, 40);
  if (negocio.length < 2) throw new HttpError(400, "Poné el nombre de la empresa");
  if (nombre.length < 2) throw new HttpError(400, "Poné el nombre del empresario");
  if (!claveTelefono(telefono)) throw new HttpError(400, "Poné un teléfono (con característica)");
  const previo = await leadExistente("", telefono);
  if (previo) {
    if (previo.data.socio_id !== caller.uid)
      await avisarAdmin(
        `Lead repetido: ${negocio}`,
        `${caller.nombre || "Un socio"} lo cargó, pero ya era lead${previo.data.socio_id ? ` de ${previo.data.socio_nombre || "otro vendedor"}` : ""}. Queda para quien lo trajo primero.`,
        `/web?lead=${previo.id}`,
        `socio-repetido:${previo.id}:${caller.uid}`,
        appUrl(req)
      );
    return { repetido: true, tuyo: previo.data.socio_id === caller.uid };
  }
  const { temporada } = await leerConfig();
  const id = randomUUID();
  const at = new Date().toISOString();
  await guardarDoc(getPool(), COL, id, {
    created_at: at,
    updated_at: at,
    temporada,
    nombre,
    negocio,
    email: "",
    telefono,
    rubro: texto(b.rubro, 60),
    califica: true,
    dudoso: false,
    estado: "calificado",
    notas: String(b.nota ?? "").trim() ? `Nota de la entrevista (${caller.nombre || "socio"}): ${String(b.nota).trim().slice(0, 3000)}` : "",
    manual: true,
    fuente: "Vendedor",
    origen: "socio",
    socio_id: caller.uid,
    socio_nombre: caller.nombre,
    creado_por: caller.uid,
    historial: [{ at, de: null, a: "calificado", por: caller.uid, por_nombre: `${caller.nombre || "Vendedor"} (vendedor)` }],
  });
  await avisarAdmin(`Nuevo lead de ${caller.nombre || "un vendedor"}`, `${negocio}${nombre ? ` · ${nombre}` : ""}`, `/web?lead=${id}`, `socio-lead-nuevo:${id}`, appUrl(req));
  return { id };
}

/** El admin asigna (o cambia, o saca) el socio de un lead. */
async function socioAsignar(caller: Caller, req: VercelRequest) {
  const b = body<{ id?: string; socio_id?: string | null }>(req);
  const socioId = b.socio_id ? texto(b.socio_id, 60) : null;
  const socio = socioId ? (await listarSocios()).find((s) => s.uid === socioId) : null;
  if (socioId && !socio) throw new HttpError(404, "No encontramos ese socio");
  const at = new Date().toISOString();
  await conLead(texto(b.id, 40), (d) => ({
    socio_id: socio?.uid ?? null,
    socio_nombre: socio?.nombre ?? null,
    historial: conHistorial(d, { at, tipo: "nota", texto: socio ? `Traído por: ${socio.nombre}` : "Sin socio", por: caller.uid, por_nombre: caller.nombre || caller.email || "" }),
  }));
  return { ok: true };
}

/** Cliente nuevo que salió de un lead: queda con el socio del lead y la fecha de alta (y el lead, ganado). */
async function socioAlta(caller: Caller, req: VercelRequest) {
  const b = body<{ lead_id?: string; proyecto_id?: string }>(req);
  const leadId = texto(b.lead_id, 40);
  const pid = texto(b.proyecto_id, 60);
  const proyecto = await adminDb().collection("projects").doc(pid).get();
  if (!proyecto.exists) throw new HttpError(404, "No encontramos el cliente");
  let lead: Record<string, unknown> | null = null;
  let estadoAntes = "";
  await conLead(leadId, (d) => {
    lead = d;
    estadoAntes = String(d.estado ?? "");
    const at = new Date().toISOString();
    return {
      cliente_id: pid,
      ...(d.estado !== "ganado" ? { estado: "ganado" } : {}),
      historial: conHistorial(d, { at, ...(d.estado !== "ganado" ? { de: d.estado ?? null, a: "ganado" } : { tipo: "nota", texto: "" }), texto: `Alta como cliente: ${proyecto.data()?.nombre ?? ""}`, por: caller.uid, por_nombre: caller.nombre || caller.email || "" }),
    };
  });
  const l = lead as Record<string, unknown> | null;
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  await proyecto.ref.update({ lead_id: leadId, ...(l?.socio_id ? { socio_id: String(l.socio_id), socio_alta: hoy } : {}) });
  if (l?.socio_id && estadoAntes !== "ganado") await avisarEstadoAlSocio(l, leadId, "ganado", appUrl(req));
  return { ok: true, socio_id: l?.socio_id ?? null };
}

/** El admin cambia a mano el socio de un cliente (y la fecha de alta, si no tenía). */
async function socioCliente(req: VercelRequest) {
  const b = body<{ proyecto_id?: string; socio_id?: string | null; socio_alta?: string | null }>(req);
  const ref = adminDb().collection("projects").doc(texto(b.proyecto_id, 60));
  const p = await ref.get();
  if (!p.exists) throw new HttpError(404, "No encontramos el cliente");
  const socioId = b.socio_id ? texto(b.socio_id, 60) : null;
  if (socioId && !(await listarSocios()).some((s) => s.uid === socioId)) throw new HttpError(404, "No encontramos ese socio");
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.socio_alta ?? "")) ? String(b.socio_alta) : null;
  const d = p.data() ?? {};
  // La comisión es solo por clientes NUEVOS que trae el socio: no se le asigna un cliente que ya era de Prodi
  // antes de que fuera socio (dado de alta antes de que se creara su usuario).
  if (socioId && socioId !== d.socio_id) {
    const perfil = (await adminDb().collection("profiles").doc(socioId).get()).data() ?? {};
    const altaCliente = String(d.alta ?? d.created_at ?? "").slice(0, 10);
    const desdeSocio = String(perfil.created_at ?? "").slice(0, 10);
    if (altaCliente && desdeSocio && altaCliente < desdeSocio)
      throw new HttpError(409, `${d.nombre ?? "Este cliente"} ya era cliente de Prodi antes de que ${perfil.nombre ?? "este socio"} fuera socio: la comisión es solo por clientes nuevos.`);
  }
  await ref.update({
    socio_id: socioId,
    socio_alta: socioId ? fecha ?? d.socio_alta ?? String(d.alta ?? d.created_at ?? "").slice(0, 10) ?? null : null,
  });
  return { ok: true };
}

/** Ganancias del socio: la comisión de los últimos meses (lo cobrado), mes por mes. */
async function socioGanancias(caller: Caller, req: VercelRequest) {
  const b = body<{ meses?: number; uid?: string }>(req);
  const uid = caller.roles.includes("admin") && b.uid ? texto(b.uid, 60) : caller.uid;
  const n = Math.min(Math.max(Math.round(Number(b.meses) || 6), 1), 12);
  const hoy = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
  const meses = Array.from({ length: n }, (_, i) => sumarMeses(hoy, -i));
  const lista = await Promise.all(meses.map(async (m) => (await comisionesDelMes(m, uid))[0] ?? null));
  return { meses: lista.filter(Boolean) };
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
  const publica = ["aplicar", "reunion", "cupos", "crm-espera", "precios", "comprar", "sumate"].includes(accion);
  if (publica) cors(req, res);
  try {
    if (req.method === "OPTIONS" && publica) {
      res.status(204).end();
      return;
    }
    if (accion === "precios" && req.method === "GET") {
      res.status(200).json(await precios());
      return;
    }
    if (accion === "cupos" && req.method === "GET") {
      res.status(200).json(await cupos());
      return;
    }
    // Formularios de los anuncios de Prodi (api/_lib/meta-leads.ts): Meta verifica con GET y avisa con POST.
    if (accion === "meta-webhook") {
      if (req.method === "GET") res.status(200).setHeader("Content-Type", "text/plain").send(verificarWebhook(req.query as Record<string, unknown>));
      else if (req.body?.object === "whatsapp_business_account") res.status(200).json(await recibirWhatsApp(req.body, appUrl(req)));
      else res.status(200).json(await recibirWebhook(req.body, appUrl(req)));
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    if (accion.startsWith("socio-")) {
      // Socio comercial: lo suyo. Admin: asignar, dar de alta y el resumen.
      if (["socio-panel", "socio-cargar", "socio-ganancias"].includes(accion)) {
        const caller = await requireCaller(req, accion === "socio-ganancias" ? ["socio", "admin"] : ["socio"]);
        if (accion === "socio-panel") res.status(200).json(await socioPanel(caller, req));
        else if (accion === "socio-cargar") res.status(200).json(await socioCargar(caller, req));
        else res.status(200).json(await socioGanancias(caller, req));
        return;
      }
      // El resumen también lo ve administración (Pagos al equipo); lo demás, solo el admin.
      const admin = await requireCaller(req, accion === "socio-resumen" ? ["admin", "administracion"] : accion === "socio-lista" ? VENTAS : ["admin"]);
      if (accion === "socio-asignar") res.status(200).json(await socioAsignar(admin, req));
      else if (accion === "socio-alta") res.status(200).json(await socioAlta(admin, req));
      else if (accion === "socio-cliente") res.status(200).json(await socioCliente(req));
      else if (accion === "socio-resumen") {
        const mes = texto(body<{ mes?: string }>(req).mes, 7);
        res.status(200).json({ socios: await resumenSocios(mes) });
      } else if (accion === "socio-estandar") {
        const b = body<{ comision_pct?: unknown; meses?: unknown; ver?: boolean }>(req);
        res.status(200).json(b.ver ? { estandar: await comisionEstandar() } : await guardarEstandar(b));
      } else if (accion === "socio-lista") res.status(200).json({ socios: (await listarSocios()).map((x) => ({ uid: x.uid, nombre: x.nombre, activo: x.activo, codigo: x.config?.codigo ?? null })) });
      else res.status(404).json({ error: "Acción desconocida" });
      return;
    }
    // Ventas (no admin) solo toca sus leads: los que le asignaron o cargó él.
    if (LEAD_DE_VENTAS.includes(accion)) await soloSuLead(req);
    if (accion === "vendedor") res.status(200).json(await asignarVendedor(req));
    else if (accion === "aplicar") res.status(200).json(await aplicar(req));
    else if (accion === "crm-espera") res.status(200).json(await crmEspera(req));
    else if (accion === "sumate") res.status(200).json(await sumate(req));
    else if (accion === "postulante-estado") res.status(200).json(await postulanteEstado(req));
    else if (accion === "comprar") res.status(200).json(await comprar(req));
    else if (accion === "reunion") res.status(200).json(await reunion(req));
    else if (accion === "estado") res.status(200).json(await cambiar(req, "estado"));
    else if (accion === "notas") res.status(200).json(await cambiar(req, "notas"));
    else if (accion === "config") res.status(200).json(await config(req));
    else if (accion === "manual") res.status(200).json(await manual(req));
    else if (accion === "seguimiento") res.status(200).json(await seguimiento(req));
    else if (accion === "actividad") res.status(200).json(await actividad(req));
    else if (accion === "borrar") res.status(200).json(await borrarLead(req));
    else if (accion === "datos") res.status(200).json(await datos(req));
    else if (accion === "visto") res.status(200).json(await visto(req));
    else if (accion === "meta-productos") {
      const caller = await requireCaller(req, VENTAS);
      const b = body<{ id?: string; ids?: string[] }>(req);
      const id = texto(b.id, 40);
      const productos = await linksParaMandar(appUrl(req), "prodi", Array.isArray(b.ids) ? b.ids.map(String) : [], { col: "leads_web", id });
      res.status(200).json(await enviarProductos(id, productos, { uid: caller.uid, nombre: caller.nombre || caller.email || "" }));
    } else if (accion === "unir") {

      const caller = await requireCaller(req, VENTAS);

      const b = body<{ id?: string; otro?: string }>(req);

      res.status(200).json(await unirLeads(texto(b.id, 40), texto(b.otro, 40), { uid: caller.uid, nombre: caller.nombre || caller.email || "" }));

    } else if (accion === "foto") {

      await requireCaller(req, VENTAS);

      const b = body<{ id?: string; foto?: string }>(req);

      res.status(200).json(await fotoManual(texto(b.id, 40), String(b.foto ?? "")));

    } else if (accion === "wa-estado") {
      await requireCaller(req, ["admin"]);
      res.status(200).json(await estadoWhatsApp());
    } else if (accion === "wa-config") {
      await requireCaller(req, ["admin"]);
      res.status(200).json(await guardarConfigWhatsApp(String(body<{ config_id?: string }>(req).config_id ?? "")));
    } else if (accion === "wa-conectar") {
      await requireCaller(req, ["admin"]);
      res.status(200).json(await conectarWhatsApp(body<{ code?: string; waba_id?: string; phone_number_id?: string }>(req)));
    } else if (accion === "meta-sugerir") {
      await requireCaller(req, VENTAS);
      const b = body<{ id?: string; pedido?: string }>(req);
      res.status(200).json(await sugerirRespuestas(texto(b.id, 40), texto(b.pedido, 300)));
    } else if (accion === "respuestas") {
      await requireCaller(req, VENTAS);
      res.status(200).json(await guardarRespuestas(body<{ lista?: unknown }>(req).lista));
    } else if (accion === "meta-conversacion") {
      await requireCaller(req, VENTAS);
      res.status(200).json(await conversacionLead(texto(body<{ id?: string }>(req).id, 40)));
    } else if (accion === "meta-responder") {
      const caller = await requireCaller(req, VENTAS);
      const b = body<{ id?: string; texto?: string }>(req);
      res.status(200).json(await responderLead(texto(b.id, 40), String(b.texto ?? ""), { uid: caller.uid, nombre: caller.nombre || caller.email || "" }));
    } else if (accion === "meta-estado") {
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
