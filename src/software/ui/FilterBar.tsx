import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Filtros: en la compu siempre a la vista; en el celular, detrás de un botón. */
export function FilterBar({ children, className, activeCount = 0 }: { children: ReactNode; className?: string; activeCount?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <Button variant="outline" size="sm" className="mb-2 md:hidden" onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal className="mr-1.5 h-4 w-4" />
        Filtros{activeCount ? ` · ${activeCount}` : ""}
      </Button>
      <div className={cn("flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 md:flex", open ? "flex" : "hidden", className)}>{children}</div>
    </div>
  );
}
