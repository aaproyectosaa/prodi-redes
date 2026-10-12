import { useState, type ReactNode } from "react";

export function FilterBar({
  children,
  className = "filters-payments",
  activeCount = 0,
}: {
  children: ReactNode;
  className?: string;
  activeCount?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="filter-shell">
      <button
        type="button"
        className="btn sm line filter-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        Filtros{activeCount ? ` · ${activeCount}` : ""}
      </button>
      <div className={`filters is-collapsible ${className}${open ? " open" : ""}`}>
        {children}
      </div>
    </div>
  );
}
