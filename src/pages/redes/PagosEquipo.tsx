import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock,
  FileSpreadsheet,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Receipt,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputNumero } from "@/components/ui/input-numero";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { planDe } from "@/lib/redes/planes";
import { PageShell, StatCard } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { getRoleInfo } from "@/lib/roles";
import {
  ESTADO_FACTURA,
  MEDIOS,
  abrirBoleta,
  UNIDAD_POR_ROL,
  anularFactura,
  calcularPago,
  descargarPlanilla,
  editarFactura,
  emitirFacturas,
  guardarAjustes,
  guardarDatosFacturacion,
  reactivarFactura,
  guardarConfigPago,
  clientesDe,
  htmlBoleta,
  marcarCobrada,
  marcarPagado,
  prepararFacturacion,
  unidadesDelMes,
  useConfigPagos,
  useFacturas,
  useLiquidaciones,
  volverAPendiente,
  type AjustePago,
  type ConfigPago,
  type FacturaDoc,
  type ItemFactura,
  type MedioCobro,
} from "@/lib/redes/facturacion";
import { DATOS_COBRO_DEFAULT, type DatosCobro } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

import { MesNav } from "@/components/redes/admin/FacturaPartes";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Algo salió mal");

/** Pagos al equipo: cuánto le corresponde a cada uno este mes y si ya se le pagó. */
export default function PagosEquipoPage() {
  const [mes, setMes] = useState(mesActual());
  return (
    <PageShell
      title="Pagos al equipo"
      subtitle="El sistema cuenta lo que hizo cada uno en el mes y calcula lo que le corresponde."
      actions={<MesNav mes={mes} setMes={setMes} max={mesActual()} />}
    >
      <PagosEquipo mes={mes} />
    </PageShell>
  );
}

function PagosEquipo({ mes }: { mes: string }) {
  const { profiles } = useAppData();
  const { videos, piezas, clientes } = useRedes();
  const cfg = useConfigPagos();
  const liqs = useLiquidaciones(mes);
  // El equipo actual, más quien tenga algo liquidado ese mes (los que ya no están, o los de la planilla sin usuario).
  const conLiq = new Set(liqs.filter((l) => l.mes === mes).map((l) => l.uid));
  const equipo = [
    ...profiles.filter((p) => (["productor", "editor", "pauta", "diseno"].includes(p.role ?? "") && p.activo !== false) || conLiq.has(p.id)),
    ...liqs
      .filter((l) => l.mes === mes && !profiles.some((p) => p.id === l.uid))
      .map((l) => ({ id: l.uid, nombre: l.nombre ?? "Sin usuario", email: "" }) as unknown as (typeof profiles)[number]),
  ];

  const filas = equipo.map((p) => {
    const unidades = unidadesDelMes(p.id, p.role ?? "", mes, videos, piezas);
    const liq = liqs.find((l) => l.uid === p.id && l.mes === mes);
    const calc = calcularPago(cfg[p.id], unidades, liq?.ajustes ?? [], clientes.map((c) => c.id));
    return { p, unidades, liq, calc };
  });
  const total = filas.reduce((a, f) => a + (f.liq?.estado === "pagado" ? (f.liq.total_pagado ?? f.calc.total) : f.calc.total), 0);
  const pagado = filas.filter((f) => f.liq?.estado === "pagado").reduce((a, f) => a + (f.liq?.total_pagado ?? 0), 0);
  const sinConfig = filas.filter((f) => !cfg[f.p.id]).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={`A pagar en ${mesLabel(mes).split(" ")[0].toLowerCase()}`} value={formatARS(total)} icon={Users} tone="primary" hint={`${filas.length} personas`} />
        <StatCard label="Ya pagado" value={formatARS(pagado)} icon={Check} tone="success" />
        <StatCard label="Falta pagar" value={formatARS(total - pagado)} icon={Clock} />
      </div>
      {sinConfig > 0 && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] p-3 text-sm">
          Cargá cómo le pagás a cada uno (fijo, por trabajo o las dos cosas) y el sistema calcula solo lo del mes con lo que hizo cada uno.
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {filas.map((f) => (
          <PersonaPago key={f.p.id} {...f} cfg={cfg[f.p.id]} mes={mes} />
        ))}
        {filas.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay equipo cargado.</p>}
      </div>
    </div>
  );
}

function PersonaPago({
  p,
  unidades,
  liq,
  calc,
  cfg,
  mes,
}: {
  p: ReturnType<typeof useAppData>["profiles"][number];
  unidades: number;
  liq?: { ajustes: AjustePago[]; estado: string; total_pagado?: number | null; importado?: boolean; detalle?: string | null };
  calc: ReturnType<typeof calcularPago>;
  cfg?: ConfigPago;
  mes: string;
}) {
  const [editandoManual, setEditando] = useState(false);
  // Sin configuración cargada, se muestra directo el formulario.
  const editando = editandoManual || !cfg;
  const [modo, setModo] = useState<ConfigPago["modo"]>(cfg?.modo ?? "fijo");
  const [fijo, setFijo] = useState(String(cfg?.fijo ?? ""));
  const [porUnidad, setPorUnidad] = useState(String(cfg?.por_unidad ?? ""));
  const { clientes } = useRedes();
  const asignados = clientesDe(p.id, clientes);
  const [porCliente, setPorCliente] = useState<Record<string, string>>(() => montosIniciales(cfg, asignados));
  const [base, setBase] = useState("");
  const [ajuste, setAjuste] = useState({ concepto: "", monto: "" });
  useEffect(() => {
    if (!cfg) return;
    setModo(cfg.modo);
    setFijo(String(cfg.fijo ?? ""));
    setPorUnidad(String(cfg.por_unidad ?? ""));
    setPorCliente(montosIniciales(cfg, asignados));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);
  const unidad = UNIDAD_POR_ROL[p.role ?? ""] ?? { label: "trabajo", plural: "trabajos" };
  const pagado = liq?.estado === "pagado";
  const ajustes = liq?.ajustes ?? [];

  const guardar = async () => {
    try {
      const montos = Object.fromEntries(Object.entries(porCliente).map(([id, v]) => [id, Number(v) || 0]).filter(([, v]) => (v as number) > 0));
      if (modo === "por_cliente" && !Object.keys(montos).length) {
        toast.error("Tildá al menos un cliente y poné cuánto le pagás por él");
        return;
      }
      await guardarConfigPago(p.id, { modo, fijo: Number(fijo) || 0, por_unidad: Number(porUnidad) || 0, por_cliente: montos, activo: true });
      setEditando(false);
      toast.success("Guardado");
    } catch (e) {
      err(e);
    }
  };
  const sumarAjuste = async () => {
    const monto = Number(ajuste.monto.replace(/[^\d-]/g, ""));
    if (!ajuste.concepto.trim() || !monto) {
      toast.error("Poné el concepto y el monto (negativo para descontar)");
      return;
    }
    try {
      await guardarAjustes(p.id, mes, [...ajustes, { concepto: ajuste.concepto.trim(), monto }]);
      setAjuste({ concepto: "", monto: "" });
    } catch (e) {
      err(e);
    }
  };
  const detalle = [
    calc.fijo ? `Fijo ${formatARS(calc.fijo)}` : "",
    calc.variable && cfg?.modo === "por_cliente"
      ? `${calc.clientes} ${calc.clientes === 1 ? "cliente" : "clientes"}: ${Object.entries(cfg.por_cliente ?? {})
          .filter(([id, m]) => m > 0 && clientes.some((c) => c.id === id))
          .map(([id, m]) => `${clientes.find((c) => c.id === id)?.nombre} ${formatARS(m)}`)
          .join(", ")}`
      : calc.variable
        ? `${unidades} ${unidades === 1 ? unidad.label : unidad.plural} × ${formatARS(cfg?.por_unidad ?? 0)}`
        : "",
    ...ajustes.map((a) => `${a.concepto} ${formatARS(a.monto)}`),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("space-y-3 rounded-2xl border bg-card p-4", pagado && "border-emerald-500/40")}>
      <div className="flex items-center gap-3">
        <UserAvatar profile={p} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{p.nombre}</p>
          <p className="text-xs text-muted-foreground">
            {getRoleInfo(p.role).label} ·{" "}
            {cfg?.modo === "por_cliente"
              ? `${calc.clientes} ${calc.clientes === 1 ? "cliente" : "clientes"}`
              : `${unidades} ${unidades === 1 ? unidad.label : unidad.plural} en el mes`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums">{formatARS(pagado ? (liq?.total_pagado ?? calc.total) : calc.total)}</p>
          <p className={cn("text-[11px] font-medium", pagado ? "text-emerald-600" : "text-muted-foreground")}>{pagado ? "Pagado" : "A pagar"}</p>
        </div>
      </div>
      {liq?.importado ? (
        <p className="text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">De la planilla</span> {liq.detalle}
        </p>
      ) : (
        detalle && <p className="text-xs text-muted-foreground">{detalle}</p>
      )}

      {editando ? (
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
          <p className="text-xs font-semibold">¿Cómo le pagás?</p>
          <Select value={modo} onValueChange={(v) => setModo(v as ConfigPago["modo"])}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fijo">Sueldo fijo por mes</SelectItem>
              <SelectItem value="por_unidad">Por {unidad.label}</SelectItem>
              <SelectItem value="mixto">Fijo + por {unidad.label}</SelectItem>
              <SelectItem value="por_cliente">Por cliente (y fijo si querés)</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            {modo !== "por_unidad" && (
              <div className="space-y-1">
                <Label className="text-[11px]">{modo === "por_cliente" ? "Fijo por mes (opcional)" : "Fijo por mes"}</Label>
                <InputNumero value={fijo} onChange={(e) => setFijo(e.target.value.replace(/\D/g, ""))} />
              </div>
            )}
            {modo !== "fijo" && modo !== "por_cliente" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Por {unidad.label}</Label>
                <InputNumero value={porUnidad} onChange={(e) => setPorUnidad(e.target.value.replace(/\D/g, ""))} />
              </div>
            )}
          </div>
          {modo === "por_cliente" && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Tildá los clientes que lleva y cuánto le pagás por cada uno. Si uno da más trabajo, cambiale el monto solo a ese.
              </p>
              <div className="flex gap-2">
                <InputNumero
                  className="h-8"
                  placeholder="Mismo monto para todos los tildados"
                  value={base}
                  onChange={(e) => setBase(e.target.value.replace(/\D/g, ""))}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  disabled={!base}
                  onClick={() => setPorCliente((m) => Object.fromEntries(Object.keys(m).map((id) => [id, base])))}
                >
                  Aplicar
                </Button>
              </div>
              <div className="divide-y rounded-lg border bg-background sm:max-h-64 sm:overflow-y-auto">
                {clientes.map((c) => {
                  const tildado = porCliente[c.id] !== undefined;
                  return (
                    <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5">
                      <Checkbox
                        checked={tildado}
                        aria-label={`Lleva ${c.nombre}`}
                        onCheckedChange={() =>
                          setPorCliente((m) => {
                            const n = { ...m };
                            if (tildado) delete n[c.id];
                            else n[c.id] = base || "";
                            return n;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {c.nombre}
                        {asignados.some((a) => a.id === c.id) && <span className="ml-1.5 text-[10px] text-muted-foreground">asignado</span>}
                      </span>
                      {tildado && (
                        <InputNumero
                          className="h-7 w-28 text-right"
                          placeholder="$"
                          aria-label={`Monto por ${c.nombre}`}
                          value={porCliente[c.id]}
                          onChange={(e) => setPorCliente((m) => ({ ...m, [c.id]: e.target.value.replace(/\D/g, "") }))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-right text-xs">
                Total por clientes:{" "}
                <b className="tabular-nums">{formatARS(Object.values(porCliente).reduce((a, v) => a + (Number(v) || 0), 0))}</b>
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {cfg && (
              <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
            )}
            <Button size="sm" onClick={() => void guardar()}>
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditando(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Cómo le pago
          </Button>
          {!pagado && (
            <details className="text-xs">
              <summary className="cursor-pointer rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted">+ Bono o descuento</summary>
              <div className="mt-2 flex gap-2">
                <Input className="h-8" value={ajuste.concepto} onChange={(e) => setAjuste((a) => ({ ...a, concepto: e.target.value }))} placeholder="Concepto" />
                <InputNumero negativos className="h-8 w-28" value={ajuste.monto} onChange={(e) => setAjuste((a) => ({ ...a, monto: e.target.value }))} placeholder="Monto" />
                <Button size="sm" className="h-8" onClick={() => void sumarAjuste()}>
                  Sumar
                </Button>
              </div>
            </details>
          )}
          <Button
            size="sm"
            variant={pagado ? "ghost" : "secondary"}
            className="ml-auto h-8"
            onClick={() =>
              void marcarPagado(p.id, mes, calc.total, detalle, !pagado)
                .then(() => toast.success(pagado ? "Volvió a pendiente" : "Marcado como pagado"))
                .catch(err)
            }
          >
            {pagado ? "Deshacer" : (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Marcar pagado
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Montos por cliente para el formulario: lo guardado o, si no hay, los clientes asignados vacíos. */
function montosIniciales(cfg: ConfigPago | undefined, asignados: { id: string }[]): Record<string, string> {
  if (cfg?.por_cliente && Object.keys(cfg.por_cliente).length)
    return Object.fromEntries(Object.entries(cfg.por_cliente).map(([id, m]) => [id, String(m)]));
  return Object.fromEntries(asignados.map((c) => [c.id, ""]));
}
