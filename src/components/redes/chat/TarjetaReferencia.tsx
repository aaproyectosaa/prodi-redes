import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, CheckCircle2, Clapperboard, Image as ImageIcon, Loader2, MessageSquareWarning, PenLine } from "lucide-react";
import { toast } from "sonner";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useRedes } from "@/contexts/redes-data-context";
import { aprobarCliente, pedirCambiosCliente } from "@/lib/redes/videos";
import { aprobarPieza, pedirCambiosPieza } from "@/lib/redes/piezas";
import type { ReferenciaChat } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

/**
 * Tarjeta del video o la pieza de la que se habla (sale de "Hablarlo con el cliente" o del aviso "para aprobar"):
 * título, en qué está y la corrección entera. Tocándola se abre el video o la pieza.
 * Si es el cliente y está esperando su respuesta, aprueba o pide cambios ahí mismo, sin salir del chat.
 */
export function TarjetaReferencia({ r, mio, compacta }: { r: ReferenciaChat; mio?: boolean; compacta?: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { role, user } = useUserProfileContext();
  const { videos, piezas } = useRedes();
  const [cambios, setCambios] = useState(false);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState<null | "aprobar" | "cambios">(null);

  const video = r.tipo === "video" ? videos.find((v) => v.id === r.id) : undefined;
  const pieza = r.tipo === "pieza" ? piezas.find((p) => p.id === r.id) : undefined;
  const esperando = video ? video.etapa === "revision_cliente" : pieza ? pieza.estado === "para_aprobar" : false;
  const puedeResponder = role === "cliente" && esperando && !compacta;
  // Ya respondió (o lo resolvió el equipo): se dice en la tarjeta.
  const respondido = !esperando && r.detalle === "Para aprobar" && (video || pieza);

  const abrir = () => {
    if (r.tipo === "video") {
      const next = new URLSearchParams(params);
      next.set("video", r.id);
      setParams(next);
    } else navigate(role === "cliente" ? `/cliente?tab=piezas&pieza=${r.id}` : `/piezas?pieza=${r.id}`);
  };

  const aprobar = async () => {
    setBusy("aprobar");
    try {
      if (video) await aprobarCliente(video, undefined, user?.uid ?? "");
      else if (pieza) await aprobarPieza(pieza, undefined, user?.uid ?? "", pieza.version_enviada_id ?? undefined);
      toast.success(r.tipo === "video" ? "¡Aprobado! Lo preparamos para publicar." : "¡Aprobada! Ya la podés descargar.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo aprobar");
    } finally {
      setBusy(null);
    }
  };
  const pedirCambios = async () => {
    if (nota.trim().length < 3) {
      toast.error("Contanos qué cambiarías");
      return;
    }
    setBusy("cambios");
    try {
      if (video) await pedirCambiosCliente(video, undefined, user?.uid ?? "", nota);
      else if (pieza) await pedirCambiosPieza(pieza, undefined, user?.uid ?? "", nota, pieza.version_enviada_id ?? undefined);
      toast.success("Listo, le pasamos tus cambios al equipo.");
      setCambios(false);
      setNota("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo mandar");
    } finally {
      setBusy(null);
    }
  };

  const Icono = r.tipo === "video" ? Clapperboard : ImageIcon;
  const estadoTexto = respondido
    ? video
      ? video.etapa === "para_publicar" || video.etapa === "publicado"
        ? "Aprobado"
        : "Con cambios pedidos"
      : pieza && pieza.estado === "entregada"
        ? "Aprobada"
        : "Con cambios pedidos"
    : null;

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border text-left",
        mio ? "border-white/25 bg-white/10" : "bg-background/60",
        puedeResponder && !mio && "border-primary/50 ring-1 ring-primary/30",
        compacta ? "" : "mb-1.5"
      )}
    >
      <button
        type="button"
        onClick={abrir}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
          mio ? "hover:bg-white/10" : "hover:bg-background",
          !compacta && (r.correccion || puedeResponder) && "border-b",
          mio ? "border-white/20" : ""
        )}
      >
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", mio ? "bg-white/20" : "bg-primary/10 text-primary")}>
          <Icono className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{r.titulo}</span>
          <span className={cn("block truncate text-[11px]", mio ? "text-primary-foreground/75" : "text-muted-foreground")}>
            {[r.tipo === "video" ? "Video" : "Pieza gráfica", estadoTexto ?? r.detalle].filter(Boolean).join(" · ")}
          </span>
        </span>
        {estadoTexto === "Aprobado" || estadoTexto === "Aprobada" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
        {puedeResponder && <span className="shrink-0 text-[11px] font-semibold text-primary">Ver →</span>}
      </button>
      {!compacta && r.correccion && (
        <div className="px-3 py-2">
          <p className={cn("mb-0.5 flex items-center gap-1 text-[11px] font-semibold", mio ? "text-primary-foreground/90" : "text-orange-600 dark:text-orange-300")}>
            <MessageSquareWarning className="h-3 w-3" /> Cambios pedidos
          </p>
          <p className={cn("line-clamp-6 whitespace-pre-wrap text-xs", mio ? "text-primary-foreground/90" : "text-foreground/90")}>{r.correccion}</p>
        </div>
      )}
      {/* El cliente responde ahí mismo. */}
      {puedeResponder && (
        <div className="space-y-2 p-2.5">
          {cambios ? (
            <>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={3}
                autoFocus
                maxLength={1500}
                placeholder="¿Qué cambiarías? Ej.: que el texto diga 2x1 y que dure menos"
                className="w-full resize-none rounded-lg border bg-background px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCambios(false)}
                  disabled={!!busy}
                  className="flex-1 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={() => void pedirCambios()}
                  disabled={!!busy}
                  className="flex flex-1 items-center justify-center gap-1 rounded-full bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600"
                >
                  {busy === "cambios" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Mandar cambios
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void aprobar()}
                disabled={!!busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-emerald-500 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-500/25 transition-colors hover:bg-emerald-600"
              >
                {busy === "aprobar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Aprobar
              </button>
              <button
                type="button"
                onClick={() => setCambios(true)}
                disabled={!!busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted"
              >
                <PenLine className="h-4 w-4" /> Pedir cambios
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
