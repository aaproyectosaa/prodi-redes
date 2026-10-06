import { assertEditable } from "@/lib/redes/vistaComo";
import { arrayUnion, doc, updateDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import type { DriveAttachmentRef, Project } from "@/integrations/firebase/types";
import { avisar, equipoDe } from "./avisos";
import { callApi } from "@/lib/redes/api";
import type { EnfoquePieza, FormatoPieza, PiezaIA, PlanRedes, RedesSettings } from "./types";
import { planDe } from "./planes";

export const PIEZAS = "piezas_ia";
/** Destinatario especial: todas las personas de diseño (lo resuelve el servidor). */
export const DISENO = "rol:diseno";

export interface FormatoInfo {
  value: FormatoPieza;
  label: string;
  medida: string;
  /** Para qué sirve, en criollo. */
  ejemplo: string;
  /** Proporción que se le pide a la IA. */
  ratio: "1:1" | "4:5" | "9:16" | "16:9" | "2:3" | "3:4" | "21:9";
  grupo: "redes" | "impresion";
}

export const FORMATOS: FormatoInfo[] = [
  { value: "cuadrado", label: "Posteo", medida: "1080 × 1080", ejemplo: "Para el feed de Instagram y Facebook", ratio: "1:1", grupo: "redes" },
  { value: "posteo_vertical", label: "Posteo vertical", medida: "1080 × 1350", ejemplo: "Ocupa más pantalla en el feed", ratio: "4:5", grupo: "redes" },
  { value: "vertical", label: "Historia", medida: "1080 × 1920", ejemplo: "Historias de Instagram y estados de WhatsApp", ratio: "9:16", grupo: "redes" },
  { value: "horizontal", label: "Pantalla o portada", medida: "16:9", ejemplo: "TV del local, portada de Facebook o web", ratio: "16:9", grupo: "redes" },
  { value: "afiche", label: "Afiche o flyer", medida: "A4 / A3 / volante", ejemplo: "Para pegar o repartir", ratio: "2:3", grupo: "impresion" },
  { value: "vidriera", label: "Cartel o menú", medida: "Vertical 3:4", ejemplo: "Vidriera, mostrador o carta del local", ratio: "3:4", grupo: "impresion" },
  { value: "banner", label: "Banner o lona", medida: "Apaisado 21:9", ejemplo: "Frente del local, marquesina, evento", ratio: "21:9", grupo: "impresion" },
];

export const formatoInfo = (f: FormatoPieza) => FORMATOS.find((x) => x.value === f) ?? FORMATOS[0];

/** Medidas (px) del dibujito del formato, máximo `max` px de lado. */
export function iconoFormato(ratio: FormatoInfo["ratio"], max = 32): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  const k = max / Math.max(w, h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

export const ENFOQUES: Record<EnfoquePieza, { label: string; corto: string; desc: string }> = {
  comercial: { label: "Para vender", corto: "Comercial", desc: "Promo, producto, precio. Que te escriban o te compren." },
  institucional: { label: "Para comunicar", corto: "Institucional", desc: "Un saludo, una novedad, un horario, un aviso." },
};

/** Cómo lo ve el equipo. */
export const ESTADO_PIEZA_LABEL: Record<PiezaIA["estado"], string> = {
  pendiente_pago: "Falta el pago",
  pagada: "Para hacer",
  en_proceso: "Diseñando",
  para_aprobar: "Esperando al cliente",
  entregada: "Entregada",
  rechazada: "Rechazada (reembolsada)",
  cancelada: "Cancelada",
};

/** Cómo lo ve el cliente. */
export const ESTADO_PIEZA_CLIENTE: Record<PiezaIA["estado"], string> = {
  pendiente_pago: "Falta el pago",
  pagada: "En diseño",
  en_proceso: "En diseño",
  para_aprobar: "Para aprobar",
  entregada: "Lista",
  rechazada: "No se pudo hacer",
  cancelada: "Cancelada",
};

export interface VersionVista {
  id: string;
  drive_file_id: string;
  name: string;
  mime_type: string;
  web_view_link?: string;
  thumbnail_link?: string;
  created_at: string;
  origen: "ia" | "subida";
}

/** Versiones hechas con IA + diseños subidos a mano, en orden. */
export function versionesDe(p: PiezaIA): VersionVista[] {
  const ia = (p.versiones ?? []).map((v) => ({ ...v, origen: "ia" as const }));
  const subidas = (p.attachments_finalizado ?? []).map((a: DriveAttachmentRef) => ({
    id: a.drive_file_id,
    drive_file_id: a.drive_file_id,
    name: a.name,
    mime_type: a.mime_type,
    web_view_link: a.web_view_link,
    thumbnail_link: a.thumbnail_link,
    created_at: a.uploaded_at ?? p.updated_at,
    origen: "subida" as const,
  }));
  return [...ia, ...subidas].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export const versionEnviada = (p: PiezaIA) => versionesDe(p).find((v) => v.id === p.version_enviada_id) ?? null;
export const versionFinal = (p: PiezaIA) =>
  versionesDe(p).find((v) => v.id === p.version_aprobada_id) ?? null;

/** Piezas del plan este mes: cuántas incluye y cuántas usó. */
export function cupoPiezas(cliente: Project | undefined, planes: PlanRedes[], piezas: PiezaIA[], mes: string) {
  const incluidas = cliente?.plan_redes_override?.piezas_mes ?? planDe(cliente, planes).plan?.piezas_mes ?? 0;
  const usadas = piezas.filter(
    (p) => p.proyecto_id === cliente?.id && p.mes === mes && p.incluida && !["cancelada", "rechazada"].includes(p.estado)
  ).length;
  return { incluidas, usadas, quedan: Math.max(0, incluidas - usadas) };
}

export function precioDe(settings: RedesSettings, formato: FormatoPieza): number {
  return formatoInfo(formato).grupo === "impresion" ? (settings.precio_pieza_impresion ?? settings.precio_pieza_ia) : settings.precio_pieza_ia;
}

const now = () => new Date().toISOString();
const evento = (by: string, accion: string, nota?: string | null) => ({ at: now(), by, accion, nota: nota ?? null });

export interface DatosPedidoPieza {
  formato: FormatoPieza;
  enfoque: EnfoquePieza;
  pedido: string;
  texto_en_pieza?: string | null;
  producto?: string | null;
  oferta?: string | null;
  cta?: string | null;
  fecha_deseada?: string | null;
}

/** El cliente pide la pieza: si entra en el plan se crea; si no, devuelve el link de pago. */
export function pedirPieza(proyectoId: string, datos: DatosPedidoPieza) {
  return callApi<
    { estado: "creada"; pieza_id: string } | { estado: "pago"; pieza_id: string; init_point: string; monto: number; cobro_id: string }
  >("/api/pagos/pedir-pieza", { proyecto_id: proyectoId, ...datos });
}

/** Crea la preferencia de Mercado Pago y devuelve el link de pago. */
export async function iniciarPago(
  body: { tipo: "pieza_ia"; pieza_id: string } | { tipo: "video_extra"; proyecto_id: string; mes: string; cantidad: number }
): Promise<{ init_point: string; cobro_id: string }> {
  assertEditable();
  return callApi("/api/pagos/crear", body);
}

/** Consulta a Mercado Pago si el pago ya se acreditó (al volver del checkout). */
export async function verificarPago(cobroId: string): Promise<{ estado: string }> {
  return callApi("/api/pagos/verificar", { cobro_id: cobroId });
}

/** Diseño genera una versión con IA (se guarda en Drive). */
export async function generarVersion(piezaId: string, ajustes?: string) {
  assertEditable();
  return callApi<{ ok: true }>("/api/ia/pieza", { pieza_id: piezaId, ajustes: ajustes ?? null });
}

/** Diseño la empieza (al subir un diseño propio). */
export async function empezarPieza(pieza: PiezaIA) {
  if (pieza.estado !== "pagada") return;
  assertEditable();
  await updateDoc(doc(db, PIEZAS, pieza.id), { estado: "en_proceso", updated_at: now() });
}

/** Diseño le manda una versión al cliente para que la apruebe. */
export async function mandarAlCliente(pieza: PiezaIA, versionId: string, project: Project | undefined, by: string) {
  assertEditable();
  await updateDoc(doc(db, PIEZAS, pieza.id), {
    estado: "para_aprobar",
    version_enviada_id: versionId,
    updated_at: now(),
    historial: arrayUnion(evento(by, (pieza.rondas ?? 0) > 0 ? "Corrección enviada al cliente" : "Enviada al cliente para aprobar")),
  });
  void avisar({
    destinatarios: equipoDe(project, "cliente"),
    titulo: "Tenés una pieza para aprobar",
    cuerpo: `${formatoInfo(pieza.formato).label}: ${(pieza.producto || pieza.pedido).slice(0, 90)}`,
    link: `/cliente?tab=piezas&pieza=${pieza.id}`,
    clave: `pieza_aprobar:${pieza.id}`,
    proyectoId: pieza.proyecto_id,
  });
}

/** El cliente la aprueba: queda lista para descargar. */
// (La hace el servidor: valida el estado y avisa a diseño.)
export async function aprobarPieza(pieza: PiezaIA, _project: Project | undefined, _by: string) {
  await callApi("/api/publico/pieza-cliente", { pieza_id: pieza.id, decision: "aprobar" });
}

/** El cliente pide cambios: vuelve a diseño con su comentario. */
export async function pedirCambiosPieza(pieza: PiezaIA, _project: Project | undefined, _by: string, nota: string) {
  await callApi("/api/publico/pieza-cliente", { pieza_id: pieza.id, decision: "cambios", nota });
}

/** Diseño no la puede hacer: si se pagó, se devuelve el pago. */
export async function rechazarPieza(pieza: PiezaIA, nota: string) {
  assertEditable();
  return callApi("/api/pagos/reembolsar", { pieza_id: pieza.id, nota });
}

export async function cancelarPieza(pieza: PiezaIA) {
  assertEditable();
  await updateDoc(doc(db, PIEZAS, pieza.id), { estado: "cancelada", updated_at: now() });
}
