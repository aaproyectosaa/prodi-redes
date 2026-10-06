import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CalendarClock,
  Check,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Scale,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageShell, Section, StatCard } from "@/components/redes/PageShell";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { formatARS, hoyISO, mesActual, mesLabel } from "@/lib/redes/format";
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
const TIPOS: TipoObligacion[] = ["credito", "arca", "impuesto"];

function sumarDias(f: string, d: number) {
  const x = new Date(f + "T12:00:00");
  x.setDate(x.getDate() + d);
  return hoyISO(x);
}

/** Créditos del banco, convenios con ARCA e impuestos: cuotas, vencimientos y avisos. */
export default function Deudas() {
  const lista = useObligaciones();
  const hoy = hoyISO();
  const mes = mesActual();
  const [params] = useSearchParams();
  const [nuevo, setNuevo] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(params.get("id"));
  const [pagar, setPagar] = useState<{ o: Obligacion; c: Cuota } | null>(null);

  const proximos = vencimientos(lista, sumarDias(hoy, 35));
  const vencidas = proximos.filter((v) => v.c.vence < hoy);
  const delMes = cuotasDelMes(lista, mes);
  const faltaMes = delMes.filter((v) => !v.c.pagada).reduce((a, v) => a + v.c.monto, 0);
  const pagadoMes = delMes.filter((v) => v.c.pagada).reduce((a, v) => a + v.c.monto, 0);
  const deuda = deudaRestante(lista);
  const prox = proximos.find((v) => v.c.vence >= hoy);
  const detalle = lista.find((o) => o.id === abierta) ?? null;

  return (
    <PageShell
      title="Deudas e impuestos"
      subtitle="Créditos, convenios con ARCA e impuestos. Te avisamos 3 días antes de cada vencimiento y lo que pagás pasa solo al libro del mes."
      actions={
        <Button onClick={() => setNuevo(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Agregar
        </Button>
      }
    >
      {lista.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Todavía no cargaste nada"
          description="Cargá los créditos, el convenio con ARCA y los impuestos que pagás todos los meses. Después solo tenés que tocar “Pagar” cuando los pagás."
          action={
            <Button onClick={() => setNuevo(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Agregar el primero
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Deuda que queda" value={formatARS(deuda)} icon={Landmark} hint="Créditos y convenios, sin impuestos" />
            <StatCard
              label={`Para pagar en ${mesLabel(mes).split(" ")[0].toLowerCase()}`}
              value={formatARS(faltaMes)}
              icon={CalendarClock}
              tone={faltaMes > 0 ? "primary" : "success"}
              hint={pagadoMes ? `Ya pagaste ${formatARS(pagadoMes)}` : "Cuotas e impuestos del mes"}
            />
            <StatCard
              label="Vencido sin pagar"
              value={formatARS(vencidas.reduce((a, v) => a + v.c.monto, 0))}
              icon={AlertTriangle}
              tone={vencidas.length ? "danger" : "default"}
              hint={vencidas.length ? `${vencidas.length} ${vencidas.length === 1 ? "cuota" : "cuotas"}` : "Nada vencido"}
            />
            <StatCard
              label="Próximo vencimiento"
              value={prox ? ddmm(prox.c.vence) : "—"}
              icon={BellRing}
              hint={prox ? `${prox.o.nombre} · ${formatARS(prox.c.monto)}` : "Sin vencimientos cerca"}
            />
          </div>

          <Section title="Lo que viene" description="Lo vencido y lo que vence en las próximas 5 semanas. Tocá “Pagar” cuando lo pagues.">
            {proximos.length === 0 ? (
              <div className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-5 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-emerald-500" /> Nada para pagar en las próximas semanas.
              </div>
            ) : (
              <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                {proximos.map(({ o, c }) => {
                  const vencida = c.vence < hoy;
                  const pronto = !vencida && c.vence <= sumarDias(hoy, 3);
                  const Icono = ICONO[o.tipo];
                  return (
                    <div key={`${o.id}-${c.n}`} className="flex items-center gap-3 px-3 py-3 sm:px-4">
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
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <Icono className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {o.nombre}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {o.tipo === "impuesto" ? `${TIPOS_OBLIGACION.impuesto.label} de ${mesLabel(c.vence.slice(0, 7)).toLowerCase()}` : `Cuota ${c.n} de ${o.cuotas.length}`}
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
            )}
          </Section>

          {TIPOS.map((t) => {
            const items = lista.filter((o) => o.tipo === t);
            if (!items.length) return null;
            return (
              <Section
                key={t}
                title={TIPOS_OBLIGACION[t].plural}
                description={t === "impuesto" ? "Se pagan todos los meses. Si el monto cambia, lo corregís al pagarlo." : `Quedan ${formatARS(deudaRestante(lista, t))} por pagar.`}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((o) => (
                    <TarjetaObligacion key={o.id} o={o} hoy={hoy} mes={mes} onAbrir={() => setAbierta(o.id)} />
                  ))}
                </div>
              </Section>
            );
          })}
        </div>
      )}

      {nuevo && <NuevaObligacion onClose={() => setNuevo(false)} />}
      {detalle && <DetalleObligacion o={detalle} hoy={hoy} onClose={() => setAbierta(null)} onPagar={(c) => setPagar({ o: detalle, c })} />}
      {pagar && <PagarDialog o={pagar.o} c={pagar.c} onClose={() => setPagar(null)} />}
    </PageShell>
  );
}

function TarjetaObligacion({ o, hoy, mes, onAbrir }: { o: Obligacion; hoy: string; mes: string; onAbrir: () => void }) {
  const r = resumenObligacion(o, hoy);
  const Icono = ICONO[o.tipo];
  const pct = r.total ? Math.round((r.pagadas / r.total) * 100) : 0;
  const esteMes = o.cuotas.find((c) => c.vence.startsWith(mes));
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icono className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{o.nombre}</p>
          <p className="truncate text-xs text-muted-foreground">{o.entidad || TIPOS_OBLIGACION[o.tipo].label}</p>
        </div>
        {r.vencidas.length > 0 && (
          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
            {r.vencidas.length} vencida{r.vencidas.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {o.tipo === "impuesto" ? (
        <div className="text-sm">
          {esteMes ? (
            <p>
              Este mes: <b className="tabular-nums">{formatARS(esteMes.monto)}</b>{" "}
              <span className={esteMes.pagada ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                {esteMes.pagada ? "· pagado" : `· vence el ${ddmm(esteMes.vence)}`}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">No hay cuota cargada este mes.</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cargado hasta {mesLabel(([...o.cuotas].sort((a, b) => a.vence.localeCompare(b.vence)).at(-1)?.vence ?? hoy).slice(0, 7)).toLowerCase()}
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span>
              <b className="tabular-nums">{r.pagadas}</b> de {r.total} cuotas
            </span>
            <span className="text-xs text-muted-foreground">Quedan {formatARS(r.restante)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {r.proxima ? `Próxima: ${ddmmaa(r.proxima.vence)} · ${formatARS(r.proxima.monto)}` : "¡Terminada!"}
          </p>
        </div>
      )}
    </button>
  );
}

function PagarDialog({ o, c, onClose }: { o: Obligacion; c: Cuota; onClose: () => void }) {
  const [monto, setMonto] = useState(String(c.monto));
  const [medio, setMedio] = useState<MedioCobro>(o.tipo === "credito" ? "debito" : "transferencia");
  const [guardando, setGuardando] = useState(false);
  const ok = async () => {
    setGuardando(true);
    try {
      await pagarCuota(o, c.n, medio, Number(monto.replace(/\D/g, "")));
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
            <Input id="monto-pago" inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)} className="text-lg font-semibold tabular-nums" />
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
          <Button onClick={ok} disabled={guardando || !Number(monto.replace(/\D/g, ""))}>
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
        o.cuotas.map((c) => (montos[c.n] != null ? { ...c, monto: Number(montos[c.n].replace(/\D/g, "")) || c.monto } : c))
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
                  <Input
                    aria-label={`Monto cuota ${c.n}`}
                    inputMode="numeric"
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
    const d = new Date();
    d.setMonth(d.getMonth() + (d.getDate() > 10 ? 1 : 0), 10);
    return hoyISO(d);
  });
  const [guardando, setGuardando] = useState(false);

  const elegir = (t: TipoObligacion) => {
    setTipo(t);
    setEntidad(t === "arca" || t === "impuesto" ? "ARCA" : "");
    setCantidad(t === "arca" ? "24" : "12");
  };
  const n = Math.max(1, Math.min(120, Number(cantidad) || 0));
  const pagadas = tipo === "impuesto" ? 0 : Math.max(0, Math.min(n - 1, Number(yaPagadas) || 0));
  const m = Number(monto.replace(/\D/g, "")) || 0;
  const cuotas = useMemo(() => {
    if (!primera) return [];
    const [y, mm, d] = primera.split("-").map(Number);
    const ultimo = new Date(y, mm - pagadas, 0).getDate();
    const base = hoyISO(new Date(y, mm - 1 - pagadas, Math.min(d, ultimo)));
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
                <Input id="ob-monto" inputMode="numeric" placeholder="$" value={monto} onChange={(e) => setMonto(e.target.value)} />
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
