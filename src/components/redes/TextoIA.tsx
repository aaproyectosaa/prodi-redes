import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Solo se abren rutas de la app (videos, clientes, piezas, reuniones): nada de links de afuera. */
const RUTA_OK = /^\/(videos\?video=|clientes\/|piezas\?pieza=|reuniones\?r=)[A-Za-z0-9_-]{1,100}$/;

/** **negrita** dentro de un pedazo de texto. */
function negritas(l: string, k: string) {
  return l.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={`${k}${i}`}>{p.slice(2, -2)}</b> : <Fragment key={`${k}${i}`}>{p}</Fragment>));
}

/** Una línea: **negritas** y [nombre](/ruta) como botón que abre eso. */
function linea(l: string) {
  return l.split(/(\[[^\]]{1,160}\]\([^)\s]{1,200}\))/g).map((p, i) => {
    const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (m && RUTA_OK.test(m[2]))
      return (
        <Link
          key={i}
          to={m[2]}
          className="mx-0.5 inline-flex items-center gap-0.5 rounded-md bg-[#6F40FC]/10 px-1.5 py-0.5 font-medium text-[#6F40FC] transition-colors hover:bg-[#6F40FC]/20 dark:text-violet-300"
        >
          {m[1].replace(/\*\*/g, "")}
          <ArrowUpRight className="h-3 w-3 shrink-0" />
        </Link>
      );
    // Un link que no es de la app: se muestra solo el nombre.
    if (m) return <Fragment key={i}>{negritas(m[1], `l${i}-`)}</Fragment>;
    return <Fragment key={i}>{negritas(p, `t${i}-`)}</Fragment>;
  });
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
