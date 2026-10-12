import type { ReactNode } from "react";
import Link from "@/software/compat";
import { cn } from "@/lib/utils";

/** Tarjeta con un número grande. Si lleva href u onClick, se puede tocar para ver el detalle. */
export function KpiCard({
  value,
  label,
  hint,
  href,
  tone,
  onClick,
  active,
  icon,
}: {
  value: ReactNode;
  label: string;
  hint?: ReactNode;
  href?: string;
  tone?: "ok" | "pending" | "muted";
  onClick?: () => void;
  active?: boolean;
  icon?: ReactNode;
}) {
  const cls = cn(
    "group block min-w-0 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all",
    (href || onClick) && "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
    tone === "ok" && "border-success/30 bg-success/[0.05]",
    tone === "pending" && "border-warning/40 bg-warning/[0.06]",
    active && "border-primary ring-2 ring-primary/20"
  );
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon ? (
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4",
              tone === "ok" && "bg-success/15 text-success",
              tone === "pending" && "bg-warning/15 text-warning"
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-2 text-[length:clamp(1.1rem,calc((50vw-3.5rem)/6.4),1.6rem)] font-bold tabular-nums tracking-tight [overflow-wrap:anywhere] sm:text-[1.6rem]",
          tone === "ok" && "text-success",
          tone === "pending" && "text-warning",
          tone === "muted" && "text-muted-foreground"
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className={cn(cls, "w-full")} onClick={onClick}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}
