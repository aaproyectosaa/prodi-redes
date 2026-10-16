import { useState } from "react";
import { Check, HandCoins, Loader2, Plus, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/redes/PageShell";
import { cobrarCuotaCliente, crearDeudaCliente, marcarIncobrable, saldoDeudaCliente, useDeudasClientes, type DeudaCliente } from "@/lib/redes/facturacion";
import { formatARS, hoyISO } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

const ddmmaa = (f: string) => f.split("-").reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join("/");

/** "Te deben los clientes": planes de pago y deudas viejas, cuota por cuota. Tocás "Cobrada" cuando entra. */
export function DeudasClientes() {
  const lista = useDeudasClientes();
  const hoy = hoyISO();
  const [nueva, setNueva] = useState(false);
  const boton = (
    <Button size="sm" onClick={() => setNueva(true)}>
      <Plus className="mr-1.5 h-4 w-4" /> Cargar deuda
    </Button>
  );
  if (!lista.length)
    return (
      <Section title="Te deben los clientes" description="Deudas fuera de las boletas: lo que quedó debiendo un cliente, con recargo y en cuotas si hace falta." actions={boton}>
        <NuevaDeuda open={nueva} onOpenChange={setNueva} />
      </Section>
    );
  const activas = lista.filter((d) => !d.incobrable);
  const incobrables = lista.filter((d) => d.incobrable);
  const total = activas.reduce((a, d) => a + saldoDeudaCliente(d), 0);
  const vencido = activas.reduce((a, d) => a + d.cuotas.filter((c) => !c.pagada && c.vence < hoy).reduce((x, c) => x + c.monto, 0), 0);
  return (
    <Section
      title="Te deben los clientes"
      description={`Planes de pago y deudas viejas. Falta cobrar ${formatARS(total)}${vencido ? `, ${formatARS(vencido)} ya vencido` : ""}.`}
      actions={boton}
    >
      <NuevaDeuda open={nueva} onOpenChange={setNueva} />
      <div className="grid gap-3 lg:grid-cols-2">
        {activas.map((d) => (
          <Tarjeta key={d.id} d={d} hoy={hoy} />
        ))}
      </div>
      {incobrables.length > 0 && (
        <div className="mt-4 space-y-2">
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
    </Section>
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
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegí el cliente" />
              </SelectTrigger>
              <SelectContent>
                {[...clientes]
                  .sort((a, b) => a.nombre.localeCompare(b.nombre))
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                <SelectItem value={OTRO}>Otro (no está cargado)</SelectItem>
              </SelectContent>
            </Select>
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

function Tarjeta({ d, hoy }: { d: DeudaCliente; hoy: string }) {
  const [busy, setBusy] = useState<number | null>(null);
  const cobradas = d.cuotas.filter((c) => c.pagada).length;
  const saldo = saldoDeudaCliente(d);
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
    <div className={cn("space-y-3 rounded-2xl border bg-card p-4", saldo === 0 && "border-emerald-500/40")}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <HandCoins className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{d.cliente}</p>
          <p className="text-xs text-muted-foreground">
            {[d.detalle, d.base ? `deuda original ${formatARS(d.base)}` : null, d.interes ? `interés ${d.interes}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold tabular-nums">{saldo ? formatARS(saldo) : "Cobrado"}</p>
          <p className="text-[11px] text-muted-foreground">
            {cobradas} de {d.cuotas.length} cuotas
          </p>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(cobradas / Math.max(1, d.cuotas.length)) * 100}%` }} />
      </div>
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
      {d.nota && <p className="text-xs text-muted-foreground">{d.nota}</p>}
      {saldo > 0 && (
        <button type="button" onClick={() => void marcarIncobrable(d, true).catch(() => toast.error("No se pudo"))} className="text-xs text-muted-foreground hover:underline">
          Marcar como incobrable
        </button>
      )}
    </div>
  );
}
