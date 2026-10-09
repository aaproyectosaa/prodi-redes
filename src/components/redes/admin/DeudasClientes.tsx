import { useState } from "react";
import { Check, HandCoins, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/redes/PageShell";
import { cobrarCuotaCliente, marcarIncobrable, saldoDeudaCliente, useDeudasClientes, type DeudaCliente } from "@/lib/redes/facturacion";
import { formatARS, hoyISO } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

const ddmmaa = (f: string) => f.split("-").reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join("/");

/** "Te deben los clientes": planes de pago y deudas viejas, cuota por cuota. Tocás "Cobrada" cuando entra. */
export function DeudasClientes() {
  const lista = useDeudasClientes();
  const hoy = hoyISO();
  if (!lista.length) return null;
  const activas = lista.filter((d) => !d.incobrable);
  const incobrables = lista.filter((d) => d.incobrable);
  const total = activas.reduce((a, d) => a + saldoDeudaCliente(d), 0);
  const vencido = activas.reduce((a, d) => a + d.cuotas.filter((c) => !c.pagada && c.vence < hoy).reduce((x, c) => x + c.monto, 0), 0);
  return (
    <Section
      title="Te deben los clientes"
      description={`Planes de pago y deudas viejas. Falta cobrar ${formatARS(total)}${vencido ? `, ${formatARS(vencido)} ya vencido` : ""}.`}
    >
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
