import type { Project } from "@/integrations/firebase/types";
import type { Video } from "@/lib/redes/types";
import { loSubeElCliente } from "@/lib/redes/extra";
import { NOMBRE_RESULTADO, resumirPauta, sumarDiasF, type PautaDia } from "@/lib/redes/metaPauta";

// Alertas para quien maneja la pauta: lo que hay que tocar hoy en Meta. Salen de la pauta que se trae sola
// (meta_pauta_diaria) y de los videos. Se muestran en su tablero y en "Mi día"; el presupuesto además avisa solo
// (api/_lib/meta-cuenta.ts).

export type TipoAlerta = "presupuesto_excedido" | "presupuesto_cerca" | "presupuesto_ritmo" | "sin_gasto" | "costo_sube" | "sin_resultados" | "frecuencia" | "video_sin_anuncio";

export interface AlertaPauta {
  id: string;
  tipo: TipoAlerta;
  /** 2 = urgente, 1 = mirar hoy, 0 = para tener en cuenta. */
  nivel: 0 | 1 | 2;
  proyectoId: string;
  titulo: string;
  detalle: string;
  videoId?: string;
}

/** Presupuesto mensual de pauta del cliente: el que eligió él o, si no, el de su plan. */
export function presupuestoPauta(c: Project): number | null {
  const elegido = (c as { pauta_cliente?: { monto?: number } }).pauta_cliente?.monto;
  const m = elegido ?? c.plan_redes_override?.pauta?.monto ?? null;
  return m && m > 0 ? m : null;
}

const ars = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Cómo viene la inversión del mes contra el presupuesto (y a qué ritmo). */
export function estadoPresupuesto(c: Project, filas: PautaDia[], hoy: string) {
  const tope = presupuestoPauta(c);
  const desde = `${hoy.slice(0, 7)}-01`;
  const gasto = filas.filter((f) => f.proyecto_id === c.id && f.fecha >= desde && f.fecha <= hoy).reduce((a, f) => a + f.gasto, 0);
  const [y, m, d] = hoy.split("-").map(Number);
  const diasMes = new Date(y, m, 0).getDate();
  // Proyección al fin de mes con el ritmo de lo que va (desde el día 5, antes es poco para proyectar).
  const proyectado = d >= 5 ? (gasto / d) * diasMes : null;
  return { tope, gasto, uso: tope ? gasto / tope : null, proyectado, diasMes, dia: d };
}

export function alertasPauta({ clientes, filas, videos, hoy }: { clientes: Project[]; filas: PautaDia[]; videos: Video[]; hoy: string }): AlertaPauta[] {
  const out: AlertaPauta[] = [];
  for (const c of clientes) {
    if (c.enabled === false) continue;
    const mias = filas.filter((f) => f.proyecto_id === c.id);
    const conectado = !!c.meta?.ad_account_id;

    // Presupuesto del mes.
    const p = estadoPresupuesto(c, mias, hoy);
    if (p.tope && p.uso != null) {
      if (p.uso >= 1) {
        out.push({ id: `pres-${c.id}`, tipo: "presupuesto_excedido", nivel: 2, proyectoId: c.id, titulo: "Se pasó del presupuesto", detalle: `Lleva ${ars(p.gasto)} de ${ars(p.tope)} (${pct(p.uso)}). Pausá o bajá el presupuesto en Meta.` });
      } else if (p.uso >= 0.9) {
        out.push({ id: `pres-${c.id}`, tipo: "presupuesto_cerca", nivel: 1, proyectoId: c.id, titulo: "Casi llega al presupuesto", detalle: `Lleva ${ars(p.gasto)} de ${ars(p.tope)} (${pct(p.uso)}) y faltan ${p.diasMes - p.dia} días del mes.` });
      } else if (p.proyectado != null && p.proyectado > p.tope * 1.1) {
        out.push({ id: `pres-${c.id}`, tipo: "presupuesto_ritmo", nivel: 1, proyectoId: c.id, titulo: "Al ritmo actual se pasa del presupuesto", detalle: `Va a terminar el mes en ${ars(p.proyectado)} y el presupuesto es ${ars(p.tope)}. Bajá el diario.` });
      }
    }

    if (conectado && mias.length) {
      // Sin gasto en los últimos 2 días cuando venía gastando (el anuncio se cortó o se quedó sin saldo).
      const ult2 = mias.filter((f) => f.fecha >= sumarDiasF(hoy, -2) && f.fecha < hoy).reduce((a, f) => a + f.gasto, 0);
      const antes = mias.filter((f) => f.fecha >= sumarDiasF(hoy, -14) && f.fecha < sumarDiasF(hoy, -2)).reduce((a, f) => a + f.gasto, 0);
      if (ult2 === 0 && antes > 0 && !(p.uso != null && p.uso >= 1)) {
        out.push({ id: `sg-${c.id}`, tipo: "sin_gasto", nivel: 2, proyectoId: c.id, titulo: "Dejó de gastar", detalle: "No tuvo inversión en los últimos 2 días y venía pautando. Revisá si el anuncio se cortó, se rechazó o se quedó sin saldo." });
      }

      // Costo por resultado: últimos 7 días contra los 7 anteriores.
      const r7 = resumirPauta(mias, sumarDiasF(hoy, -7), sumarDiasF(hoy, -1));
      const a7 = resumirPauta(mias, sumarDiasF(hoy, -14), sumarDiasF(hoy, -8));
      if (r7.costo != null && a7.costo != null && r7.resultados >= 3 && a7.resultados >= 3 && r7.costo > a7.costo * 1.3) {
        const n = NOMBRE_RESULTADO[r7.principal];
        out.push({ id: `cs-${c.id}`, tipo: "costo_sube", nivel: 1, proyectoId: c.id, titulo: `Cada ${n.uno} sale más caro`, detalle: `Esta semana ${ars(r7.costo)} contra ${ars(a7.costo)} la anterior (+${pct(r7.costo / a7.costo - 1)}). Probá otro anuncio o público.` });
      }

      // Campaña que gasta sin resultados hace 3 días.
      const r3 = mias.filter((f) => f.fecha >= sumarDiasF(hoy, -3) && f.fecha < hoy);
      const porCamp = new Map<string, { nombre: string; gasto: number; res: number }>();
      const principal = r7.principal;
      for (const f of r3) {
        const x = porCamp.get(f.campaign_id) ?? { nombre: f.campaign_name || f.campaign_id, gasto: 0, res: 0 };
        x.gasto += f.gasto;
        x.res += principal === "clics" ? f.clics : Number(f[principal]) || 0;
        porCamp.set(f.campaign_id, x);
      }
      for (const [id, x] of porCamp) {
        if (x.gasto > 0 && x.res === 0 && principal !== "clics") {
          out.push({ id: `sr-${c.id}-${id}`, tipo: "sin_resultados", nivel: 1, proyectoId: c.id, titulo: "Gasta sin resultados", detalle: `"${x.nombre}" lleva ${ars(x.gasto)} en 3 días y ningún${principal === "compras" ? "a venta" : principal === "leads" ? " contacto" : " mensaje"}.` });
        }
      }

      // Frecuencia de los últimos 7 días (la misma gente ve el anuncio demasiadas veces).
      for (const fr of c.meta_sync?.frecuencia ?? []) {
        if (fr.frecuencia >= 3.5) {
          out.push({ id: `fr-${c.id}-${fr.id}`, tipo: "frecuencia", nivel: fr.frecuencia >= 5 ? 1 : 0, proyectoId: c.id, titulo: "El anuncio ya cansa", detalle: `"${fr.nombre}": cada persona lo vio ${fr.frecuencia.toFixed(1).replace(".", ",")} veces en 7 días. Cambiá el anuncio.` });
        }
      }
    }
  }

  // Videos publicados con pauta y sin anuncio vinculado (últimos 30 días).
  const desde30 = sumarDiasF(hoy, -30);
  for (const v of videos) {
    if (v.etapa !== "publicado" || loSubeElCliente(v) || v.meta?.ad_id || v.meta?.campaign_id) continue;
    if (!v.pauta?.objetivo && !v.pauta?.inicio) continue;
    const pub = (v.publicacion?.publicado_at ?? "").slice(0, 10);
    if (!pub || pub < desde30) continue;
    if (!clientes.some((c) => c.id === v.proyecto_id)) continue;
    out.push({ id: `va-${v.id}`, tipo: "video_sin_anuncio", nivel: 1, proyectoId: v.proyecto_id, videoId: v.id, titulo: "Video pautado sin anuncio vinculado", detalle: `"${v.titulo}": cargá el ID del anuncio para que se vean sus resultados.` });
  }

  return out.sort((a, b) => b.nivel - a.nivel);
}
