import { useState } from "react";
import { BadgeCheck, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { abrirBoleta, autorizarEnArca, htmlBoletas, logoBoleta, nombrePeriodo, numeroArca, type Factura } from "@/lib/redes/facturacion";
import type { DatosCobro } from "@/lib/redes/types";

/**
 * La boleta tal cual le llega al cliente, con el botón para descargarla (imprimir o guardar en PDF).
 * Con `arca` (administración) muestra el botón para pedir el CAE de la factura electrónica.
 */
export function BoletaDialog({ f, cobro, onClose, arca = false }: { f: (Factura & { id?: string }) | null; cobro: DatosCobro; onClose: () => void; arca?: boolean }) {
  return (
    <Dialog open={!!f} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-3 rounded-2xl p-4 sm:p-6">
        {f && (
          <>
            <DialogHeader className="text-left">
              <DialogTitle>
                {f.tipo === "factura" ? "Factura" : "Boleta"} · {nombrePeriodo(f)}
              </DialogTitle>
              <DialogDescription>{f.razon_social || f.cliente}</DialogDescription>
            </DialogHeader>
            {f.tipo === "factura" && <EstadoArca f={f} puedeAutorizar={arca} />}
            <iframe
              title="Boleta"
              srcDoc={htmlBoletas([f], cobro, logoBoleta(), false)}
              className="min-h-[55dvh] w-full flex-1 rounded-xl border bg-white"
            />
            <Button onClick={() => abrirBoleta(f, cobro)} className="w-full sm:ml-auto sm:w-auto">
              <Download className="mr-2 h-4 w-4" /> Descargar o imprimir (PDF)
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EstadoArca({ f, puedeAutorizar }: { f: Factura & { id?: string }; puedeAutorizar: boolean }) {
  const [cargando, setCargando] = useState(false);
  const a = f.arca;
  if (a) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div>
          <div className="font-medium">
            {numeroArca(a)}
            {a.homologacion && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-700">prueba (homologación)</span>}
          </div>
          <div className="text-muted-foreground">
            CAE {a.cae} · vence {a.cae_vto.split("-").reverse().join("/")}
          </div>
        </div>
      </div>
    );
  }
  if (!puedeAutorizar || !f.id || f.estado === "borrador") return null;
  const id = f.id;
  const autorizar = async (reintentar: boolean) => {
    setCargando(true);
    try {
      const r = await autorizarEnArca({ ...f, id }, reintentar);
      toast.success(`${numeroArca(r.arca)} autorizada`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo autorizar";
      // Un intento anterior quedó a medias: se ofrece reintentar después de revisar en ARCA.
      if (/Revisá en ARCA/.test(msg)) {
        toast.error(msg, { action: { label: "Reintentar igual", onClick: () => void autorizar(true) }, duration: 15000 });
      } else toast.error(msg);
    } finally {
      setCargando(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground">
        Todavía no está autorizada en ARCA.
        {f.arca_error && <div className="mt-1 text-destructive">Último intento: {f.arca_error}</div>}
      </div>
      <Button size="sm" onClick={() => void autorizar(false)} disabled={cargando} className="shrink-0">
        {cargando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Autorizar en ARCA
      </Button>
    </div>
  );
}
