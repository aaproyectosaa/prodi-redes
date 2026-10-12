import Link from "@/software/compat";
import type { ReactNode } from "react";

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
  const color =
    tone === "ok" ? "var(--ok)" : tone === "pending" ? "var(--pending)" : undefined;
  const inner = (
    <>
      <div className="kpi-head">
        <div className="l">{label}</div>
        {icon ? <span className={`kpi-ico${tone ? ` ${tone}` : ""}`}>{icon}</span> : null}
      </div>
      <div className="n" style={color ? { color } : undefined}>
        {value}
      </div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </>
  );
  const cls = `card kpi kpi-link${active ? " kpi-active" : ""}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
