import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { doc, updateDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LogoCliente } from "@/components/redes/LogoCliente";
import { assertEditable } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import type { Project, QuienPublica } from "@/integrations/firebase/types";

const OPCIONES: { v: QuienPublica; label: string }[] = [
  { v: "prodi", label: "Nosotros" },
  { v: "cliente", label: "El cliente" },
];

/**
 * Quién sube los videos de cada cliente, todos en una lista: "Nosotros" (pasa a pauta) o "El cliente"
 * (el video aprobado se le entrega). Se guarda al tocar.
 */
export function QuienSubeDialog({ open, onOpenChange, clientes }: { open: boolean; onOpenChange: (o: boolean) => void; clientes: Project[] }) {
  const [guardando, setGuardando] = useState<string | null>(null);
  const cambiar = async (c: Project, publica: QuienPublica) => {
    if ((c.produccion?.publica ?? "prodi") === publica) return;
    setGuardando(c.id);
    try {
      assertEditable();
      await updateDoc(doc(db, "projects", c.id), { produccion: { ...(c.produccion ?? {}), publica } });
      toast.success(`${c.nombre}: ${publica === "cliente" ? "los sube el cliente" : "los subimos nosotros"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  };
  const ordenados = [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const delCliente = ordenados.filter((c) => c.produccion?.publica === "cliente").length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>¿Quién sube los videos?</DialogTitle>
          <DialogDescription>
            Nosotros: cuando el cliente aprueba, pasa a Pauta para subirlo. El cliente: se le entrega el video para que lo suba él.
            {` ${ordenados.length - delCliente} los subimos nosotros · ${delCliente} los sube el cliente.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-xl border">
          {ordenados.map((c) => {
            const actual = c.produccion?.publica ?? "prodi";
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <LogoCliente cliente={c} className="h-8 w-8 text-[10px]" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.nombre}</span>
                {guardando === c.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <div className="flex shrink-0 rounded-lg border p-0.5" role="radiogroup" aria-label={`Quién sube los videos de ${c.nombre}`}>
                  {OPCIONES.map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      role="radio"
                      aria-checked={actual === o.v}
                      disabled={guardando === c.id}
                      onClick={() => void cambiar(c, o.v)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        actual === o.v ? (o.v === "cliente" ? "bg-amber-500 text-white" : "bg-primary text-primary-foreground") : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
