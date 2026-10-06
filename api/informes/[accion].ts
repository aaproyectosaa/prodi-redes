// POST /api/informes/enviar  { proyecto_id, mes, solo_vista }  (admin)
// GET  /api/informes/cron    (Vercel Cron, día 1 de cada mes)
// GET  /api/informes/diario  (Vercel Cron, todos los días: resultados de Meta, aviso de rodaje
//                              y recordatorios al cliente que no aprobó en 48 h)
// POST /api/informes/meta    { video_id }  (equipo) → trae ya los resultados de Meta

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, getPool } from "../_lib/db";
import { appUrl, body, HttpError, requireCaller, sendError } from "../_lib/http";
import { construirInforme, enviarMail, mesAnteriorAR } from "../_lib/informe";
import { sincronizarTodoMeta, sincronizarVideoMeta } from "../_lib/meta";
import { facturacionDel27, recordatoriosCobro, vencimientosObligaciones, recordatoriosAprobacion, recordatoriosPlan, recordatoriosRodaje } from "../_lib/diario";
import { assertProjectAccess } from "../_lib/http";

export const config = { maxDuration: 120 };

async function registrar(proyectoId: string, mes: string, destinatarios: string[], resumen: unknown, por: string) {
  await adminDb()
    .collection("informes")
    .doc(`${proyectoId}_${mes}`)
    .set({ proyecto_id: proyectoId, mes, destinatarios, resumen, enviado_at: new Date().toISOString(), enviado_por: por }, { merge: true });
}

async function enviar(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin"]);
  const b = body<{ proyecto_id?: string; mes?: string; solo_vista?: boolean }>(req);
  if (!b.proyecto_id || !/^\d{4}-\d{2}$/.test(String(b.mes))) throw new HttpError(400, "Datos incompletos");
  const inf = await construirInforme(b.proyecto_id, String(b.mes), appUrl(req));
  if (b.solo_vista) return { html: inf.html };
  if (!inf.destinatarios.length) throw new HttpError(409, "El cliente no tiene correos cargados");
  await enviarMail(inf.destinatarios, inf.asunto, inf.html);
  await registrar(inf.proyectoId, inf.mes, inf.destinatarios, inf.resumen, caller.uid);
  return { ok: true, enviados: inf.destinatarios };
}

function assertCron(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, "No autorizado");
}

async function meta(req: VercelRequest) {
  const caller = await requireCaller(req, ["admin", "productor", "pauta"]);
  const { video_id } = body<{ video_id?: string }>(req);
  if (!video_id) throw new HttpError(400, "Falta video_id");
  const v = (await adminDb().collection("videos").doc(video_id).get()).data();
  if (!v) throw new HttpError(404, "Video no encontrado");
  await assertProjectAccess(caller, v.proyecto_id);
  try {
    const resultados = await sincronizarVideoMeta(video_id);
    if (!resultados) throw new Error("Meta todavía no tiene datos de ese anuncio (o el ID no es correcto)");
    return { ok: true, resultados };
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : "Meta no respondió");
  }
}

async function diario(req: VercelRequest) {
  assertCron(req);
  const base = appUrl(req);
  const [metaRes, rodajes, aprobar, planes, facturacion, vencimientos, cobros] = await Promise.all([
    sincronizarTodoMeta().catch((err) => ({ error: String(err) })),
    recordatoriosRodaje(base).catch((err) => `error: ${err}`),
    recordatoriosAprobacion(base).catch((err) => `error: ${err}`),
    recordatoriosPlan(base).catch((err) => `error: ${err}`),
    facturacionDel27(base).catch((err) => `error: ${err}`),
    vencimientosObligaciones(base).catch((err) => `error: ${err}`),
    recordatoriosCobro(base).catch((err) => `error: ${err}`),
  ]);
  // Lo borrado se anota unos días para que las pantallas abiertas se enteren; después se limpia.
  await getPool().query("delete from borrados where borrado < now() - interval '7 days'").catch(() => undefined);
  return { ok: true, meta: metaRes, recordatorios_rodaje: rodajes, recordatorios_aprobar: aprobar, recordatorios_plan: planes, facturacion, vencimientos, recordatorios_cobro: cobros };
}

async function cron(req: VercelRequest) {
  assertCron(req);
  const db = adminDb();
  const settings = (await db.collection("app_settings").doc("redes").get()).data() ?? {};
  if (settings.informe_automatico === false) return { ok: true, omitido: "desactivado" };

  const mes = mesAnteriorAR();
  const base = appUrl(req);
  const projects = await db.collection("projects").get();
  const resultado: { cliente: string; estado: string }[] = [];

  for (const d of projects.docs) {
    const p = d.data();
    if (p.enabled === false) continue;
    const emails = (p.contacto_emails ?? []) as string[];
    if (!emails.length) continue;
    const ya = await db.collection("informes").doc(`${d.id}_${mes}`).get();
    if (ya.exists && ya.data()?.enviado_at) {
      resultado.push({ cliente: p.nombre, estado: "ya enviado" });
      continue;
    }
    try {
      const inf = await construirInforme(d.id, mes, base);
      if (inf.resumen.planificados === 0 && inf.resumen.publicados === 0) {
        resultado.push({ cliente: p.nombre, estado: "sin videos" });
        continue;
      }
      await enviarMail(inf.destinatarios, inf.asunto, inf.html);
      await registrar(d.id, mes, inf.destinatarios, inf.resumen, "cron");
      resultado.push({ cliente: p.nombre, estado: "enviado" });
    } catch (err) {
      console.error("[informes/cron]", p.nombre, err);
      resultado.push({ cliente: p.nombre, estado: `error: ${err instanceof Error ? err.message : err}` });
    }
  }
  return { ok: true, mes, resultado };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const accion = String(req.query.accion ?? "");
    if (accion === "cron") res.status(200).json(await cron(req));
    else if (accion === "diario") res.status(200).json(await diario(req));
    else if (accion === "meta" && req.method === "POST") res.status(200).json(await meta(req));
    else if (accion === "enviar" && req.method === "POST") res.status(200).json(await enviar(req));
    else res.status(404).json({ error: "Acción desconocida" });
  } catch (err) {
    sendError(res, err);
  }
}
