import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Título principal de la página. */
  title: string;
  /** Subtítulo opcional (ej: "Resumen operativo del día") */
  subtitle?: string;
  /** Contenido del lado derecho: botones de acción, badges, etc. */
  actions?: ReactNode;
  /** Contenido a la izquierda del título (ej: avatar, ícono). */
  leading?: ReactNode;
  /** Sin borde ni sticky (p. ej. dentro de un header compuesto del dashboard). */
  embedded?: boolean;
}

/**
 * Header consistente para todas las páginas. Compacto, alineado y sin
 * elementos redundantes con el sidebar (no incluye nav).
 */
export const PageHeader = ({
  title,
  subtitle,
  actions,
  leading,
  embedded = false,
}: PageHeaderProps) => {
  return (
    <header
      className={cn(
        "bg-card",
        !embedded && "border-b border-border sticky top-0 z-10"
      )}
    >
      <div className="px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:min-h-[56px]">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {leading}
          <div className="min-w-0 flex-1">
            <h1 className="text-sm sm:text-base md:text-lg font-bold leading-tight line-clamp-2 sm:truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] sm:text-xs text-muted-foreground line-clamp-2 sm:truncate mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 overflow-x-auto max-w-full sm:max-w-none pb-0.5 sm:pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
};
