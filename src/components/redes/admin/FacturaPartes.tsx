import { useEffect, useMemo, useState } from "react";
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
import { PlazoPago } from "@/components/redes/admin/PlazoPago";
import { errorPlazo, plazoInicial, plazoParaGuardar } from "@/lib/redes/plazoPago";
import { useAppData } from "@/contexts/app-data-context";
import { formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { getRoleInfo } from "@/lib/roles";
import {
  DIA_VENCIMIENTO,
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
  htmlBoleta,
  marcarCobrada,
  marcarPagado,
  nombrePeriodo,
  prepararFacturacion,
  textoWhatsApp,
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

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Algo salió mal");

/** Navegación de mes (◀ Octubre 2026 ▶) para las pantallas de administración. */
export function MesNav({
  mes,
  setMes,
  max,
  etiqueta = mesLabel,
}: {
  mes: string;
  setMes: (m: string) => void;
  max?: string;
  /** Cómo se muestra el mes (por defecto, "Octubre 2026"). */
  etiqueta?: (m: string) => string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border p-0.5">
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setMes(sumarMeses(mes, -1))} aria-label="Mes anterior">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[128px] text-center text-sm font-semibold">{etiqueta(mes)}</span>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setMes(sumarMeses(mes, 1))} disabled={!!max && mes >= max} aria-label="Mes siguiente">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ElegirClientes({
  mes,
  candidatos,
  planes,
  onListo,
  inline = false,
}: {
  mes: string;
  candidatos: ReturnType<typeof useRedes>["clientes"];
  planes: ReturnType<typeof useRedes>["planes"];
  onListo: () => void;
  inline?: boolean;
}) {
  const conPlan = (c: (typeof candidatos)[number]) => planDe(c, planes).precioMensual > 0;
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(inline ? candidatos.filter((c) => conPlan(c) && !c.facturacion?.pausada).map((c) => c.id) : []));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setMarcados((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const total = candidatos.filter((c) => marcados.has(c.id)).reduce((a, c) => a + planDe(c, planes).precioMensual, 0);
  const preparar = async () => {
    setBusy(true);
    try {
      const r = await prepararFacturacion(mes, [...marcados]);
      toast.success(r.creadas ? `Listas ${r.creadas} para revisar` : "Ya estaban preparadas");
      onListo();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <button type="button" className="hover:text-foreground" onClick={() => setMarcados(new Set(candidatos.map((c) => c.id)))}>
          Marcar todos
        </button>
        <button type="button" className="hover:text-foreground" onClick={() => setMarcados(new Set())}>
          Ninguno
        </button>
      </div>
      <div className="divide-y rounded-xl border bg-card">
        {candidatos.map((c) => {
          const plan = planDe(c, planes);
          return (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40">
              <Checkbox checked={marcados.has(c.id)} onCheckedChange={() => toggle(c.id)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.nombre}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {plan.precioMensual ? `${plan.nombre} · ${formatARS(plan.precioMensual)}` : "Sin plan: cargás los ítems después"}
                  {c.facturacion?.tipo === "factura" ? " · factura" : ""}
                  {c.facturacion?.pausada ? " · no se factura solo el 27" : ""}
                </span>
              </span>
            </label>
          );
        })}
        {candidatos.length === 0 && <p className="p-3 text-sm text-muted-foreground">No hay clientes para agregar.</p>}
      </div>
      <Button className="w-full" onClick={() => void preparar()} disabled={busy || marcados.size === 0}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Receipt className="mr-2 h-4 w-4" />}
        Preparar {marcados.size === 1 ? "1 boleta" : `${marcados.size} boletas`}
        {total ? ` · ${formatARS(total)}` : ""}
      </Button>
    </div>
  );
}

export function DatosFacturacionDialog({ proyectoId, onClose }: { proyectoId: string | null; onClose: () => void }) {
  const { clienteById, settings } = useRedes();
  const c = clienteById(proyectoId);
  const diaDefecto = settings.dia_vencimiento ?? DIA_VENCIMIENTO;
  const [tipo, setTipo] = useState<"boleta" | "factura">("boleta");
  const [razon, setRazon] = useState("");
  const [cuit, setCuit] = useState("");
  const [adelantado, setAdelantado] = useState("");
  const [plazo, setPlazo] = useState({ desde: "", hasta: "" });
  const [pausada, setPausada] = useState(false);
  const [recordar, setRecordar] = useState(true);
  const [fijos, setFijos] = useState<{ concepto: string; neto: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!c) return;
    const f = c.facturacion ?? {};
    setTipo(f.tipo ?? "factura");
    setRazon(f.razon_social ?? "");
    setCuit(f.cuit ?? "");
    setAdelantado(f.adelantado_hasta ?? "");
    setPlazo({ desde: plazoInicial(f.pago_desde), hasta: plazoInicial(f.pago_hasta) });
    setPausada(!!f.pausada);
    setRecordar(!f.sin_recordatorios);
    setFijos((f.extras_fijos ?? []).map((x) => ({ concepto: x.concepto, neto: String(x.neto) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId]);
  if (!c) return null;
  const errPlazo = errorPlazo(plazo.desde, plazo.hasta, diaDefecto);
  const guardar = async () => {
    setBusy(true);
    try {
      await guardarDatosFacturacion(c.id, {
        // Lo que no se edita acá (ej. la condición frente al IVA) no se pierde.
        ...(c.facturacion ?? {}),
        tipo,
        ...plazoParaGuardar(plazo.desde, plazo.hasta, diaDefecto),
        razon_social: razon.trim() || null,
        cuit: cuit.trim() || null,
        adelantado_hasta: /^\d{4}-\d{2}$/.test(adelantado) ? adelantado : null,
        pausada,
        sin_recordatorios: !recordar,
        extras_fijos: fijos.filter((x) => x.concepto.trim() && Number(x.neto) > 0).map((x) => ({ concepto: x.concepto.trim(), neto: Number(x.neto) })),
      });
      toast.success("Guardado: se usa desde la próxima boleta");
      onClose();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!proyectoId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Datos de facturación · {c.nombre}</DialogTitle>
          <DialogDescription>Se usan cada vez que se prepara su boleta.</DialogDescription>
        </DialogHeader>
        <PlazoPago desde={plazo.desde} hasta={plazo.hasta} onChange={setPlazo} adelantado={adelantado} onAdelantado={setAdelantado} />
        <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1">
          {(["boleta", "factura"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={cn("rounded-lg py-1.5 text-sm font-medium transition-all", tipo === t ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              {t === "boleta" ? "Boleta (sin IVA)" : "Factura (con IVA)"}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Razón social</Label>
            <Input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Si es distinta del nombre" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">CUIT</Label>
            <Input value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="Opcional" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ítems que se suman todos los meses</Label>
          {fijos.map((x, i) => (
            <div key={i} className="flex gap-2">
              <Input value={x.concepto} onChange={(e) => setFijos(fijos.map((y, j) => (j === i ? { ...y, concepto: e.target.value } : y)))} placeholder="Ej.: Combustible" />
              <Input
                inputMode="numeric"
                className="w-28"
                value={x.neto}
                onChange={(e) => setFijos(fijos.map((y, j) => (j === i ? { ...y, neto: e.target.value.replace(/\D/g, "") } : y)))}
                placeholder="$"
              />
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setFijos(fijos.filter((_, j) => j !== i))} aria-label="Quitar">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setFijos([...fijos, { concepto: "", neto: "" }])}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Agregar ítem fijo
          </Button>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <span>
            <span className="block text-sm font-medium">No facturarle solo el 27</span>
            <span className="block text-xs text-muted-foreground">Canje, pausa o se le factura distinto: solo se le arma si lo elegís a mano.</span>
          </span>
          <Switch checked={pausada} onCheckedChange={setPausada} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <span>
            <span className="block text-sm font-medium">Recordarle solo cuando debe</span>
            <span className="block text-xs text-muted-foreground">2 días antes del vencimiento y a los 1, 7 y 15 días de vencida, por la app y por mail.</span>
          </span>
          <Switch checked={recordar} onCheckedChange={setRecordar} />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={busy || !!errPlazo}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditarFacturaDialog({ f, onClose, ivaPct }: { f: FacturaDoc | null; onClose: () => void; ivaPct: number }) {
  const [items, setItems] = useState<ItemFactura[]>([]);
  const [tipo, setTipo] = useState<FacturaDoc["tipo"]>("boleta");
  const [vto, setVto] = useState("");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!f) return;
    setItems(f.items);
    setTipo(f.tipo);
    setVto(f.vencimiento);
    setNota(f.nota ?? "");
  }, [f]);
  if (!f) return null;
  const neto = items.reduce((a, i) => a + (Number(i.neto) || 0), 0);
  const iva = tipo === "factura" ? Math.round((neto * ivaPct) / 100) : 0;
  const guardar = async () => {
    setBusy(true);
    try {
      await editarFactura(f, { items: items.filter((i) => i.concepto.trim()), tipo, vencimiento: vto, nota: nota.trim() || null }, ivaPct);
      toast.success("Guardado");
      onClose();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!f} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{f.cliente}</DialogTitle>
          <DialogDescription>Período {nombrePeriodo(f)}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1">
          {(["boleta", "factura"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={cn("rounded-lg py-1.5 text-sm font-medium transition-all", tipo === t ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              {t === "boleta" ? "Boleta (sin IVA)" : `Factura (IVA ${ivaPct}%)`}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2">
              <Input
                value={it.concepto}
                onChange={(e) => setItems((p) => p.map((x) => (x.id === it.id ? { ...x, concepto: e.target.value } : x)))}
                placeholder="Concepto"
              />
              <Input
                inputMode="numeric"
                className="w-32 text-right"
                value={String(it.neto)}
                onChange={(e) => setItems((p) => p.map((x) => (x.id === it.id ? { ...x, neto: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)))}
              />
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} aria-label="Quitar">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setItems((p) => [...p, { id: `i${Date.now()}`, concepto: "", servicio: "EXTRAS", neto: 0 }])}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Agregar ítem
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Vence</Label>
            <Input type="date" value={vto} onChange={(e) => setVto(e.target.value)} />
          </div>
          <div className="space-y-0.5 rounded-xl bg-muted/40 p-2 text-right text-xs">
            <p className="text-muted-foreground">Neto {formatARS(neto)}</p>
            {iva > 0 && <p className="text-muted-foreground">IVA {formatARS(iva)}</p>}
            <p className="text-base font-bold">{formatARS(neto + iva)}</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Nota (sale en la boleta)</Label>
          <Textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: incluye saldo de IVA de agosto" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

