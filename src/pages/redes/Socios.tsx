import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { AlertTriangle, ChevronDown, Handshake, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SocioDialog, type SocioEditable } from "@/components/redes/socio/SocioDialog";
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
  /** La comisión que se le aplica: la suya o la estándar. */
  vigente: { comision_pct: number; meses: number; propia: boolean } | null;
  leads: number;
  ganados: number;
  clientes: number;
  base: number;
  total: number;
  lineas: { factura_id: string; cliente: string; periodo: string; base: number; comision: number }[];
}

export function useResumenSocios(mes: string, activo = true, version = 0) {
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
  }, [mes, activo, version]);
  return { socios, error };
}

export default function Socios() {
  // A mes vencido: lo que se paga ahora es lo cobrado el mes pasado.
  const [mes, setMes] = useState(sumarMeses(mesActual(), -1));
  const [version, setVersion] = useState(0);
  const { socios, error } = useResumenSocios(mes, true, version);
  const [abierto, setAbierto] = useState<string | null>(null);
  // Nuevo socio (null) o editar uno; undefined = cerrado.
  const [dialogo, setDialogo] = useState<SocioEditable | null | undefined>(undefined);
  const total = (socios ?? []).reduce((a, s) => a + s.total, 0);
  const estandar = useEstandar(version);
  const faltan = (socios ?? []).filter((s) => s.activo && s.sin_config);

  return (
    <PageShell
      title="Vendedores"
      subtitle="Los que te pasan clientes a comisión: cuántos trajeron, lo cobrado y lo que ganan."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <MesNav mes={mes} setMes={setMes} max={mesActual()} />
          <Button onClick={() => setDialogo(null)} className="h-11 rounded-2xl bg-[#6F40FC] px-4 font-semibold text-white hover:bg-[#5d32e6]">
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo vendedor
          </Button>
        </div>
      }
    >
      <ComisionEstandar actual={estandar} onListo={() => setVersion((x) => x + 1)} />
      <SocioDialog socio={dialogo ?? null} open={dialogo !== undefined} onOpenChange={(v) => !v && setDialogo(undefined)} onListo={() => setVersion((x) => x + 1)} />
      {faltan.length > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3.5 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>{faltan.map((s) => s.nombre.split(" ")[0]).join(", ")}</b> no {faltan.length === 1 ? "tiene" : "tienen"} comisión: cargá la estándar arriba (o una propia con «Editar»).
          </span>
        </p>
      )}
      {error && <p className="rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {!socios && !error ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : socios && socios.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed p-10 text-center">
          <Handshake className="h-8 w-8 text-[#6F40FC]" />
          <p className="mt-2 font-semibold">Todavía no hay vendedores</p>
          <p className="mt-1 text-sm text-muted-foreground">Crealo acá: alguien nuevo o alguien que ya tiene usuario.</p>
          <Button onClick={() => setDialogo(null)} className="mt-4 h-11 rounded-2xl bg-[#6F40FC] px-5 font-semibold text-white hover:bg-[#5d32e6]">
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo vendedor
          </Button>
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
                      {s.sin_config ? (
                        <b className="text-amber-600 dark:text-amber-400">sin comisión</b>
                      ) : (
                        `${s.vigente!.comision_pct}% por ${s.vigente!.meses} meses${s.vigente!.propia ? "" : " (estándar)"}`
                      )}
                    </span>
                  </span>
                  <span className="hidden text-right text-xs text-muted-foreground sm:block">
                    {s.leads} pasados · {s.ganados} ganados
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
                      {s.leads} pasados · {s.ganados} ganados
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
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">Abono neto cobrado, sin IVA, sin pauta ni reintegros. Se paga en Pagos al equipo.</p>
                      <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => setDialogo({ uid: s.uid, nombre: s.nombre, config: s.config })}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar comisión
                      </Button>
                    </div>
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

/** La comisión estándar (para todos los que no tienen una propia). */
function useEstandar(version: number) {
  const [e, setE] = useState<{ comision_pct: number; meses: number } | null | undefined>(undefined);
  useEffect(() => {
    callApi<{ estandar: { comision_pct: number; meses: number } | null }>("/api/web/socio-estandar", { ver: true })
      .then((r) => setE(r.estandar))
      .catch(() => setE(null));
  }, [version]);
  return e;
}

function ComisionEstandar({ actual, onListo }: { actual: { comision_pct: number; meses: number } | null | undefined; onListo: () => void }) {
  const [editando, setEditando] = useState(false);
  const [pct, setPct] = useState("");
  const [meses, setMeses] = useState("");
  const [guardando, setGuardando] = useState(false);
  if (actual === undefined) return null;
  const abrir = () => {
    setPct(actual ? String(actual.comision_pct) : "");
    setMeses(actual ? String(actual.meses) : "");
    setEditando(true);
  };
  const guardar = async () => {
    setGuardando(true);
    try {
      await callApi("/api/web/socio-estandar", { comision_pct: pct, meses });
      toast.success("Comisión estándar guardada");
      setEditando(false);
      onListo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Comisión estándar</span>
        <span className="block text-xs text-muted-foreground">
          {actual ? `${actual.comision_pct}% del abono durante ${actual.meses} meses, para todos los que no tienen otra.` : "Cargala una vez y vale para todos (cada uno puede tener la suya)."}
        </span>
      </span>
      {editando ? (
        <span className="flex flex-wrap items-center gap-2">
          <Input type="number" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="%" className="h-10 w-20 rounded-xl" aria-label="Porcentaje" />
          <span className="text-sm text-muted-foreground">% por</span>
          <Input type="number" inputMode="numeric" value={meses} onChange={(e) => setMeses(e.target.value)} placeholder="meses" className="h-10 w-20 rounded-xl" aria-label="Meses" />
          <span className="text-sm text-muted-foreground">meses</span>
          <Button size="sm" className="h-10 rounded-xl" disabled={guardando || !pct || !meses} onClick={() => void guardar()}>
            Guardar
          </Button>
        </span>
      ) : (
        <Button size="sm" variant={actual ? "outline" : "default"} className="h-9 rounded-full" onClick={abrir}>
          {actual ? "Cambiar" : "Cargar"}
        </Button>
      )}
    </div>
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
