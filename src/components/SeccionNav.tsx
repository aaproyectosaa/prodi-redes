import { useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import type { NavSection } from "@/lib/redes/nav";
import { isNavItemActive } from "@/components/AppSidebar";
import { cn } from "@/lib/utils";

/**
 * Los grupos con título del menú (Administración, Producción, Gestión) arrancan plegados;
 * el grupo donde estás parado se abre solo. Cada uno se abre o cierra con un toque.
 */
export function useSeccionesPlegables() {
  const location = useLocation();
  const [toque, setToque] = useState<Record<string, boolean>>({});
  const activa = (s: NavSection) => s.items.some((i) => isNavItemActive(i, location.pathname, location.search));
  const abierta = (s: NavSection) => !s.title || (toque[s.title] ?? activa(s));
  const alternar = (s: NavSection) => s.title && setToque((t) => ({ ...t, [s.title!]: !abierta(s) }));
  return { abierta, alternar, activa };
}

export function TituloSeccion({
  titulo,
  abierta,
  activa,
  pendientes,
  onClick,
  className,
}: {
  titulo: string;
  abierta: boolean;
  activa: boolean;
  pendientes: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={abierta}
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors hover:bg-accent/60",
        activa ? "text-foreground" : "text-muted-foreground/80",
        className
      )}
    >
      <span className="flex-1 text-left">{titulo}</span>
      {!abierta && pendientes > 0 && (
        <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold normal-case text-destructive-foreground">
          {pendientes > 99 ? "99+" : pendientes}
        </span>
      )}
      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", !abierta && "-rotate-90")} />
    </button>
  );
}
