import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, FileSpreadsheet, Loader2, Pencil, Plus, Repeat, Trash2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageShell, Section, StatCard } from "@/components/redes/PageShell";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import {
  CATEGORIAS_GASTO,
  MEDIOS,
  borrarGasto,
  copiarFijos,
  descargarLibro,
  guardarGasto,
  useGastos,
  type CategoriaGasto,
  type Gasto,
  type MedioCobro,
} from "@/lib/redes/facturacion";
import { cn } from "@/lib/utils";
import { useLibroMes } from "@/lib/redes/libro";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Algo salió mal");

/** Gastos del negocio y libro del mes para el contador. */
export default function Gastos() {
  const { user } = useUserProfileContext();
  const [mes, setMes] = useState(mesActual());
  const anterior = sumarMeses(mes, -1);
  const todos = useGastos(anterior);
  const gastos = todos.filter((g) => g.mes === mes);
  const previos = todos.filter((g) => g.mes === anterior);
  const [editar, setEditar] = useState<Gasto | "nuevo" | null>(null);
  const [copiando, setCopiando] = useState(false);

  const total = gastos.reduce((a, g) => a + g.monto, 0);
  const totalAnt = previos.reduce((a, g) => a + g.monto, 0);
  const fijos = gastos.filter((g) => g.fijo).reduce((a, g) => a + g.monto, 0);
  const faltanFijos = previos.filter((p) => p.fijo && !gastos.some((g) => g.fijo && g.concepto === p.concepto)).length;
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    gastos.forEach((g) => m.set(g.categoria, (m.get(g.categoria) ?? 0) + g.monto));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [gastos]);
  const maxCat = Math.max(1, ...porCategoria.map(([, v]) => v));

  const { libro, ingresos, egresos } = useLibroMes(mes);

  const copiar = async () => {
    setCopiando(true);
    try {
      const pendientes = previos.filter((p) => p.fijo && !gastos.some((g) => g.fijo && g.concepto === p.concepto));
      const n = await copiarFijos(pendientes, mes, user?.uid ?? "");
      toast.success(`Cargados ${n} gasto${n === 1 ? "" : "s"} fijo${n === 1 ? "" : "s"}`);
    } catch (e) {
      err(e);
    } finally {
      setCopiando(false);
    }
  };

  return (
    <PageShell
      title="Gastos"
      subtitle="Lo que sale todos los meses y el libro para el contador. Las cuotas de créditos, ARCA e impuestos se cargan en Deudas e impuestos y entran solas al libro."
      actions={
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setMes(sumarMeses(mes, -1))} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[128px] text-center text-sm font-semibold">{mesLabel(mes)}</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setMes(sumarMeses(mes, 1))} disabled={mes >= mesActual()} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Gastos del mes"
          value={formatARS(total)}
          icon={Wallet}
          tone="primary"
          hint={totalAnt ? `${total >= totalAnt ? "+" : ""}${Math.round(((total - totalAnt) / totalAnt) * 100)}% vs ${mesLabel(anterior).split(" ")[0].toLowerCase()}` : `${gastos.length} cargados`}
        />
        <StatCard label="Fijos" value={formatARS(fijos)} icon={Repeat} hint="Se repiten todos los meses" />
        <StatCard label="Entró" value={formatARS(ingresos)} icon={TrendingUp} tone="success" hint="Cobros del mes" />
        <StatCard label="Salió" value={formatARS(egresos)} icon={TrendingDown} hint={`Gastos, equipo, cuotas e impuestos · resultado ${formatARS(ingresos - egresos)}`} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditar("nuevo")}>
          <Plus className="mr-2 h-4 w-4" /> Cargar gasto
        </Button>
        {faltanFijos > 0 && (
          <Button variant="outline" onClick={() => void copiar()} disabled={copiando}>
            {copiando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
            Traer {faltanFijos === 1 ? "1 fijo" : `${faltanFijos} fijos`} de {mesLabel(anterior).split(" ")[0].toLowerCase()}
          </Button>
        )}
        <Button variant="outline" onClick={() => descargarLibro(libro, mes)} disabled={!libro.length}>
          <FileSpreadsheet className="mr-2 h-4 w-4" /> Libro del mes (Excel)
        </Button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <Section title={`Gastos de ${mesLabel(mes).toLowerCase()}`}>
          {gastos.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no cargaste gastos este mes.
              {faltanFijos > 0 && " Podés traer los fijos del mes pasado con un toque."}
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {gastos.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setEditar(g)}
                  style={{ animationDelay: `${i * 25}ms` }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors animate-in fade-in fill-mode-both hover:bg-muted/40 motion-reduce:animate-none"
                >
                  <span className="w-11 shrink-0 text-center text-xs text-muted-foreground">
                    {g.fecha.slice(8)}/{g.fecha.slice(5, 7)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      {g.concepto}
                      {g.fijo && <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Fijo" />}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {g.categoria}
                      {g.proveedor ? ` · ${g.proveedor}` : ""} · {MEDIOS.find((m) => m.value === g.medio)?.label}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatARS(g.monto)}</span>
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </Section>

        <div className="space-y-8">
          <Section title="En qué se va">
            {porCategoria.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos este mes.</p>
            ) : (
              <div className="space-y-2.5 rounded-xl border bg-card p-4">
                {porCategoria.map(([cat, v]) => (
                  <div key={cat} className="space-y-1">
                    <div className="flex justify-between gap-2 text-xs">
                      <span>{cat}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatARS(v)} · {Math.round((v / total) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(v / maxCat) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Libro del mes" description="Todo lo que entró y salió, listo para pasarle al contador.">
            <div className="divide-y rounded-xl border bg-card text-sm">
              {libro.slice(-8).map((m, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <span className={cn("w-2 shrink-0 self-stretch rounded-full", m.tipo === "Ingreso" ? "bg-emerald-500" : "bg-rose-500")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.concepto}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.fecha.split("-").reverse().slice(0, 2).join("/")} · {m.contraparte || m.medio}
                    </span>
                  </span>
                  <span className={cn("shrink-0 tabular-nums", m.tipo === "Ingreso" ? "text-emerald-600 dark:text-emerald-400" : "")}>
                    {m.tipo === "Egreso" ? "−" : "+"}
                    {formatARS(m.monto)}
                  </span>
                </div>
              ))}
              {libro.length === 0 && <p className="p-3 text-xs text-muted-foreground">Sin movimientos todavía.</p>}
              {libro.length > 8 && <p className="p-3 text-xs text-muted-foreground">y {libro.length - 8} más en el Excel.</p>}
            </div>
          </Section>
        </div>
      </div>

      <GastoDialog gasto={editar} mes={mes} onClose={() => setEditar(null)} uid={user?.uid ?? ""} />
    </PageShell>
  );
}

function GastoDialog({ gasto, mes, onClose, uid }: { gasto: Gasto | "nuevo" | null; mes: string; onClose: () => void; uid: string }) {
  const nuevo = gasto === "nuevo";
  const g = gasto && gasto !== "nuevo" ? gasto : null;
  const [fecha, setFecha] = useState(hoyISO());
  const [concepto, setConcepto] = useState("");
  const [categoria, setCategoria] = useState<CategoriaGasto>("Otros");
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<MedioCobro>("transferencia");
  const [proveedor, setProveedor] = useState("");
  const [fijo, setFijo] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!gasto) return;
    setFecha(g?.fecha ?? (mes === mesActual() ? hoyISO() : `${mes}-01`));
    setConcepto(g?.concepto ?? "");
    setCategoria(g?.categoria ?? "Otros");
    setMonto(g ? String(g.monto) : "");
    setMedio(g?.medio ?? "transferencia");
    setProveedor(g?.proveedor ?? "");
    setFijo(g?.fijo ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gasto]);

  const guardar = async () => {
    if (concepto.trim().length < 2 || !(Number(monto) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      toast.error("Completá qué es, el monto y la fecha");
      return;
    }
    setBusy(true);
    try {
      await guardarGasto({ id: g?.id, fecha, concepto: concepto.trim(), categoria, monto: Number(monto), medio, proveedor: proveedor.trim() || null, fijo }, uid);
      toast.success("Gasto guardado");
      onClose();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  const borrar = async () => {
    if (!g) return;
    try {
      await borrarGasto(g.id);
      toast.success("Gasto borrado");
      onClose();
    } catch (e) {
      err(e);
    }
  };

  return (
    <Dialog open={!!gasto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{nuevo ? "Cargar gasto" : "Editar gasto"}</DialogTitle>
          <DialogDescription>Lo que sale de la caja de Prodi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Qué es</Label>
            <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej.: Canva Pro, alquiler oficina, monotributo" autoFocus maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Monto</Label>
              <Input inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))} placeholder="$" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Categoría</Label>
              <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaGasto)}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS_GASTO.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cómo se pagó</Label>
              <Select value={medio} onValueChange={(v) => setMedio(v as MedioCobro)}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEDIOS.filter((m) => m.value !== "adelantado").map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Proveedor (opcional)</Label>
            <Input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="A quién se le pagó" maxLength={120} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <span>
              <span className="block text-sm font-medium">Se repite todos los meses</span>
              <span className="block text-xs text-muted-foreground">El mes que viene lo traés con un toque.</span>
            </span>
            <Switch checked={fijo} onCheckedChange={setFijo} />
          </label>
        </div>
        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          {g ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void borrar()}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Borrar
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => void guardar()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
