import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatARS } from "@/lib/redes/format";
import { hoyAR } from "@/lib/fecha";
import { corregirCobro, interesAlPagar, marcarCobrada, MEDIOS, type FacturaDoc, type MedioCobro } from "@/lib/redes/facturacion";

const fechaCorta = (f: string) => f.split("-").reverse().slice(0, 2).join("/");

/**
 * Registrar un cobro (o corregir uno ya registrado): el día que pagó de verdad y si se le cobra el interés.
 * A veces se anota días después de que pagó: con la fecha real, si pagó hasta el vencimiento no hay interés.
 * Si pagó tarde, se elige si se le cobra o no.
 */
export function CobroDialog({
  fs,
  medio,
  onClose,
}: {
  /** Las que se cobran (o la que se corrige). null: cerrado. */
  fs: FacturaDoc[] | null;
  /** Al cobrar: cómo pagó. Sin medio: corregir un cobro que ya está registrado. */
  medio?: MedioCobro | null;
  onClose: () => void;
}) {
  const corregir = !medio;
  const hoy = hoyAR();
  const [fecha, setFecha] = useState(hoy);
  const [conInteres, setConInteres] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!fs?.length) return;
    const f = fs[0];
    // Al corregir: lo que ya estaba anotado. Al cobrar: hoy y con interés.
    setFecha(corregir ? f.pagado_el ?? (f.cobrado_at ? f.cobrado_at.slice(0, 10) : hoy) : hoy);
    setConInteres(corregir ? !!f.interes_cobrado : true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs]);

  const filas = (fs ?? []).map((f) => ({ f, interes: interesAlPagar(f, fecha) }));
  const hayInteres = filas.some((x) => x.interes > 0);
  const total = filas.reduce((n, x) => n + x.interes, 0);
  const venc = fs?.length === 1 ? fs[0].vencimiento : null;

  const guardar = async () => {
    if (!fs?.length) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoy) {
      toast.error("Elegí un día que no sea futuro");
      return;
    }
    setBusy(true);
    try {
      for (const f of fs) {
        if (corregir) await corregirCobro(f, { fecha, conInteres });
        else await marcarCobrada(f, medio!, { fecha, conInteres });
      }
      toast.success(
        corregir
          ? "Cobro corregido"
          : fs.length === 1
            ? `Marcada como cobrada${hayInteres ? (conInteres ? " con el interés" : " sin interés") : ""}`
            : `${fs.length} marcadas como cobradas`
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!fs?.length} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{corregir ? "Corregir el cobro" : "Registrar el cobro"}</DialogTitle>
          <DialogDescription>
            {fs?.length === 1 ? fs[0].cliente : `${fs?.length ?? 0} clientes`}
            {medio ? ` · ${MEDIOS.find((m) => m.value === medio)?.label ?? ""}` : ""}
            {venc ? ` · vencía el ${fechaCorta(venc)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cobro-fecha">¿Qué día pagó?</Label>
            <Input id="cobro-fecha" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Si lo anotás después, poné el día en que pagó de verdad.</p>
          </div>

          {hayInteres ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
              <Checkbox checked={conInteres} onCheckedChange={(v) => setConInteres(v === true)} className="mt-0.5" />
              <span className="text-sm">
                <span className="font-medium">Cobrarle el interés por mora</span>
                <span className="block text-xs text-muted-foreground">
                  {fs?.length === 1 ? `Pagó tarde: ${formatARS(total)} de interés.` : `Las que pagaron tarde suman ${formatARS(total)} de interés.`} Destildalo si no se le cobra.
                </span>
              </span>
            </label>
          ) : (
            <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">Pagó en término: sin interés.</p>
          )}

          {fs && fs.length > 1 && hayInteres && (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {filas
                .filter((x) => x.interes > 0)
                .map((x) => (
                  <li key={x.f.id} className="flex justify-between gap-2">
                    <span className="truncate">{x.f.cliente}</span>
                    <span className="tabular-nums">{formatARS(x.interes)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => void guardar()} disabled={busy} className="bg-emerald-600 hover:bg-emerald-600/90">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {corregir ? "Guardar" : "Marcar cobrada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
