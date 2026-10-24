import { useState, type ReactNode } from "react";
import { CalendarPlus, ChevronDown, Clapperboard, ImagePlus, MoreHorizontal, Plus, SlidersHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PlanMesDialog } from "@/components/redes/PlanMesDialog";
import { NuevaPiezaEquipo } from "@/components/redes/NuevaPiezaEquipo";
import type { ModoPlanificar } from "@/components/redes/PlanificarDialog";
import { cn } from "@/lib/utils";

// La barra de Videos, ordenada para no marear: un solo botón «Nuevo» con todo lo que se puede crear, los filtros
// juntos en un botón y lo que se usa poco (borrar) en «⋯».

function Opcion({ icon: Icon, color, titulo, texto }: { icon: React.ElementType; color: string; titulo: string; texto: string }) {
  return (
    <span className="flex items-start gap-3">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm", color)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{titulo}</span>
        <span className="block text-xs leading-snug text-muted-foreground">{texto}</span>
      </span>
    </span>
  );
}

/** «+ Nuevo»: planificar, ya lo filmé, rodaje, armar el mes con IA y pieza gráfica, en un menú. */
export function MenuNuevo({
  clienteId,
  onPlanificar,
  onRodaje,
}: {
  clienteId?: string | null;
  onPlanificar: (modo: ModoPlanificar) => void;
  onRodaje?: () => void;
}) {
  const navigate = useNavigate();
  const [mes, setMes] = useState(false);
  const [pieza, setPieza] = useState(false);
  const item = "cursor-pointer rounded-xl px-2.5 py-2 focus:bg-primary/[0.07]";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-11 w-full rounded-2xl bg-gradient-to-r from-[#6F40FC] to-[#9B6BFF] px-5 text-base font-semibold shadow-md shadow-primary/25 sm:h-10 sm:w-auto sm:rounded-xl sm:text-sm">
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo <ChevronDown className="ml-1.5 h-4 w-4 opacity-80" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl p-1.5">
          <DropdownMenuItem className={item} onSelect={() => onPlanificar("planificar")}>
            <Opcion icon={Plus} color="from-[#6F40FC] to-[#9B6BFF]" titulo="Planificar video" texto="Cargás la idea; después se agenda el rodaje" />
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => onPlanificar("filmado")}>
            <Opcion icon={Clapperboard} color="from-sky-500 to-blue-600" titulo="Ya lo filmé" texto="Grabaste sin planificar: creás el video y subís el material" />
          </DropdownMenuItem>
          {onRodaje && (
            <DropdownMenuItem className={item} onSelect={onRodaje}>
              <Opcion icon={CalendarPlus} color="from-amber-400 to-orange-500" titulo="Agendar rodaje" texto="Día, hora, lugar y qué videos se filman" />
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={item} onSelect={() => setMes(true)}>
            <Opcion icon={Sparkles} color="from-violet-500 to-fuchsia-500" titulo="Armar el mes con IA" texto="Las ideas del mes o una campaña de varios meses" />
          </DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => setPieza(true)}>
            <Opcion icon={ImagePlus} color="from-pink-500 to-rose-600" titulo="Pieza gráfica" texto="Un pedido para diseño, con las fotos" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PlanMesDialog open={mes} onOpenChange={setMes} clienteId={clienteId} />
      <NuevaPiezaEquipo open={pieza} onOpenChange={setPieza} clienteInicial={clienteId ?? null} onCreada={(id) => navigate(`/piezas?pieza=${id}`)} />
    </>
  );
}

/** Botón «Filtros» (con cuántos hay puestos) que abre los filtros juntos. */
export function BotonFiltros({ activos, onLimpiar, children }: { activos: number; onLimpiar?: () => void; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-medium transition-colors",
            activos ? "bg-primary/10 text-primary hover:bg-primary/15" : "bg-muted/60 hover:bg-muted"
          )}
        >
          <SlidersHorizontal className="h-4 w-4 text-primary" /> Filtros
          {activos > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-foreground">{activos}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] space-y-2 rounded-2xl p-3">
        {children}
        {activos > 0 && onLimpiar && (
          <button type="button" onClick={onLimpiar} className="w-full rounded-xl py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Sacar los filtros
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** «⋯»: lo que se usa poco. Hoy, borrar videos (con el modo borrar activo, queda el botón Cancelar a la vista). */
export function MenuMas({ modoBorrar, onBorrar, onCancelar }: { modoBorrar: boolean; onBorrar: () => void; onCancelar: () => void }) {
  if (modoBorrar)
    return (
      <Button variant="destructive" className="h-11 shrink-0 rounded-2xl px-4" onClick={onCancelar}>
        <X className="mr-1.5 h-4 w-4" /> Cancelar
      </Button>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Más opciones">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl">
        <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onSelect={onBorrar}>
          <Trash2 className="mr-2 h-4 w-4" /> Borrar videos
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
