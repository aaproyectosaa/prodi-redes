// Cambios de etapa que hace el servidor (aprobación del cliente desde el link).

import { FieldValue } from "./db";
import { HttpError } from "./auth";
import { adminDb } from "./db";
import { enviarAviso } from "./notify";

export interface VideoPublico {
  id: string;
  titulo: string;
  cliente: { nombre: string; color: string };
  estado: "para_aprobar" | "aprobado" | "en_cambios" | "en_proceso";
  idea: string | null;
  copy: string | null;
  rondas: number;
  final: { drive_file_id: string; name: string; mime_type: string }[];
}

const LINK_VIEJO = "Este link es de una versión anterior del video. Te mandamos uno nuevo cuando esté la corrección.";

export async function leerVideoPublico(videoId: string, ronda: number): Promise<VideoPublico> {
  const db = adminDb();
  const snap = await db.collection("videos").doc(videoId).get();
  if (!snap.exists) throw new HttpError(404, "El video ya no existe");
  const v = snap.data()!;
  if ((v.rondas ?? 0) > ronda && v.etapa === "revision_cliente") throw new HttpError(410, LINK_VIEJO);
  const p = (await db.collection("projects").doc(v.proyecto_id).get()).data() ?? {};
  const estado =
    v.etapa === "revision_cliente"
      ? "para_aprobar"
      : v.etapa === "para_publicar" || v.etapa === "publicado"
        ? "aprobado"
        : v.etapa === "edicion" && v.feedback_cliente
          ? "en_cambios"
          : "en_proceso";
  return {
    id: snap.id,
    titulo: v.titulo,
    cliente: { nombre: p.nombre ?? "", color: p.color ?? "#6F40FC" },
    estado,
    idea: v.idea ?? null,
    copy: estado === "en_proceso" ? null : (v.copy ?? null),
    rondas: v.rondas ?? 0,
    final:
      estado === "en_proceso"
        ? []
        : ((v.attachments_finalizado ?? []) as VideoPublico["final"]).map((a) => ({
            drive_file_id: a.drive_file_id,
            name: a.name,
            mime_type: a.mime_type,
          })),
  };
}

/** El cliente aprueba o pide cambios desde el link (sin usuario). */
export async function responderCliente(
  videoId: string,
  ronda: number,
  decision: "aprobar" | "cambios",
  nota: string | null,
  rating: number | null,
  base: string
): Promise<void> {
  const db = adminDb();
  const ref = db.collection("videos").doc(videoId);
  const now = new Date().toISOString();

  const { v, p } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "El video ya no existe");
    const v = snap.data()!;
    if (v.etapa !== "revision_cliente") throw new HttpError(409, "Este video ya fue respondido");
    if ((v.rondas ?? 0) !== ronda) throw new HttpError(410, LINK_VIEJO);
    const pSnap = await tx.get(db.collection("projects").doc(v.proyecto_id));
    const p = pSnap.data() ?? {};
    // En el historial queda a nombre del primer usuario cliente (si hay).
    const by = (p.team_roles?.cliente ?? [])[0] ?? "cliente";
    const evento = (accion: string) => ({ at: now, by, accion, nota: nota || null });
    if (decision === "aprobar") {
      // Si los sube el cliente, el video aprobado se le entrega (queda publicado) y no pasa por pauta.
      const subeCliente = p.produccion?.publica === "cliente";
      tx.update(ref, {
        etapa: subeCliente ? "publicado" : "para_publicar",
        etapa_desde: now,
        updated_at: now,
        feedback_cliente: null,
        cliente_rating: rating,
        ...(subeCliente ? { publicacion: { publicado_at: now, sube_cliente: true, link_instagram: null, link_facebook: null, link_tiktok: null } } : {}),
        historial: FieldValue.arrayUnion(evento("Aprobado por el cliente (desde el link)")),
      });
    } else {
      tx.update(ref, {
        etapa: "edicion",
        etapa_desde: now,
        updated_at: now,
        feedback_cliente: nota,
        feedback_interno: null,
        feedback_marcas: null,
        rondas: FieldValue.increment(1),
        cliente_rating: rating,
        historial: FieldValue.arrayUnion(evento("El cliente pidió cambios (desde el link)")),
      });
    }
    return { v, p };
  });

  const team = (p.team_roles ?? {}) as Record<string, string[]>;
  const uno = (id: string | null | undefined, rol: string) => (id ? [id] : (team[rol] ?? []));
  if (decision === "aprobar") {
    await enviarAviso(
      {
        destinatarios: [...(p.produccion?.publica === "cliente" ? [] : uno(v.pauta_id, "pauta")), ...uno(v.productor_id, "productor")],
        titulo: p.produccion?.publica === "cliente" ? "Video aprobado: se le entregó al cliente para que lo suba" : "Video aprobado: listo para subir y pautar",
        cuerpo: `${p.nombre ?? "Cliente"} · ${v.titulo}`,
        link: `/videos?video=${videoId}`,
        clave: `para_publicar:${videoId}`,
        proyectoId: v.proyecto_id,
        videoId,
      },
      base
    );
  } else {
    await enviarAviso(
      {
        destinatarios: [...uno(v.editor_id, "editor"), ...uno(v.productor_id, "productor")],
        titulo: "El cliente pidió cambios",
        cuerpo: `${p.nombre ?? "Cliente"} · ${v.titulo}: ${(nota ?? "").slice(0, 120)}`,
        link: `/videos?video=${videoId}`,
        clave: `cambios_cliente:${videoId}`,
        proyectoId: v.proyecto_id,
        videoId,
      },
      base
    );
  }
}
