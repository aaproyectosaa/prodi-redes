import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonthsYm, yearMonth, type StatsPeriod } from "@/software/lib/money";
import { mesLabel } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

const PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: "today", label: "Hoy" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
  { id: "year", label: "Año" },
  { id: "all", label: "Todo" },
];

/** Elegir de qué período se ven los números. En "Mes", flechas para ir al anterior o al siguiente. */
export function PeriodBar({
  period,
  month,
  onPeriod,
  onMonth,
  showAll = true,
}: {
  period: StatsPeriod;
  month?: string;
  onPeriod: (period: StatsPeriod) => void;
  onMonth?: (month: string) => void;
  showAll?: boolean;
}) {
  const items = showAll ? PERIODS : PERIODS.filter((p) => p.id !== "all");
  const mes = month || yearMonth();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl border bg-muted/40 p-1" role="tablist" aria-label="Período">
        {items.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={period === p.id}
            onClick={() => onPeriod(p.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
              period === p.id ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {period === "month" && onMonth ? (
        <div className="inline-flex items-center gap-1 rounded-xl border p-1">
          <button type="button" className="rounded-lg p-1.5 hover:bg-muted" onClick={() => onMonth(addMonthsYm(mes, -1))} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[120px] text-center text-sm font-semibold">{mesLabel(mes)}</span>
          <button
            type="button"
            className="rounded-lg p-1.5 hover:bg-muted disabled:opacity-40"
            onClick={() => onMonth(addMonthsYm(mes, 1))}
            disabled={mes >= yearMonth()}
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
