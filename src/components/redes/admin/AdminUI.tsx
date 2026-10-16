// Piezas comunes de la parte administrativa (Resumen, Cobros, Pagos al equipo, Gastos, Deudas): los números grandes
// de arriba, las pestañas de cada paso y el "¿Cómo funciona?" que guarda las explicaciones largas.

import { useState, type ReactNode } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type TonoKpi = "violeta" | "verde" | "ambar" | "rojo" | "azul" | "gris";
const TONOS: Record<TonoKpi, { icono: string; borde: string }> = {
  violeta: { icono: "from-[#6F40FC] to-[#E040A0]", borde: "" },
  verde: { icono: "from-emerald-400 to-teal-600", borde: "" },
  ambar: { icono: "from-amber-400 to-orange-500", borde: "" },
  rojo: { icono: "from-red-500 to-rose-600", borde: "border-red-500/40 bg-red-500/[0.05]" },
  azul: { icono: "from-sky-400 to-blue-600", borde: "" },
  gris: { icono: "from-slate-400 to-slate-600", borde: "" },
};

/** Un número grande con su ícono de color, qué es y una línea chica abajo (opcional, con barra de avance). */
export function Kpi({
  icono: Icono,
  label,
  valor,
  sub,
  tono = "violeta",
  avance,
  onClick,
}: {
  icono: React.ElementType;
  label: string;
  valor: string;
  sub?: ReactNode;
  tono?: TonoKpi;
  /** 0 a 1: barra de avance abajo. */
  avance?: number;
  onClick?: () => void;
}) {
  const t = TONOS[tono];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-2xl border bg-card p-3.5 text-left sm:p-4",
        t.borde,
        onClick && "transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", t.icono)}>
          <Icono className="h-4 w-4" />
        </span>
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      </span>
      <span className="truncate text-xl font-bold tabular-nums tracking-tight sm:text-2xl">{valor}</span>
      {avance != null && (
        <span className="h-1.5 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${Math.round(Math.min(1, Math.max(0, avance)) * 100)}%` }} />
        </span>
      )}
      {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
    </Comp>
  );
}

export function FilaKpis({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-2.5 lg:grid-cols-4", className)}>{children}</div>;
}

/** "¿Cómo funciona?": las explicaciones largas quedan plegadas (no tapan lo importante). */
export function ComoFunciona({ children, className }: { children: ReactNode; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className={cn("rounded-2xl border border-dashed", abierto && "bg-muted/30", className)}>
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium text-muted-foreground hover:text-foreground">
        <HelpCircle className="h-4 w-4 text-primary" />
        ¿Cómo funciona?
        <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", abierto && "rotate-180")} />
      </button>
      {abierto && <div className="space-y-2 px-3.5 pb-3.5 text-sm leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

export interface Pestania<K extends string> {
  k: K;
  label: string;
  n?: number;
  /** Rojo si hay algo urgente ahí. */
  alerta?: boolean;
  /** Ya está todo hecho (tilde verde). */
  listo?: boolean;
}

/** Pestañas de los pasos de cada pantalla, con su número al lado. En el celular se deslizan. */
export function Pestanias<K extends string>({ items, valor, onChange }: { items: Pestania<K>[]; valor: K; onChange: (k: K) => void }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
      <div className="inline-flex min-w-full gap-1 rounded-2xl bg-muted/60 p-1 md:min-w-0">
        {items.map((p) => (
          <button
            key={p.k}
            type="button"
            onClick={() => onChange(p.k)}
            className={cn(
              "flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
              valor === p.k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {p.listo && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            {p.label}
            {p.n != null && p.n > 0 && (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                  p.alerta ? "bg-red-500 text-white" : valor === p.k ? "bg-primary text-primary-foreground" : "bg-muted-foreground/15"
                )}
              >
                {p.n}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Lista vacía amable ("Todo al día"). */
export function Vacio({ icono: Icono, titulo, texto }: { icono: React.ElementType; titulo: string; texto?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Icono className="h-6 w-6" />
      </span>
      <p className="font-semibold">{titulo}</p>
      {texto && <p className="max-w-sm text-sm text-muted-foreground">{texto}</p>}
    </div>
  );
}
