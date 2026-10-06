import type { Project } from "@/integrations/firebase/types";
import { hoyISO, mesActual, mesLabel } from "./format";
import type { PiezaIA, Rodaje, Video } from "./types";

/** Lo que el cliente tiene que saber o hacer ahora, en orden de importancia. */
export type TipoPaso =
  | "aprobar"
  | "elegir_ideas"
  | "pagar_pieza"
  | "pieza_lista"
  | "rodaje"
  | "planificar"
  | "en_produccion"
  | "resultados"
  | "todo_listo";

export interface Paso {
  tipo: TipoPaso;
  titulo: string;
  texto: string;
  /** Acción principal sugerida. */
  accion?: { label: string; destino: "video" | "piezas" | "chat" | "resultados" | "plan" | "pedir" | "ideas"; videoId?: string };
  /** true = el cliente tiene que hacer algo; false = solo información. */
  teToca: boolean;
}

function cuando(fecha: string, hora: string | null): string {
  const hoy = hoyISO();
  const manana = new Date(`${hoy}T12:00:00`);
  manana.setDate(manana.getDate() + 1);
  const m = manana.toISOString().slice(0, 10);
  const dia =
    fecha === hoy
      ? "hoy"
      : fecha === m
        ? "mañana"
        : `el ${new Date(`${fecha}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}`;
  return `${dia}${hora ? ` a las ${hora}` : ""}`;
}

export function pasosCliente(params: {
  cliente: Project;
  videos: Video[];
  rodajes: Rodaje[];
  piezas: PiezaIA[];
  cupo: number;
  /** Plan del mes que el equipo le mandó y todavía no respondió. */
  planPendiente?: { mes: string; ideas: number } | null;
}): Paso[] {
  const { cliente, videos, rodajes, piezas, cupo, planPendiente } = params;
  const mes = mesActual();
  const mios = videos.filter((v) => v.proyecto_id === cliente.id);
  const delMes = mios.filter((v) => v.mes === mes);
  const out: Paso[] = [];

  const paraAprobar = mios.filter((v) => v.etapa === "revision_cliente").sort((a, b) => a.etapa_desde.localeCompare(b.etapa_desde));
  if (paraAprobar.length) {
    out.push({
      tipo: "aprobar",
      teToca: true,
      titulo: paraAprobar.length === 1 ? "Tenés un video para aprobar" : `Tenés ${paraAprobar.length} videos para aprobar`,
      texto: paraAprobar.length === 1 ? `“${paraAprobar[0].titulo}” está listo. Miralo y decinos si va.` : "Están listos. Miralos y decinos si van.",
      accion: { label: "Ver y aprobar", destino: "video", videoId: paraAprobar[0].id },
    });
  }

  if (planPendiente) {
    const nombreMes = mesLabel(planPendiente.mes).toLowerCase().split(" ")[0];
    out.push({
      tipo: "elegir_ideas",
      teToca: true,
      titulo: `Elegí tus videos de ${nombreMes}`,
      texto: `Te armamos ${planPendiente.ideas === 1 ? "1 idea" : `${planPendiente.ideas} ideas`}. Marcá cuáles van y, si algo no te convence, contanos qué cambiarías.`,
      accion: { label: "Ver las ideas", destino: "ideas" },
    });
  }

  const misPiezas = piezas.filter((p) => p.proyecto_id === cliente.id);
  const sinPagar = misPiezas.filter((p) => p.estado === "pendiente_pago");
  if (sinPagar.length) {
    out.push({
      tipo: "pagar_pieza",
      teToca: true,
      titulo: "Te falta pagar una pieza gráfica",
      texto: "Cuando se acredite el pago la empezamos a diseñar.",
      accion: { label: "Ir a pagar", destino: "piezas" },
    });
  }
  const piezaParaAprobar = misPiezas.filter((p) => p.estado === "para_aprobar");
  if (piezaParaAprobar.length) {
    out.push({
      tipo: "pieza_lista",
      teToca: true,
      titulo: piezaParaAprobar.length === 1 ? "Tenés una pieza para aprobar" : `Tenés ${piezaParaAprobar.length} piezas para aprobar`,
      texto: "Mirala y decinos si va o qué cambiarías.",
      accion: { label: "Ver y aprobar", destino: "piezas" },
    });
  }
  const hace3 = new Date(Date.now() - 3 * 86_400_000).toISOString();
  if (misPiezas.some((p) => p.estado === "entregada" && p.updated_at >= hace3)) {
    out.push({
      tipo: "pieza_lista",
      teToca: true,
      titulo: "Tu pieza gráfica está lista",
      texto: "Ya la aprobaste. Descargala y usala donde quieras.",
      accion: { label: "Ver y descargar", destino: "piezas" },
    });
  }

  const hoy = hoyISO();
  const en7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const rodaje = rodajes
    .filter((r) => r.proyecto_id === cliente.id && r.estado === "agendado" && r.fecha >= hoy && r.fecha <= en7)
    .sort((a, b) => (a.fecha + (a.hora ?? "")).localeCompare(b.fecha + (b.hora ?? "")))[0];
  if (rodaje) {
    const n = rodaje.video_ids.length;
    out.push({
      tipo: "rodaje",
      teToca: !!rodaje.preparar,
      titulo: `Filmamos ${cuando(rodaje.fecha, rodaje.hora)}`,
      texto: `${rodaje.lugar ? `En ${rodaje.lugar}. ` : ""}Vamos a grabar ${n} video${n === 1 ? "" : "s"}.${
        rodaje.preparar ? ` Tené listo: ${rodaje.preparar}` : ""
      }`,
      accion: { label: "¿Dudas? Escribinos", destino: "chat" },
    });
  }

  if (delMes.length === 0 && planPendiente?.mes !== mes) {
    out.push({
      tipo: "planificar",
      teToca: true,
      titulo: `Armemos tus videos de ${mesLabel(mes).toLowerCase().split(" ")[0]}`,
      texto: `Tu plan incluye ${cupo} video${cupo === 1 ? "" : "s"} este mes. Contanos qué querés mostrar y lo armamos juntos.`,
      accion: { label: "Pedir un video", destino: "pedir" },
    });
  }

  const enProduccion = delMes.filter((v) => ["agendado", "edicion", "revision_interna"].includes(v.etapa));
  const editando = delMes.filter((v) => ["edicion", "revision_interna"].includes(v.etapa)).length;
  if (enProduccion.length && !paraAprobar.length) {
    out.push({
      tipo: "en_produccion",
      teToca: false,
      titulo: editando ? `Estamos editando ${editando} video${editando === 1 ? "" : "s"}` : "Tus videos están en camino",
      texto: "No tenés que hacer nada por ahora. Te avisamos por WhatsApp apenas haya algo para ver.",
    });
  }

  const publicados = delMes.filter((v) => v.etapa === "publicado");
  if (publicados.length) {
    out.push({
      tipo: "resultados",
      teToca: false,
      titulo: `${publicados.length} video${publicados.length === 1 ? "" : "s"} ya en tus redes`,
      texto: "Están con pauta. Mirá cuánta gente los vio y cuántos mensajes te llegaron.",
      accion: { label: "Ver resultados", destino: "resultados" },
    });
  }

  if (!out.length) {
    out.push({
      tipo: "todo_listo",
      teToca: false,
      titulo: "Todo al día",
      texto: "No hay nada pendiente. Si se te ocurre una idea o una promo, escribinos.",
      accion: { label: "Escribir al equipo", destino: "chat" },
    });
  }
  return out;
}

/** Los 5 pasos que ve el cliente en cada video. */
export const CAMINO_CLIENTE = [
  { key: "idea", label: "Idea", etapas: ["planificado"] },
  { key: "filmacion", label: "Filmación", etapas: ["agendado"] },
  { key: "edicion", label: "Edición", etapas: ["edicion", "revision_interna"] },
  { key: "aprobacion", label: "Tu OK", etapas: ["revision_cliente"] },
  { key: "redes", label: "En redes", etapas: ["para_publicar", "publicado"] },
] as const;

export function pasoCamino(etapa: Video["etapa"]): number {
  return CAMINO_CLIENTE.findIndex((p) => (p.etapas as readonly string[]).includes(etapa));
}

/** Lo mínimo que el cliente tiene que cargar de su marca: logo, rubro y qué lo hace distinto. */
export function faltaMarca(cliente: import("@/integrations/firebase/types").Project): { logo: boolean; info: boolean } {
  const m = cliente.marca ?? {};
  return {
    logo: !cliente.marca_archivos?.logo,
    info: !(m.rubro && m.rubro.trim().length >= 3 && (m.descripcion || m.notas || "").trim().length >= 10),
  };
}
