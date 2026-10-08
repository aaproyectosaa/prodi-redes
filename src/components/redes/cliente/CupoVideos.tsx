import { CalendarClock, Clapperboard, Hourglass, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hoyAR } from "@/lib/fecha";
import { formatARS, mesLabel, sumarMeses } from "@/lib/redes/format";
import type { UsoPlan } from "@/lib/redes/planes";
import { cn } from "@/lib/utils";

const nombreMes = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();

/** Días que faltan para el 1 del mes que viene (cuando se renuevan los videos). */
function diasParaRenovar(mes: string): number {
  const hoy = Date.parse(`${hoyAR()}T12:00:00Z`);
  const renueva = Date.parse(`${sumarMeses(mes, 1)}-01T12:00:00Z`);
  return Math.max(1, Math.round((renueva - hoy) / 86_400_000));
}

/** Un circulito por video del plan: lleno = usado. Con muchos videos, una barra. */
function Puntos({ usados, cupo, agotado }: { usados: number; cupo: number; agotado: boolean }) {
  if (cupo > 12) {
    return (
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", agotado ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(100, (usados / cupo) * 100)}%` }} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden>
      {Array.from({ length: cupo }, (_, i) => (
        <span
          key={i}
          style={{ animationDelay: `${i * 40}ms` }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors animate-in zoom-in-50 fill-mode-both motion-reduce:animate-none",
            i < usados
              ? agotado
                ? "border-amber-500/40 bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "border-primary/30 bg-primary/15 text-primary"
              : "border-dashed border-primary/50 bg-background text-primary/60"
          )}
        >
          <Clapperboard className="h-3.5 w-3.5" />
        </span>
      ))}
    </div>
  );
}

/**
 * Aviso de los videos del plan: cuando le queda 1 y cuando se le terminaron (con la opción de pedir
 * uno extra o esperar a que se renueven el 1). Con más de 1 disponible no muestra nada.
 */
export function CupoVideos({
  uso,
  mes,
  precioExtra,
  onPedir,
  className,
}: {
  uso: UsoPlan;
  mes: string;
  precioExtra: number;
  onPedir: () => void;
  className?: string;
}) {
  if (uso.cupo <= 0 || uso.disponibles > 1) return null;
  const agotado = uso.disponibles === 0;
  const sig = nombreMes(sumarMeses(mes, 1));
  const dias = diasParaRenovar(mes);
  const usados = Math.min(uso.usados, uso.cupo);

  if (!agotado) {
    return (
      <div className={cn("rounded-2xl border border-primary/30 bg-primary/[0.05] p-4 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none", className)}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Hourglass className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Te queda 1 video de {nombreMes(mes)}</p>
            <p className="text-sm text-muted-foreground">
              Usaste {usados} de los {uso.cupo} de tu plan. El 1 de {sig} se renuevan.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Puntos usados={usados} cupo={uso.cupo} agotado={false} />
          <Button size="sm" onClick={onPedir}>
            <Plus className="mr-1.5 h-4 w-4" /> Pedir mi último video
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/[0.12] via-amber-500/[0.05] to-transparent p-4 sm:p-5 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
          <Clapperboard className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight">Se te terminaron los videos de {nombreMes(mes)}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ya usaste los {uso.cupo} videos de tu plan este mes. ¿Necesitás otro? Podés pedirlo igual.
          </p>
        </div>
      </div>
      <div className="mt-4">
        <Puntos usados={usados} cupo={uso.cupo} agotado />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onPedir}
          className="group flex items-center gap-3 rounded-xl bg-primary p-3 text-left text-primary-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/20">
            <Plus className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Pedir un video extra</span>
            <span className="block text-xs opacity-90">{precioExtra > 0 ? `${formatARS(precioExtra)} · lo pagás con Mercado Pago` : "Te pasamos el precio"}</span>
          </span>
        </button>
        <div className="flex items-center gap-3 rounded-xl border bg-background/70 p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CalendarClock className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">O esperá al 1 de {sig}</span>
            <span className="block text-xs text-muted-foreground">
              Faltan {dias} día{dias === 1 ? "" : "s"}: se renuevan tus {uso.incluidos} videos
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
