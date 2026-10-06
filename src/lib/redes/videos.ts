import { assertEditable } from "@/lib/redes/vistaComo";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  increment,
  updateDoc,
  writeBatch,
} from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { Project } from "@/integrations/firebase/types";
import { avisar, equipoDe } from "./avisos";
import { callApi } from "./api";
import type {
  EtapaVideo,
  HistorialVideo,
  PautaVideo,
  PublicacionVideo,
  ResultadosVideo,
  Rodaje,
  Video,
} from "./types";
import { etapaInfo } from "./etapas";
import { fechaCorta, segundos } from "./format";
import type { MarcaCorreccion } from "./types";

/** Nota + correcciones marcadas, en texto (para el historial y los avisos). */
export function textoConMarcas(nota: string, marcas: MarcaCorreccion[] = []): string {
  return [nota.trim(), ...marcas.map((m) => `${segundos(m.t)} · ${m.texto}`)].filter(Boolean).join("\n");
}
const limpiarMarcas = (marcas: MarcaCorreccion[], de: "equipo" | "cliente") =>
  marcas
    .filter((m) => m.texto.trim())
    .map((m) => ({ t: Math.max(0, Math.round(m.t)), texto: m.texto.trim().slice(0, 300), de }))
    .sort((a, b) => a.t - b.t)
    .slice(0, 30);

export const VIDEOS = "videos";
export const RODAJES = "rodajes";

const now = () => new Date().toISOString();

function evento(by: string, accion: string, nota?: string | null): HistorialVideo {
  return { at: now(), by, accion, nota: nota ?? null };
}

/** Cambia de etapa dejando registro en el historial. */
async function moverA(
  video: Video,
  etapa: EtapaVideo,
  by: string,
  accion: string,
  extra: Record<string, unknown> = {},
  nota?: string | null
) {
  assertEditable();
  const ts = now();
  await updateDoc(doc(db, VIDEOS, video.id), {
    etapa,
    etapa_desde: ts,
    updated_at: ts,
    historial: arrayUnion(evento(by, accion, nota)),
    ...extra,
  });
}

const linkPara = (ruta: string, videoId: string) => `${ruta}?video=${videoId}`;

// ---------------------------------------------------------------------------
// Planificación
// ---------------------------------------------------------------------------

export interface NuevoVideo {
  titulo: string;
  idea?: string | null;
  objetivo?: string | null;
  referencias?: string | null;
}

export async function crearVideos(
  project: Project,
  items: NuevoVideo[],
  mes: string,
  by: string,
  opts: { extra?: boolean } = {}
): Promise<string[]> {
  assertEditable();
  const batch = writeBatch(db);
  const ids: string[] = [];
  const ts = now();
  for (const item of items) {
    const ref = doc(collection(db, VIDEOS));
    ids.push(ref.id);
    const video: Omit<Video, "id"> = {
      proyecto_id: project.id,
      titulo: item.titulo.trim(),
      idea: item.idea?.trim() || null,
      objetivo: item.objetivo?.trim() || null,
      referencias: item.referencias?.trim() || null,
      mes,
      extra: Boolean(opts.extra),
      etapa: "planificado",
      etapa_desde: ts,
      rodaje_id: null,
      productor_id: equipoDe(project, "productor")[0] ?? null,
      editor_id: equipoDe(project, "editor")[0] ?? null,
      pauta_id: equipoDe(project, "pauta")[0] ?? null,
      attachments_crudo: [],
      attachments_finalizado: [],
      copy: null,
      feedback_interno: null,
      feedback_cliente: null,
      rondas: 0,
      cliente_rating: null,
      publicacion: null,
      pauta: null,
      resultados: null,
      meta: null,
      historial: [evento(by, "Planificado")],
      created_at: ts,
      created_by: by,
      updated_at: ts,
    };
    batch.set(ref, video);
  }
  await batch.commit();
  return ids;
}

export async function actualizarVideo(
  videoId: string,
  patch: Partial<Omit<Video, "id">>,
  by: string,
  accion?: string
) {
  assertEditable();
  const data: Record<string, unknown> = { ...patch, updated_at: now() };
  if (accion) data.historial = arrayUnion(evento(by, accion));
  await updateDoc(doc(db, VIDEOS, videoId), data);
}

export async function eliminarVideo(video: Video) {
  assertEditable();
  if (video.rodaje_id) {
    await updateDoc(doc(db, RODAJES, video.rodaje_id), { video_ids: arrayRemove(video.id) }).catch(() => undefined);
  }
  await deleteDoc(doc(db, VIDEOS, video.id));
}

// ---------------------------------------------------------------------------
// Rodajes
// ---------------------------------------------------------------------------

export interface DatosRodaje {
  fecha: string;
  hora: string | null;
  lugar: string | null;
  notas: string | null;
  preparar?: string | null;
}

export async function agendarRodaje(
  project: Project,
  datos: DatosRodaje,
  videos: Video[],
  by: string
): Promise<string> {
  assertEditable();
  const ts = now();
  const rodaje: Omit<Rodaje, "id"> = {
    proyecto_id: project.id,
    fecha: datos.fecha,
    hora: datos.hora || null,
    lugar: datos.lugar?.trim() || null,
    notas: datos.notas?.trim() || null,
    preparar: datos.preparar?.trim() || null,
    recordatorio_at: null,
    estado: "agendado",
    video_ids: videos.map((v) => v.id),
    productor_id: by,
    created_at: ts,
    created_by: by,
  };
  const ref = await addDoc(collection(db, RODAJES), rodaje);
  const batch = writeBatch(db);
  for (const v of videos) {
    batch.update(doc(db, VIDEOS, v.id), {
      rodaje_id: ref.id,
      etapa: v.etapa === "planificado" ? "agendado" : v.etapa,
      etapa_desde: v.etapa === "planificado" ? ts : v.etapa_desde,
      updated_at: ts,
      historial: arrayUnion(
        evento(by, `Rodaje agendado para el ${fechaCorta(datos.fecha)}`)
      ),
    });
  }
  await batch.commit();

  void avisar({
    destinatarios: equipoDe(project, "cliente"),
    titulo: "Filmación agendada",
    cuerpo: `${fechaCorta(datos.fecha)}${datos.hora ? ` a las ${datos.hora}` : ""}${
      datos.lugar ? ` en ${datos.lugar}` : ""
    } · ${videos.length} video${videos.length === 1 ? "" : "s"}`,
    link: "/cliente",
    clave: `rodaje:${ref.id}`,
    proyectoId: project.id,
  });
  return ref.id;
}

export async function actualizarRodaje(
  rodaje: Rodaje,
  patch: Partial<Omit<Rodaje, "id">>,
  videosNuevos?: Video[],
  by?: string,
  todos: Video[] = []
) {
  assertEditable();
  // Si cambia la fecha, el aviso del día anterior se vuelve a mandar.
  const extra = patch.fecha && patch.fecha !== rodaje.fecha ? { recordatorio_at: null } : {};
  await updateDoc(doc(db, RODAJES, rodaje.id), { ...patch, ...extra } as Record<string, unknown>);
  if (videosNuevos && by) {
    const ts = now();
    const batch = writeBatch(db);
    const nuevosIds = new Set(videosNuevos.map((v) => v.id));
    for (const v of videosNuevos) {
      if (rodaje.video_ids.includes(v.id)) continue;
      batch.update(doc(db, VIDEOS, v.id), {
        rodaje_id: rodaje.id,
        etapa: v.etapa === "planificado" ? "agendado" : v.etapa,
        etapa_desde: v.etapa === "planificado" ? ts : v.etapa_desde,
        updated_at: ts,
        historial: arrayUnion(evento(by, "Sumado a un rodaje")),
      });
    }
    for (const id of rodaje.video_ids) {
      if (nuevosIds.has(id)) continue;
      const v = todos.find((x) => x.id === id);
      // Solo vuelve a "planificado" si todavía no se filmó; si ya avanzó, se deja como está.
      if (!v) continue;
      if (v.etapa !== "agendado") {
        batch.update(doc(db, VIDEOS, id), { rodaje_id: null, updated_at: ts });
        continue;
      }
      batch.update(doc(db, VIDEOS, id), {
        rodaje_id: null,
        etapa: "planificado",
        etapa_desde: ts,
        updated_at: ts,
        historial: arrayUnion(evento(by, "Quitado del rodaje")),
      });
    }
    await batch.commit();
  }
}

export async function cancelarRodaje(rodaje: Rodaje, videos: Video[], by: string) {
  assertEditable();
  const ts = now();
  const batch = writeBatch(db);
  batch.update(doc(db, RODAJES, rodaje.id), { estado: "cancelado" });
  for (const v of videos) {
    if (v.rodaje_id !== rodaje.id || v.etapa !== "agendado") continue;
    batch.update(doc(db, VIDEOS, v.id), {
      rodaje_id: null,
      etapa: "planificado",
      etapa_desde: ts,
      updated_at: ts,
      historial: arrayUnion(evento(by, "Rodaje cancelado")),
    });
  }
  await batch.commit();
}

export async function marcarRodajeRealizado(rodaje: Rodaje) {
  assertEditable();
  await updateDoc(doc(db, RODAJES, rodaje.id), { estado: "realizado" });
}

// ---------------------------------------------------------------------------
// Circuito
// ---------------------------------------------------------------------------

/** Producción: crudo cargado → pasa a edición. */
export async function enviarAEdicion(video: Video, project: Project | undefined, by: string) {
  await moverA(video, "edicion", by, "Crudo cargado, pasa a edición");
  void avisar({
    destinatarios: video.editor_id ? [video.editor_id] : equipoDe(project, "editor"),
    titulo: "Video nuevo para editar",
    cuerpo: `${project?.nombre ?? "Cliente"} · ${video.titulo}`,
    link: linkPara("/videos", video.id),
    clave: `edicion:${video.id}`,
    proyectoId: video.proyecto_id,
    videoId: video.id,
  });
}

/** Edición: entrega la versión para revisión interna. */
export async function entregarEdicion(video: Video, project: Project | undefined, by: string) {
  const reentrega = video.rondas > 0;
  await moverA(
    video,
    "revision_interna",
    by,
    reentrega ? "Corrección entregada" : "Edición entregada"
  );
  void avisar({
    destinatarios: video.productor_id
      ? [video.productor_id]
      : equipoDe(project, "productor"),
    titulo: reentrega ? "Corrección lista para revisar" : "Video listo para revisar",
    cuerpo: `${project?.nombre ?? "Cliente"} · ${video.titulo}`,
    link: linkPara("/videos", video.id),
    clave: `revision_interna:${video.id}`,
    proyectoId: video.proyecto_id,
    videoId: video.id,
  });
}

/** Producción aprueba → va al cliente. */
export async function aprobarInterno(video: Video, project: Project | undefined, by: string) {
  await moverA(video, "revision_cliente", by, "Aprobado por producción, enviado al cliente", {
    feedback_interno: null,
    feedback_marcas: null,
    // Nueva versión para el cliente: los recordatorios de 48 h arrancan de cero.
    recordatorios_cliente: 0,
    recordatorio_cliente_at: null,
  });
  void avisar({
    destinatarios: equipoDe(project, "cliente"),
    titulo: "Tenés un video para aprobar",
    cuerpo: video.titulo,
    link: linkPara("/cliente", video.id),
    clave: `revision_cliente:${video.id}`,
    proyectoId: video.proyecto_id,
    videoId: video.id,
  });
}

export async function pedirCambiosInterno(
  video: Video,
  project: Project | undefined,
  by: string,
  nota: string,
  marcasIn: MarcaCorreccion[] = []
) {
  const marcas = limpiarMarcas(marcasIn, "equipo");
  const completo = textoConMarcas(nota, marcas);
  await moverA(
    video,
    "edicion",
    by,
    "Producción pidió cambios",
    {
      feedback_interno: nota.trim() || "Correcciones marcadas en el video",
      feedback_cliente: null,
      feedback_marcas: marcas.length ? marcas : null,
      rondas: increment(1),
    },
    completo
  );
  void avisar({
    destinatarios: video.editor_id ? [video.editor_id] : equipoDe(project, "editor"),
    titulo: "Producción pidió cambios",
    cuerpo: `${video.titulo}: ${completo.slice(0, 160)}`,
    link: linkPara("/videos", video.id),
    clave: `cambios_interno:${video.id}`,
    proyectoId: video.proyecto_id,
    videoId: video.id,
  });
}

// Aprobación del cliente: la hace el servidor (valida la etapa, suma la ronda y avisa al equipo).
export async function aprobarCliente(
  video: Video,
  _project: Project | undefined,
  _by: string,
  rating?: number | null,
  comentario?: string | null
) {
  await callApi("/api/publico/video-cliente", {
    video_id: video.id,
    decision: "aprobar",
    rating: rating ?? null,
    comentario: comentario ?? null,
  });
}

export async function pedirCambiosCliente(
  video: Video,
  _project: Project | undefined,
  _by: string,
  nota: string,
  rating?: number | null,
  marcasIn: MarcaCorreccion[] = []
) {
  await callApi("/api/publico/video-cliente", {
    video_id: video.id,
    decision: "cambios",
    nota: nota.trim(),
    rating: rating ?? null,
    marcas: limpiarMarcas(marcasIn, "cliente"),
  });
}

export async function publicarVideo(
  video: Video,
  project: Project | undefined,
  by: string,
  publicacion: Omit<PublicacionVideo, "publicado_at"> & { publicado_at?: string },
  pauta: PautaVideo | null
) {
  await moverA(video, "publicado", by, pauta?.activa ? "Publicado y pautado" : "Publicado", {
    publicacion: { ...publicacion, publicado_at: publicacion.publicado_at ?? now() },
    pauta,
  });
  void avisar({
    destinatarios: [
      ...equipoDe(project, "cliente"),
      ...(video.productor_id ? [video.productor_id] : equipoDe(project, "productor")),
    ],
    titulo: "¡Tu video ya está publicado!",
    cuerpo: `${video.titulo}${pauta?.activa ? " · con pauta activa" : ""}`,
    link: "/cliente?tab=resultados",
    clave: `publicado:${video.id}`,
    proyectoId: video.proyecto_id,
    videoId: video.id,
  });
}

export async function guardarPauta(video: Video, pauta: PautaVideo, by: string) {
  await actualizarVideo(video.id, { pauta }, by, pauta.activa ? "Pauta actualizada" : "Pauta pausada");
}

export async function cargarResultados(
  video: Video,
  resultados: Omit<ResultadosVideo, "actualizado_at" | "actualizado_por">,
  by: string
) {
  await actualizarVideo(
    video.id,
    { resultados: { ...resultados, actualizado_at: now(), actualizado_por: by } },
    by,
    "Resultados de pauta actualizados"
  );
}

/** ID del anuncio de Meta: con esto los resultados se actualizan solos todos los días. */
export async function guardarMetaId(video: Video, adId: string | null) {
  assertEditable();
  const limpio = (adId ?? "").replace(/\D/g, "") || null;
  if ((video.meta?.ad_id ?? null) === limpio) return;
  await updateDoc(doc(db, VIDEOS, video.id), { meta: { ...(video.meta ?? {}), ad_id: limpio }, updated_at: now() });
}

/** Guion y tomas (editados a mano). */
export async function guardarGuion(video: Video, guion: string | null, tomas: string[]) {
  assertEditable();
  await updateDoc(doc(db, VIDEOS, video.id), {
    guion: guion?.trim() || null,
    tomas: tomas.map((t) => t.trim()).filter(Boolean),
    updated_at: now(),
  });
}

/** Solo admin: mover a cualquier etapa (corrige errores). */
export async function forzarEtapa(video: Video, etapa: EtapaVideo, by: string) {
  await moverA(video, etapa, by, `Movido a "${etapaInfo(etapa).label}" por admin`);
}
