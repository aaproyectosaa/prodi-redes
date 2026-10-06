import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { abrirBoleta, htmlBoletas, logoBoleta, type Factura } from "@/lib/redes/facturacion";
import { nombreMesF } from "../../../../api/_lib/facturacion";
import type { DatosCobro } from "@/lib/redes/types";

/** La boleta tal cual le llega al cliente, con el botón para descargarla (imprimir o guardar en PDF). */
export function BoletaDialog({ f, cobro, onClose }: { f: Factura | null; cobro: DatosCobro; onClose: () => void }) {
  return (
    <Dialog open={!!f} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-3 rounded-2xl p-4 sm:p-6">
        {f && (
          <>
            <DialogHeader className="text-left">
              <DialogTitle>
                {f.tipo === "factura" ? "Factura" : "Boleta"} · {nombreMesF(f.mes)}
              </DialogTitle>
              <DialogDescription>{f.razon_social || f.cliente}</DialogDescription>
            </DialogHeader>
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
