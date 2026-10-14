// Código en los mensajes (chats de Prodi Software): ```bloques``` con letra de programación, colores y "Copiar", y
// `código` suelto dentro del texto. Sin librerías: un coloreado simple que alcanza para leer JS/TS, SQL, Python, JSON, etc.

import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn, hrefSeguro } from "@/lib/utils";

/**
 * ¿Es un error pegado? (un log o stack trace: varias líneas con "Error", "Exception", "Traceback", líneas "at …" o
 * "File …, line N"). Se muestra plegado para que no tape la conversación.
 */
export function esError(texto: string): boolean {
  const lineas = texto.trim().split("\n");
  if (lineas.length < 4) return false;
  const pila = lineas.filter((l) => /^\s+at\s|^\s*File ".*", line \d+|^\s+\^+\s*$/.test(l)).length;
  const marca = /\b(\w*Error|Exception|Traceback|Uncaught|FATAL|ERR!|panic:|failed|Unhandled)\b/i.test(lineas.slice(0, 5).join("\n"));
  return pila >= 2 || (marca && lineas.length >= 5);
}

/** ¿El texto tiene un bloque de código (``` con varias líneas)? */
export const tieneCodigo = (texto: string) => /```[^\n`]*\n[\s\S]*?```/.test(texto);

// Lo que se reconoce solo dentro del texto, sin poner comillas:
// - links (https://… o www.…);
// - código marcado: `así` o ```así``` en una línea;
// - nombres de variables como MP_ACCESS_TOKEN;
// - claves, tokens e ids: tiras largas de letras y números (APP_USR-1234…, 6f1a9c…).
const RICO =
  /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]|www\.[^\s<>"']*[^\s<>"'.,;:!?)\]])|```([^`\n]+)```|`([^`\n]+)`|(\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:-[A-Za-z0-9_-]+)?\b|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_-]{19,}\b)/g;

/** Código suelto: se toca y se copia. */
function CodigoSuelto({ codigo, mio }: { codigo: string; mio: boolean }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      title="Tocá para copiar"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard
          .writeText(codigo)
          .then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1200);
          })
          .catch(() => toast.error("No se pudo copiar"));
      }}
      className={cn(
        "inline rounded px-1 py-px text-left font-mono text-[0.88em] [overflow-wrap:anywhere] transition-colors",
        mio ? "bg-black/25 hover:bg-black/35" : "bg-muted text-foreground hover:bg-muted-foreground/20"
      )}
    >
      {codigo}
      {copiado ? <Check className="ml-1 inline h-3 w-3 align-[-1px]" /> : <Copy className="ml-1 inline h-3 w-3 align-[-1px] opacity-50" />}
    </button>
  );
}

/** Texto con links y código reconocidos solos; lo demás (ej. las menciones) va con `render`. */
export function textoRico(texto: string, mio: boolean, render: (t: string) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  let ultimo = 0;
  let k = 0;
  RICO.lastIndex = 0;
  for (let m = RICO.exec(texto); m; m = RICO.exec(texto)) {
    if (m.index > ultimo) out.push(<Fragment key={k++}>{render(texto.slice(ultimo, m.index))}</Fragment>);
    const [txt, link, triple, simple, auto] = m;
    if (link) {
      out.push(
        <a
          key={k++}
          href={hrefSeguro(link.startsWith("www.") ? `https://${link}` : link)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn("underline underline-offset-2 [overflow-wrap:anywhere]", mio ? "text-white" : "text-primary")}
        >
          {link}
        </a>
      );
    } else out.push(<CodigoSuelto key={k++} codigo={(triple ?? simple ?? auto).trim()} mio={mio} />);
    ultimo = m.index + txt.length;
  }
  if (ultimo < texto.length) out.push(<Fragment key={k++}>{render(texto.slice(ultimo))}</Fragment>);
  return out;
}

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

/** Líneas que se ven de un error plegado (las primeras, que son las que dicen qué pasó). */
const LINEAS_PLEGADO = 3;

function BloqueCodigo({ codigo, lenguaje, error = false }: { codigo: string; lenguaje: string; error?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const lineas = codigo.split("\n");
  const plegable = error && lineas.length > LINEAS_PLEGADO;
  const [abierto, setAbierto] = useState(false);
  const visible = plegable && !abierto ? lineas.slice(0, LINEAS_PLEGADO).join("\n") : codigo;
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
    <div className={cn("my-1 overflow-hidden rounded-lg border bg-zinc-900 text-left text-zinc-100 shadow-sm", error ? "border-red-500/40" : "border-white/10")}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-zinc-800/80 px-2.5 py-1 text-[10px] text-zinc-400">
        <span className={cn("font-mono uppercase tracking-wide", error && "text-red-300")}>{error ? `⚠ error · ${lineas.length} líneas` : lenguaje || "código"}</span>
        <button type="button" onClick={() => void copiar()} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-zinc-100">
          {copiado ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[12px] leading-relaxed">
        <code>{error ? <span className="text-red-200">{visible}</span> : colorear(visible)}</code>
      </pre>
      {plegable && (
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="w-full border-t border-white/10 bg-zinc-800/60 px-3 py-1 text-left text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          {abierto ? "Ver menos" : `Ver todo (${lineas.length - LINEAS_PLEGADO} líneas más)`}
        </button>
      )}
    </div>
  );
}

/**
 * Texto con código: los bloques ```…``` se muestran como código y el resto como siempre (lo que no es
 * código, ej. las menciones, va con `render`). `mio`: el globo propio (fondo violeta) para el código suelto.
 */
export function TextoConCodigo({ texto, mio, render }: { texto: string; mio: boolean; render: (t: string) => ReactNode }) {
  // Bloque = ``` con varias líneas (```así``` en una línea es código suelto).
  const partes = texto.split(/(```[^\n`]*\n[\s\S]*?```)/g);
  return (
    <div className="min-w-0 space-y-1">
      {partes.map((p, i) => {
        const bloque = p.match(/^```([^\n`]*)\n([\s\S]*?)```$/);
        if (bloque) {
          const codigo = bloque[2].replace(/\n$/, "");
          return <BloqueCodigo key={i} lenguaje={bloque[1].trim()} codigo={codigo} error={esError(codigo)} />;
        }
        if (!p.trim()) return null;
        // Un error pegado sin ``` también va plegado.
        if (esError(p)) return <BloqueCodigo key={i} lenguaje="" codigo={p.trim()} error />;
        // Links y código suelto dentro del texto.
        return (
          <p key={i} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {textoRico(p.replace(/^\n+|\n+$/g, ""), mio, render)}
          </p>
        );
      })}
    </div>
  );
}
