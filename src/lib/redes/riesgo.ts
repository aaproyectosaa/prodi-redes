// Avisos de que un cliente se puede ir: puntaje de riesgo con sus motivos, a partir de lo que ya
// está cargado en el navegador (videos, perfiles de los usuarios del cliente, boletas y débito).
// Es una función pura: no lee nada de Firestore.
import type { Profile, Project } from "@/integrations/firebase/types";
import { fechaAR, mesAR, sumarMeses } from "@/lib/fecha";
import { mesLabel } from "./format";
import { planDe } from "./planes";
import type { PlanRedes, Video } from "./types";
import type { FacturaDoc } from "./facturacion";
import { saldoDe } from "../../../api/_lib/facturacion";

// ---------------------------------------------------------------------------
// Umbrales (en un solo lugar para ajustarlos fácil)
// ---------------------------------------------------------------------------

/** Video esperando que el cliente lo apruebe: desde cuántos días avisa (medio / alto). */
export const DIAS_REVISION_MEDIO = 4;
export const DIAS_REVISION_ALTO = 8;
/** Días sin entrar al sistema (el que más recientemente entró de los usuarios del cliente). */
export const DIAS_SIN_ENTRAR_MEDIO = 14;
export const DIAS_SIN_ENTRAR_ALTO = 30;
/** Cliente con usuario que nunca entró: solo si se dio de alta hace más de estos días. */
export const DIAS_ALTA_NUNCA_ENTRO = 7;
/** Pauta: cuánto tiene que bajar (fracción) el gasto del último mes cerrado vs el anterior. */
export const CAIDA_PAUTA = 0.4;
/** Pauta: gasto mínimo del mes anterior (ARS) para que la comparación tenga sentido. */
export const GASTO_MINIMO_PAUTA = 20000;
/** Sin videos publicados en el mes: se avisa desde este día del mes. */
export const DIA_SIN_PUBLICAR = 15;
/** Boleta vencida hace al menos estos días: pesa más. */
export const DIAS_VENCIDA_ALTO = 15;
/** Puntaje (suma de pesos) desde el que el cliente queda en riesgo medio / alto. */
export const PUNTAJE_MEDIO = 2;
export const PUNTAJE_ALTO = 4;

// ---------------------------------------------------------------------------

export type NivelRiesgo = "alto" | "medio" | "ok";

export interface MotivoRiesgo {
  clave: "revision" | "acceso" | "pauta" | "publicados" | "vencida" | "debito";
  /** Texto corto para el chip. */
  texto: string;
  peso: number;
}

export interface RiesgoCliente {
  clienteId: string;
  puntaje: number;
  nivel: NivelRiesgo;
  motivos: MotivoRiesgo[];
}

export interface DatosRiesgo {
  clientes: Project[];
  videos: Video[];
  planes: PlanRedes[];
  profiles: Profile[];
  /** Si no se pueden leer (no es admin), se omite la señal de boletas vencidas. */
  facturas?: FacturaDoc[] | null;
  ahora?: Date;
}

const DIA_MS = 86_400_000;
const diasDesde = (iso: string | null | undefined, ahora: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((ahora - t) / DIA_MS) : null;
};
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const nombreMes = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();

export function nivelDe(puntaje: number): NivelRiesgo {
  return puntaje >= PUNTAJE_ALTO ? "alto" : puntaje >= PUNTAJE_MEDIO ? "medio" : "ok";
}

/** Riesgo de un cliente. */
export function riesgoCliente(c: Project, d: DatosRiesgo): RiesgoCliente {
  const ahoraD = d.ahora ?? new Date();
  const ahora = ahoraD.getTime();
  const hoy = fechaAR(ahoraD);
  const mes = mesAR(ahoraD);
  const dia = Number(hoy.slice(8, 10));
  const motivos: MotivoRiesgo[] = [];
  const videos = d.videos.filter((v) => v.proyecto_id === c.id);

  // 1) Videos esperando la aprobación del cliente hace muchos días.
  const esperando = videos
    .filter((v) => v.etapa === "revision_cliente")
    .map((v) => diasDesde(v.etapa_desde || v.historial?.[v.historial.length - 1]?.at, ahora) ?? 0)
    .filter((n) => n >= DIAS_REVISION_MEDIO);
  if (esperando.length) {
    const max = Math.max(...esperando);
    motivos.push({
      clave: "revision",
      peso: max >= DIAS_REVISION_ALTO ? 3 : 2,
      texto:
        esperando.length === 1
          ? `Video sin aprobar hace ${plural(max, "día", "días")}`
          : `${esperando.length} videos sin aprobar (hasta ${plural(max, "día", "días")})`,
    });
  }

  // 2) Hace mucho que no entra al sistema (cualquiera de sus usuarios activos).
  const usuariosIds = new Set(c.team_roles?.cliente ?? []);
  const usuarios = d.profiles.filter(
    (p) =>
      p.activo !== false &&
      (usuariosIds.has(p.id) || ((p.role === "cliente" || p.role === "contacto") && p.project_permissions?.includes(c.id)))
  );
  if (usuarios.length) {
    const ultimos = usuarios.map((p) => diasDesde(p.ultimo_acceso, ahora)).filter((n): n is number => n !== null);
    if (ultimos.length) {
      const dias = Math.min(...ultimos);
      if (dias >= DIAS_SIN_ENTRAR_MEDIO)
        motivos.push({ clave: "acceso", peso: dias >= DIAS_SIN_ENTRAR_ALTO ? 3 : 2, texto: `No entra hace ${plural(dias, "día", "días")}` });
    } else if ((diasDesde(c.created_at, ahora) ?? 0) >= DIAS_ALTA_NUNCA_ENTRO) {
      motivos.push({ clave: "acceso", peso: 2, texto: "Nunca entró al sistema" });
    }
  }

  // 3) Pauta: el gasto del último mes cerrado bajó mucho vs el anterior (los videos van por su mes del plan).
  const publicados = videos.filter((v) => v.etapa === "publicado");
  const gastoDe = (m: string) => publicados.filter((v) => v.mes === m).reduce((a, v) => a + (Number(v.resultados?.gasto) || 0), 0);
  const mesCerrado = sumarMeses(mes, -1);
  const mesPrevio = sumarMeses(mes, -2);
  const gCerrado = gastoDe(mesCerrado);
  const gPrevio = gastoDe(mesPrevio);
  if (gPrevio >= GASTO_MINIMO_PAUTA && gCerrado < gPrevio * (1 - CAIDA_PAUTA)) {
    const caida = Math.round((1 - gCerrado / gPrevio) * 100);
    motivos.push({ clave: "pauta", peso: 2, texto: `Pauta −${caida}% en ${nombreMes(mesCerrado)}` });
  }

  // 4) Pasada la mitad del mes y ningún video publicado (si su plan incluye videos y no es nuevo).
  const cupo = planDe(c, d.planes).videosMes;
  const esNuevo = !!c.created_at && mesAR(c.created_at) === mes;
  if (cupo > 0 && !esNuevo && dia >= DIA_SIN_PUBLICAR) {
    const delMes = publicados.some((v) => v.mes === mes || (v.publicacion?.publicado_at && mesAR(v.publicacion.publicado_at) === mes));
    if (!delMes) motivos.push({ clave: "publicados", peso: 2, texto: "Sin videos publicados este mes" });
  }

  // 5) Boletas / facturas vencidas sin pagar.
  if (d.facturas) {
    const vencidas = d.facturas.filter((f) => f.proyecto_id === c.id && f.estado === "pendiente" && f.vencimiento < hoy && saldoDe(f) > 0);
    if (vencidas.length) {
      const masVieja = vencidas.reduce((a, f) => (f.vencimiento < a ? f.vencimiento : a), vencidas[0].vencimiento);
      const dias = diasDesde(`${masVieja}T12:00:00-03:00`, ahora) ?? 0;
      motivos.push({
        clave: "vencida",
        peso: dias >= DIAS_VENCIDA_ALTO ? 4 : 3,
        texto: vencidas.length === 1 ? `Boleta vencida hace ${plural(dias, "día", "días")}` : `${vencidas.length} boletas vencidas`,
      });
    }
  }

  // 6) Débito automático pausado o cancelado.
  const sus = c.suscripcion?.estado;
  if (sus === "cancelada") motivos.push({ clave: "debito", peso: 4, texto: "Canceló el débito automático" });
  else if (sus === "pausada") motivos.push({ clave: "debito", peso: 2, texto: "Pausó el débito automático" });

  motivos.sort((a, b) => b.peso - a.peso);
  const puntaje = motivos.reduce((a, m) => a + m.peso, 0);
  return { clienteId: c.id, puntaje, nivel: nivelDe(puntaje), motivos };
}

/** Riesgo de todos los clientes, por id. */
export function calcularRiesgo(d: DatosRiesgo): Map<string, RiesgoCliente> {
  const ahora = d.ahora ?? new Date();
  // La cuenta propia de Prodi no es un cliente que se pueda perder.
  return new Map(d.clientes.filter((c) => !c.cuenta_propia).map((c) => [c.id, riesgoCliente(c, { ...d, ahora })]));
}

/** Los que están en riesgo (alto o medio), de mayor a menor puntaje. */
export function clientesEnRiesgo(riesgos: Map<string, RiesgoCliente>): RiesgoCliente[] {
  return Array.from(riesgos.values())
    .filter((r) => r.nivel !== "ok")
    .sort((a, b) => b.puntaje - a.puntaje);
}
