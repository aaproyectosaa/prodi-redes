// Aprobación del cliente desde la app (con usuario). Antes se escribía directo en /api/db;
// ahora pasa por acá para que la etapa, las rondas y el historial no se puedan tocar a mano.

import { adminDb, FieldValue } from "./db";
import { HttpError } from "./auth";
import type { Caller } from "./http";
import { disenadorasDe, enviarAviso } from "./notify";

interface Marca {
  t: number;
  texto: string;
  de: "cliente";
}

const segundos = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

function limpiarMarcas(x: unknown): Marca[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((m): m is { t: unknown; texto: string } => !!m && typeof m === "object" && typeof (m as { texto?: unknown }).texto === "string")
    .filter((m) => m.texto.trim())
    .map((m) => ({ t: Math.max(0, Math.round(Number(m.t) || 0)), texto: m.texto.trim().slice(0, 300), de: "cliente" as const }))
    .sort((a, b) => a.t - b.t)
    .slice(0, 30);
}

const texto = (x: unknown, max: number) => String(x ?? "").trim().slice(0, max);
const ratingDe = (x: unknown) => (Number(x) >= 1 && Number(x) <= 5 ? Math.round(Number(x)) : null);
const miembro = (team: Record<string, string[]>, uid: string) => Object.values(team).some((ids) => Array.isArray(ids) && ids.includes(uid));

export interface PedidoVideo {
  video_id?: string;
  decision?: string;
  nota?: string;
  rating?: number | null;
  marcas?: unknown;
  /** Nota para el historial al aprobar (ej. "Aprobado por el cliente fuera del sistema"). */
  comentario?: string | null;
}

/**
 * El cliente (o producción, si el cliente aprobó por otro medio) aprueba o pide cambios.
 * Mismo resultado que hacía la app, pero validado acá.
 */
export async function responderVideoApp(caller: Caller, b: PedidoVideo, base: string) {
  const videoId = texto(b.video_id, 200);
  if (!videoId) throw new HttpError(400, "Falta video_id");
  const decision = b.decision === "aprobar" ? "aprobar" : b.decision === "cambios" ? "cambios" : null;
  if (!decision) throw new HttpError(400, "Respuesta inválida");
  const rating = ratingDe(b.rating);
  const marcas = limpiarMarcas(b.marcas);
  const nota = texto(b.nota, 2000);
  if (decision === "cambios" && !nota && !marcas.length) throw new HttpError(400, "Contanos qué querés cambiar");
  const completo = [nota, ...marcas.map((m) => `${segundos(m.t)} · ${m.texto}`)].filter(Boolean).join("\n");
  const comentario = texto(b.comentario, 500) || null;

  const db = adminDb();
  const ref = db.collection("videos").doc(videoId);
  const now = new Date().toISOString();

  const { v, p } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "El video ya no existe");
    const v = snap.data()!;
    const p = (await tx.get(db.collection("projects").doc(String(v.proyecto_id)))).data() ?? {};
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const esCliente = caller.role === "cliente" && (team.cliente ?? []).includes(caller.uid);
    const esProd = caller.role === "admin" || (caller.role === "productor" && miembro(team, caller.uid));
    if (!esCliente && !esProd) throw new HttpError(403, "No tenés acceso a este video");
    if (v.etapa !== "revision_cliente") throw new HttpError(409, "Este video ya fue respondido");
    const evento = (accion: string, n: string | null) => ({ at: now, by: caller.uid, accion, nota: n });
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
        historial: FieldValue.arrayUnion(evento("Aprobado por el cliente", comentario)),
      });
    } else {
      tx.update(ref, {
        etapa: "edicion",
        etapa_desde: now,
        updated_at: now,
        feedback_cliente: nota || "Correcciones marcadas en el video",
        feedback_interno: null,
        feedback_marcas: marcas.length ? marcas : null,
        rondas: FieldValue.increment(1),
        cliente_rating: rating,
        historial: FieldValue.arrayUnion(evento("El cliente pidió cambios", completo)),
      });
    }
    return { v, p };
  });

  const team = (p.team_roles ?? {}) as Record<string, string[]>;
  const uno = (id: unknown, rol: string) => (typeof id === "string" && id ? [id] : (team[rol] ?? []));
  const sinMi = (ids: string[]) => ids.filter((id) => id !== caller.uid);
  if (decision === "aprobar") {
    await enviarAviso(
      {
        destinatarios: sinMi([...(p.produccion?.publica === "cliente" ? [] : uno(v.pauta_id, "pauta")), ...uno(v.productor_id, "productor")]),
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
        destinatarios: sinMi([...uno(v.editor_id, "editor"), ...uno(v.productor_id, "productor")]),
        titulo: "El cliente pidió cambios",
        cuerpo: `${p.nombre ?? "Cliente"} · ${v.titulo}: ${completo.slice(0, 160)}`,
        link: `/videos?video=${videoId}`,
        clave: `cambios_cliente:${videoId}`,
        proyectoId: v.proyecto_id,
        videoId,
      },
      base
    );
  }
  return { ok: true };
}

export interface PedidoPieza {
  pieza_id?: string;
  decision?: string;
  nota?: string;
}

const FORMATOS: Record<string, string> = {
  cuadrado: "Posteo",
  posteo_vertical: "Posteo vertical",
  vertical: "Historia",
  horizontal: "Pantalla o portada",
  afiche: "Afiche o flyer",
  vidriera: "Cartel o menú",
  banner: "Banner o lona",
};

/** El cliente aprueba la pieza que le mandó diseño, o pide cambios. */
export async function responderPiezaApp(caller: Caller, b: PedidoPieza, base: string) {
  const piezaId = texto(b.pieza_id, 200);
  if (!piezaId) throw new HttpError(400, "Falta pieza_id");
  const decision = b.decision === "aprobar" ? "aprobar" : b.decision === "cambios" ? "cambios" : null;
  if (!decision) throw new HttpError(400, "Respuesta inválida");
  const nota = texto(b.nota, 2000);
  if (decision === "cambios" && !nota) throw new HttpError(400, "Contanos qué querés cambiar");

  const db = adminDb();
  const ref = db.collection("piezas_ia").doc(piezaId);
  const now = new Date().toISOString();

  const { pz, p } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "La pieza ya no existe");
    const pz = snap.data()!;
    const p = (await tx.get(db.collection("projects").doc(String(pz.proyecto_id)))).data() ?? {};
    const team = (p.team_roles ?? {}) as Record<string, string[]>;
    const esCliente = caller.role === "cliente" && (team.cliente ?? []).includes(caller.uid);
    if (!esCliente && caller.role !== "admin") throw new HttpError(403, "No tenés acceso a esta pieza");
    if (pz.estado !== "para_aprobar") throw new HttpError(409, "Esta pieza ya fue respondida");
    if (decision === "aprobar") {
      tx.update(ref, {
        estado: "entregada",
        version_aprobada_id: pz.version_enviada_id ?? null,
        updated_at: now,
        historial: FieldValue.arrayUnion({ at: now, by: caller.uid, accion: "Aprobada por el cliente", nota: null }),
      });
    } else {
      tx.update(ref, {
        estado: "en_proceso",
        feedback_cliente: nota,
        rondas: FieldValue.increment(1),
        updated_at: now,
        historial: FieldValue.arrayUnion({ at: now, by: caller.uid, accion: "El cliente pidió cambios", nota }),
      });
    }
    return { pz, p };
  });

  const diseno = (await disenadorasDe(pz.proyecto_id)).filter((id) => id !== caller.uid);
  await enviarAviso(
    decision === "aprobar"
      ? {
          destinatarios: diseno,
          titulo: "Pieza aprobada 🎉",
          cuerpo: `${p.nombre ?? "Cliente"} · ${FORMATOS[pz.formato] ?? "Pieza"}`,
          link: `/piezas?pieza=${piezaId}`,
          clave: `pieza_ok:${piezaId}`,
          proyectoId: pz.proyecto_id,
        }
      : {
          destinatarios: diseno,
          titulo: "El cliente pidió cambios en una pieza",
          cuerpo: `${p.nombre ?? "Cliente"}: ${nota.slice(0, 140)}`,
          link: `/piezas?pieza=${piezaId}`,
          clave: `pieza_cambios:${piezaId}`,
          proyectoId: pz.proyecto_id,
        },
    base
  );
  return { ok: true };
}
