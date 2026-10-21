import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Briefcase, ChevronDown, Clapperboard, Landmark, Layers, type LucideIcon } from "lucide-react";
import type { NavSection } from "@/lib/redes/nav";
import { isNavItemActive } from "@/components/AppSidebar";
import { cn } from "@/lib/utils";

/**
 * Los grupos con título del menú (Administración, Producción, Gestión) van como acordeón: uno abierto por vez, así no
 * se mezclan. Arranca abierto el grupo donde estás parado; cada uno se abre o cierra con un toque.
 */
export function useSeccionesPlegables() {
  const location = useLocation();
  // undefined: lo decide la pantalla actual. null: todos cerrados. Texto: el grupo que abrió la persona.
  const [elegida, setElegida] = useState<string | null | undefined>(undefined);
  const activa = (s: NavSection) => s.items.some((i) => isNavItemActive(i, location.pathname, location.search));
  const abierta = (s: NavSection) => !s.title || (elegida === undefined ? activa(s) : elegida === s.title);
  const alternar = (s: NavSection) => s.title && setElegida(abierta(s) ? null : s.title);
  return { abierta, alternar, activa };
}

/** Color e ícono de cada grupo, para distinguirlos de un vistazo. */
export function estiloSeccion(titulo?: string): { icono: LucideIcon; chip: string; linea: string; texto: string } {
  switch (titulo) {
    case "Administración":
      return { icono: Landmark, chip: "bg-emerald-500/15 text-emerald-500", linea: "border-emerald-500/30", texto: "text-emerald-500" };
    case "Producción":
      return { icono: Clapperboard, chip: "bg-violet-500/15 text-violet-500", linea: "border-violet-500/30", texto: "text-violet-500" };
    case "Gestión":
      return { icono: Briefcase, chip: "bg-amber-500/15 text-amber-500", linea: "border-amber-500/30", texto: "text-amber-500" };
    default:
      return { icono: Layers, chip: "bg-sky-500/15 text-sky-500", linea: "border-sky-500/30", texto: "text-sky-500" };
  }
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
  const e = estiloSeccion(titulo);
  const Icono = e.icono;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={abierta}
      className={cn(
        "group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] font-semibold transition-colors hover:bg-accent/60",
        abierta || activa ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-transform group-hover:scale-105", e.chip)}>
        <Icono className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 text-left">{titulo}</span>
      {!abierta && pendientes > 0 && (
        <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
          {pendientes > 99 ? "99+" : pendientes}
        </span>
      )}
      {!abierta && activa && pendientes === 0 && <span className={cn("h-1.5 w-1.5 rounded-full bg-current", e.texto)} aria-label="Estás en este grupo" />}
      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", !abierta && "-rotate-90")} />
    </button>
  );
}
