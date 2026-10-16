import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileSpreadsheet,
  Loader2,
  Pencil,
  PieChart,
  Plus,
  Receipt,
  Repeat,
  Scale,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputNumero } from "@/components/ui/input-numero";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageShell } from "@/components/redes/PageShell";
import { ComoFunciona, FilaKpis, Kpi, Pestanias, Vacio, type Pestania } from "@/components/redes/admin/AdminUI";
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

// Un color por categoría: el mismo en la etiqueta de cada gasto y en las barras de "En qué se va".
const COLOR_CAT: Record<CategoriaGasto, { pill: string; barra: string }> = {
  "Sueldos y honorarios": { pill: "bg-violet-500/12 text-violet-700 dark:text-violet-300", barra: "from-violet-500 to-fuchsia-500" },
  "Software y suscripciones": { pill: "bg-sky-500/12 text-sky-700 dark:text-sky-300", barra: "from-sky-400 to-blue-600" },
  Equipos: { pill: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300", barra: "from-indigo-400 to-indigo-600" },
  "Alquiler y servicios": { pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300", barra: "from-amber-400 to-orange-500" },
  Impuestos: { pill: "bg-rose-500/12 text-rose-700 dark:text-rose-300", barra: "from-rose-400 to-red-600" },
  "Contador y bancos": { pill: "bg-teal-500/12 text-teal-700 dark:text-teal-300", barra: "from-emerald-400 to-teal-600" },
  "Viáticos y combustible": { pill: "bg-lime-500/15 text-lime-700 dark:text-lime-300", barra: "from-lime-400 to-green-600" },
  "Publicidad propia": { pill: "bg-pink-500/12 text-pink-700 dark:text-pink-300", barra: "from-pink-400 to-[#E040A0]" },
  Otros: { pill: "bg-slate-500/12 text-slate-700 dark:text-slate-300", barra: "from-slate-400 to-slate-600" },
};
const colorCat = (c: string) => COLOR_CAT[c as CategoriaGasto] ?? COLOR_CAT.Otros;

type Paso = "gastos" | "categorias" | "libro";

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
  const [paso, setPaso] = useState<Paso>("gastos");

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
  const resultado = ingresos - egresos;
  const mesAnt = mesLabel(anterior).split(" ")[0].toLowerCase();
  const mesNombre = mesLabel(mes).split(" ")[0].toLowerCase();

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

  const pestanias: Pestania<Paso>[] = [
    { k: "gastos", label: "Gastos", n: gastos.length },
    { k: "categorias", label: "En qué se va" },
    { k: "libro", label: "Libro del mes", n: libro.length },
  ];

  return (
    <PageShell
      title="Gastos"
      subtitle="Lo que sale cada mes y el libro para el contador."
      actions={
        <div className="flex items-center gap-1 self-start rounded-xl border bg-card p-0.5 sm:self-auto">
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
      <div className="space-y-5">
        <FilaKpis>
          <Kpi
            icono={Wallet}
            label="Gastos del mes"
            valor={formatARS(total)}
            sub={
              totalAnt
                ? `${total >= totalAnt ? "+" : ""}${Math.round(((total - totalAnt) / totalAnt) * 100)}% vs ${mesAnt}`
                : `${gastos.length} cargado${gastos.length === 1 ? "" : "s"}`
            }
            tono="violeta"
            onClick={() => setPaso("gastos")}
          />
          <Kpi
            icono={Repeat}
            label="Fijos (se repiten)"
            valor={formatARS(fijos)}
            sub={total ? `${Math.round((fijos / total) * 100)}% de los gastos` : "Todos los meses"}
            tono="ambar"
          />
          <Kpi icono={TrendingUp} label="Entró (cobros)" valor={formatARS(ingresos)} sub="Lo que se cobró en el mes" tono="azul" onClick={() => setPaso("libro")} />
          <Kpi
            icono={resultado >= 0 ? Scale : TrendingDown}
            label={resultado >= 0 ? "Quedó (ganancia)" : "Quedó (pérdida)"}
            valor={formatARS(resultado)}
            sub={`Salió ${formatARS(egresos)} en total`}
            tono={resultado >= 0 ? "verde" : "rojo"}
            onClick={() => setPaso("libro")}
          />
        </FilaKpis>

        {/* Lo que más se hace: cargar un gasto. Lo demás, al costado. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button size="lg" className="h-11 rounded-xl text-base shadow-sm" onClick={() => setEditar("nuevo")}>
            <Plus className="mr-2 h-5 w-5" /> Cargar gasto
          </Button>
          <div className="flex gap-2">
            {faltanFijos > 0 && (
              <Button variant="secondary" className="h-11 flex-1 rounded-xl sm:flex-none" onClick={() => void copiar()} disabled={copiando}>
                {copiando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
                Traer {faltanFijos === 1 ? "1 fijo" : `${faltanFijos} fijos`} de {mesAnt}
              </Button>
            )}
            <Button variant="outline" className="h-11 flex-1 rounded-xl sm:flex-none" onClick={() => descargarLibro(libro, mes)} disabled={!libro.length}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Libro (Excel)
            </Button>
          </div>
        </div>

        <Pestanias<Paso> items={pestanias} valor={paso} onChange={setPaso} />

        <div key={`${mes}-${paso}`} className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
          {paso === "gastos" &&
            (gastos.length === 0 ? (
              <Vacio
                icono={Receipt}
                titulo={`Sin gastos en ${mesNombre}`}
                texto={faltanFijos > 0 ? "Podés traer los fijos del mes pasado con un toque, o cargar uno nuevo." : "Tocá «Cargar gasto» para sumar el primero."}
              />
            ) : (
              <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                {gastos.map((g, i) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setEditar(g)}
                    style={{ animationDelay: `${i * 25}ms` }}
                    className="group flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors animate-in fade-in fill-mode-both hover:bg-muted/40 motion-reduce:animate-none sm:px-4"
                  >
                    {/* La fecha como un mini calendario */}
                    <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-muted/70 leading-none">
                      <span className="text-base font-bold tabular-nums">{g.fecha.slice(8)}</span>
                      <span className="mt-0.5 text-[10px] uppercase text-muted-foreground">{mesLabel(g.fecha.slice(0, 7)).slice(0, 3)}</span>
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className="truncate">{g.concepto}</span>
                        {g.fijo && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                            title="Se repite todos los meses"
                          >
                            <Repeat className="h-2.5 w-2.5" /> Fijo
                          </span>
                        )}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn("max-w-[60%] shrink-0 truncate rounded-full px-2 py-px text-[11px] font-medium", colorCat(g.categoria).pill)}>{g.categoria}</span>
                        <span className="truncate">
                          {MEDIOS.find((m) => m.value === g.medio)?.label}
                          {g.proveedor ? ` · ${g.proveedor}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-semibold tabular-nums">{formatARS(g.monto)}</span>
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-label="Editar o borrar" />
                  </button>
                ))}
                <div className="flex items-center justify-between gap-3 bg-muted/30 px-3 py-2.5 text-sm sm:px-4">
                  <span className="text-xs text-muted-foreground">Tocá un gasto para editarlo o borrarlo</span>
                  <span className="font-bold tabular-nums">{formatARS(total)}</span>
                </div>
              </div>
            ))}

          {paso === "categorias" &&
            (porCategoria.length === 0 ? (
              <Vacio icono={PieChart} titulo="Sin datos este mes" texto="Cuando cargues gastos vas a ver acá en qué se va la plata." />
            ) : (
              <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
                {/* Barra apilada: todo el mes de un vistazo */}
                <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
                  {porCategoria.map(([cat, v]) => (
                    <div key={cat} className={cn("h-full bg-gradient-to-r", colorCat(cat).barra)} style={{ width: `${(v / total) * 100}%` }} title={cat} />
                  ))}
                </div>
                {porCategoria.map(([cat, v]) => (
                  <div key={cat} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br", colorCat(cat).barra)} />
                        <span className="truncate font-medium">{cat}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-semibold">{formatARS(v)}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{Math.round((v / total) * 100)}%</span>
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", colorCat(cat).barra)} style={{ width: `${(v / maxCat) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {paso === "libro" &&
            (libro.length === 0 ? (
              <Vacio icono={BookOpen} titulo="Sin movimientos todavía" texto="Acá aparece todo lo que entra y sale en el mes, listo para el contador." />
            ) : (
              <div className="space-y-2">
                <div className="divide-y overflow-hidden rounded-2xl border bg-card text-sm">
                  {libro.slice(-8).map((m, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          m.tipo === "Ingreso" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/12 text-rose-600 dark:text-rose-400"
                        )}
                      >
                        {m.tipo === "Ingreso" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.concepto}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.fecha.split("-").reverse().slice(0, 2).join("/")} · {m.contraparte || m.medio}
                        </span>
                      </span>
                      <span className={cn("shrink-0 font-medium tabular-nums", m.tipo === "Ingreso" ? "text-emerald-600 dark:text-emerald-400" : "")}>
                        {m.tipo === "Egreso" ? "−" : "+"}
                        {formatARS(m.monto)}
                      </span>
                    </div>
                  ))}
                </div>
                {libro.length > 8 && <p className="px-1 text-xs text-muted-foreground">Últimos 8 movimientos · los otros {libro.length - 8} están en el Excel.</p>}
              </div>
            ))}
        </div>

        <ComoFunciona>
          <p>
            <b>Cargar gasto</b> es para lo que sale de la caja de Prodi (software, alquiler, contador, viáticos…). Si lo marcás como <b>fijo</b>, el mes que viene
            aparece el botón para traerlo con un toque.
          </p>
          <p>
            Las <b>cuotas de créditos, ARCA e impuestos</b> no se cargan acá: van en <b>Deudas e impuestos</b> y entran solas al libro del mes.
          </p>
          <p>
            El <b>libro del mes</b> junta todo lo que entró (cobros) y lo que salió (gastos, equipo, cuotas e impuestos). <b>Quedó</b> es lo que entró menos lo que
            salió. Bajalo en Excel para pasárselo al contador.
          </p>
        </ComoFunciona>
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
              <InputNumero value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))} placeholder="$" />
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
