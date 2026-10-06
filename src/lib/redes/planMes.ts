// Plan del mes con IA: la IA propone, producción revisa y recién ahí le llega al cliente.
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { callApi } from "@/lib/redes/api";
import { assertEditable } from "@/lib/redes/vistaComo";
import { diaAR } from "@/lib/fecha";
import { mesActual, sumarMeses } from "./format";
import type { ContextoComercial, EstadoPlanMes, IdeaPlan, MemoriaIA, PlanMes } from "./types";

export const PLANES_MES = "planes_mes";
export const planMesId = (proyectoId: string, mes: string) => `${proyectoId}_${mes}`;

/** Desde el 15 se arma el mes que viene; antes, el actual. */
export function mesParaPlanificar(d = new Date()): string {
  return diaAR(d) >= 15 ? sumarMeses(mesActual(d), 1) : mesActual(d);
}

export const ESTADO_PLAN: Record<EstadoPlanMes | "nada", { label: string; clase: string }> = {
  nada: { label: "Sin armar", clase: "bg-muted text-muted-foreground" },
  borrador: { label: "Borrador · revisalo", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  enviado: { label: "Esperando al cliente", clase: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  respondido: { label: "Pidió cambios", clase: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  cerrado: { label: "Listo", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

/** Ideas con pedido de cambio que producción todavía no resolvió. */
export const cambiosPendientes = (p: PlanMes | null | undefined) =>
  (p?.ideas ?? []).filter((i) => i.respuesta?.ok === false && !i.video_id && !i.descartada);

/** Un plan (el cliente solo lo ve cuando ya se lo mandaron). */
export function usePlanMes(proyectoId: string | null | undefined, mes: string): { plan: PlanMes | null; loading: boolean } {
  const [plan, setPlan] = useState<PlanMes | null>(null);
  const [loading, setLoading] = useState(true);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    if (!proyectoId) {
      setPlan(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let reintento = 0;
    const unsub = onSnapshot(
      doc(db, PLANES_MES, planMesId(proyectoId, mes)),
      (s) => {
        setPlan(s.exists() ? ({ id: s.id, ...s.data() } as PlanMes) : null);
        setLoading(false);
      },
      () => {
        // El cliente no puede leer el borrador: Firestore corta la escucha. Se vuelve a
        // intentar cada un rato para que aparezca apenas producción se lo mande.
        setPlan(null);
        setLoading(false);
        reintento = window.setTimeout(() => setIntento((n) => n + 1), 45_000);
      }
    );
    return () => {
      unsub();
      window.clearTimeout(reintento);
    };
  }, [proyectoId, mes, intento]);
  return { plan, loading };
}

/** Todos los planes de un mes (equipo). */
export function usePlanesDelMes(meses: string[], enabled = true): PlanMes[] {
  const [planes, setPlanes] = useState<PlanMes[]>([]);
  const key = meses.join(",");
  useEffect(() => {
    if (!enabled || meses.length === 0) {
      setPlanes([]);
      return;
    }
    return onSnapshot(
      query(collection(db, PLANES_MES), where("mes", "in", meses)),
      (s) => setPlanes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as PlanMes)),
      () => setPlanes([])
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return planes;
}

export function useMemoriaIA(proyectoId: string | null | undefined): MemoriaIA | null {
  const [m, setM] = useState<MemoriaIA | null>(null);
  useEffect(() => {
    if (!proyectoId) {
      setM(null);
      return;
    }
    return onSnapshot(
      doc(db, "ia_memoria", proyectoId),
      (s) => setM(s.exists() ? (s.data() as MemoriaIA) : null),
      () => setM(null)
    );
  }, [proyectoId]);
  return m;
}

export const armarPlan = (proyectoId: string, mes: string, pista?: string | null) =>
  callApi<{ ok: true; ideas: IdeaPlan[] }>("/api/ia/plan-mes", { proyecto_id: proyectoId, mes, pista: pista ?? null });

export const rehacerIdea = (proyectoId: string, mes: string, ideaId: string, pista?: string | null) =>
  callApi<{ ok: true; idea: IdeaPlan }>("/api/ia/plan-mes", { proyecto_id: proyectoId, mes, idea_id: ideaId, pista: pista ?? null });

/** Guarda lo que va editando producción (solo en borrador). */
export async function guardarBorrador(plan: PlanMes, ideas: IdeaPlan[], nota: string | null) {
  assertEditable();
  await updateDoc(doc(db, PLANES_MES, plan.id), { ideas, nota_equipo: nota, updated_at: new Date().toISOString() });
}

export const enviarPlan = (proyectoId: string, mes: string, ideas: IdeaPlan[], nota: string | null) =>
  callApi("/api/ia/plan-enviar", { proyecto_id: proyectoId, mes, ideas, nota_equipo: nota });

export const responderPlan = (
  proyectoId: string,
  mes: string,
  respuestas: { id: string; ok: boolean; comentario?: string | null }[],
  nota: string | null
) => callApi<{ ok: true; aprobadas: number; cambios: number }>("/api/ia/plan-responder", { proyecto_id: proyectoId, mes, respuestas, nota });

export const ajustarIdea = (
  proyectoId: string,
  mes: string,
  ideaId: string,
  accion: "crear" | "descartar",
  datos: { titulo?: string; idea?: string; objetivo?: string | null } = {}
) => callApi<{ ok: true; video_id: string | null }>("/api/ia/plan-ajustar", { proyecto_id: proyectoId, mes, idea_id: ideaId, accion, ...datos });

export const guardarComercial = (proyectoId: string, comercial: ContextoComercial) =>
  callApi<{ ok: true; comercial: ContextoComercial }>("/api/ia/comercial-guardar", { proyecto_id: proyectoId, comercial });

/**
 * Contexto comercial de un cliente. El equipo lo escucha en vivo; el cliente lo pide al servidor
 * (no tiene acceso a la memoria de la IA, solo a esta parte).
 */
export function useComercial(proyectoId: string, viaServidor: boolean): [ContextoComercial | undefined, (c: ContextoComercial) => void] {
  const memoria = useMemoriaIA(viaServidor ? null : proyectoId);
  const [delServidor, setDelServidor] = useState<ContextoComercial | undefined>(undefined);
  useEffect(() => {
    if (!viaServidor) return;
    let vivo = true;
    callApi<{ comercial: ContextoComercial }>("/api/ia/comercial-ver", { proyecto_id: proyectoId })
      .then((r) => vivo && setDelServidor(r.comercial ?? {}))
      .catch(() => vivo && setDelServidor({}));
    return () => {
      vivo = false;
    };
  }, [proyectoId, viaServidor]);
  return [viaServidor ? delServidor : memoria?.comercial, setDelServidor];
}

export const guardarNotasIA = (proyectoId: string, notas: string) =>
  callApi("/api/ia/memoria-notas", { proyecto_id: proyectoId, notas });
