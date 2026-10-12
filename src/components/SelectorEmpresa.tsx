import { Check, ChevronsUpDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EMPRESAS, useEmpresa, type Empresa } from "@/lib/empresa";
import { cn } from "@/lib/utils";

/**
 * Etiqueta de la empresa (Redes / Software) al lado del logo. Si la persona trabaja en las dos, se toca y se cambia
 * de empresa (como cambiar de cuenta): el menú y las pantallas pasan a ser los de esa empresa.
 */
export function SelectorEmpresa({ className }: { className?: string }) {
  const { empresa, disponibles, cambiar } = useEmpresa();
  const navigate = useNavigate();
  const etiqueta = (
    <span className={cn("rounded-md bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary", className)}>
      {EMPRESAS[empresa].corto}
    </span>
  );
  if (disponibles.length < 2) return etiqueta;
  const ir = (e: Empresa) => {
    if (e === empresa) return;
    cambiar(e);
    navigate(EMPRESAS[e].inicio);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-0.5 rounded-md bg-primary/12 py-0.5 pl-1.5 pr-1 text-[10px] font-semibold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20",
            className
          )}
          title="Cambiar de empresa"
          aria-label={`Empresa: ${EMPRESAS[empresa].nombre}. Cambiar de empresa`}
        >
          {EMPRESAS[empresa].corto}
          <ChevronsUpDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Cambiar de empresa</DropdownMenuLabel>
        {disponibles.map((e) => (
          <DropdownMenuItem key={e} onClick={() => ir(e)} className="gap-2">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold",
                e === "software" ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "bg-primary/15 text-primary"
              )}
            >
              {e === "software" ? "SW" : "RD"}
            </span>
            <span className="flex-1 text-sm font-medium">{EMPRESAS[e].nombre}</span>
            {e === empresa && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
