import { ArrowRight, CheckCircle2, Clock, PlayCircle, Plus } from "lucide-react";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { driveThumb } from "@/components/redes/PiezaDialogs";
import { useRedes } from "@/contexts/redes-data-context";
import { fechaCorta } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/redes/types";

/** Los videos del mes en 3 columnas simples: lo que te toca, lo que está en proceso y lo publicado. */
export function CaminoVideos({ videos, onPedir }: { videos: Video[]; onPedir?: () => void }) {
  const { rodajes } = useRedes();
  const open = useOpenVideo();

  const estado = (v: Video): string => {
    if (v.etapa === "planificado") return "Idea lista, falta agendar la filmación";
    if (v.etapa === "agendado") {
      const r = rodajes.find((x) => x.id === v.rodaje_id);
      return r ? `Lo filmamos el ${fechaCorta(r.fecha)}${r.hora ? ` a las ${r.hora}` : ""}` : "Por filmar";
    }
    if (v.etapa === "edicion" || v.etapa === "revision_interna") return "Lo estamos editando";
    if (v.etapa === "para_publicar") return "Aprobado, lo estamos subiendo";
    if (v.etapa === "publicado") return v.publicacion ? `Publicado el ${fechaCorta(v.publicacion.publicado_at)}` : "Publicado";
    return "";
  };

  const columnas = [
    { id: "vos", titulo: "Te toca", icon: PlayCircle, items: videos.filter((v) => v.etapa === "revision_cliente"), vacio: "Nada pendiente 👌" },
    {
      id: "proceso",
      titulo: "En proceso",
      icon: Clock,
      items: videos.filter((v) => !["revision_cliente", "publicado"].includes(v.etapa)),
      vacio: "Nada en proceso",
    },
    { id: "listos", titulo: "Publicados", icon: CheckCircle2, items: videos.filter((v) => v.etapa === "publicado"), vacio: "Todavía ninguno" },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {columnas.map((c, ci) => {
        const activa = c.id === "vos" && c.items.length > 0;
        return (
          <div
            key={c.id}
            style={{ animationDelay: `${120 + ci * 90}ms` }}
            className={cn(
              "rounded-2xl border p-2 animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-500 motion-reduce:animate-none",
              activa ? "border-primary/40 bg-primary/[0.06]" : "bg-muted/20"
            )}
          >
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <p className={cn("flex items-center gap-1.5 text-sm font-semibold", activa && "text-primary")}>
                <c.icon className="h-4 w-4" /> {c.titulo}
                {activa && (
                  <span className="relative ml-0.5 flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                )}
              </p>
              <span className="text-xs tabular-nums text-muted-foreground">{c.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {c.items.map((v, i) => {
                const final = v.attachments_finalizado?.[0];
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => open(v.id)}
                    style={{ animationDelay: `${220 + ci * 90 + i * 60}ms` }}
                    className="group flex w-full items-center gap-3 rounded-xl border bg-card p-2.5 text-left transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 fill-mode-both hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_10px_28px_-14px_hsl(var(--primary)/0.6)] motion-reduce:animate-none"
                  >
                    {final && c.id !== "proceso" ? (
                      <img
                        src={driveThumb(final.drive_file_id, 200)}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 shrink-0 rounded-lg bg-black object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{v.titulo}</span>
                      <span className={cn("block truncate text-xs", activa ? "font-medium text-primary" : "text-muted-foreground")}>
                        {activa ? "Tocá para verlo y aprobarlo" : estado(v)}
                      </span>
                    </span>
                    {activa && <ArrowRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-1" />}
                  </button>
                );
              })}
              {c.items.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">{c.vacio}</p>}
              {c.id === "proceso" && onPedir && (
                <button
                  type="button"
                  onClick={onPedir}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed p-2.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <Plus className="h-3.5 w-3.5" /> Pedir otro video
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
