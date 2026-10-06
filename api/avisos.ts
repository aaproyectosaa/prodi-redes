// POST /api/avisos — aviso in-app + push + WhatsApp a uno o más usuarios.
// Lo llama la app cuando un video cambia de etapa.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "./_lib/db";
import { appUrl, body, HttpError, requireCaller, sendError } from "./_lib/http";
import { enviarAviso, usuariosConRol } from "./_lib/notify";
import { crearTokenAprobacion } from "./_lib/aprobacion";

export const config = { maxDuration: 30 };

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
