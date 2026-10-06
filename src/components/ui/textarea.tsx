import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Crece con el texto (por defecto sí): así no queda un scroll adentro de otro en el celular. */
  autoAlto?: boolean;
}

function ajustar(el: HTMLTextAreaElement) {
  const max = parseFloat(getComputedStyle(el).maxHeight);
  el.style.height = "auto";
  const borde = el.offsetHeight - el.clientHeight;
  const alto = el.scrollHeight + borde;
  el.style.height = `${Number.isFinite(max) ? Math.min(alto, max) : alto}px`;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, autoAlto = true, onInput, ...props }, ref) => {
  const propio = React.useRef<HTMLTextAreaElement | null>(null);
  const setRef = React.useCallback(
    (el: HTMLTextAreaElement | null) => {
      propio.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref]
  );

  React.useLayoutEffect(() => {
    if (autoAlto && propio.current) ajustar(propio.current);
  }, [autoAlto, props.value]);

  React.useEffect(() => {
    const el = propio.current;
    if (!autoAlto || !el || typeof ResizeObserver === "undefined") return;
    // Si cambia el ancho (girar el celular, abrir un panel) el texto ocupa otras líneas.
    let ancho = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== ancho) {
        ancho = el.clientWidth;
        ajustar(el);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [autoAlto]);

  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={setRef}
      onInput={(e) => {
        if (autoAlto) ajustar(e.currentTarget);
        onInput?.(e);
      }}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
