// Demo en vivo (módulo de un cliente, ej. DS Ingeniería): la empresa muestra en vivo, con celulares como cámaras,
// cómo su máquina hace una pieza real para un lead. Todo lo maneja el cliente desde su panel; Prodi no interviene.
//
// Los videos van directo entre los celulares y quien mira (WebRTC): Prodi solo los presenta (señales oferta /
// respuesta) y lleva quién está adentro y el chat. Todo por /api/publico/demo-* (el lead y las cámaras no tienen
// usuario: entran con un link firmado).
//
// Con usuario (cliente del proyecto, su productora o admin):
//   demo-lista { proyecto_id } · demo-crear { proyecto_id, titulo, fecha? } · demo-borrar { demo_id }
//   demo-estado { demo_id, estado: "en_vivo" | "terminada" } · demo-presentar { demo_id } (entra a transmitir)
//   demo-activar { proyecto_id, activo } (solo admin: prende el módulo en el cliente)
// Sin usuario:
//   demo-ver { t } · demo-entrar { t, nombre } (lead) · demo-camara { c, cam, nombre } (celular cámara)
//   demo-latido { d, pid, llave, desde } · demo-senal { d, pid, llave, para, tipo, data }
//   demo-mensaje { d, pid, llave, texto } · demo-interes { d, pid, llave, contacto? } · demo-salir { d, pid, llave }

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { adminDb, getPool } from "./db";
import { appUrl, assertProjectAccess, body, HttpError, requireCaller, type Caller } from "./http";
import { enviarAviso } from "./notify";

const COL = "demos_vivo";
/** Si alguien deja de avisar que sigue (cerró la pestaña, se cortó), a los 20 s deja de figurar. */
const VIGENCIA_S = 20;

type Estado = "programada" | "en_vivo" | "terminada";
type Tipo = "camara" | "presentador" | "lead";

interface Demo {
  proyecto_id: string;
  titulo: string;
  fecha: string | null;
  estado: Estado;
  creada_por: string;
  creada_por_nombre: string;
  created_at: string;
  inicio_at?: string | null;
  fin_at?: string | null;
  /** Leads que entraron (nombre y cuándo), para verlo después. */
  visitas?: { nombre: string; at: string }[];
  /** Leads que tocaron "Quiero cotizar". */
  interesados?: { nombre: string; contacto: string; at: string }[];
}

// ---- Firmas: los links y la llave de cada participante no se pueden inventar sin la clave del servidor ----
function clave(): string {
  const k = process.env.TOKEN_ENCRYPTION_KEY || process.env.CRON_SECRET;
  if (!k) throw new HttpError(500, "Falta configurar la clave del servidor");
  return k;
}
const firmar = (s: string) => createHmac("sha256", clave()).update(`demo-vivo:${s}`).digest("base64url").slice(0, 24);
function igual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;

/** Link del lead: /vivo/<demo>.<firma> */
const tokenLead = (demoId: string) => `${demoId}.${firmar(`lead:${demoId}`)}`;
function leerTokenLead(t: string): string {
  const [id, f] = String(t ?? "").split(".");
  if (!id || !f || !ID_OK.test(id) || !igual(f, firmar(`lead:${id}`))) throw new HttpError(404, "Este link no existe o está mal copiado");
  return id;
}
/** Link de las cámaras del cliente: /camara/<proyecto>.<versión>.<firma> (la versión cambia si se renueva). */
const tokenCamara = (proyectoId: string, v: number) => `${proyectoId}.${v}.${firmar(`cam:${proyectoId}:${v}`)}`;
async function leerTokenCamara(c: string): Promise<string> {
  const [pid, v, f] = String(c ?? "").split(".");
  if (!pid || !v || !f || !ID_OK.test(pid) || !igual(f, firmar(`cam:${pid}:${v}`))) throw new HttpError(404, "Este link de cámara no es válido");
  const p = (await adminDb().collection("projects").doc(pid).get()).data();
  if (!p || p.demo_vivo_activo !== true) throw new HttpError(403, "La demo en vivo no está activa para esta empresa");
  if (String(p.demo_camaras_v ?? 1) !== v) throw new HttpError(403, "Este link de cámara se renovó: escaneá el QR nuevo");
  return pid;
}
const llaveDe = (demoId: string, pid: string) => firmar(`p:${demoId}:${pid}`);

// ---- Tablas de lo que pasa en vivo (se crean solas la primera vez) ----
let tablas: Promise<unknown> | null = null;
function asegurarTablas() {
  tablas ??= (async () => {
    const pool = getPool();
    await pool.query(
      "create table if not exists demo_part (demo_id text not null, pid text not null, tipo text not null, nombre text not null default '', desde timestamptz not null default now(), hasta timestamptz not null, primary key (demo_id, pid))"
    );
    await pool.query(
      "create table if not exists demo_senal (id bigserial primary key, demo_id text not null, de text not null, para text not null, tipo text not null, data jsonb not null default '{}', creado timestamptz not null default now())"
    );
    await pool.query("create index if not exists demo_senal_para on demo_senal (demo_id, para)");
    await pool.query(
      "create table if not exists demo_msg (id bigserial primary key, demo_id text not null, pid text not null, nombre text not null default '', tipo text not null default 'texto', texto text not null, creado timestamptz not null default now())"
    );
    await pool.query("create index if not exists demo_msg_demo on demo_msg (demo_id, id)");
  })().catch((e) => {
    tablas = null;
    throw e;
  });
  return tablas;
}

async function presencia(demoId: string, pid: string, tipo: Tipo, nombre: string) {
  await getPool().query(
    `insert into demo_part (demo_id, pid, tipo, nombre, hasta) values ($1, $2, $3, $4, now() + make_interval(secs => $5))
     on conflict (demo_id, pid) do update set tipo = excluded.tipo, nombre = excluded.nombre, hasta = excluded.hasta,
       desde = case when demo_part.hasta < now() then now() else demo_part.desde end`,
    [demoId, pid, tipo, nombre.slice(0, 60), VIGENCIA_S]
  );
}
/** Avisos en el chat. "privado": solo lo ve la empresa (quién entró, quién quiere cotizar y su contacto). */
async function mensajeSistema(demoId: string, texto: string, privado = false) {
  await getPool().query("insert into demo_msg (demo_id, pid, nombre, tipo, texto) values ($1, '', '', $2, $3)", [demoId, privado ? "privado" : "sistema", texto.slice(0, 300)]);
}

async function leerDemo(id: string): Promise<Demo> {
  if (!ID_OK.test(id)) throw new HttpError(400, "Demo inválida");
  const d = (await adminDb().collection(COL).doc(id).get()).data() as Demo | undefined;
  if (!d) throw new HttpError(404, "Esta demo ya no existe");
  return d;
}

/** Cliente del proyecto, su productora o admin; y el módulo prendido. */
async function puedeManejar(caller: Caller, proyectoId: string) {
  if (!proyectoId || !ID_OK.test(proyectoId)) throw new HttpError(400, "Falta la empresa");
  await assertProjectAccess(caller, proyectoId);
  const p = (await adminDb().collection("projects").doc(proyectoId).get()).data();
  if (!p) throw new HttpError(404, "Cliente no encontrado");
  if (p.demo_vivo_activo !== true) throw new HttpError(403, "La demo en vivo no está activa para esta empresa");
  return p;
}

function vistaDemo(id: string, d: Demo, base: string) {
  return {
    id,
    titulo: d.titulo,
    fecha: d.fecha,
    estado: d.estado,
    creada_por_nombre: d.creada_por_nombre,
    created_at: d.created_at,
    inicio_at: d.inicio_at ?? null,
    fin_at: d.fin_at ?? null,
    visitas: d.visitas ?? [],
    interesados: d.interesados ?? [],
    link: `${base}/vivo/${tokenLead(id)}`,
  };
}

// ---------------------------------------------------------------------------
// Con usuario
// ---------------------------------------------------------------------------

async function lista(caller: Caller, b: { proyecto_id?: string }, base: string) {
  const proyectoId = String(b.proyecto_id ?? "");
  const p = await puedeManejar(caller, proyectoId);
  const snap = await adminDb().collection(COL).where("proyecto_id", "==", proyectoId).get();
  const demos = snap.docs
    .map((x) => vistaDemo(x.id, x.data() as Demo, base))
    .sort((a, b) => (b.fecha ?? b.created_at).localeCompare(a.fecha ?? a.created_at));
  await asegurarTablas();
  const camaras = await getPool().query("select pid, nombre from demo_part where demo_id = $1 and hasta > now() order by nombre", [`cam:${proyectoId}`]);
  return {
    demos,
    camara_link: `${base}/camara/${tokenCamara(proyectoId, Number(p.demo_camaras_v ?? 1))}`,
    camaras: camaras.rows as { pid: string; nombre: string }[],
  };
}

async function crear(caller: Caller, b: { proyecto_id?: string; titulo?: string; fecha?: string | null }, base: string) {
  const proyectoId = String(b.proyecto_id ?? "");
  await puedeManejar(caller, proyectoId);
  const titulo = String(b.titulo ?? "").trim().slice(0, 120);
  if (!titulo) throw new HttpError(400, "Ponele un nombre a la demo");
  const fecha = b.fecha && !Number.isNaN(Date.parse(b.fecha)) ? new Date(b.fecha).toISOString() : null;
  const d: Demo = {
    proyecto_id: proyectoId,
    titulo,
    fecha,
    estado: "programada",
    creada_por: caller.uid,
    creada_por_nombre: caller.nombre ?? "",
    created_at: new Date().toISOString(),
    visitas: [],
    interesados: [],
  };
  const ref = await adminDb().collection(COL).add(d);
  return { demo: vistaDemo(ref.id, d, base) };
}

async function demoConPermiso(caller: Caller, demoId: string) {
  const d = await leerDemo(demoId);
  await puedeManejar(caller, d.proyecto_id);
  return d;
}

async function cambiarEstado(caller: Caller, b: { demo_id?: string; estado?: string }) {
  const id = String(b.demo_id ?? "");
  const d = await demoConPermiso(caller, id);
  const ahora = new Date().toISOString();
  if (b.estado === "en_vivo") {
    // Una sola demo en vivo por empresa: las cámaras se suman a esa.
    const otras = await adminDb().collection(COL).where("proyecto_id", "==", d.proyecto_id).where("estado", "==", "en_vivo").get();
    for (const o of otras.docs) if (o.id !== id) await o.ref.update({ estado: "terminada", fin_at: ahora });
    await adminDb().collection(COL).doc(id).update({ estado: "en_vivo", inicio_at: d.inicio_at ?? ahora, fin_at: null });
    await asegurarTablas();
    await mensajeSistema(id, "Empezó la demo");
  } else if (b.estado === "terminada") {
    await adminDb().collection(COL).doc(id).update({ estado: "terminada", fin_at: ahora });
    await asegurarTablas();
    await getPool().query("delete from demo_part where demo_id = $1", [id]);
    await getPool().query("delete from demo_senal where demo_id = $1", [id]);
  } else throw new HttpError(400, "Estado inválido");
  return { ok: true };
}

async function borrar(caller: Caller, b: { demo_id?: string }) {
  const id = String(b.demo_id ?? "");
  const d = await demoConPermiso(caller, id);
  if (d.estado === "en_vivo") throw new HttpError(409, "Terminá la demo antes de borrarla");
  await adminDb().collection(COL).doc(id).delete();
  return { ok: true };
}

async function presentar(caller: Caller, b: { demo_id?: string }) {
  const id = String(b.demo_id ?? "");
  const d = await demoConPermiso(caller, id);
  if (d.estado === "terminada") throw new HttpError(409, "Esta demo ya terminó");
  await asegurarTablas();
  const pid = `p-${caller.uid}`.slice(0, 80);
  await presencia(id, pid, "presentador", caller.nombre || "Presentador");
  return { d: id, pid, llave: llaveDe(id, pid), titulo: d.titulo, estado: d.estado };
}

async function activar(caller: Caller, b: { proyecto_id?: string; activo?: boolean; renovar_camaras?: boolean }) {
  if (!caller.roles.includes("admin")) throw new HttpError(403, "Solo el super admin prende la demo en vivo");
  const id = String(b.proyecto_id ?? "");
  const ref = adminDb().collection("projects").doc(id);
  const p = (await ref.get()).data();
  if (!p) throw new HttpError(404, "Cliente no encontrado");
  const cambios: Record<string, unknown> = {};
  if (typeof b.activo === "boolean") cambios.demo_vivo_activo = b.activo;
  if (b.renovar_camaras) cambios.demo_camaras_v = Number(p.demo_camaras_v ?? 1) + 1;
  await ref.update(cambios);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sin usuario (lead y cámaras)
// ---------------------------------------------------------------------------

async function nombreEmpresa(proyectoId: string) {
  const p = (await adminDb().collection("projects").doc(proyectoId).get()).data();
  return { empresa: String(p?.nombre ?? ""), color: (p?.color as string | undefined) ?? null };
}

async function ver(b: { t?: string }) {
  const id = leerTokenLead(String(b.t ?? ""));
  const d = await leerDemo(id);
  return { titulo: d.titulo, fecha: d.fecha, estado: d.estado, ...(await nombreEmpresa(d.proyecto_id)) };
}

async function entrar(b: { t?: string; nombre?: string }) {
  const id = leerTokenLead(String(b.t ?? ""));
  const d = await leerDemo(id);
  const nombre = String(b.nombre ?? "").trim().slice(0, 60);
  if (!nombre) throw new HttpError(400, "Poné tu nombre para entrar");
  if (d.estado === "terminada") throw new HttpError(409, "Esta demo ya terminó");
  await asegurarTablas();
  const pid = `l-${randomBytes(6).toString("hex")}`;
  await presencia(id, pid, "lead", nombre);
  const visitas = [...(d.visitas ?? []), { nombre, at: new Date().toISOString() }].slice(-200);
  await adminDb().collection(COL).doc(id).update({ visitas });
  await mensajeSistema(id, `${nombre} entró`, true);
  return { d: id, pid, llave: llaveDe(id, pid), titulo: d.titulo, estado: d.estado, ...(await nombreEmpresa(d.proyecto_id)) };
}

/** El celular cámara avisa que está prendido; si hay una demo en vivo de la empresa, se suma. */
async function camara(b: { c?: string; cam?: string; nombre?: string }) {
  const proyectoId = await leerTokenCamara(String(b.c ?? ""));
  const cam = String(b.cam ?? "");
  if (!/^[a-z0-9]{6,20}$/.test(cam)) throw new HttpError(400, "Cámara inválida");
  const nombre = String(b.nombre ?? "").trim().slice(0, 40) || "Cámara";
  await asegurarTablas();
  const pid = `c-${cam}`;
  await presencia(`cam:${proyectoId}`, pid, "camara", nombre);
  const enVivo = await adminDb().collection(COL).where("proyecto_id", "==", proyectoId).where("estado", "==", "en_vivo").get();
  const demo = enVivo.docs[0];
  const empresa = (await nombreEmpresa(proyectoId)).empresa;
  if (!demo) return { demo: null, empresa };
  await presencia(demo.id, pid, "camara", nombre);
  return { demo: { d: demo.id, pid, llave: llaveDe(demo.id, pid), titulo: (demo.data() as Demo).titulo }, empresa };
}

interface Credencial {
  d?: string;
  pid?: string;
  llave?: string;
}
async function credencial(b: Credencial) {
  const d = String(b.d ?? "");
  const pid = String(b.pid ?? "");
  if (!ID_OK.test(d) || !ID_OK.test(pid) || !igual(String(b.llave ?? ""), llaveDe(d, pid))) throw new HttpError(403, "No estás en esta demo");
  await asegurarTablas();
  return { d, pid };
}

async function latido(b: Credencial & { desde?: number }) {
  const { d, pid } = await credencial(b);
  const pool = getPool();
  const demo = (await adminDb().collection(COL).doc(d).get()).data() as Demo | undefined;
  const estado: Estado = demo?.estado ?? "terminada";
  if (estado === "terminada") return { estado, participantes: [], senales: [], mensajes: [] };
  const yo = await pool.query("update demo_part set hasta = now() + make_interval(secs => $3) where demo_id = $1 and pid = $2 returning tipo", [d, pid, VIGENCIA_S]);
  if (!yo.rowCount) return { estado, fuera: true, participantes: [], senales: [], mensajes: [] };
  // Las cámaras siguen figurando como prendidas en el panel de la empresa mientras están en una demo.
  if (yo.rows[0].tipo === "camara" && demo) {
    await pool.query("update demo_part set hasta = now() + make_interval(secs => $3) where demo_id = $1 and pid = $2", [`cam:${demo.proyecto_id}`, pid, VIGENCIA_S]);
  }
  const [part, senales, msgs] = await Promise.all([
    pool.query("select pid, tipo, nombre from demo_part where demo_id = $1 and hasta > now() order by desde", [d]),
    pool.query("delete from demo_senal where demo_id = $1 and para = $2 and creado > now() - interval '1 minute' returning de, tipo, data", [d, pid]),
    // Los leads no ven los avisos privados (quién más entró, quién quiere cotizar y su contacto).
    pool.query("select id, pid, nombre, tipo, texto, creado from demo_msg where demo_id = $1 and id > $2 and (tipo <> 'privado' or $3 <> 'lead') order by id limit 100", [
      d,
      Number(b.desde) || 0,
      yo.rows[0].tipo,
    ]),
  ]);
  return {
    estado,
    participantes: part.rows as { pid: string; tipo: Tipo; nombre: string }[],
    senales: senales.rows as { de: string; tipo: string; data: unknown }[],
    mensajes: (msgs.rows as { id: string; pid: string; nombre: string; tipo: string; texto: string; creado: string }[]).map((m) => ({ ...m, id: Number(m.id) })),
  };
}

async function senal(b: Credencial & { para?: string; tipo?: string; data?: unknown }) {
  const { d, pid } = await credencial(b);
  const para = String(b.para ?? "");
  const tipo = String(b.tipo ?? "");
  if (!ID_OK.test(para) || !["oferta", "respuesta", "chau"].includes(tipo)) throw new HttpError(400, "Señal inválida");
  const data = JSON.stringify(b.data ?? {});
  if (data.length > 60_000) throw new HttpError(413, "Señal muy grande");
  const pool = getPool();
  await pool.query("delete from demo_senal where creado < now() - interval '2 minutes'");
  await pool.query("insert into demo_senal (demo_id, de, para, tipo, data) values ($1, $2, $3, $4, $5::jsonb)", [d, pid, para, tipo, data]);
  return { ok: true };
}

async function mensaje(b: Credencial & { texto?: string }) {
  const { d, pid } = await credencial(b);
  const texto = String(b.texto ?? "").trim().slice(0, 500);
  if (!texto) throw new HttpError(400, "Mensaje vacío");
  const r = await getPool().query("select nombre from demo_part where demo_id = $1 and pid = $2", [d, pid]);
  if (!r.rowCount) throw new HttpError(403, "No estás en esta demo");
  await getPool().query("insert into demo_msg (demo_id, pid, nombre, texto) values ($1, $2, $3, $4)", [d, pid, r.rows[0].nombre, texto]);
  return { ok: true };
}

async function interes(b: Credencial & { contacto?: string }, base: string) {
  const { d, pid } = await credencial(b);
  const r = await getPool().query("select nombre from demo_part where demo_id = $1 and pid = $2", [d, pid]);
  const nombre = String(r.rows[0]?.nombre ?? "Alguien");
  const contacto = String(b.contacto ?? "").trim().slice(0, 80);
  const demo = await leerDemo(d);
  const interesados = [...(demo.interesados ?? []), { nombre, contacto, at: new Date().toISOString() }].slice(-100);
  await adminDb().collection(COL).doc(d).update({ interesados });
  await mensajeSistema(d, `🔥 ${nombre} quiere cotizar${contacto ? ` (${contacto})` : ""}`, true);
  // Aviso a la gente de la empresa (no frena si falla).
  const p = (await adminDb().collection("projects").doc(demo.proyecto_id).get()).data();
  const destinatarios = ((p?.team_roles?.cliente as string[] | undefined) ?? []).filter(Boolean);
  if (destinatarios.length) {
    await enviarAviso(
      {
        destinatarios,
        titulo: `${nombre} quiere cotizar`,
        cuerpo: `Lo pidió durante la demo «${demo.titulo}».${contacto ? ` Contacto: ${contacto}` : ""}`,
        link: "/cliente?tab=demo",
        clave: `demo-interes:${d}:${pid}`,
        proyectoId: demo.proyecto_id,
      },
      base
    ).catch((e) => console.warn("[demo] aviso", e));
  }
  return { ok: true };
}

async function salir(b: Credencial) {
  const { d, pid } = await credencial(b);
  await getPool().query("delete from demo_part where demo_id = $1 and pid = $2", [d, pid]);
  return { ok: true };
}

export async function demoVivo(req: VercelRequest, accion: string): Promise<unknown> {
  const b = body<Record<string, unknown>>(req);
  const base = appUrl(req);
  switch (accion) {
    case "demo-ver":
      return ver(b);
    case "demo-entrar":
      return entrar(b);
    case "demo-camara":
      return camara(b);
    case "demo-latido":
      return latido(b);
    case "demo-senal":
      return senal(b);
    case "demo-mensaje":
      return mensaje(b);
    case "demo-interes":
      return interes(b, base);
    case "demo-salir":
      return salir(b);
  }
  const caller = await requireCaller(req, ["admin", "productor", "cliente"]);
  switch (accion) {
    case "demo-lista":
      return lista(caller, b, base);
    case "demo-crear":
      return crear(caller, b, base);
    case "demo-estado":
      return cambiarEstado(caller, b);
    case "demo-borrar":
      return borrar(caller, b);
    case "demo-presentar":
      return presentar(caller, b);
    case "demo-activar":
      return activar(caller, b);
  }
  throw new HttpError(404, "Acción desconocida");
}
