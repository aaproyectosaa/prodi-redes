import { Check, CloudOff, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hace } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import type { EstadoBorrador as Estado } from "@/lib/redes/borradores";

/** "Guardar borrador" con el estado al lado (guardado hace X, guardando…, sin guardar). */
export function EstadoBorrador({
  estado,
  guardadoAt,
  porNombre,
  onGuardar,
  className,
}: {
  estado: Estado;
  guardadoAt: string | null;
  porNombre?: string | null;
  onGuardar: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "flex items-center gap-1 text-[11px]",
          estado === "error" ? "text-red-600 dark:text-red-400" : estado === "guardado" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
        )}
      >
        {estado === "guardando" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Guardando…
          </>
        ) : estado === "guardado" && guardadoAt ? (
          <>
            <Check className="h-3 w-3" /> Borrador guardado {hace(guardadoAt)}
            {porNombre ? ` por ${porNombre.split(" ")[0]}` : ""}
          </>
        ) : estado === "sin-guardar" ? (
          "Cambios sin guardar"
        ) : estado === "error" ? (
          <>
            <CloudOff className="h-3 w-3" /> No se pudo guardar
          </>
        ) : null}
      </span>
      <Button type="button" size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-[11px]" onClick={onGuardar} disabled={estado === "guardando"}>
        <Save className="mr-1 h-3 w-3" /> Guardar borrador
      </Button>
    </div>
  );
}
