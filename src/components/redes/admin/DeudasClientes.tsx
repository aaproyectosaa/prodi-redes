import { useState } from "react";
import { ElegirCliente } from "@/components/redes/ElegirCliente";
import { Check, ChevronDown, HandCoins, Loader2, Plus, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Vacio } from "@/components/redes/admin/AdminUI";
import { cobrarCuotaCliente, crearDeudaCliente, marcarIncobrable, saldoDeudaCliente, useDeudasClientes, type DeudaCliente } from "@/lib/redes/facturacion";
import { formatARS, hoyISO } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

const ddmmaa = (f: string) => f.split("-").reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join("/");

/** "Nos deben los clientes": planes de pago y deudas viejas, cuota por cuota. Tocás "Cobrar" cuando entra. */
export function DeudasClientes() {
  const lista = useDeudasClientes();
  const hoy = hoyISO();
  const [nueva, setNueva] = useState(false);
  const activas = lista.filter((d) => !d.incobrable);
  const incobrables = lista.filter((d) => d.incobrable);
  const total = activas.reduce((a, d) => a + saldoDeudaCliente(d), 0);
  const vencido = activas.reduce((a, d) => a + d.cuotas.filter((c) => !c.pagada && c.vence < hoy).reduce((x, c) => x + c.monto, 0), 0);
  // Primero las que tienen algo vencido, después las que faltan cobrar y al final las ya cobradas.
  const orden = (d: DeudaCliente) => (saldoDeudaCliente(d) === 0 ? 2 : d.cuotas.some((c) => !c.pagada && c.vence < hoy) ? 0 : 1);
  const ordenadas = [...activas].sort((a, b) => orden(a) - orden(b));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {activas.length ? (
            <>
              Falta cobrar <b className="tabular-nums text-foreground">{formatARS(total)}</b>
              {vencido ? (
                <>
                  {" · "}
                  <b className="tabular-nums text-destructive">{formatARS(vencido)}</b> vencido
                </>
              ) : null}
            </>
          ) : (
            "Lo que un cliente quedó debiendo fuera de las boletas."
          )}
        </p>
        <Button size="sm" onClick={() => setNueva(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Cargar deuda
        </Button>
      </div>
      <NuevaDeuda open={nueva} onOpenChange={setNueva} />
      {activas.length === 0 ? (
        <Vacio icono={Check} titulo="Ningún cliente nos debe" texto="Si un cliente queda debiendo algo fuera de las boletas, tocá “Cargar deuda” (con recargo y en cuotas si hace falta)." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {ordenadas.map((d) => (
            <Tarjeta key={d.id} d={d} hoy={hoy} />
          ))}
        </div>
      )}
      {incobrables.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Incobrables</p>
          {incobrables.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <b>{d.cliente}</b>
                {d.detalle ? ` · ${d.detalle}` : ""}
              </span>
              <span className="tabular-nums text-muted-foreground line-through">{formatARS(d.cuotas.reduce((a, c) => a + c.monto, 0))}</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void marcarIncobrable(d, false).catch(() => toast.error("No se pudo"))}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Reactivar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const OTRO = "__otro";

/** Cargar una deuda: cliente, de qué es, monto, recargo (%), en cuántas cuotas y desde cuándo. */
function NuevaDeuda({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { clientes } = useRedes();
  const { user } = useUserProfileContext();
  const [clienteId, setClienteId] = useState("");
  const [otro, setOtro] = useState("");
  const [detalle, setDetalle] = useState("");
  const [monto, setMonto] = useState("");
  const [recargo, setRecargo] = useState("");
  const [cuotas, setCuotas] = useState("1");
  const [vence, setVence] = useState(hoyISO());
  const [guardando, setGuardando] = useState(false);
  const base = Number(monto.replace(/\D/g, "")) || 0;
  const pct = Number(recargo.replace(",", ".")) || 0;
  const total = Math.round(base * (1 + pct / 100));
  const n = Math.max(1, Number(cuotas) || 1);
  const cliente = clientes.find((c) => c.id === clienteId);
  const nombre = clienteId === OTRO ? otro.trim() : cliente?.nombre ?? "";
  const listo = !!nombre && base > 0 && !!vence;

  const guardar = async () => {
    if (!listo || !user) return;
    setGuardando(true);
    try {
      const t = await crearDeudaCliente({
        cliente: nombre,
        proyecto_id: clienteId === OTRO ? null : clienteId,
        detalle: detalle.trim() || null,
        base,
        recargoPct: pct,
        cuotas: n,
        primera: vence,
        by: user.uid,
      });
      toast.success(`Deuda de ${nombre} cargada: ${formatARS(t)}`);
      setClienteId("");
      setOtro("");
      setDetalle("");
      setMonto("");
      setRecargo("");
      setCuotas("1");
      setVence(hoyISO());
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>Cargar deuda de un cliente</DialogTitle>
          <DialogDescription>Lo que quedó debiendo fuera de las boletas. Si lleva recargo, se suma al total.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <ElegirCliente value={clienteId} onChange={setClienteId} clientes={clientes} opciones={[{ value: OTRO, label: "Otro (no está cargado)" }]} placeholder="Elegí el cliente" />
            {clienteId === OTRO && <Input value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Nombre del cliente" />}
          </div>
          <div className="space-y-1.5">
            <Label>¿De qué es?</Label>
            <Input value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej.: septiembre y octubre" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Monto</Label>
              <Input inputMode="numeric" value={monto ? Number(monto.replace(/\D/g, "")).toLocaleString("es-AR") : ""} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))} placeholder="250.000" />
            </div>
            <div className="space-y-1.5">
              <Label>Recargo (%)</Label>
              <Input inputMode="decimal" value={recargo} onChange={(e) => setRecargo(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))} placeholder="5" />
            </div>
            <div className="space-y-1.5">
              <Label>Cuotas</Label>
              <Input inputMode="numeric" value={cuotas} onChange={(e) => setCuotas(e.target.value.replace(/\D/g, "").slice(0, 2))} />
            </div>
            <div className="space-y-1.5">
              <Label>{n > 1 ? "1ª cuota vence" : "Vence"}</Label>
              <Input type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
            </div>
          </div>
          {base > 0 && (
            <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
              {formatARS(base)}
              {pct ? ` + ${String(pct).replace(".", ",")}% = ` : " = "}
              <b className="text-base">{formatARS(total)}</b>
              {n > 1 && <span className="text-muted-foreground"> · {n} cuotas de {formatARS(Math.floor(total / n))}</span>}
            </div>
          )}
          <Button className="w-full" onClick={guardar} disabled={!listo || guardando}>
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar deuda
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tarjeta de cada deuda: cliente, saldo grande, avance de cuotas, cobrar la próxima y el detalle plegable. */
function Tarjeta({ d, hoy }: { d: DeudaCliente; hoy: string }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [verCuotas, setVerCuotas] = useState(false);
  const cobradas = d.cuotas.filter((c) => c.pagada).length;
  const saldo = saldoDeudaCliente(d);
  const pendientes = d.cuotas.filter((c) => !c.pagada).sort((a, b) => a.vence.localeCompare(b.vence));
  const proxima = pendientes[0] ?? null;
  const vencidas = pendientes.filter((c) => c.vence < hoy).length;
  const proximaVencida = !!proxima && proxima.vence < hoy;
  const cobrar = async (n: number, cobrada: boolean) => {
    setBusy(n);
    try {
      await cobrarCuotaCliente(d, n, cobrada, cobrada ? "transferencia" : null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-4", saldo === 0 ? "border-emerald-500/40" : vencidas > 0 && "border-red-500/40")}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-sm">
          <HandCoins className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{d.cliente}</span>
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Cliente</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[d.detalle, d.base ? `deuda original ${formatARS(d.base)}` : null, d.interes ? `interés ${d.interes}` : null].filter(Boolean).join(" · ") || "Deuda de cliente"}
          </p>
        </div>
        {vencidas > 0 && (
          <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
            {vencidas} vencida{vencidas > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div>
        <p className="text-xs text-muted-foreground">{saldo ? "Falta cobrar" : "Estado"}</p>
        <p className={cn("text-2xl font-bold tabular-nums tracking-tight", !saldo && "text-emerald-600 dark:text-emerald-400")}>{saldo ? formatARS(saldo) : "Cobrado"}</p>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span>
            <b className="tabular-nums">{cobradas}</b> de {d.cuotas.length} cuotas cobradas
          </span>
          {proxima && (
            <span className={cn(proximaVencida ? "font-medium text-destructive" : "text-muted-foreground")}>
              {proximaVencida ? "Venció" : "Vence"} el {ddmmaa(proxima.vence)}
            </span>
          )}
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${(cobradas / Math.max(1, d.cuotas.length)) * 100}%` }} />
        </div>
      </div>

      <div className="flex gap-2">
        {proxima && (
          <Button size="sm" className="flex-1" variant={proximaVencida ? "destructive" : "default"} disabled={busy === proxima.n} onClick={() => void cobrar(proxima.n, true)}>
            {busy === proxima.n ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
            Cobrar {formatARS(proxima.monto)}
          </Button>
        )}
        <Button size="sm" variant="outline" className={cn(!proxima && "flex-1")} onClick={() => setVerCuotas((v) => !v)} aria-expanded={verCuotas}>
          Cuotas <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", verCuotas && "rotate-180")} />
        </Button>
      </div>

      {verCuotas && (
        <ul className="divide-y rounded-xl border text-sm">
          {d.cuotas.map((c) => {
            const vencida = !c.pagada && c.vence < hoy;
            return (
              <li key={c.n} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-12 text-xs text-muted-foreground">Cuota {c.n}</span>
                <span className={cn("flex-1 text-xs", vencida ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {ddmmaa(c.vence)}
                  {vencida ? " · vencida" : ""}
                </span>
                <span className="tabular-nums">{formatARS(c.monto)}</span>
                {c.pagada ? (
                  <button
                    type="button"
                    onClick={() => void cobrar(c.n, false)}
                    className="inline-flex w-20 items-center justify-end gap-1 text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                    title="Volver a pendiente"
                  >
                    <Check className="h-3.5 w-3.5" /> Cobrada
                  </button>
                ) : (
                  <Button size="sm" variant={vencida ? "destructive" : "outline"} className="h-7 w-20 text-xs" disabled={busy === c.n} onClick={() => void cobrar(c.n, true)}>
                    {busy === c.n ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Cobrar"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {d.nota && <p className="text-xs text-muted-foreground">{d.nota}</p>}
      {saldo > 0 && (
        <button type="button" onClick={() => void marcarIncobrable(d, true).catch(() => toast.error("No se pudo"))} className="self-start text-xs text-muted-foreground hover:underline">
          Marcar como incobrable
        </button>
      )}
    </div>
  );
}
