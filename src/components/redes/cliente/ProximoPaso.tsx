import { useNavigate, useSearchParams } from "react-router-dom";
import { Palette,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Film,
  ImageIcon,
  Lightbulb,
  PlayCircle,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Paso, TipoPaso } from "@/lib/redes/proximoPaso";

const ICONOS: Record<TipoPaso, LucideIcon> = {
  aprobar: PlayCircle,
  elegir_ideas: Sparkles,
  pagar_pieza: CreditCard,
  pieza_lista: ImageIcon,
  rodaje: CalendarDays,
  planificar: Lightbulb,
  en_produccion: Film,
  resultados: TrendingUp,
  todo_listo: CheckCircle2,
  marca: Palette,
};

function useIrA(onPedir?: () => void, onIdeas?: () => void) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  return (accion: NonNullable<Paso["accion"]>) => {
    if (accion.destino === "pedir") return onPedir?.();
    if (accion.destino === "ideas") return onIdeas?.();
    if (accion.destino === "chat") return navigate("/chat");
    const next = new URLSearchParams(params);
    if (accion.destino === "video" && accion.videoId) next.set("video", accion.videoId);
    else next.set("tab", accion.destino);
    setParams(next);
  };
}

/** El cartel de arriba de todo: qué está pasando y qué tiene que hacer el cliente ahora. */
export function ProximoPaso({ pasos, onPedir, onIdeas }: { pasos: Paso[]; onPedir?: () => void; onIdeas?: () => void }) {
  const ir = useIrA(onPedir, onIdeas);
  // Una sola cosa por vez: lo más importante. El resto aparece cuando le toque.
  const [principal] = pasos;
  if (!principal) return null;
  const Icon = ICONOS[principal.tipo];
  return (
    <div className="space-y-2">
      <section
        className={cn(
          "relative overflow-hidden rounded-2xl border p-5 animate-in fade-in slide-in-from-bottom-3 duration-500 motion-reduce:animate-none sm:p-6",
          principal.teToca
            ? "border-primary/40 bg-gradient-to-br from-primary/[0.16] via-primary/[0.06] to-transparent"
            : "bg-card"
        )}
      >
        {principal.teToca && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-2/3 animate-barrido bg-gradient-to-r from-transparent via-primary/[0.10] to-transparent motion-reduce:hidden"
          />
        )}
        <p
          className={cn(
            "relative mb-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
            principal.teToca ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          {principal.teToca && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary-foreground" />
            </span>
          )}
          {principal.teToca ? "Te toca" : "Todo en marcha"}
        </p>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
              principal.teToca && "animate-flotar motion-reduce:animate-none",
              principal.teToca ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-snug sm:text-xl">{principal.titulo}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{principal.texto}</p>
          </div>
          {principal.accion && (
            <Button
              size="lg"
              className="group w-full shrink-0 shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.7)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_36px_-8px_hsl(var(--primary)/0.9)] sm:w-auto"
              onClick={() => ir(principal.accion!)}
            >
              {principal.accion.label}
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          )}
        </div>
      </section>

    </div>
  );
}
