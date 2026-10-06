import { cn } from "@/lib/utils";
import type { UsoPlan } from "@/lib/redes/planes";

export function PlanUsage({
  uso,
  compact = false,
  className,
}: {
  uso: UsoPlan;
  compact?: boolean;
  className?: string;
}) {
  const over = uso.excedido > 0;
  const full = !over && uso.cupo > 0 && uso.usados >= uso.cupo;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {compact ? "Plan" : "Videos del plan"}
        </span>
        <span className={cn("font-semibold tabular-nums", over && "text-destructive")}>
          {uso.usados}/{uso.cupo}
          {uso.creditosExtra > 0 && (
            <span className="ml-1 font-normal text-muted-foreground">
              {compact ? `(+${uso.creditosExtra})` : `(incluye ${uso.creditosExtra} extra)`}
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            over ? "bg-destructive" : full ? "bg-warning" : "bg-primary"
          )}
          style={{ width: `${uso.pct}%` }}
        />
      </div>
      {!compact && over && (
        <p className="text-xs text-destructive">
          Se pasó por {uso.excedido} video{uso.excedido === 1 ? "" : "s"}: ofrecele videos extra.
        </p>
      )}
    </div>
  );
}
