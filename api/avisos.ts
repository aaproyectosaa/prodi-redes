// POST /api/avisos — aviso in-app + push + correo a uno o más usuarios.
// Lo llama la app cuando un video cambia de etapa. El cliente solo puede mandar los de chat y reuniones.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "./_lib/db";
import { appUrl, body, HttpError, requireCaller, sendError, type Caller } from "./_lib/http";
import { enviarAviso, usuariosConRol, type AvisoServer } from "./_lib/notify";
import { crearTokenAprobacion } from "./_lib/aprobacion";

export const config = { maxDuration: 30 };

const ZONA_AR = "America/Argentina/Buenos_Aires";
const fechaHoraAR = (iso: unknown) => {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", { timeZone: ZONA_AR, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
};

/**
 * Avisos que puede disparar un cliente. Tipos permitidos (por la clave):
 *  - chat:<chatId>      → mensaje nuevo: a los miembros del chat, con el último mensaje que mandó él.
 *  - reunion:<id>       → reunión que creó él: a los participantes que son de su cliente (o admins).
 * Las aprobaciones de videos y piezas las avisa el servidor (/api/publico/*-cliente).
 */
async function avisoDelCliente(caller: Caller, b: Body): Promise<AvisoServer> {
  const db = adminDb();
  const pedidos = new Set((Array.isArray(b.destinatarios) ? b.destinatarios : []).filter((x) => typeof x === "string"));
  pedidos.delete(caller.uid);
  const clave = String(b.clave ?? "");
  const [tipo, id] = [clave.slice(0, clave.indexOf(":")), clave.slice(clave.indexOf(":") + 1)];
  if (!id || id.includes("/")) throw new HttpError(400, "Aviso no permitido");

  if (tipo === "chat") {
    const chat = (await db.collection("chats").doc(id).get()).data();
    const miembros: string[] = Array.isArray(chat?.miembros) ? chat!.miembros : [];
    if (!chat || !miembros.includes(caller.uid)) throw new HttpError(403, "No sos parte de este chat");
    // Solo el mensaje que acaba de mandar (lo que ya ven en el chat).
    const ultimo = chat.ultimo as { texto?: string; by?: string } | null;
    if (!ultimo || ultimo.by !== caller.uid || typeof ultimo.texto !== "string") throw new HttpError(409, "No hay mensaje nuevo");
    const texto = ultimo.texto.slice(0, 140);
    const nombre = caller.nombre || "Mensaje nuevo";
    const llamada = texto.startsWith("Videollamada:");
    return {
      destinatarios: miembros.filter((m) => pedidos.has(m)),
      titulo: llamada ? `${nombre} te invita a una videollamada` : chat.tipo === "directo" ? nombre : String(chat.nombre ?? "Chat").slice(0, 120),
      cuerpo: chat.tipo === "directo" ? texto : `${caller.nombre}: ${texto.slice(0, 120)}`,
      link: `/chat?c=${id}`,
      clave: `chat:${id}`,
      proyectoId: (chat.proyecto_id as string | null) ?? null,
      videoId: null,
    };
  }

  if (tipo === "reunion") {
    const r = (await db.collection("reuniones").doc(id).get()).data();
    if (!r || r.creada_por !== caller.uid || typeof r.proyecto_id !== "string") throw new HttpError(403, "Aviso no permitido");
    const p = (await db.collection("projects").doc(r.proyecto_id).get()).data();
    const team = (p?.team_roles ?? {}) as Record<string, string[]>;
    if (!(team.cliente ?? []).includes(caller.uid)) throw new HttpError(403, "Sin acceso a este cliente");
    const validos = new Set(Object.values(team).flat());
    const admins = await db.collection("profiles").where("role", "in", ["admin", "diseno", "administracion"]).get();
    admins.docs.forEach((d) => validos.add(d.id));
    const participantes: string[] = Array.isArray(r.participantes) ? r.participantes : [];
    const ahora = Math.abs(new Date(String(r.fecha)).getTime() - Date.now()) < 10 * 60_000;
    const cuando = fechaHoraAR(r.fecha);
    return {
      destinatarios: participantes.filter((u) => pedidos.has(u) && validos.has(u)),
      titulo: ahora ? `${caller.nombre || "Tu cliente"} te invita a una videollamada` : "Reunión agendada",
      cuerpo: `${String(r.titulo ?? "Reunión").slice(0, 120)}${cuando ? ` · ${cuando}` : ""}`,
      link: `/reuniones?r=${id}`,
      clave: `reunion:${id}`,
      proyectoId: r.proyecto_id,
      videoId: null,
    };
  }

  throw new HttpError(403, "Aviso no permitido");
}

interface Body {
  destinatarios?: string[];
  titulo?: string;
  cuerpo?: string;
  link?: string;
  clave?: string;
  proyectoId?: string | null;
  videoId?: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const caller = await requireCaller(req, ["admin", "productor", "editor", "pauta", "diseno", "administracion", "cliente"]);
    const b = body<Body>(req);
    // Mensajes del chat (de cualquiera): a los miembros, con el texto que arma el servidor. Así también
    // funcionan los privados y los grupos, que no son de un cliente.
    if (caller.role === "cliente" || String(b.clave ?? "").startsWith("chat:")) {
      // El cliente no arma avisos a mano (salen también por correo con la marca de Prodi): solo los de
      // chat y reuniones, con el texto que arma el servidor y a quienes corresponde.
      const aviso = await avisoDelCliente(caller, b);
      if (aviso.destinatarios.length) await enviarAviso(aviso, appUrl(req));
      res.status(200).json({ ok: true, enviados: aviso.destinatarios.length });
      return;
    }
    const pedidos = Array.isArray(b.destinatarios) ? b.destinatarios.filter((x) => typeof x === "string") : [];
    // "rol:diseno" = todas las personas de diseño (el cliente no puede ver los perfiles del equipo).
    const porRol = pedidos.filter((d) => d === "rol:diseno").length ? await usuariosConRol(["diseno"]) : [];
    const destinatarios = [...pedidos.filter((d) => !d.startsWith("rol:")), ...porRol];
    const titulo = String(b.titulo ?? "").slice(0, 120).trim();
    const cuerpo = String(b.cuerpo ?? "").slice(0, 400).trim();
    const link = String(b.link ?? "/").startsWith("/") ? String(b.link) : "/";
    const clave = String(b.clave ?? "").slice(0, 200);
    if (!pedidos.length || !titulo || !clave) throw new HttpError(400, "Faltan datos del aviso");

    // Solo se puede avisar a gente del mismo cliente (o a los admins). Los que no
    // corresponden se descartan en silencio para no perder el resto del aviso.
    let permitidos = destinatarios;
    if (caller.role !== "admin") {
      if (!b.proyectoId) throw new HttpError(400, "Falta el cliente");
      const p = await adminDb().collection("projects").doc(b.proyectoId).get();
      const team = (p.data()?.team_roles ?? {}) as Record<string, string[]>;
      const miembros = new Set(Object.values(team).flat());
      // Diseño trabaja con todos los clientes sin estar asignado.
      if (!miembros.has(caller.uid) && caller.role !== "diseno" && caller.role !== "administracion") throw new HttpError(403, "Sin acceso a este cliente");
      const globales = await adminDb().collection("profiles").where("role", "in", ["admin", "diseno", "administracion"]).get();
      globales.docs.forEach((d) => miembros.add(d.id));
      permitidos = destinatarios.filter((d) => miembros.has(d));
    }
    if (!permitidos.length) {
      res.status(200).json({ ok: true, enviados: 0 });
      return;
    }

    // Video para aprobar: el cliente recibe un link directo, sin tener que entrar al sistema.
    let destino = link;
    if (clave.startsWith("revision_cliente:") && b.videoId && caller.role !== "cliente") {
      const v = (await adminDb().collection("videos").doc(String(b.videoId)).get()).data();
      if (v && v.proyecto_id === b.proyectoId && v.etapa === "revision_cliente") {
        try {
          destino = `/aprobar/${crearTokenAprobacion(String(b.videoId), v.rondas ?? 0)}`;
        } catch (err) {
          console.warn("[avisos] sin secreto para links de aprobación", err);
        }
      }
    }

    await enviarAviso(
      { destinatarios: permitidos, titulo, cuerpo, link: destino, clave, proyectoId: b.proyectoId ?? null, videoId: b.videoId ?? null },
      appUrl(req)
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
