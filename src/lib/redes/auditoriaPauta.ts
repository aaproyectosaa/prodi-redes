// Reporte a fondo de quien sube y pauta: lo que está esperando que lo publique, lo que subió tarde, lo pautado sin
// el ID de Meta (sin eso no hay resultados), los resultados viejos, las piezas sin publicar y cómo viene cada cliente,
// comparado mes a mes. Es una función pura: usa lo que ya está cargado en el navegador.

import type { Project } from "@/integrations/firebase/types";
import { mesAR } from "@/lib/fecha";
import { mesLabel, sumarMeses } from "./format";
import type { PiezaIA, Video } from "./types";

/** Días que puede esperar algo aprobado antes de marcarse en rojo. */
export const DIAS_PARA_PUBLICAR = 2;
/** Días sin actualizar resultados de una pauta activa. */
export const DIAS_RESULTADOS = 7;

const DIA = 86_400_000;
const dias = (desde: string, hasta = Date.now()) => Math.max(0, Math.floor((hasta - new Date(desde).getTime()) / DIA));

/** Cuándo lo aprobó el cliente (o desde cuándo está para publicar). */
function aprobadoAt(v: Video): string {
  const h = [...(v.historial ?? [])].reverse().find((e) => e.accion.startsWith("Aprobado por el cliente"));
  return h?.at ?? v.etapa_desde;
}
/** Cuándo se publicó. */
function publicadoAt(v: Video): string | null {
  return v.publicacion?.publicado_at ?? [...(v.historial ?? [])].reverse().find((e) => e.accion.startsWith("Publicado"))?.at ?? null;
}
const pautado = (v: Video) => !!v.pauta?.activa || !!v.pauta?.presupuesto;

export interface MesPauta {
  mes: string;
  publicados: number;
  /** Horas promedio de aprobado a publicado. */
  tarda: number | null;
  tarde: number;
  pautados: number;
  sinMeta: number;
}

export interface FilaCliente {
  cliente: Project;
  esperando: number;
  /** Días del que más espera. */
  masViejo: number;
  publicadosMes: number;
  pautaActiva: number;
  /** Último resultado cargado (fecha) o null. */
  ultimoResultado: string | null;
  piezasSinPublicar: number;
  desatendido: boolean;
}

export interface AuditoriaPauta {
  esperando: { video: Video; dias: number }[];
  tarde: { video: Video; dias: number; publicado: string }[];
  sinMeta: Video[];
  resultadosViejos: { video: Video; dias: number | null }[];
  piezasSinPublicar: { pieza: PiezaIA; dias: number }[];
  meses: MesPauta[];
  clientes: FilaCliente[];
  /** Promedio de los 3 meses anteriores (publicados) para comparar. */
  promedioAntes: number | null;
  resumen: string[];
}

export function auditoriaPauta(uid: string, videos: Video[], piezas: PiezaIA[], clientes: Project[], mes: string, nombre: string): AuditoriaPauta {
  const suyos = videos.filter((v) => v.pauta_id === uid);
  // Sus clientes: los que lo tienen en la ficha como pauta, o donde tiene videos.
  const ids = new Set([...clientes.filter((c) => (c.team_roles?.pauta ?? []).includes(uid)).map((c) => c.id), ...suyos.map((v) => v.proyecto_id)]);
  const susClientes = clientes.filter((c) => ids.has(c.id) && c.enabled !== false);

  const esperando = suyos
    .filter((v) => v.etapa === "para_publicar")
    .map((video) => ({ video, dias: dias(aprobadoAt(video)) }))
    .sort((a, b) => b.dias - a.dias);

  const publicados = suyos.filter((v) => v.etapa === "publicado");
  const tarde = publicados
    .map((video) => {
      const pub = publicadoAt(video);
      if (!pub || !video.fecha_deseada) return null;
      const atraso = Math.floor((new Date(pub).getTime() - new Date(`${video.fecha_deseada}T23:59:59-03:00`).getTime()) / DIA) + 1;
      return atraso > 0 && mesAR(pub) === mes ? { video, dias: atraso, publicado: pub } : null;
    })
    .filter((x): x is { video: Video; dias: number; publicado: string } => !!x)
    .sort((a, b) => b.dias - a.dias);

  // Pautados de los últimos 60 días sin el ID del anuncio: sin eso no llegan los resultados.
  const hace60 = new Date(Date.now() - 60 * DIA).toISOString();
  const sinMeta = publicados.filter((v) => pautado(v) && !v.meta?.ad_id && (publicadoAt(v) ?? "") >= hace60);

  // Pautas vigentes: activas y con fecha de fin por delante, o publicadas en los últimos 60 días.
  const hoyStr = new Date().toISOString().slice(0, 10);
  const vigente = (v: Video) => !!v.pauta?.activa && (v.pauta.fin ? v.pauta.fin >= hoyStr : (publicadoAt(v) ?? "") >= hace60);
  const resultadosViejos = publicados
    .filter(vigente)
    .map((video) => ({ video, dias: video.resultados?.actualizado_at ? dias(video.resultados.actualizado_at) : null }))
    .filter((x) => x.dias === null || x.dias > DIAS_RESULTADOS)
    .sort((a, b) => (b.dias ?? 999) - (a.dias ?? 999));

  const piezasSinPublicar = piezas
    .filter((p) => ids.has(p.proyecto_id) && p.estado === "entregada" && !p.publicada_at && !p._origen)
    .map((pieza) => ({ pieza, dias: dias(pieza.updated_at ?? pieza.created_at) }))
    .filter((x) => x.dias >= 1)
    .sort((a, b) => b.dias - a.dias);

  // Mes a mes (este y los 5 anteriores).
  const meses: MesPauta[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = sumarMeses(mes, -i);
    const del = publicados.filter((v) => mesAR(publicadoAt(v) ?? v.updated_at ?? "") === m);
    const tiempos = del.map((v) => (new Date(publicadoAt(v)!).getTime() - new Date(aprobadoAt(v)).getTime()) / 3_600_000).filter((h) => h >= 0);
    meses.push({
      mes: m,
      publicados: del.length,
      tarda: tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null,
      tarde: del.filter((v) => v.fecha_deseada && (publicadoAt(v) ?? "").slice(0, 10) > v.fecha_deseada).length,
      pautados: del.filter(pautado).length,
      sinMeta: del.filter((v) => pautado(v) && !v.meta?.ad_id).length,
    });
  }
  const antes = meses.slice(-4, -1).filter((m) => m.publicados > 0);
  const promedioAntes = antes.length ? antes.reduce((a, m) => a + m.publicados, 0) / antes.length : null;

  const filas: FilaCliente[] = susClientes
    .map((cliente) => {
      const deEste = suyos.filter((v) => v.proyecto_id === cliente.id);
      const esp = esperando.filter((x) => x.video.proyecto_id === cliente.id);
      const res = deEste.map((v) => v.resultados?.actualizado_at).filter(Boolean).sort().reverse()[0] ?? null;
      const pzs = piezasSinPublicar.filter((x) => x.pieza.proyecto_id === cliente.id).length;
      const pubMes = deEste.filter((v) => v.etapa === "publicado" && mesAR(publicadoAt(v) ?? "") === mes).length;
      const activa = deEste.filter((v) => v.etapa === "publicado" && vigente(v)).length;
      const masViejo = esp[0]?.dias ?? 0;
      return {
        cliente,
        esperando: esp.length,
        masViejo,
        publicadosMes: pubMes,
        pautaActiva: activa,
        ultimoResultado: res,
        piezasSinPublicar: pzs,
        desatendido: masViejo > DIAS_PARA_PUBLICAR || pzs > 0 || (!!res && dias(res) > DIAS_RESULTADOS * 2) || (pubMes === 0 && esp.length > 0),
      };
    })
    .sort((a, b) => Number(b.desatendido) - Number(a.desatendido) || b.masViejo - a.masViejo);

  // Resumen en texto, para copiar y usar en la charla.
  const actual = meses[meses.length - 1];
  const resumen: string[] = [];
  resumen.push(
    `${nombre} publicó ${actual.publicados} video${actual.publicados === 1 ? "" : "s"} en ${mesLabel(mes).toLowerCase()}` +
      (promedioAntes !== null ? ` (promedio de los 3 meses anteriores: ${promedioAntes.toFixed(1).replace(".0", "")}).` : ".")
  );
  if (actual.tarda !== null) resumen.push(`Tarda en promedio ${actual.tarda < 24 ? `${Math.round(actual.tarda)} h` : `${(actual.tarda / 24).toFixed(1)} días`} desde que el cliente aprueba hasta publicar.`);
  const viejos = esperando.filter((x) => x.dias > DIAS_PARA_PUBLICAR);
  if (esperando.length) resumen.push(`Hoy hay ${esperando.length} video${esperando.length === 1 ? "" : "s"} aprobado${esperando.length === 1 ? "" : "s"} sin publicar${viejos.length ? `; ${viejos.length} hace más de ${DIAS_PARA_PUBLICAR} días (el más viejo, ${esperando[0].dias} días)` : ""}.`);
  if (tarde.length) resumen.push(`${tarde.length} se publicaron después de la fecha que pidió el cliente este mes.`);
  if (sinMeta.length) resumen.push(`${sinMeta.length} pautado${sinMeta.length === 1 ? "" : "s"} sin el ID del anuncio de Meta (no traen resultados).`);
  if (resultadosViejos.length) resumen.push(`${resultadosViejos.length} pauta${resultadosViejos.length === 1 ? "" : "s"} activa${resultadosViejos.length === 1 ? "" : "s"} sin resultados actualizados hace más de ${DIAS_RESULTADOS} días.`);
  if (piezasSinPublicar.length) resumen.push(`${piezasSinPublicar.length} pieza${piezasSinPublicar.length === 1 ? "" : "s"} gráfica${piezasSinPublicar.length === 1 ? "" : "s"} aprobada${piezasSinPublicar.length === 1 ? "" : "s"} sin publicar.`);
  const desat = filas.filter((f) => f.desatendido);
  if (desat.length) resumen.push(`Clientes desatendidos: ${desat.map((f) => f.cliente.nombre).join(", ")}.`);

  return { esperando, tarde, sinMeta, resultadosViejos, piezasSinPublicar, meses, clientes: filas, promedioAntes, resumen };
}
