import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Clock, HandCoins, Loader2 } from "lucide-react";
import { collection, db, onSnapshot, query, where } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { fechaCorta, formatARS, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { usePoppins } from "./usePoppins";

// "Mis ganancias" del socio comercial: la comisión de cada mes (sobre lo cobrado de sus clientes) y si ya se le
// pagó. Se paga a mes vencido, como el resto del equipo.

interface MesComision {
  mes: string;
  sin_config: boolean;
  config: { comision_pct: number | null; meses: number | null } | null;
  vigente: { comision_pct: number; meses: number } | null;
  base: number;
  total: number;
  lineas: { factura_id: string; cliente: string; periodo: string; base: number; comision: number }[];
}
export interface LiquidacionSocio {
  id: string;
  uid: string;
  mes: string;
  estado: "pendiente" | "pagado";
  total_pagado?: number | null;
  pagado_at?: string | null;
}

/** Lo que ya se le pagó a cada socio (socio_liquidaciones/socio_{uid}_{mes}). */
export function useLiquidacionesSocio(uid?: string) {
  const [lista, setLista] = useState<LiquidacionSocio[]>([]);
  useEffect(() => {
    const q = uid ? query(collection(db, "socio_liquidaciones"), where("uid", "==", uid)) : collection(db, "socio_liquidaciones");
    return onSnapshot(q, (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() }) as LiquidacionSocio)));
  }, [uid]);
  return lista;
}

const nombreMes = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();

export function GananciasSocio({ uid }: { uid: string }) {
  usePoppins();
  const [meses, setMeses] = useState<MesComision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const liqs = useLiquidacionesSocio(uid);
  useEffect(() => {
    callApi<{ meses: MesComision[] }>("/api/web/socio-ganancias", { meses: 6 })
      .then((r) => setMeses(r.meses))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar"));
  }, []);

  if (error) return <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (!meses)
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  const sinConfig = meses[0]?.sin_config;
  // A mes vencido: lo que se cobra ahora es la comisión del mes pasado.
  const vencido = sumarMeses(mesActual(), -1);
  const delMes = (m: string) => meses.find((x) => x.mes === m);
  const pago = (m: string) => liqs.find((l) => l.mes === m && l.estado === "pagado");
  const actual = delMes(vencido);

  return (
    <div className="space-y-5 font-[Poppins,Inter,sans-serif]">
      {sinConfig && (
        <div className="rounded-2xl border border-dashed p-5 text-center">
          <HandCoins className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 font-semibold">Todavía falta acordar tu comisión</p>
          <p className="text-sm text-muted-foreground">Cuando Prodi la cargue, acá vas a ver lo que ganás por cada cliente que traigas.</p>
        </div>
      )}
      {!sinConfig && (
        <div className={cn("rounded-3xl p-5", pago(vencido) ? "bg-emerald-500/[0.08] ring-1 ring-emerald-500/30" : "bg-[#0a0a0a] text-white")}>
          <p className={cn("text-sm", pago(vencido) ? "text-muted-foreground" : "text-white/70")}>
            {pago(vencido) ? `Te pagamos ${nombreMes(vencido)}` : `Tu comisión de ${nombreMes(vencido)}`}
          </p>
          <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight">{formatARS(pago(vencido)?.total_pagado ?? actual?.total ?? 0)}</p>
          <p className={cn("mt-1 text-xs", pago(vencido) ? "text-muted-foreground" : "text-white/60")}>
            {actual?.vigente?.comision_pct ?? meses[0]?.vigente?.comision_pct}% de {formatARS(actual?.base ?? 0)} cobrados de tus clientes · {pago(vencido) ? `pagado el ${fechaCorta(pago(vencido)!.pagado_at ?? "")}` : `se paga en ${nombreMes(mesActual())}`}
          </p>
        </div>
      )}
      <ul className="overflow-hidden rounded-3xl border bg-card">
        {meses.map((m) => {
          const p = pago(m.mes);
          const enCurso = m.mes === mesActual();
          return (
            <li key={m.mes} className="border-b last:border-0">
              <button type="button" onClick={() => setAbierto(abierto === m.mes ? null : m.mes)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold capitalize">{mesLabel(m.mes)}</span>
                  <span className="block text-xs text-muted-foreground">{m.lineas.length ? `${m.lineas.length} abono${m.lineas.length === 1 ? "" : "s"} cobrado${m.lineas.length === 1 ? "" : "s"}` : "Sin cobros de tus clientes"}</span>
                </span>
                <span className="text-right">
                  <span className="block font-bold tabular-nums">{formatARS(p?.total_pagado ?? m.total)}</span>
                  <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", p ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                    {p ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {p ? "Pagado" : enCurso ? "Va sumando" : m.total ? "Falta pagar" : "—"}
                  </span>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto === m.mes && "rotate-180")} />
              </button>
              {abierto === m.mes && m.lineas.length > 0 && (
                <ul className="space-y-1 bg-muted/30 px-4 py-3 text-sm">
                  {m.lineas.map((l) => (
                    <li key={`${l.factura_id}-${l.cliente}`} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {l.cliente} <span className="text-xs text-muted-foreground">· abono de {nombreMes(l.periodo)}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatARS(l.comision)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Sobre el abono neto que pagan tus clientes (sin IVA, sin la inversión en publicidad ni reintegros), durante los meses de tu acuerdo desde que cada uno se
        da de alta.
      </p>
    </div>
  );
}
