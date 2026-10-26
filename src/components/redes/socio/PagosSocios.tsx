import { CheckCircle2, Handshake, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/redes/PageShell";
import { db, doc, setDoc } from "@/lib/db";
import { formatARS, mesLabel } from "@/lib/redes/format";
import { assertEditable } from "@/lib/redes/vistaComo";
import { useResumenSocios } from "@/pages/redes/Socios";
import { useLiquidacionesSocio } from "./GananciasSocio";

// Pagos al equipo → socios comerciales: la comisión del mes (sobre lo cobrado de sus clientes) y marcarla pagada.
// Queda en socio_liquidaciones/socio_{uid}_{mes} (aparte de la liquidación del equipo, por si también trabaja en Prodi).

export function PagosSocios({ mes }: { mes: string }) {
  const { socios, error } = useResumenSocios(mes);
  const liqs = useLiquidacionesSocio();
  if (error) return null;
  if (!socios)
    return (
      <div className="mt-8 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  const pagoDe = (uid: string) => liqs.find((l) => l.uid === uid && l.mes === mes && l.estado === "pagado");
  const lista = socios.filter((s) => s.total > 0 || s.sin_config || pagoDe(s.uid));
  if (!lista.length) return null;

  const marcar = async (uid: string, total: number, detalle: string, pagado: boolean) => {
    try {
      assertEditable();
      await setDoc(
        doc(db, "socio_liquidaciones", `socio_${uid}_${mes}`),
        pagado ? { uid, mes, estado: "pagado", total_pagado: total, pagado_at: new Date().toISOString(), detalle } : { uid, mes, estado: "pendiente", total_pagado: null, pagado_at: null },
        { merge: true }
      );
      toast.success(pagado ? "Comisión marcada como pagada" : "Vuelve a falta pagar");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    }
  };

  return (
    <Section title="Vendedores" className="mt-10" description={`Comisión sobre lo cobrado en ${mesLabel(mes).split(" ")[0].toLowerCase()} de los clientes que trajeron (abono neto, sin IVA, pauta ni reintegros).`}>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {lista.map((s) => {
          const p = pagoDe(s.uid);
          const detalle = s.lineas.map((l) => `${l.cliente} (${l.periodo}): ${formatARS(l.comision)}`).join(" · ");
          return (
            <li key={s.uid} className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#6F40FC]/12 text-[#6F40FC]">
                <Handshake className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.nombre}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {s.sin_config ? (
                    <b className="text-amber-600 dark:text-amber-400">Sin comisión cargada: cargá la estándar en CRM → Vendedores</b>
                  ) : (
                    `${s.vigente!.comision_pct}%${s.vigente!.modo === "entrada" ? " del primer abono" : ""} de ${formatARS(s.base)} · ${s.lineas.length} abono${s.lineas.length === 1 ? "" : "s"}`
                  )}
                </span>
              </span>
              <span className="text-right font-bold tabular-nums">{formatARS(p?.total_pagado ?? s.total)}</span>
              {p ? (
                <span className="flex items-center gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Pagado
                  </span>
                  <Button size="icon" variant="ghost" className="h-8 w-8" title="Deshacer" onClick={() => void marcar(s.uid, 0, "", false)}>
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </span>
              ) : (
                <Button size="sm" className="h-9 rounded-full" disabled={!(s.total > 0)} onClick={() => void marcar(s.uid, s.total, detalle, true)}>
                  Marcar pagado
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
