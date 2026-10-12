// Prodi Software (lo que era MP Socios): una sola función con todas las acciones.
//   /api/software/<accion>?id=…&client=…   (mismos filtros y cuerpos que tenía MP Socios)
//
// Quién puede:
//   · Mercado Pago (webhook-mp) y la caja de Dulce (ingest-*): sin usuario; se validan con su firma / clave.
//   · Programación: solo mirar clientes, pagos y lo suyo (mis-ganancias).
//   · Dirección (admin y administración): todo.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, requireCaller, sendError, tieneRol, type Caller } from "../_lib/http";
import { NextRequest, type NextResponse } from "../_lib/software/next-shim";
import { misGanancias } from "../_lib/software/mis-ganancias";

import * as activity from "../_lib/software/rutas/activity";
import * as apps from "../_lib/software/rutas/apps";
import * as app from "../_lib/software/rutas/app";
import * as appCleanup from "../_lib/software/rutas/app-cleanup";
import * as appClients from "../_lib/software/rutas/app-clients";
import * as appClient from "../_lib/software/rutas/app-client";
import * as appSync from "../_lib/software/rutas/app-sync";
import * as appTestWebhook from "../_lib/software/rutas/app-test-webhook";
import * as clients from "../_lib/software/rutas/clients";
import * as extras from "../_lib/software/rutas/extras";
import * as gastos from "../_lib/software/rutas/gastos";
import * as ingestMpPayment from "../_lib/software/rutas/ingest-mp-payment";
import * as ingestMpSubscription from "../_lib/software/rutas/ingest-mp-subscription";
import * as ingestMpSubscriptionVisibility from "../_lib/software/rutas/ingest-mp-subscription-visibility";
import * as liquidacion from "../_lib/software/rutas/liquidacion";
import * as mantenimientos from "../_lib/software/rutas/mantenimientos";
import * as partners from "../_lib/software/rutas/partners";
import * as payments from "../_lib/software/rutas/payments";
import * as paymentsExport from "../_lib/software/rutas/payments-export";
import * as settlements from "../_lib/software/rutas/settlements";
import * as stats from "../_lib/software/rutas/stats";
import * as subscriptions from "../_lib/software/rutas/subscriptions";
import * as subscriptionsExport from "../_lib/software/rutas/subscriptions-export";
import * as sync from "../_lib/software/rutas/sync";
import * as webhookMp from "../_lib/software/rutas/webhook-mp";

// El cuerpo crudo hace falta para validar la firma de Mercado Pago.
export const config = { maxDuration: 60, api: { bodyParser: false } };

type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse> | NextResponse;
type Modulo = Partial<Record<Metodo, Handler>>;

/** publica = sin usuario (valida su propia firma/clave) · lectura = también programación (solo GET) · direccion = admin y administración. */
type Acceso = "publica" | "lectura" | "direccion";

const ACCIONES: Record<string, { m: Modulo; acceso: Acceso }> = {
  activity: { m: activity, acceso: "direccion" },
  apps: { m: apps, acceso: "direccion" },
  app: { m: app, acceso: "direccion" },
  "app-cleanup": { m: appCleanup, acceso: "direccion" },
  "app-clients": { m: appClients, acceso: "direccion" },
  "app-client": { m: appClient, acceso: "direccion" },
  "app-sync": { m: appSync, acceso: "direccion" },
  "app-test-webhook": { m: appTestWebhook, acceso: "direccion" },
  clients: { m: clients, acceso: "lectura" },
  extras: { m: extras, acceso: "direccion" },
  gastos: { m: gastos, acceso: "direccion" },
  "ingest-mp-payment": { m: ingestMpPayment, acceso: "publica" },
  "ingest-mp-subscription": { m: ingestMpSubscription, acceso: "publica" },
  "ingest-mp-subscription-visibility": { m: ingestMpSubscriptionVisibility, acceso: "publica" },
  liquidacion: { m: liquidacion, acceso: "direccion" },
  mantenimientos: { m: mantenimientos, acceso: "direccion" },
  partners: { m: partners, acceso: "direccion" },
  payments: { m: payments, acceso: "lectura" },
  "payments-export": { m: paymentsExport, acceso: "direccion" },
  settlements: { m: settlements, acceso: "direccion" },
  stats: { m: stats, acceso: "direccion" },
  subscriptions: { m: subscriptions, acceso: "direccion" },
  "subscriptions-export": { m: subscriptionsExport, acceso: "direccion" },
  sync: { m: sync, acceso: "direccion" },
  "webhook-mp": { m: webhookMp, acceso: "publica" },
};

const esDireccion = (c: Caller) => tieneRol(c, "admin") || tieneRol(c, "administracion");

/** El cuerpo tal cual llegó (en Vercel con bodyParser apagado; en el servidor local ya viene leído). */
async function cuerpoCrudo(req: VercelRequest): Promise<string> {
  const ya = (req as unknown as { body?: unknown }).body;
  if (typeof ya === "string") return ya;
  if (Buffer.isBuffer(ya)) return ya.toString("utf8");
  if (ya && typeof ya === "object") return JSON.stringify(ya);
  if (req.method === "GET" || req.method === "HEAD") return "";
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(typeof p === "string" ? Buffer.from(p) : (p as Buffer));
  return Buffer.concat(partes).toString("utf8");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const accion = String(req.query.accion ?? "");
    if (accion === "mis-ganancias") {
      const caller = await requireCaller(req, ["admin", "administracion", "programador"]);
      res.status(200).json(await misGanancias(caller, String(req.query.mes ?? "")));
      return;
    }
    if (!Object.hasOwn(ACCIONES, accion)) throw new HttpError(404, "Acción desconocida");
    const { m, acceso } = ACCIONES[accion];
    const metodo = String(req.method ?? "GET").toUpperCase() as Metodo;
    const fn = m[metodo];
    if (!fn) throw new HttpError(405, "Método no permitido");

    if (acceso !== "publica") {
      const caller = await requireCaller(req, ["admin", "administracion", "programador"]);
      const permitido = esDireccion(caller) || (acceso === "lectura" && metodo === "GET");
      if (!permitido) throw new HttpError(403, "No tenés permiso para esta acción");
    }

    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost");
    const proto = String(req.headers["x-forwarded-proto"] ?? "https");
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const nreq = new NextRequest(`${proto}://${host}${req.url ?? ""}`, metodo, headers, await cuerpoCrudo(req));
    const params: Record<string, string> = {};
    if (typeof req.query.id === "string") params.id = req.query.id;
    if (typeof req.query.client === "string") params.clientId = req.query.client;
    if (typeof req.query.app === "string") params.appId = req.query.app;

    const r = await fn(nreq, { params: Promise.resolve(params) });
    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(r.body);
  } catch (err) {
    sendError(res, err);
  }
}
