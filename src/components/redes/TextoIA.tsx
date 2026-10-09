import { Fragment } from "react";
import { cn } from "@/lib/utils";

/** **negrita** dentro de una línea. */
function linea(l: string) {
  return l.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
}

/**
 * Respuestas de la IA ordenadas: títulos ("Algo:" o "## Algo") en negrita y separados, listas con viñetas
 * (y sublistas más adentro), **negritas** y párrafos con aire entre bloques.
 */
export function TextoIA({ texto, className }: { texto: string; className?: string }) {
  const filas = texto.replace(/\r/g, "").split("\n");
  return (
    <div className={cn("break-words [overflow-wrap:anywhere]", className)}>
      {filas.map((l, i) => {
        const t = l.trim();
        if (!t) return <div key={i} className="h-2" />;
        const sangria = l.match(/^\s*/)?.[0].length ?? 0;
        const item = t.match(/^([-*•]|\d+[.)])\s+(.*)$/);
        if (item) {
          const numero = /^\d/.test(item[1]) ? item[1] : null;
          const sub = sangria >= 2;
          return (
            <div key={i} className={cn("flex gap-2 py-0.5", sub ? "pl-5 text-[0.95em] opacity-90" : "pl-1")}>
              <span className={cn("shrink-0 select-none", numero ? "min-w-4 tabular-nums" : sub ? "opacity-60" : "text-[#6F40FC]")}>{numero ?? (sub ? "◦" : "•")}</span>
              <span className="min-w-0">{linea(item[2])}</span>
            </div>
          );
        }
        const titulo = /^#{1,4}\s/.test(t) || (/:$/.test(t) && t.length <= 60) || /^\*\*[^*]+\*\*:?$/.test(t);
        if (titulo)
          return (
            <p key={i} className={cn("font-semibold", i > 0 && "pt-2")}>
              {linea(t.replace(/^#+\s*/, "").replace(/^\*\*([^*]+)\*\*(:?)$/, "$1$2"))}
            </p>
          );
        return (
          <p key={i} className="py-0.5">
            {linea(t)}
          </p>
        );
      })}
    </div>
  );
}
