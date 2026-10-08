// Pedido de video del cliente: si entra en el plan del mes se crea directo;
// si se pasa del límite se cotiza y se cobra con Mercado Pago (el video se crea al acreditarse el pago).

import { HttpError } from "./auth";
import { adminDb, type Data } from "./db";

/** De dónde sale el material del video que pide el cliente. */
export type TipoMaterial = "existente" | "nueva" | "cliente";

/** Archivo que ya estaba cargado (crudo, o editado que ya le llegó) en otro video del mismo cliente. */
export interface ArchivoBase {
  drive_file_id: string;
  name: string;
  mime_type: string;
  size: number;
  web_view_link: string;
  thumbnail_link?: string;
  /** Video del que sale el archivo. */
  video_id: string;
  video_titulo: string;
}

export interface MaterialBase {
  tipo: TipoMaterial;
  /** Solo "existente": los archivos que eligió el cliente (con los datos del servidor, no los que mandó la página). */
  archivos?: ArchivoBase[];
  /** Solo "nueva": cuándo le queda mejor filmar. */
  preferencia?: string | null;
}

export interface PedidoVideo {
  titulo: string;
  idea: string | null;
  objetivo: string | null;
  /** Para cuándo lo quiere publicado (YYYY-MM-DD) o null si no tiene fecha. */
  fecha_deseada?: string | null;
  pedido_por: string;
  /** Lo filma el cliente y nos manda el material: arranca esperando su material (sin rodaje). */
  filma_cliente?: boolean;
  /** Con qué material se hace: ya cargado (va directo a edición), filmación nueva o lo manda el cliente. */
  material_base?: MaterialBase | null;
}

export type QuienFilma = "prodi" | "cliente" | "ambos";

/** Solo pauta: el cliente manda los videos terminados (projects.produccion.servicio). Igual en src/lib/redes/etapas.ts. */
export const soloPauta = (proyecto: Data | undefined | null) => (proyecto?.produccion as { servicio?: unknown } | undefined)?.servicio === "solo_pauta";

/** Quién filma los videos del cliente (projects.produccion.filma, por defecto Prodi; en "solo pauta", el cliente). */
export function quienFilma(proyecto: Data | undefined | null): QuienFilma {
  if (soloPauta(proyecto)) return "cliente";
  const f = (proyecto?.produccion as { filma?: unknown } | undefined)?.filma;
  return f === "cliente" || f === "ambos" ? f : "prodi";
}

/**
 * ¿Este video lo filma el cliente? Si filma siempre él, sí; si filman los dos, lo que eligió
 * (sin elección, lo filmamos nosotros); si filma Prodi, no.
 */
export function filmaElCliente(proyecto: Data | undefined | null, eleccion?: boolean | null): boolean {
  const f = quienFilma(proyecto);
  return f === "cliente" || (f === "ambos" && eleccion === true);
}

/** Hasta edición el cliente puede mandar material (después ya está editado). Igual en src/lib/redes/etapas.ts. */
export const ETAPAS_CON_MATERIAL = ["planificado", "agendado", "material_cliente", "edicion"];

/** ¿El cliente puede subir material a este video? */
export function aceptaMaterialCliente(video: Data, proyecto: Data | undefined | null): boolean {
  if (!ETAPAS_CON_MATERIAL.includes(String(video.etapa))) return false;
  return video.filma_cliente === true || video.etapa === "material_cliente" || quienFilma(proyecto) !== "prodi";
}

/** El editado se le muestra al cliente recién cuando le llega para aprobar (igual que en MaterialCliente.tsx). */
const EDITADO_VISIBLE = ["revision_cliente", "para_publicar", "publicado"];
export const MAX_ARCHIVOS_BASE = 30;
/** Opciones de "¿cuándo te queda mejor filmar?" (igual en PedirVideoDialog.tsx). */
const PREFERENCIAS = ["Mañanas", "Tardes", "Fines de semana"];

/** La preferencia de día para filmar, solo si es una de las opciones. */
export const preferenciaRodaje = (x: unknown): string | null => (PREFERENCIAS.includes(String(x)) ? String(x) : null);

/**
 * Archivos ya cargados que el cliente eligió para su video nuevo: cada uno tiene que ser material de un video de
 * SU cliente (crudo, o editado que ya le llegó para aprobar si quien pide es el cliente). Tira 400/403 si no.
 */
export async function archivosBaseDe(pid: string, ids: unknown, soloVisibles: boolean): Promise<ArchivoBase[]> {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, "Elegí al menos un archivo del material cargado");
  const pedidos = [...new Set(ids.map(String))];
  if (pedidos.length > MAX_ARCHIVOS_BASE) throw new HttpError(400, `Elegí hasta ${MAX_ARCHIVOS_BASE} archivos`);
  const snap = await adminDb().collection("videos").where("proyecto_id", "==", pid).get();
  const disponibles = new Map<string, ArchivoBase>();
  for (const d of snap.docs) {
    const v = d.data();
    const listas = [v.attachments_crudo, !soloVisibles || EDITADO_VISIBLE.includes(String(v.etapa)) ? v.attachments_finalizado : null];
    for (const lista of listas) {
      for (const a of (Array.isArray(lista) ? lista : []) as Data[]) {
        const id = String(a?.drive_file_id ?? "");
        if (!id || disponibles.has(id)) continue;
        disponibles.set(id, {
          drive_file_id: id,
          name: String(a.name ?? "archivo").slice(0, 200),
          mime_type: String(a.mime_type ?? "application/octet-stream"),
          size: Number(a.size ?? 0) || 0,
          web_view_link: String(a.web_view_link ?? ""),
          ...(a.thumbnail_link ? { thumbnail_link: String(a.thumbnail_link) } : {}),
          video_id: d.id,
          video_titulo: String(v.titulo ?? "").slice(0, 120),
        });
      }
    }
  }
  return pedidos.map((id) => {
    const a = disponibles.get(id);
    if (!a) throw new HttpError(403, "Uno de los archivos elegidos no es de tu material. Volvé a elegirlos.");
    return a;
  });
}

/** Texto corto de la elección de material, para los avisos al equipo. */
export function textoMaterial(p: PedidoVideo): string {
  const m = p.material_base;
  if (m?.tipo === "existente") return ` · con material ya cargado (${m.archivos?.length ?? 0} archivo${m.archivos?.length === 1 ? "" : "s"})`;
  if (p.filma_cliente) return " · lo filma el cliente y nos manda el material";
  if (m?.tipo === "nueva") return ` · filmación nueva${m.preferencia ? ` (prefiere ${m.preferencia.toLowerCase()})` : ""}`;
  return "";
}

/** Documento del video nuevo, igual que lo crea producción al planificar. */
export function videoDesdePedido(proyectoId: string, team: Record<string, string[]>, mes: string, p: PedidoVideo, nota: string) {
  const ts = new Date().toISOString();
  const existente = p.material_base?.tipo === "existente" && (p.material_base.archivos?.length ?? 0) > 0;
  const filma = !existente && p.filma_cliente === true;
  return {
    proyecto_id: proyectoId,
    titulo: p.titulo,
    idea: p.idea,
    objetivo: p.objetivo,
    referencias: null,
    mes,
    extra: false,
    // Con material ya cargado no hay nada que filmar: va directo a edición (producción recibe el aviso y, si hace
    // falta filmar algo más, lo vuelve a planificado). Lo filma el cliente: no lleva rodaje, espera su material.
    etapa: existente ? "edicion" : filma ? "material_cliente" : "planificado",
    etapa_desde: ts,
    rodaje_id: null,
    productor_id: team.productor?.[0] ?? null,
    editor_id: team.editor?.[0] ?? null,
    pauta_id: team.pauta?.[0] ?? null,
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
    pedido_cliente: true,
    fecha_deseada: p.fecha_deseada ?? null,
    filma_cliente: filma,
    material_base: p.material_base ?? null,
    historial: [
      {
        at: ts,
        by: p.pedido_por,
        accion: existente ? `${nota} · con material ya cargado` : filma ? `${nota} · lo filma el cliente` : nota,
        nota: null,
      },
    ],
    created_at: ts,
    created_by: p.pedido_por,
    updated_at: ts,
  };
}
