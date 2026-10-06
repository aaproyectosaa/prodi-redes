import { useMemo, useState } from "react";
import { formatARS, formatNum, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/redes/types";
import { resumirMes } from "./ResultadosMes";

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const corto = (m: string) => MES_CORTO[Number(m.slice(5, 7)) - 1];

/**
 * Un solo gráfico: mensajes recibidos por mes (últimos 6). Es lo que más le importa al
 * comercio. El costo por mensaje va en el texto y en el detalle de cada barra (nunca un segundo eje).
 */
export function EvolucionMensajes({
  videos,
  proyectoId,
  mes,
  onMes,
}: {
  videos: Video[];
  proyectoId: string;
  /** Mes elegido (se resalta). */
  mes: string;
  onMes?: (m: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const datos = useMemo(() => {
    // La ventana siempre termina en el mes actual; el mes elegido se resalta.
    const ultimo = mesActual();
    return [-5, -4, -3, -2, -1, 0].map((d) => {
      const m = sumarMeses(ultimo, d);
      const r = resumirMes(videos, proyectoId, m);
      return { mes: m, mensajes: r.mensajes, costo: r.costoMensaje, publicados: r.publicados.length };
    });
  }, [videos, proyectoId]);

  const max = Math.max(1, ...datos.map((d) => d.mensajes));
  if (datos.every((d) => d.mensajes === 0)) return null;

  const idx = Math.max(0, datos.findIndex((d) => d.mes === mes));
  const actual = datos.findIndex((d) => d.mes === mes) >= 0 ? datos[idx] : datos[datos.length - 1];
  const anterior = datos[datos.indexOf(actual) - 1] ?? { mes: "", mensajes: 0 };
  const enCurso = actual.mes === mesActual();
  const nombreMes = mesLabel(actual.mes).toLowerCase().split(" ")[0];
  let frase = `${enCurso ? `En lo que va de ${nombreMes}` : `En ${nombreMes}`} te llegaron ${formatNum(actual.mensajes)} mensajes`;
  if (actual.costo) frase += ` y cada uno costó ${formatARS(actual.costo)}`;
  // Un mes que todavía no terminó no se compara (siempre daría "menos").
  if (!enCurso && anterior.mes && anterior.mensajes > 0 && actual.mensajes > 0) {
    const dif = Math.round(((actual.mensajes - anterior.mensajes) / anterior.mensajes) * 100);
    if (dif !== 0) frase += `: ${Math.abs(dif)}% ${dif > 0 ? "más" : "menos"} que en ${mesLabel(anterior.mes).toLowerCase().split(" ")[0]}`;
  }
  frase += ".";

  const foco = datos.find((d) => d.mes === hover);

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Mensajes recibidos por mes</h3>
        <p className="text-xs text-muted-foreground">{frase}</p>
      </div>

      <div className="relative">
        {foco && (
          <div className="pointer-events-none absolute -top-1 right-0 z-10 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
            <p className="font-semibold capitalize">{mesLabel(foco.mes)}</p>
            <p>{formatNum(foco.mensajes)} mensajes</p>
            <p className="text-muted-foreground">
              {foco.costo ? `${formatARS(foco.costo)} por mensaje` : "Sin inversión cargada"} · {foco.publicados} video
              {foco.publicados === 1 ? "" : "s"}
            </p>
          </div>
        )}
        <div className="flex h-44 items-end gap-[2px] border-b border-border/70" role="img" aria-label={frase}>
          {datos.map((d) => {
            const sel = d.mes === actual.mes;
            const alto = d.mensajes ? Math.max(4, (d.mensajes / max) * 100) : 0;
            return (
              <button
                key={d.mes}
                type="button"
                onMouseEnter={() => setHover(d.mes)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(d.mes)}
                onBlur={() => setHover(null)}
                onClick={() => onMes?.(d.mes)}
                className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                aria-label={`${mesLabel(d.mes)}: ${d.mensajes} mensajes`}
              >
                {(sel || hover === d.mes) && d.mensajes > 0 && (
                  <span className="mb-1 text-xs font-semibold tabular-nums">{formatNum(d.mensajes)}</span>
                )}
                <span
                  className={cn(
                    "w-3/5 max-w-[56px] rounded-t-[4px] transition-colors",
                    sel ? "bg-primary" : "bg-primary/40 group-hover:bg-primary/70"
                  )}
                  style={{ height: `${alto}%` }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-[2px]">
          {datos.map((d) => (
            <span
              key={d.mes}
              className={cn("flex-1 text-center text-[11px]", d.mes === actual.mes ? "font-semibold text-foreground" : "text-muted-foreground")}
            >
              {corto(d.mes)}
              {d.mes === mesActual() && <span className="hidden font-normal text-muted-foreground sm:inline"> (en curso)</span>}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
