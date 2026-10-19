import type { Project } from "@/integrations/firebase/types";
import type { PautaDia } from "@/lib/redes/metaPauta";
import { estadoMes, evaluarPauta, REGLAS_DEFAULT, type ReglaPauta } from "../../../api/_lib/pauta-reglas";

// Alertas para quien maneja la pauta: lo que hay que tocar hoy en Meta, con el diagnóstico y qué hacer. Las reglas
// son las mismas que usa el cron para avisar (api/_lib/pauta-reglas.ts); cuáles están prendidas se elige en Ajustes.

export type TipoAlerta = ReglaPauta;

export interface AlertaPauta {
  id: string;
  tipo: TipoAlerta;
  /** 2 = urgente, 1 = mirar hoy, 0 = para tener en cuenta. */
  nivel: 0 | 1 | 2;
  proyectoId: string;
  titulo: string;
  detalle: string;
}

/** Presupuesto mensual de pauta del cliente: el que eligió él o, si no, el de su plan. */
export function presupuestoPauta(c: Project): number | null {
  const elegido = (c as { pauta_cliente?: { monto?: number } }).pauta_cliente?.monto;
  const m = elegido ?? c.plan_redes_override?.pauta?.monto ?? null;
  return m && m > 0 ? m : null;
}

/** Cómo viene la inversión del mes contra el presupuesto (y a qué ritmo). En pesos; en dólares no se compara. */
export function estadoPresupuesto(c: Project, filas: PautaDia[], hoy: string) {
  return estadoMes(
    filas.filter((f) => f.proyecto_id === c.id),
    hoy,
    presupuestoPauta(c)
  );
}

export function alertasPauta({ clientes, filas, hoy, reglas = REGLAS_DEFAULT }: { clientes: Project[]; filas: PautaDia[]; hoy: string; reglas?: Record<ReglaPauta, boolean> }): AlertaPauta[] {
  const out: AlertaPauta[] = [];
  for (const c of clientes) {
    if (c.enabled === false || !c.meta?.ad_account_id) continue;
    const mias = filas.filter((f) => f.proyecto_id === c.id);
    for (const a of evaluarPauta({ filas: mias, hoy, presupuesto: presupuestoPauta(c), frecuencia: c.meta_sync?.frecuencia ?? [], reglas })) {
      out.push({ id: `${a.id}-${c.id}`, tipo: a.regla, nivel: a.nivel, proyectoId: c.id, titulo: a.titulo, detalle: a.detalle });
    }
  }
  return out.sort((a, b) => b.nivel - a.nivel);
}
