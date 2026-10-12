import { yearMonth, type StatsPeriod } from "@/software/lib/money";

const PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: "today", label: "Hoy" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
  { id: "year", label: "Año" },
  { id: "all", label: "Todo" },
];

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
  return (
    <div className="period-tabs" role="tablist" aria-label="Período">
      {items.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={period === p.id}
          className={`period-tab${period === p.id ? " active" : ""}`}
          onClick={() => onPeriod(p.id)}
        >
          {p.label}
        </button>
      ))}
      {period === "month" && onMonth ? (
        <input
          type="month"
          value={month || yearMonth()}
          onChange={(e) => onMonth(e.target.value)}
          className="period-month"
          aria-label="Mes"
        />
      ) : null}
    </div>
  );
}
