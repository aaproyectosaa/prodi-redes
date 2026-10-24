import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, Handshake, Loader2 } from "lucide-react";
import { PageShell } from "@/components/redes/PageShell";
import { MesNav } from "@/components/redes/admin/FacturaPartes";
import { callApi } from "@/lib/redes/api";
import { formatARS, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

// Resumen de los socios comerciales (admin): cuántos leads trajo cada uno, cuántos se ganaron, sus clientes, lo
// facturado (cobrado) de esos clientes en el mes y la comisión. Se paga desde Pagos al equipo, a mes vencido.

export interface ResumenSocio {
  uid: string;
  nombre: string;
  activo: boolean;
  config: { codigo: string; comision_pct: number | null; meses: number | null } | null;
  sin_config: boolean;
  leads: number;
  ganados: number;
  clientes: number;
  base: number;
  total: number;
  lineas: { factura_id: string; cliente: string; periodo: string; base: number; comision: number }[];
}

export function useResumenSocios(mes: string, activo = true) {
  const [socios, setSocios] = useState<ResumenSocio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    setSocios(null);
    callApi<{ socios: ResumenSocio[] }>("/api/web/socio-resumen", { mes })
      .then((r) => vivo && setSocios(r.socios))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "No se pudo cargar"));
    return () => {
      vivo = false;
    };
  }, [mes, activo]);
  return { socios, error };
}

export default function Socios() {
  // A mes vencido: lo que se paga ahora es lo cobrado el mes pasado.
  const [mes, setMes] = useState(sumarMeses(mesActual(), -1));
  const { socios, error } = useResumenSocios(mes);
  const [abierto, setAbierto] = useState<string | null>(null);
  const total = (socios ?? []).reduce((a, s) => a + s.total, 0);
  const faltan = (socios ?? []).filter((s) => s.activo && s.sin_config);

  return (
    <PageShell
      title="Socios comerciales"
      subtitle="Los que traen clientes: sus leads, lo cobrado de sus clientes y su comisión."
      actions={<MesNav mes={mes} setMes={setMes} max={mesActual()} />}
    >
      {faltan.length > 0 && (
        <Link to="/equipo" className="mb-4 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3.5 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>{faltan.map((s) => s.nombre.split(" ")[0]).join(", ")}</b> no {faltan.length === 1 ? "tiene" : "tienen"} cargado el porcentaje o los meses de comisión: no se calcula.
            Cargalo en Equipo →
          </span>
        </Link>
      )}
      {error && <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {!socios && !error ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : socios && socios.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed p-10 text-center">
          <Handshake className="h-8 w-8 text-[#6F40FC]" />
          <p className="mt-2 font-semibold">Todavía no hay socios</p>
          <p className="mt-1 text-sm text-muted-foreground">Crealos en Equipo con el rol «Socio comercial» (solo o junto a otro rol).</p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Leads traídos" valor={String((socios ?? []).reduce((a, s) => a + s.leads, 0))} />
            <Kpi label="Clientes ganados" valor={String((socios ?? []).reduce((a, s) => a + s.ganados, 0))} />
            <Kpi label={`Cobrado en ${mesLabel(mes).split(" ")[0].toLowerCase()}`} valor={formatARS((socios ?? []).reduce((a, s) => a + s.base, 0))} />
            <Kpi label="Comisiones" valor={formatARS(total)} destacado />
          </div>
          <ul className="space-y-2">
            {(socios ?? []).map((s) => (
              <li key={s.uid} className={cn("overflow-hidden rounded-2xl border bg-card", !s.activo && "opacity-60")}>
                <button type="button" onClick={() => setAbierto(abierto === s.uid ? null : s.uid)} className="flex w-full items-center gap-3 p-4 text-left">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#6F40FC]/12 text-[#6F40FC]">
                    <Handshake className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {s.nombre} {!s.activo && <span className="text-xs font-normal text-muted-foreground">(desactivado)</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.config?.codigo ? `?ref=${s.config.codigo}` : "sin código"} ·{" "}
                      {s.sin_config ? <b className="text-amber-600 dark:text-amber-400">sin comisión cargada</b> : `${s.config!.comision_pct}% por ${s.config!.meses} meses`}
                    </span>
                  </span>
                  <span className="hidden text-right text-xs text-muted-foreground sm:block">
                    {s.leads} leads · {s.ganados} ganados · {s.clientes} clientes
                  </span>
                  <span className="text-right">
                    <span className="block font-bold tabular-nums">{formatARS(s.total)}</span>
                    <span className="block text-[11px] text-muted-foreground">de {formatARS(s.base)}</span>
                  </span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto === s.uid && "rotate-180")} />
                </button>
                {abierto === s.uid && (
                  <div className="border-t bg-muted/30 px-4 py-3 text-sm">
                    <p className="mb-2 text-xs text-muted-foreground sm:hidden">
                      {s.leads} leads · {s.ganados} ganados · {s.clientes} clientes
                    </p>
                    {s.lineas.length === 0 ? (
                      <p className="text-muted-foreground">Sin abonos cobrados de sus clientes en este mes.</p>
                    ) : (
                      <ul className="space-y-1">
                        {s.lineas.map((l) => (
                          <li key={`${l.factura_id}-${l.cliente}`} className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate">
                              {l.cliente} <span className="text-xs text-muted-foreground">· abono de {mesLabel(l.periodo).toLowerCase()}</span>
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {formatARS(l.base)} → <b>{formatARS(l.comision)}</b>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-[11px] text-muted-foreground">Abono neto cobrado, sin IVA, sin pauta ni reintegros. Se paga en Pagos al equipo.</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}

function Kpi({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-3.5", destacado ? "border-[#6F40FC]/30 bg-[#6F40FC]/8" : "bg-card")}>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", destacado && "text-[#6F40FC] dark:text-[#a98bff]")}>{valor}</p>
    </div>
  );
}
