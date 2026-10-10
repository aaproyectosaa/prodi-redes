import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatARS } from "@/lib/redes/format";
import { MEDIOS, pagadoDe, saldoDe, type Factura, type MedioCobro } from "@/lib/redes/facturacion";
import { cn } from "@/lib/utils";

/** "Pagó una parte": cuánto y cómo. Propone la mitad de lo que falta. */
export function PagoParcialDialog({
  f,
  onClose,
  onConfirmar,
}: {
  f: Factura | null;
  onClose: () => void;
  onConfirmar: (monto: number, medio: MedioCobro) => Promise<void>;
}) {
  const saldo = f ? saldoDe(f) : 0;
  const pagado = f ? pagadoDe(f) : 0;
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<MedioCobro>("transferencia");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (f) {
      setMonto(String(Math.round(saldo / 2)));
      setMedio("transferencia");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  const n = Math.round(Number(monto.replace(/\./g, "").replace(",", ".")) || 0);
  const ok = n > 0 && n <= saldo;
  const confirmar = async () => {
    setBusy(true);
    try {
      await onConfirmar(n, medio);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!f} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pagó una parte</DialogTitle>
          <DialogDescription>
            {f?.cliente}: total {formatARS(f?.bruto ?? 0)}
            {pagado ? ` · ya pagó ${formatARS(pagado)}` : ""} · falta {formatARS(saldo)}. Cuando complete el total queda cobrada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pp-monto">¿Cuánto pagó?</Label>
            <Input id="pp-monto" inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
            <div className="flex gap-1.5">
              {[2, 3].map((d) => (
                <Button key={d} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMonto(String(Math.round(saldo / d)))}>
                  1/{d}
                </Button>
              ))}
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMonto(String(saldo))}>
                Todo lo que falta
              </Button>
            </div>
            {n > saldo && <p className="text-xs text-destructive">Es más de lo que falta ({formatARS(saldo)}).</p>}
          </div>
          <div className="space-y-1.5">
            <Label>¿Cómo pagó?</Label>
            <div className="flex flex-wrap gap-1.5">
              {MEDIOS.filter((m) => m.value !== "adelantado" && m.value !== "debito").map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMedio(m.value)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                    medio === m.value ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50"
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
          <Button onClick={() => void confirmar()} disabled={!ok || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar {ok ? formatARS(n) : "pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
