import type { UserRole } from "@/integrations/firebase/types";
import { hoyISO, mesActual } from "./format";
import type { Video } from "./types";

/**
 * Columnas del tablero de cada rol. Cada persona del equipo ve solo sus
 * videos, repartidos en columnas que siguen su forma de trabajar.
 * `tuya` = en esa columna le toca hacer algo a esta persona.
 */
export interface Columna {
  id: string;
  titulo: string;
  ayuda: string;
  tuya: boolean;
  /** Texto del botón que aparece en la tarjeta (qué tiene que hacer). */
  accion?: string;
  dot: string;
}

export interface TableroRol {
  titulo: string;
  ayuda: string;
  columnas: Columna[];
  /** Columna de cada video o null si no se muestra. */
  columnaDe: (v: Video) => string | null;
  /** Si el video es de esta persona (los videos ya vienen filtrados por cliente). */
  esMio: (v: Video, uid: string) => boolean;
}

const conCambios = (v: Video) => !!(v.feedback_cliente || v.feedback_interno);

function resultadosAtrasados(v: Video): boolean {
  if (!v.resultados) return true;
  const dias = (Date.now() - new Date(v.resultados.actualizado_at).getTime()) / 86_400_000;
  return !!v.pauta?.activa && dias > 7;
}

const PRODUCTOR: TableroRol = {
  titulo: "Mis videos",
  ayuda: "Tocá un video para ver qué hacer. Las columnas marcadas son las que te tocan a vos.",
  columnas: [
    { id: "planificado", titulo: "Agendar rodaje", ayuda: "Ideas acordadas con el cliente.", tuya: true, accion: "Agendar", dot: "bg-slate-400" },
    { id: "agendado", titulo: "Filmar y subir crudo", ayuda: "Después de filmar, subí el material.", tuya: true, accion: "Subir crudo", dot: "bg-sky-500" },
    { id: "material_cliente", titulo: "Material del cliente", ayuda: "Lo filma el cliente: pasa a edición cuando sube todo.", tuya: false, dot: "bg-violet-500" },
    { id: "edicion", titulo: "En edición", ayuda: "Lo tiene el editor.", tuya: false, dot: "bg-amber-500" },
    { id: "revision_interna", titulo: "Revisar", ayuda: "Miralo antes de que lo vea el cliente.", tuya: true, accion: "Revisar", dot: "bg-orange-500" },
    { id: "revision_cliente", titulo: "Esperando al cliente", ayuda: "Si tarda, escribile por el chat.", tuya: false, dot: "bg-prodi" },
    { id: "listo", titulo: "Aprobados", ayuda: "Ya los tiene pauta. Este mes.", tuya: false, dot: "bg-emerald-500" },
  ],
  columnaDe: (v) => {
    if (v.etapa === "para_publicar" || v.etapa === "publicado") return v.mes === mesActual() || v.etapa === "para_publicar" ? "listo" : null;
    return v.etapa;
  },
  esMio: (v, uid) => !v.productor_id || v.productor_id === uid,
};

const EDITOR: TableroRol = {
  titulo: "Mis videos",
  ayuda: "Tocá un video, bajá el crudo, editalo y subí el final. Primero las correcciones.",
  columnas: [
    { id: "correcciones", titulo: "Correcciones", ayuda: "Pidieron cambios: van primero.", tuya: true, accion: "Corregir", dot: "bg-orange-500" },
    { id: "editar", titulo: "Para editar", ayuda: "El crudo ya está subido.", tuya: true, accion: "Editar", dot: "bg-amber-500" },
    { id: "material_cliente", titulo: "Lo filma el cliente", ayuda: "Llegan a editar cuando el cliente sube su material.", tuya: false, dot: "bg-violet-500" },
    { id: "revision", titulo: "Entregados", ayuda: "Los está revisando producción o el cliente.", tuya: false, dot: "bg-prodi" },
    { id: "listo", titulo: "Aprobados", ayuda: "Terminados este mes.", tuya: false, dot: "bg-emerald-500" },
  ],
  columnaDe: (v) => {
    if (v.etapa === "edicion") return conCambios(v) ? "correcciones" : "editar";
    if (v.etapa === "material_cliente") return "material_cliente";
    if (v.etapa === "revision_interna" || v.etapa === "revision_cliente") return "revision";
    if ((v.etapa === "para_publicar" || v.etapa === "publicado") && v.mes === mesActual()) return "listo";
    return null;
  },
  esMio: (v, uid) => !v.editor_id || v.editor_id === uid,
};

const PAUTA: TableroRol = {
  titulo: "Mis videos",
  ayuda: "Tocá un video, subilo a las redes del cliente, armá la pauta y después cargá los resultados.",
  columnas: [
    { id: "subir", titulo: "Subir y pautar", ayuda: "Aprobados por el cliente.", tuya: true, accion: "Publicar", dot: "bg-teal-500" },
    { id: "resultados", titulo: "Cargar resultados", ayuda: "Sin datos o con más de 7 días.", tuya: true, accion: "Cargar resultados", dot: "bg-orange-500" },
    { id: "activas", titulo: "Pautando", ayuda: "Pauta activa y resultados al día.", tuya: false, dot: "bg-prodi" },
    { id: "terminados", titulo: "Terminados", ayuda: "Pauta cerrada este mes.", tuya: false, dot: "bg-emerald-500" },
  ],
  columnaDe: (v) => {
    if (v.etapa === "para_publicar") return "subir";
    if (v.etapa !== "publicado") return null;
    const vigente = !!v.pauta?.activa && (!v.pauta.fin || v.pauta.fin >= hoyISO());
    if (vigente && resultadosAtrasados(v)) return "resultados";
    if (!v.resultados && v.mes === mesActual()) return "resultados";
    if (vigente) return "activas";
    return v.mes === mesActual() ? "terminados" : null;
  },
  esMio: (v, uid) => !v.pauta_id || v.pauta_id === uid,
};

export function tableroDe(role: UserRole | undefined): TableroRol | null {
  if (role === "productor") return PRODUCTOR;
  if (role === "editor") return EDITOR;
  if (role === "pauta") return PAUTA;
  return null;
}

/** Cantidad de videos donde le toca hacer algo a esta persona (para el menú). */
export function pendientesDe(role: UserRole | undefined, videos: Video[], uid: string): number {
  const t = tableroDe(role);
  if (!t) return 0;
  const tuyas = new Set(t.columnas.filter((c) => c.tuya).map((c) => c.id));
  return videos.filter((v) => t.esMio(v, uid) && tuyas.has(t.columnaDe(v) ?? "")).length;
}
