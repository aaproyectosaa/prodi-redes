import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarClock, Check, ChevronRight, HandCoins, Landmark, ListChecks, Loader2, Pencil, Plus, Receipt, Scale, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputNumero } from "@/components/ui/input-numero";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell } from "@/components/redes/PageShell";
import { DeudasClientes } from "@/components/redes/admin/DeudasClientes";
import { ComoFunciona, FilaKpis, Kpi, Pestanias, Vacio, type Pestania } from "@/components/redes/admin/AdminUI";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { sumarDias } from "@/lib/fecha";
import { formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import {
  MEDIOS_PAGO,
  TIPOS_OBLIGACION,
  agregarMeses,
  borrarObligacion,
  crearObligacion,
  cuotasDelMes,
  deudaRestante,
  generarCuotas,
  guardarCuotas,
  pagarCuota,
  resumenObligacion,
  saldoDeudaCliente,
  useDeudasClientes,
  useObligaciones,
  vencimientos,
  type Cuota,
  type MedioCobro,
  type Obligacion,
  type TipoObligacion,
} from "@/lib/redes/facturacion";
import { cn } from "@/lib/utils";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Algo salió mal");
const ddmm = (f: string) => f.slice(8, 10) + "/" + f.slice(5, 7);
const ddmmaa = (f: string) => f.split("-").reverse().join("/");
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const ICONO: Record<TipoObligacion, React.ElementType> = { credito: Landmark, arca: Scale, impuesto: Receipt };
// Orden en pantalla: primero lo de todos los meses (impuestos), después créditos y ARCA.
const TIPOS: TipoObligacion[] = ["impuesto", "credito", "arca"];
// Cada tipo con su color, para reconocerlo de un vistazo.
const COLOR: Record<TipoObligacion, { pill: string; icono: string; barra: string; corto: string }> = {
  impuesto: { pill: "bg-sky-500/15 text-sky-700 dark:text-sky-300", icono: "from-sky-400 to-blue-600", barra: "bg-sky-500", corto: "Impuesto" },
  credito: { pill: "bg-violet-500/15 text-violet-700 dark:text-violet-300", icono: "from-[#6F40FC] to-[#E040A0]", barra: "bg-violet-500", corto: "Crédito" },
  arca: { pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icono: "from-amber-400 to-orange-500", barra: "bg-amber-500", corto: "ARCA" },
};

type Vista = "pagar" | "proximos" | "nosdeben";

function PillTipo({ t }: { t: TipoObligacion }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", COLOR[t].pill)}>{COLOR[t].corto}</span>;
}

/** Lo que debemos pagar (créditos del banco, convenios con ARCA, impuestos) y lo que nos deben los clientes. */
export default function Deudas() {
  const lista = useObligaciones();
  const deudasClientes = useDeudasClientes();
  const hoy = hoyISO();
  const mes = mesActual();
  const [params] = useSearchParams();
  const [nuevo, setNuevo] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(params.get("id"));
  const [pagar, setPagar] = useState<{ o: Obligacion; c: Cuota } | null>(null);

  const proximos = vencimientos(lista, sumarDias(hoy, 35));
  const vencidas = proximos.filter((v) => v.c.vence < hoy);
  const totalVencido = vencidas.reduce((a, v) => a + v.c.monto, 0);
  const delMes = cuotasDelMes(lista, mes);
  const faltaMes = delMes.filter((v) => !v.c.pagada).reduce((a, v) => a + v.c.monto, 0);
  const pagadoMes = delMes.filter((v) => v.c.pagada).reduce((a, v) => a + v.c.monto, 0);
  const deuda = deudaRestante(lista);
  const prox = proximos.find((v) => v.c.vence >= hoy);
  const detalle = lista.find((o) => o.id === abierta) ?? null;

  // Lo que nos deben los clientes (sin las incobrables).
  const clientesActivos = deudasClientes.filter((d) => !d.incobrable && saldoDeudaCliente(d) > 0);
  const nosDeben = clientesActivos.reduce((a, d) => a + saldoDeudaCliente(d), 0);
  const clientesVencidos = clientesActivos.filter((d) => d.cuotas.some((c) => !c.pagada && c.vence < hoy)).length;

  // Si hay algo vencido arrancamos en "Próximos vencimientos"; si no, en "Para pagar". Si tocás una pestaña, queda la tuya.
  const sugerida: Vista = vencidas.length ? "proximos" : "pagar";
  const [vista, setVista] = useState<Vista>(sugerida);
  const [tocado, setTocado] = useState(false);
  useEffect(() => {
    if (!tocado) setVista(sugerida);
  }, [sugerida, tocado]);
  const ir = (v: Vista) => {
    setTocado(true);
    setVista(v);
  };

  const pestanias: Pestania<Vista>[] = [
    { k: "pagar", label: "Para pagar", n: lista.length },
    { k: "proximos", label: "Próximos vencimientos", n: proximos.length, alerta: vencidas.length > 0 },
    { k: "nosdeben", label: "Nos deben", n: clientesActivos.length, alerta: clientesVencidos > 0 },
  ];
  const mesCorto = mesLabel(mes).split(" ")[0].toLowerCase();

  return (
    <PageShell
      title="Deudas e impuestos"
      subtitle="Lo que debemos pagar (créditos, ARCA, impuestos) y lo que nos deben los clientes."
      actions={
        <Button onClick={() => setNuevo(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nueva deuda o impuesto
        </Button>
      }
    >
      <div className="space-y-5">
        <FilaKpis>
          <Kpi
            icono={CalendarClock}
            label="Vence este mes"
            valor={formatARS(faltaMes)}
            sub={pagadoMes ? `Ya pagaste ${formatARS(pagadoMes)} en ${mesCorto}` : faltaMes ? `Falta pagar en ${mesCorto}` : `Nada pendiente en ${mesCorto}`}
            avance={faltaMes + pagadoMes ? pagadoMes / (faltaMes + pagadoMes) : undefined}
            tono={faltaMes ? "violeta" : "verde"}
            onClick={() => ir("proximos")}
          />
          <Kpi
            icono={AlertTriangle}
            label="Vencido sin pagar"
            valor={formatARS(totalVencido)}
            sub={vencidas.length ? `${vencidas.length} ${vencidas.length === 1 ? "cuota" : "cuotas"}` : "Nada vencido"}
            tono={totalVencido > 0 ? "rojo" : "gris"}
            onClick={() => ir("proximos")}
          />
          <Kpi
            icono={Landmark}
            label="Deuda total"
            valor={formatARS(deuda)}
            sub={prox ? `Próximo: ${ddmm(prox.c.vence)} · ${prox.o.nombre}` : "Créditos y ARCA"}
            tono="azul"
            onClick={() => ir("pagar")}
          />
          <Kpi
            icono={HandCoins}
            label="Nos deben los clientes"
            valor={formatARS(nosDeben)}
            sub={clientesActivos.length ? `${clientesActivos.length} cliente${clientesActivos.length === 1 ? "" : "s"}${clientesVencidos ? ` · ${clientesVencidos} con atraso` : ""}` : "Nadie nos debe"}
            tono={clientesVencidos ? "ambar" : "verde"}
            onClick={() => ir("nosdeben")}
          />
        </FilaKpis>

        <Pestanias items={pestanias} valor={vista} onChange={ir} />

        <div key={vista} className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
          {vista === "pagar" &&
            (lista.length === 0 ? (
              <div className="space-y-3">
                <Vacio icono={Landmark} titulo="Todavía no cargaste nada" texto="Cargá los créditos, el convenio con ARCA y los impuestos de todos los meses. Después solo tocás “Pagar”." />
                <div className="flex justify-center">
                  <Button onClick={() => setNuevo(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Cargar la primera
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {TIPOS.map((t) => {
                  const items = lista.filter((o) => o.tipo === t);
                  if (!items.length) return null;
                  const Icono = ICONO[t];
                  return (
                    <section key={t} className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br text-white", COLOR[t].icono)}>
                          <Icono className="h-3.5 w-3.5" />
                        </span>
                        <h2 className="text-sm font-semibold">{TIPOS_OBLIGACION[t].plural}</h2>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t === "impuesto" ? "Todos los meses" : `Quedan ${formatARS(deudaRestante(lista, t))}`}
                        </span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {items.map((o) => (
                          <TarjetaObligacion key={o.id} o={o} hoy={hoy} onAbrir={() => setAbierta(o.id)} onPagar={(c) => setPagar({ o, c })} />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            ))}

          {vista === "proximos" &&
            (proximos.length === 0 ? (
              <Vacio icono={Check} titulo="Nada para pagar en las próximas semanas" texto="No hay cuotas vencidas ni por vencer en las próximas 5 semanas." />
            ) : (
              <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                {proximos.map(({ o, c }) => {
                  const vencida = c.vence < hoy;
                  const pronto = !vencida && c.vence <= sumarDias(hoy, 3);
                  return (
                    <div key={`${o.id}-${c.n}`} className={cn("flex items-center gap-3 px-3 py-3 sm:px-4", vencida && "bg-red-500/[0.04]")}>
                      <div
                        className={cn(
                          "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-center leading-none",
                          vencida ? "border-destructive/40 bg-destructive/10 text-destructive" : pronto ? "border-amber-500/40 bg-amber-500/10" : "bg-muted/40"
                        )}
                      >
                        <span className="text-base font-bold tabular-nums">{c.vence.slice(8, 10)}</span>
                        <span className="text-[10px] uppercase">{MESES_CORTOS[Number(c.vence.slice(5, 7)) - 1]}</span>
                      </div>
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setAbierta(o.id)}>
                        <p className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{o.nombre}</span>
                          <PillTipo t={o.tipo} />
                        </p>
                        <p className={cn("truncate text-xs", vencida ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {o.tipo === "impuesto" ? mesLabel(c.vence.slice(0, 7)) : `Cuota ${c.n} de ${o.cuotas.length}`}
                          {vencida ? " · vencida" : pronto ? " · vence pronto" : ""}
                        </p>
                      </button>
                      <span className="hidden text-sm font-semibold tabular-nums sm:inline">{formatARS(c.monto)}</span>
                      <Button size="sm" variant={vencida ? "destructive" : "default"} onClick={() => setPagar({ o, c })}>
                        Pagar<span className="ml-1 sm:hidden"> {formatARS(c.monto)}</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            ))}

          {vista === "nosdeben" && <DeudasClientes />}
        </div>

        <ComoFunciona>
          <p>
            Cargás cada <b>crédito del banco</b>, <b>convenio con ARCA</b> o <b>impuesto</b> una sola vez (con el botón de arriba) y armamos las cuotas solas. Cuando
            pagás una, tocás <b>Pagar</b>: el pago pasa solo al libro del mes.
          </p>
          <p>Te avisamos 3 días antes de cada vencimiento. Lo vencido sin pagar aparece en rojo en “Próximos vencimientos”.</p>
          <p>
            Los <b>impuestos</b> se pagan todos los meses: si un mes viene distinto, corregís el monto al pagarlo. Tocando una tarjeta ves todas las cuotas, podés
            cambiar montos, sumar meses o cuotas, deshacer un pago o borrarla.
          </p>
          <p>
            La <b>deuda total</b> cuenta créditos y convenios con ARCA (sin impuestos). En <b>Nos deben</b> cargás lo que un cliente quedó debiendo fuera de las
            boletas, con recargo y en cuotas si hace falta, y marcás cada cuota cuando la cobrás.
          </p>
        </ComoFunciona>
      </div>

      {nuevo && <NuevaObligacion onClose={() => setNuevo(false)} />}
      {detalle && <DetalleObligacion o={detalle} hoy={hoy} onClose={() => setAbierta(null)} onPagar={(c) => setPagar({ o: detalle, c })} />}
      {pagar && <PagarDialog o={pagar.o} c={pagar.c} onClose={() => setPagar(null)} />}
    </PageShell>
  );
}

/** Tarjeta de cada deuda o impuesto: qué es, cuánto y cuándo vence lo próximo, el avance y el botón para pagar. */
function TarjetaObligacion({ o, hoy, onAbrir, onPagar }: { o: Obligacion; hoy: string; onAbrir: () => void; onPagar: (c: Cuota) => void }) {
  const r = resumenObligacion(o, hoy);
  const Icono = ICONO[o.tipo];
  const pct = r.total ? Math.round((r.pagadas / r.total) * 100) : 0;
  const proxima = r.proxima;
  const vencida = !!proxima && proxima.vence < hoy;
  const ultima = [...o.cuotas].sort((a, b) => a.vence.localeCompare(b.vence)).at(-1)?.vence ?? hoy;
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40", r.vencidas.length > 0 && "border-red-500/40")}>
      <button type="button" onClick={onAbrir} className="flex items-start gap-3 text-left">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", COLOR[o.tipo].icono)}>
          <Icono className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{o.nombre}</span>
            <PillTipo t={o.tipo} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">{o.entidad || TIPOS_OBLIGACION[o.tipo].label}</span>
        </span>
        {r.vencidas.length > 0 && (
          <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
            {r.vencidas.length} vencida{r.vencidas.length > 1 ? "s" : ""}
          </span>
        )}
      </button>

      {r.proxima ? (
        <div>
          <p className={cn("text-xs", vencida ? "font-medium text-destructive" : "text-muted-foreground")}>
            {vencida ? "Venció el" : "Vence el"} {ddmmaa(r.proxima.vence)}
            {o.tipo === "impuesto" ? ` · ${mesLabel(r.proxima.vence.slice(0, 7)).toLowerCase()}` : ""}
          </p>
          <p className={cn("text-2xl font-bold tabular-nums tracking-tight", vencida && "text-destructive")}>{formatARS(r.proxima.monto)}</p>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" /> {o.tipo === "impuesto" ? "Todo pagado" : "¡Terminada!"}
        </p>
      )}

      {o.tipo === "impuesto" ? (
        <p className="text-xs text-muted-foreground">Cargado hasta {mesLabel(ultima.slice(0, 7)).toLowerCase()}</p>
      ) : (
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span>
              {r.proxima ? (
                <>
                  Cuota <b className="tabular-nums">{r.proxima.n}</b> de {r.total}
                </>
              ) : (
                `${r.total} de ${r.total} cuotas pagadas`
              )}
            </span>
            <span className="text-muted-foreground">Quedan {formatARS(r.restante)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-all duration-700", COLOR[o.tipo].barra)} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="mt-auto flex gap-2">
        {proxima && (
          <Button size="sm" className="flex-1" variant={vencida ? "destructive" : "default"} onClick={() => onPagar(proxima)}>
            Pagar {formatARS(proxima.monto)}
          </Button>
        )}
        <Button size="sm" variant="outline" className={cn(!proxima && "flex-1")} onClick={onAbrir}>
          <ListChecks className="mr-1 h-4 w-4" /> Cuotas <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function PagarDialog({ o, c, onClose }: { o: Obligacion; c: Cuota; onClose: () => void }) {
  const [monto, setMonto] = useState(String(c.monto));
  const [medio, setMedio] = useState<MedioCobro>(o.tipo === "credito" ? "debito" : "transferencia");
  const [guardando, setGuardando] = useState(false);
  const ok = async () => {
    setGuardando(true);
    try {
      await pagarCuota(o, c.n, medio, Number(monto));
      toast.success("Pagada. Ya está en el libro del mes.");
      onClose();
    } catch (e) {
      err(e);
    } finally {
      setGuardando(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pagar {o.nombre}</DialogTitle>
          <DialogDescription>
            {o.tipo === "impuesto" ? mesLabel(c.vence.slice(0, 7)) : `Cuota ${c.n} de ${o.cuotas.length}`} · vence el {ddmmaa(c.vence)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="monto-pago">¿Cuánto pagaste?</Label>
            <InputNumero decimales id="monto-pago" value={monto} onChange={(e) => setMonto(e.target.value)} className="text-lg font-semibold tabular-nums" />
            {o.tipo === "impuesto" && <p className="text-xs text-muted-foreground">Si este mes vino distinto, poné lo que pagaste de verdad.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>¿Cómo?</Label>
            <div className="grid grid-cols-2 gap-2">
              {MEDIOS_PAGO.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMedio(m.value)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                    medio === m.value ? "border-primary bg-primary/[0.08] font-medium" : "hover:border-primary/40"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={ok} disabled={guardando || !Number(monto)}>
            {guardando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Marcar pagada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetalleObligacion({ o, hoy, onClose, onPagar }: { o: Obligacion; hoy: string; onClose: () => void; onPagar: (c: Cuota) => void }) {
  const r = resumenObligacion(o, hoy);
  const [editando, setEditando] = useState(false);
  const [montos, setMontos] = useState<Record<number, string>>({});
  const [borrar, setBorrar] = useState(false);
  const cuotas = [...o.cuotas].sort((a, b) => a.n - b.n);
  const guardar = async () => {
    try {
      await guardarCuotas(
        o,
        o.cuotas.map((c) => (montos[c.n] != null ? { ...c, monto: Number(montos[c.n]) || c.monto } : c))
      );
      toast.success("Montos guardados");
      setEditando(false);
      setMontos({});
    } catch (e) {
      err(e);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex sm:max-h-[90dvh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{o.nombre}</DialogTitle>
          <DialogDescription>
            {TIPOS_OBLIGACION[o.tipo].label}
            {o.entidad ? ` · ${o.entidad}` : ""} · {r.pagadas} de {r.total} pagadas
            {o.tipo !== "impuesto" ? ` · quedan ${formatARS(r.restante)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-y px-6">
          <div className="divide-y">
            {cuotas.map((c) => (
              <div key={c.n} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-8 shrink-0 text-xs text-muted-foreground tabular-nums">{o.tipo === "impuesto" ? MESES_CORTOS[Number(c.vence.slice(5, 7)) - 1] : `#${c.n}`}</span>
                <span className={cn("w-20 shrink-0 tabular-nums", !c.pagada && c.vence < hoy && "font-medium text-destructive")}>{ddmmaa(c.vence)}</span>
                {editando && !c.pagada ? (
                  <InputNumero
                    decimales
                    aria-label={`Monto cuota ${c.n}`}
                    className="h-8 flex-1"
                    value={montos[c.n] ?? String(c.monto)}
                    onChange={(e) => setMontos((m) => ({ ...m, [c.n]: e.target.value }))}
                  />
                ) : (
                  <span className="flex-1 tabular-nums">{formatARS(c.monto)}</span>
                )}
                {c.pagada ? (
                  <span className="flex items-center gap-1">
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      <Check className="h-3 w-3" /> Pagada
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="No estaba pagada"
                      aria-label="No estaba pagada"
                      onClick={() => void pagarCuota(o, c.n, null).catch(err)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                ) : (
                  !editando && (
                    <Button size="sm" variant={c.vence < hoy ? "destructive" : "outline"} className="h-8" onClick={() => onPagar(c)}>
                      Pagar
                    </Button>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          {borrar ? (
            <div className="flex items-center gap-2 text-sm">
              ¿Borrar todo?
              <Button size="sm" variant="destructive" onClick={() => void borrarObligacion(o).then(onClose).catch(err)}>
                Sí, borrar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBorrar(false)}>
                No
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setBorrar(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" /> Borrar
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            {editando ? (
              <Button size="sm" onClick={guardar}>
                Guardar montos
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
                  <Pencil className="mr-1.5 h-4 w-4" /> Cambiar montos
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void agregarMeses(o, o.tipo === "impuesto" ? 12 : 1)
                      .then(() => toast.success(o.tipo === "impuesto" ? "Sumamos 12 meses más" : "Sumamos una cuota"))
                      .catch(err)
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" /> {o.tipo === "impuesto" ? "12 meses más" : "Una cuota más"}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NuevaObligacion({ onClose }: { onClose: () => void }) {
  const { user } = useUserProfileContext();
  const [tipo, setTipo] = useState<TipoObligacion | null>(null);
  const [nombre, setNombre] = useState("");
  const [entidad, setEntidad] = useState("");
  const [monto, setMonto] = useState("");
  const [cantidad, setCantidad] = useState("12");
  const [yaPagadas, setYaPagadas] = useState("0");
  const [primera, setPrimera] = useState(() => {
    const hoy = hoyISO();
    return `${sumarMeses(hoy.slice(0, 7), Number(hoy.slice(8, 10)) > 10 ? 1 : 0)}-10`;
  });
  const [guardando, setGuardando] = useState(false);

  const elegir = (t: TipoObligacion) => {
    setTipo(t);
    setEntidad(t === "arca" || t === "impuesto" ? "ARCA" : "");
    setCantidad(t === "arca" ? "24" : "12");
  };
  const n = Math.max(1, Math.min(120, Number(cantidad) || 0));
  const pagadas = tipo === "impuesto" ? 0 : Math.max(0, Math.min(n - 1, Number(yaPagadas) || 0));
  const m = Number(monto) || 0;
  const cuotas = useMemo(() => {
    if (!primera) return [];
    const base = sumarMeses(primera, -pagadas);
    return generarCuotas(base, n, m).map((c, i) =>
      i < pagadas ? { ...c, pagada: true, pagada_at: `${c.vence}T12:00:00.000Z`, medio: null } : c
    );
  }, [primera, n, m, pagadas]);
  const quedan = cuotas.filter((c) => !c.pagada);
  const valido = !!tipo && nombre.trim().length > 1 && m > 0 && cuotas.length > 0;

  const guardar = async () => {
    if (!tipo || !user) return;
    setGuardando(true);
    try {
      await crearObligacion({ tipo, nombre: nombre.trim(), entidad: entidad.trim() || null, detalle: null, cuotas }, user.uid);
      toast.success(`${nombre.trim()} cargado. Te vamos a avisar antes de cada vencimiento.`);
      onClose();
    } catch (e) {
      err(e);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tipo ? `Nuevo: ${TIPOS_OBLIGACION[tipo].label.toLowerCase()}` : "¿Qué querés cargar?"}</DialogTitle>
          <DialogDescription>
            {tipo ? TIPOS_OBLIGACION[tipo].desc : "Elegí el tipo. Después cargás el monto y las fechas, y nosotros armamos las cuotas."}
          </DialogDescription>
        </DialogHeader>

        {!tipo ? (
          <div className="grid gap-2">
            {TIPOS.map((t) => {
              const Icono = ICONO[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => elegir(t)}
                  className="flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/[0.04]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icono className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-semibold">{TIPOS_OBLIGACION[t].label}</span>
                    <span className="block text-xs text-muted-foreground">{TIPOS_OBLIGACION[t].desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ob-nombre">Nombre</Label>
                <Input id="ob-nombre" autoFocus placeholder={`Ej.: ${TIPOS_OBLIGACION[tipo].ejemplo}`} value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ob-entidad">{tipo === "credito" ? "Banco" : "A quién se paga"}</Label>
                <Input
                  id="ob-entidad"
                  placeholder={tipo === "credito" ? "Ej.: Banco Galicia" : "Ej.: ARCA, API Santa Fe"}
                  value={entidad}
                  onChange={(e) => setEntidad(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ob-monto">{tipo === "impuesto" ? "Monto de cada mes" : "Monto de cada cuota"}</Label>
                <InputNumero decimales id="ob-monto" placeholder="$" value={monto} onChange={(e) => setMonto(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ob-primera">{pagadas ? "Próximo vencimiento" : "Primer vencimiento"}</Label>
                <Input id="ob-primera" type="date" value={primera} onChange={(e) => setPrimera(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ob-cant">{tipo === "impuesto" ? "¿Cuántos meses cargamos?" : "Cantidad total de cuotas"}</Label>
                <Input id="ob-cant" inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              </div>
              {tipo !== "impuesto" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ob-pagadas">¿Cuántas ya pagaste?</Label>
                  <Input id="ob-pagadas" inputMode="numeric" value={yaPagadas} onChange={(e) => setYaPagadas(e.target.value)} />
                </div>
              )}
            </div>
            {m > 0 && quedan.length > 0 && (
              <div className="rounded-xl bg-muted/50 p-3 text-sm">
                {tipo === "impuesto" ? (
                  <>
                    Vamos a cargar <b>{n} meses</b> de {formatARS(m)}, del {ddmmaa(quedan[0].vence)} al {ddmmaa(quedan.at(-1)!.vence)}. Si un mes viene distinto, lo cambiás al pagarlo.
                  </>
                ) : (
                  <>
                    {pagadas ? `${pagadas} ya pagadas. ` : ""}Quedan <b>{quedan.length} cuotas</b> de {formatARS(m)}: del {ddmmaa(quedan[0].vence)} al {ddmmaa(quedan.at(-1)!.vence)}.
                    Total que falta: <b>{formatARS(quedan.length * m)}</b>.
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {tipo && (
          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => setTipo(null)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Volver
            </Button>
            <Button onClick={guardar} disabled={!valido || guardando}>
              {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
