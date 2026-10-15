import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Botones de acción de los tableros (Mis videos, Videos): en el celular, tarjetitas con un círculo de color
// y el nombre abajo (como el menú del clip del chat); en la compu, botones compactos en fila.

export function AccionTile({
  icon: Icon,
  label,
  color,
  onClick,
  title,
}: {
  icon: React.ElementType;
  label: string;
  /** Degradé del círculo, ej. "from-violet-500 to-fuchsia-500". */
  color: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border bg-card px-1 py-2.5 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:scale-[0.97] sm:h-10 sm:flex-row sm:gap-2 sm:rounded-xl sm:py-0 sm:pl-1.5 sm:pr-3"
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm sm:h-7 sm:w-7", color)}>
        <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
      </span>
      <span className="w-full truncate text-[11px] font-medium leading-tight sm:w-auto sm:text-sm">{label}</span>
    </button>
  );
}

/** La grilla de acciones: 4 por fila en el celular, en fila en la compu. */
export function GrillaAcciones({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid w-full grid-cols-4 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center", className)}>{children}</div>;
}
