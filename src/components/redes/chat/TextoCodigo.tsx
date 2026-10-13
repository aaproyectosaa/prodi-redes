// Código en los mensajes (chats de Prodi Software): ```bloques``` con letra de programación, colores y "Copiar", y
// `código` suelto dentro del texto. Sin librerías: un coloreado simple que alcanza para leer JS/TS, SQL, Python, JSON, etc.

import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** ¿El texto tiene código? (un bloque entre ``` o `algo` suelto). */
export const tieneCodigo = (texto: string) => /```[\s\S]*?```|`[^`\n]+`/.test(texto);

const PALABRAS = new Set(
  (
    "const let var function return if else for while do switch case break continue import from export default class extends new " +
    "await async try catch finally throw typeof instanceof in of this super true false null undefined void interface type enum " +
    "public private protected static readonly implements as def print self None True False elif lambda pass with yield raise " +
    "select insert update delete into values set where and or not join left right inner on group by order having limit create " +
    "table alter drop index primary key references begin commit rollback echo fi then"
  ).split(" ")
);

/** Partes del código con su color. */
function colorear(codigo: string): ReactNode[] {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  const out: ReactNode[] = [];
  let ultimo = 0;
  let k = 0;
  for (let m = re.exec(codigo); m; m = re.exec(codigo)) {
    if (m.index > ultimo) out.push(codigo.slice(ultimo, m.index));
    const [txt, comentario, texto, numero, palabra] = m;
    if (comentario) out.push(<span key={k++} className="italic text-zinc-500">{txt}</span>);
    else if (texto) out.push(<span key={k++} className="text-emerald-300">{txt}</span>);
    else if (numero) out.push(<span key={k++} className="text-amber-300">{txt}</span>);
    else if (palabra && PALABRAS.has(palabra.toLowerCase())) out.push(<span key={k++} className="text-violet-300">{txt}</span>);
    else out.push(txt);
    ultimo = m.index + txt.length;
  }
  if (ultimo < codigo.length) out.push(codigo.slice(ultimo));
  return out;
}

function BloqueCodigo({ codigo, lenguaje }: { codigo: string; lenguaje: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  return (
    <div className="my-1 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 text-left text-zinc-100 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-zinc-800/80 px-2.5 py-1 text-[10px] text-zinc-400">
        <span className="font-mono uppercase tracking-wide">{lenguaje || "código"}</span>
        <button type="button" onClick={() => void copiar()} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-zinc-100">
          {copiado ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[12px] leading-relaxed">
        <code>{colorear(codigo)}</code>
      </pre>
    </div>
  );
}

/**
 * Texto con código: los bloques ```…``` se muestran como código y el resto como siempre (lo que no es
 * código, ej. las menciones, va con `render`). `mio`: el globo propio (fondo violeta) para el código suelto.
 */
export function TextoConCodigo({ texto, mio, render }: { texto: string; mio: boolean; render: (t: string) => ReactNode }) {
  const partes = texto.split(/(```[^\n`]*\n?[\s\S]*?```)/g);
  return (
    <div className="min-w-0 space-y-1">
      {partes.map((p, i) => {
        const bloque = p.match(/^```([^\n`]*)\n?([\s\S]*?)```$/);
        if (bloque) return <BloqueCodigo key={i} lenguaje={bloque[1].trim()} codigo={bloque[2].replace(/\n$/, "")} />;
        if (!p.trim()) return null;
        // Código suelto dentro del texto: `así`.
        const trozos = p.replace(/^\n+|\n+$/g, "").split(/(`[^`\n]+`)/g);
        return (
          <p key={i} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {trozos.map((t, j) =>
              /^`[^`\n]+`$/.test(t) ? (
                <code key={j} className={cn("rounded px-1 py-0.5 font-mono text-[0.9em]", mio ? "bg-black/20" : "bg-muted")}>
                  {t.slice(1, -1)}
                </code>
              ) : (
                <Fragment key={j}>{render(t)}</Fragment>
              )
            )}
          </p>
        );
      })}
    </div>
  );
}
