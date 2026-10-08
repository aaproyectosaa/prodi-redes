import type { Project, QuienFilma, UserRole } from "@/integrations/firebase/types";
import type { EtapaVideo, Video } from "./types";

export interface EtapaInfo {
  value: EtapaVideo;
  label: string;
  /** Texto corto para el cliente (no ve la cocina interna). */
  clienteLabel: string;
  /** Quién tiene la pelota en esta etapa. */
  responsable: UserRole;
  descripcion: string;
  /** Clases tailwind para badge/punto. */
  dot: string;
  badge: string;
}

export const ETAPAS: EtapaInfo[] = [
  {
    value: "planificado",
    label: "Planificado",
    clienteLabel: "Planificado",
    responsable: "productor",
    descripcion: "Idea acordada con el cliente. Falta agendar el rodaje.",
    dot: "bg-slate-400",
    badge: "bg-slate-500/12 text-slate-600 dark:text-slate-300 border-slate-500/25",
  },
  {
    value: "agendado",
    label: "Rodaje agendado",
    clienteLabel: "Filmación agendada",
    responsable: "productor",
    descripcion: "Tiene día, hora y lugar. Después de filmar se sube el crudo.",
    dot: "bg-sky-500",
    badge: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25",
  },
  {
    value: "material_cliente",
    label: "Material del cliente",
    clienteLabel: "Esperando tu material",
    responsable: "cliente",
    descripcion: "Lo filma el cliente (sin rodaje). Pasa a edición cuando sube el material y avisa que está todo.",
    dot: "bg-violet-500",
    badge: "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/25",
  },
  {
    value: "edicion",
    label: "En edición",
    clienteLabel: "En edición",
    responsable: "editor",
    descripcion: "El crudo está cargado. La editora arma el video.",
    dot: "bg-amber-500",
    badge: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25",
  },
  {
    value: "revision_interna",
    label: "Revisión interna",
    clienteLabel: "En edición",
    responsable: "productor",
    descripcion: "La productora revisa antes de mandarlo al cliente.",
    dot: "bg-orange-500",
    badge: "bg-orange-500/12 text-orange-700 dark:text-orange-300 border-orange-500/25",
  },
  {
    value: "revision_cliente",
    label: "Esperando cliente",
    clienteLabel: "Para aprobar",
    responsable: "cliente",
    descripcion: "El cliente tiene que aprobarlo o pedir cambios.",
    dot: "bg-prodi",
    badge: "bg-primary/12 text-primary border-primary/30",
  },
  {
    value: "para_publicar",
    label: "Para subir y pautar",
    clienteLabel: "Aprobado",
    responsable: "pauta",
    descripcion: "Aprobado. Lo sube y pauta el equipo de pauta.",
    dot: "bg-teal-500",
    badge: "bg-teal-500/12 text-teal-700 dark:text-teal-300 border-teal-500/25",
  },
  {
    value: "publicado",
    label: "Publicado",
    clienteLabel: "Publicado",
    responsable: "pauta",
    descripcion: "Subido y con pauta. Se cargan los resultados.",
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  },
];

export const ETAPA_ORDEN: EtapaVideo[] = ETAPAS.map((e) => e.value);

export function etapaInfo(etapa: EtapaVideo): EtapaInfo {
  return ETAPAS.find((e) => e.value === etapa) ?? ETAPAS[0];
}

export function etapaIndex(etapa: EtapaVideo): number {
  return ETAPA_ORDEN.indexOf(etapa);
}

/** Días completos que lleva el video en su etapa actual. */
export function diasEnEtapa(video: Pick<Video, "etapa_desde">, now = new Date()): number {
  const since = new Date(video.etapa_desde);
  if (isNaN(since.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
}

/** Un video está trabado si superó los días de alerta y no está publicado. */
export function estaTrabado(video: Video, diasAlerta: number, now = new Date()): boolean {
  if (video.etapa === "publicado") return false;
  // Lo planificado sin rodaje es normal al principio de mes: solo alerta pasado el triple.
  // El material del cliente depende de cuándo filma él: alerta pasado el doble.
  const limite = video.etapa === "planificado" ? diasAlerta * 3 : video.etapa === "material_cliente" ? diasAlerta * 2 : diasAlerta;
  return diasEnEtapa(video, now) >= limite;
}

/** Solo pauta: el cliente manda los videos terminados y nosotros solo los subimos y pautamos. */
export const soloPauta = (cliente: Pick<Project, "produccion"> | undefined) => cliente?.produccion?.servicio === "solo_pauta";

/** Quién filma los videos de este cliente (por defecto Prodi; en "solo pauta", siempre el cliente). */
export function quienFilma(cliente: Pick<Project, "produccion"> | undefined): QuienFilma {
  if (soloPauta(cliente)) return "cliente";
  const f = cliente?.produccion?.filma;
  return f === "cliente" || f === "ambos" ? f : "prodi";
}

/** Hasta edición el cliente puede mandar material (después ya está editado). Igual en api/_lib/pedidos.ts. */
export const ETAPAS_CON_MATERIAL: EtapaVideo[] = ["planificado", "agendado", "material_cliente", "edicion"];

/** ¿El cliente puede subir material a este video? Los que filma él, o cualquiera si el cliente filma (o filman los dos). */
export function aceptaMaterialCliente(video: Video, cliente: Pick<Project, "produccion"> | undefined): boolean {
  if (!ETAPAS_CON_MATERIAL.includes(video.etapa)) return false;
  return !!video.filma_cliente || video.etapa === "material_cliente" || quienFilma(cliente) !== "prodi";
}

/** ¿Este rol tiene que hacer algo con el video en esta etapa? */
export function leTocaA(role: UserRole | undefined, video: Video): boolean {
  if (!role) return false;
  const info = etapaInfo(video.etapa);
  if (role === "admin") return false;
  return info.responsable === role;
}
