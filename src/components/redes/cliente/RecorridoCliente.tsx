import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Recorrido por la pantalla del cliente: se oscurece todo menos la parte de la que se habla (el menú, el botón
// de pedir un video, el chat…) y al lado aparece qué es. Si esa parte no se ve (otro tamaño de pantalla), el
// cartel sale al medio igual.

interface Paso {
  /** Dónde está: se usa el primero que se vea. */
  donde: string[];
  titulo: string;
  texto: string;
}

const PASOS: Paso[] = [
  {
    donde: ['[data-tour="/cliente"]'],
    titulo: "Tus videos",
    texto: "Acá están todos tus videos: en qué etapa va cada uno y los que esperan tu OK.",
  },
  {
    donde: ['[data-tour-btn="pedir-video"]'],
    titulo: "Pedir un video",
    texto: "¿Tenés una idea, una promo o un producto nuevo? Pedilo desde acá y lo armamos.",
  },
  {
    donde: ['[data-tour="/cliente?tab=resultados"]'],
    titulo: "Tus resultados",
    texto: "Cuánta gente vio tus videos y cuántos mensajes te llegaron, explicado simple.",
  },
  {
    donde: ['[aria-label^="Abrir la lista de chats"]', '[data-tour="chat"]'],
    titulo: "El chat con tu equipo",
    texto: "Escribinos cuando quieras. También está Prodi, nuestra IA, que te contesta al toque.",
  },
  {
    donde: ['[data-tour="/cliente?tab=negocio"]'],
    titulo: "Mi negocio",
    texto: "Tu logo, tus colores y los datos de tu marca. Con esto armamos tus videos y piezas.",
  },
  {
    donde: ['[aria-label="¿Cómo funciona?"]'],
    titulo: "Si te olvidás algo",
    texto: "Tocá acá y volvés a ver cómo funciona todo.",
  },
];

const MARGEN = 8;

function visible(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const st = getComputedStyle(el);
  if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return null;
  return r;
}

function buscar(paso: Paso): { el: Element; r: DOMRect } | null {
  for (const sel of paso.donde) {
    for (const el of document.querySelectorAll(sel)) {
      const r = visible(el);
      if (r) return { el, r };
    }
  }
  return null;
}

export function RecorridoCliente({ open, onCerrar }: { open: boolean; onCerrar: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);
  const paso = PASOS[i];
  const ultimo = i === PASOS.length - 1;

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  // Dónde está la parte de este paso (se vuelve a medir si cambia el tamaño o se mueve la pantalla).
  useLayoutEffect(() => {
    if (!open) return;
    const encontrado = buscar(paso);
    if (encontrado) {
      const { r } = encontrado;
      if (r.top < 0 || r.bottom > window.innerHeight) encontrado.el.scrollIntoView({ block: "center" });
    }
    const medir = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      setRect(buscar(paso)?.r ?? null);
    };
    medir();
    const t = window.setInterval(medir, 400);
    window.addEventListener("resize", medir);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", medir);
    };
  }, [open, paso]);

  useEffect(() => {
    if (!open) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, PASOS.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [open, onCerrar]);

  if (!open || !paso) return null;

  // El cartel: abajo de la parte si entra, si no arriba; sin salirse de los costados.
  const ancho = Math.min(340, vw - 32);
  let estiloCartel: React.CSSProperties;
  if (rect) {
    const abajo = rect.bottom + MARGEN + 14;
    const entraAbajo = abajo + 220 < vh;
    const izq = Math.min(Math.max(rect.left + rect.width / 2 - ancho / 2, 16), vw - ancho - 16);
    estiloCartel = entraAbajo ? { top: abajo, left: izq, width: ancho } : { bottom: vh - rect.top + MARGEN + 14, left: izq, width: ancho };
  } else {
    estiloCartel = { top: "50%", left: "50%", width: ancho, transform: "translate(-50%, -50%)" };
  }

  return createPortal(
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label="Recorrido por tu panel">
      {/* Todo oscuro menos la parte de la que se habla. */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-2xl ring-2 ring-primary transition-all duration-300 ease-out"
          style={{
            top: rect.top - MARGEN,
            left: rect.left - MARGEN,
            width: rect.width + MARGEN * 2,
            height: rect.height + MARGEN * 2,
            boxShadow: "0 0 0 9999px rgba(8, 6, 20, 0.72), 0 0 24px 4px hsl(var(--primary) / 0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(8,6,20,0.72)]" />
      )}
      {/* Tapa los toques mientras dura (para que no se toque nada sin querer). */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div key={i} className="absolute rounded-3xl border bg-card p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200" style={estiloCartel}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Paso {i + 1} de {PASOS.length}
        </p>
        <p className="mt-1 text-lg font-bold leading-tight">{paso.titulo}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{paso.texto}</p>
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {PASOS.map((_, j) => (
            <span key={j} className={cn("h-1.5 rounded-full transition-all", j === i ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30")} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {i > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setI(i - 1)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Atrás
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onCerrar} className="text-muted-foreground">
              Saltar
            </Button>
          )}
          <Button size="sm" className="ml-auto min-w-28 rounded-full" onClick={() => (ultimo ? onCerrar() : setI(i + 1))}>
            {ultimo ? (
              <>
                <PartyPopper className="mr-1.5 h-4 w-4" /> ¡Listo!
              </>
            ) : (
              <>
                Siguiente <ArrowRight className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
