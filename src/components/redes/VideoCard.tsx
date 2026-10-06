import { AlertTriangle, ArrowRight, CalendarDays, Film, MessageSquareWarning, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { EtapaBadge } from "./EtapaBadge";
import { ClienteTag } from "./ClienteTag";
import { useRedes } from "@/contexts/redes-data-context";
import { diasEnEtapa, estaTrabado } from "@/lib/redes/etapas";
import { fechaCorta } from "@/lib/redes/format";
import type { Video } from "@/lib/redes/types";
import { driveThumb } from "./PiezaDialogs";

export function useOpenVideo() {
  const [params, setParams] = useSearchParams();
  return (id: string) => {
    const next = new URLSearchParams(params);
    next.set("video", id);
    setParams(next, { replace: false });
  };
}

export function VideoCard({
  video,
  showEtapa = true,
  showCliente = true,
  vista = "equipo",
  accion,
  className,
}: {
  /** Qué tiene que hacer quien mira (aparece como botón en la tarjeta). */
  accion?: string;
  video: Video;
  showEtapa?: boolean;
  showCliente?: boolean;
  vista?: "equipo" | "cliente";
  className?: string;
}) {
  const { clienteById, rodajes, settings } = useRedes();
  const open = useOpenVideo();
  const cliente = clienteById(video.proyecto_id);
  const rodaje = video.rodaje_id ? rodajes.find((r) => r.id === video.rodaje_id) : undefined;
  const dias = diasEnEtapa(video);
  const trabado = vista === "equipo" && estaTrabado(video, settings.dias_alerta);
  const final = video.attachments_finalizado?.[0];
  const mostrarThumb = vista === "cliente" && !!final && video.etapa !== "planificado";
  const conCambios =
    vista === "equipo" && video.etapa === "edicion" && (video.feedback_cliente || video.feedback_interno);

  return (
    <button
      type="button"
      onClick={() => open(video.id)}
      className={cn(
        "group w-full rounded-xl border bg-card p-3 text-left transition-all hover:-translate-y-px hover:border-primary/50 hover:shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.45)]",
        trabado && "border-warning/50",
        className
      )}
    >
      {mostrarThumb && (
        <div className="-mx-3 -mt-3 mb-3 aspect-[4/3] overflow-hidden rounded-t-xl bg-black">
          <img
            src={driveThumb(final!.drive_file_id, 600)}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
          />
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        {showCliente ? <ClienteTag cliente={cliente} /> : <span />}
        {showEtapa && <EtapaBadge etapa={video.etapa} vista={vista} />}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug">{video.titulo}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {rodaje && video.etapa === "agendado" && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {fechaCorta(rodaje.fecha)}
            {rodaje.hora ? ` ${rodaje.hora}` : ""}
          </span>
        )}
        {video.attachments_finalizado?.length > 0 && vista === "equipo" && (
          <span className="inline-flex items-center gap-1">
            <Film className="h-3 w-3" /> final
          </span>
        )}
        {video.rondas > 0 && vista === "equipo" && (
          <span className="inline-flex items-center gap-1">
            <RotateCcw className="h-3 w-3" /> {video.rondas} ronda{video.rondas === 1 ? "" : "s"}
          </span>
        )}
        {conCambios && (
          <span className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400">
            <MessageSquareWarning className="h-3 w-3" /> con cambios
          </span>
        )}
        {video.extra && <span className="text-primary">extra</span>}
        {video.pedido_cliente && vista === "equipo" && video.etapa === "planificado" && (
          <span className="rounded-full bg-primary/12 px-1.5 py-0.5 font-medium text-primary">pedido del cliente</span>
        )}
        {video.fecha_deseada && video.etapa !== "publicado" && (
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <CalendarDays className="h-3 w-3" /> para el {fechaCorta(video.fecha_deseada)}
          </span>
        )}
        {vista === "equipo" && video.etapa !== "publicado" && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1",
              trabado && "font-medium text-warning"
            )}
          >
            {trabado && <AlertTriangle className="h-3 w-3" />}
            {dias === 0 ? "hoy" : `${dias} d`}
          </span>
        )}
      </div>
      {accion && (
        <span className="mt-2.5 flex items-center justify-between rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          {accion}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}
