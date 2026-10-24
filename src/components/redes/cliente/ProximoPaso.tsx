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
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRedes } from "@/contexts/redes-data-context";
import { cn } from "@/lib/utils";
import type { Paso, TipoPaso } from "@/lib/redes/proximoPaso";

const ICONOS: Record<TipoPaso, LucideIcon> = {
  aprobar: PlayCircle,
  material: Upload,
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
  const { videos } = useRedes();
  const [sinMiniatura, setSinMiniatura] = useState(false);
  if (!principal) return null;
  const Icon = ICONOS[principal.tipo];
  // Video para aprobar: se muestra el video (miniatura) y queda bien a la vista.
  const aprobar = principal.tipo === "aprobar";
  // Las ideas del mes también esperan una respuesta: mismo destaque que un video para aprobar.
  const destacar = aprobar || principal.tipo === "elegir_ideas";
  const videoAprobar = aprobar && principal.accion?.videoId ? videos.find((v) => v.id === principal.accion!.videoId) : undefined;
  const archivo = videoAprobar ? [...(videoAprobar.attachments_finalizado ?? [])].reverse().find((a) => a.mime_type.startsWith("video/") || a.mime_type.startsWith("image/")) : undefined;
  const otrosParaAprobar = pasos.filter((x) => x.tipo === "aprobar").length - (aprobar ? 1 : 0);
  return (
    <div className="space-y-2">
      <section
        className={cn(
          "relative overflow-hidden rounded-2xl border p-5 animate-in fade-in slide-in-from-bottom-3 duration-500 motion-reduce:animate-none sm:p-6",
          principal.teToca
            ? destacar
              ? "border-2 border-primary bg-gradient-to-br from-primary/[0.22] via-primary/[0.08] to-transparent shadow-[0_0_48px_-12px_hsl(var(--primary)/0.8)]"
              : "border-primary/40 bg-gradient-to-br from-primary/[0.16] via-primary/[0.06] to-transparent"
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
          {aprobar ? "Para aprobar" : principal.tipo === "elegir_ideas" ? "Esperamos tu respuesta" : principal.teToca ? "Te toca" : "Todo en marcha"}
        </p>
        {/* En la tablet el botón va abajo, a lo ancho: el título no se aprieta en una columna angosta. */}
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center">
          {archivo ? (
            // La miniatura del video: se toca y se abre para verlo y aprobarlo.
            <button
              type="button"
              onClick={() => principal.accion && ir(principal.accion)}
              className="relative mx-auto aspect-[9/16] w-32 shrink-0 overflow-hidden rounded-2xl bg-black shadow-xl ring-2 ring-primary/60 lg:mx-0 lg:w-24"
              aria-label="Ver el video"
            >
              {!sinMiniatura ? (
                <img
                  src={`https://drive.google.com/thumbnail?id=${archivo.drive_file_id}&sz=w400`}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setSinMiniatura(true)}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <span className="absolute inset-0 bg-gradient-to-br from-primary/50 via-fuchsia-500/30 to-black" />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-black shadow-lg">
                  <Play className="ml-0.5 h-5 w-5 fill-current" />
                </span>
              </span>
            </button>
          ) : (
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
              principal.teToca && "animate-flotar motion-reduce:animate-none",
              principal.teToca ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className={cn("font-bold leading-snug", destacar ? "text-xl sm:text-2xl" : "text-lg sm:text-xl")}>{principal.titulo}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{principal.texto}</p>
            {!!principal.lista?.length && (
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {principal.lista.map((t, n) => (
                  <li key={n} className="flex min-w-0 items-center gap-2 rounded-xl bg-background/60 px-3 py-2 text-sm font-medium ring-1 ring-border">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">{n + 1}</span>
                    <span className="truncate">{t}</span>
                  </li>
                ))}
              </ul>
            )}
            {!!principal.comoHacerlo?.length && (
              <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs font-medium">
                {principal.comoHacerlo.map((p, n) => (
                  <li key={n} className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{n + 1}</span>
                    {p}
                    {n < principal.comoHacerlo!.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                  </li>
                ))}
              </ol>
            )}
            {otrosParaAprobar > 0 && (
              <p className="mt-1.5 text-xs font-semibold text-primary">
                Y {otrosParaAprobar === 1 ? "otro más" : `${otrosParaAprobar} más`} esperando tu aprobación
              </p>
            )}
          </div>
          {principal.accion && (
            <Button
              size="lg"
              className="group w-full shrink-0 shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.7)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_36px_-8px_hsl(var(--primary)/0.9)] lg:w-auto"
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
