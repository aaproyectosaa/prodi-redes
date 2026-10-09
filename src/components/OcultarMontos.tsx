import { Eye, EyeOff } from "lucide-react";
import { useMontosOcultos } from "@/lib/privacidad";
import { cn } from "@/lib/utils";

/** El ojito: oculta o muestra los montos y los gráficos (administración). */
export function BotonOcultarMontos({ className, conTexto = true }: { className?: string; conTexto?: boolean }) {
  const [oculto, setOculto] = useMontosOcultos();
  const Icono = oculto ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={() => setOculto(!oculto)}
      className={cn("flex items-center gap-2.5 rounded-lg text-sm transition-colors hover:bg-accent hover:text-accent-foreground", className)}
      title={oculto ? "Mostrar montos" : "Ocultar montos"}
      aria-label={oculto ? "Mostrar montos" : "Ocultar montos"}
      aria-pressed={oculto}
    >
      <Icono className="h-4 w-4" />
      {conTexto && <span>{oculto ? "Mostrar montos" : "Ocultar montos"}</span>}
    </button>
  );
}
