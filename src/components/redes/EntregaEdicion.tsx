import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { diaSemana, hoyAR, sumarDias } from "@/lib/fecha";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { CLASE_TONO, entregaPorDefecto, estadoEntrega, fechaEntregaCorta, opcionesEntrega } from "@/lib/redes/entrega";
import type { Video } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

/** Lunes de la semana de esa fecha. */
const lunesDe = (f: string) => sumarDias(f, -((diaSemana(f) + 6) % 7));

/**
 * Carga de la editora para esa fecha: cuántas entregas ya tiene esa semana (y ese día) contra las que entrega por
 * semana de verdad (promedio de las últimas 4). Para no cargarle más de lo que puede hacer.
 */
function useCargaEditora(video: { id?: string; editor_id?: string | null } | null, fecha: string) {
  const { videos } = useRedes();
  const { profiles } = useAppData();
  const editor = video?.editor_id ?? null;
  if (!editor || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const lunes = lunesDe(fecha);
  const domingo = sumarDias(lunes, 6);
  const suyos = videos.filter((v) => v.editor_id === editor && v.id !== video?.id && v.etapa === "edicion" && v.entrega_edicion);
  const semana = suyos.filter((v) => v.entrega_edicion! >= lunes && v.entrega_edicion! <= domingo).length;
  const dia = suyos.filter((v) => v.entrega_edicion === fecha).length;
  // Ritmo real: ediciones entregadas por ella en las últimas 4 semanas.
  const desde = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const entregadas = videos.reduce(
    (n, v) => n + (v.historial ?? []).filter((h) => h.by === editor && h.at >= desde && h.accion.startsWith("Edición entregada")).length,
    0
  );
  const ritmo = Math.round(entregadas / 4);
  const nombre = (profiles.find((p) => p.id === editor)?.nombre ?? "La editora").split(" ")[0];
  const pasada = ritmo > 0 && semana + 1 > ritmo;
  return { nombre, semana, dia, ritmo, pasada, diaCargado: dia >= 2 };
}

/**
 * "¿Para cuándo lo necesitás editado?": se abre al mandar a edición (o para cambiar la fecha). Viene
 * con la fecha sugerida elegida, así con un toque se manda.
 */
export function EntregaEdicionDialog({
  video,
  open,
  onOpenChange,
  onConfirmar,
  cambiar = false,
}: {
  video: (Pick<Video, "titulo" | "fecha_deseada" | "entrega_edicion"> & Partial<Pick<Video, "id" | "editor_id">>) | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirmar: (fecha: string) => Promise<void>;
  /** Solo cambiar la fecha (ya está en edición). */
  cambiar?: boolean;
}) {
  const hoy = hoyAR();
  const [fecha, setFecha] = useState("");
  const [busy, setBusy] = useState(false);
  const carga = useCargaEditora(video, fecha);
  useEffect(() => {
    if (open && video) setFecha(cambiar && video.entrega_edicion ? video.entrega_edicion : entregaPorDefecto(video, hoy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!video) return null;
  const opciones = opcionesEntrega(hoy);
  const sugerida = entregaPorDefecto(video, hoy);
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) && fecha >= hoy;
  const confirmar = async () => {
    if (!valida) return;
    setBusy(true);
    try {
      await onConfirmar(fecha);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>¿Para cuándo lo necesitás editado?</DialogTitle>
          <DialogDescription>
            {video.titulo}. La editora lo ve en la tarjeta y le avisamos el día antes.
            {video.fecha_deseada ? ` El cliente lo quiere publicado el ${fechaEntregaCorta(video.fecha_deseada)}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {opciones.map((o) => (
            <button
              key={o.fecha}
              type="button"
              onClick={() => setFecha(o.fecha)}
              className={cn(
                "rounded-xl border-2 px-2 py-2.5 text-center transition-colors",
                fecha === o.fecha ? "border-primary bg-primary/[0.07]" : "border-border hover:border-primary/40"
              )}
            >
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="block text-[11px] text-muted-foreground">{fechaEntregaCorta(o.fecha)}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 rounded-xl border p-3">
          <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm">Otra fecha</span>
          <Input type="date" min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-9 w-40" />
        </label>
        {carga && (carga.pasada || carga.diaCargado) && (
          <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p>
              {carga.pasada ? (
                <>
                  <b>{carga.nombre}</b> ya tiene {carga.semana} {carga.semana === 1 ? "entrega" : "entregas"} esa semana y entrega unas {carga.ritmo} por
                  semana.
                </>
              ) : (
                <>
                  <b>{carga.nombre}</b> ya tiene {carga.dia} entregas ese día.
                </>
              )}{" "}
              Mejor otro día, o hablalo con {carga.nombre}.
            </p>
          </div>
        )}
        {!cambiar && fecha === sugerida && (
          <p className="text-xs text-muted-foreground">
            Sugerida: {video.fecha_deseada ? "un día antes de la publicación que pidió el cliente" : "en 3 días hábiles"}.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={!valida || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : !cambiar && <Send className="mr-2 h-4 w-4" />}
            {cambiar ? "Guardar fecha" : `Enviar a edición · ${valida ? fechaEntregaCorta(fecha) : "elegí fecha"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Etiqueta "Entregar el jue 15/10" (naranja si es hoy o mañana, roja si se pasó). Solo en edición. */
export function EntregaChip({ video, className }: { video: Pick<Video, "etapa" | "entrega_edicion">; className?: string }) {
  if (video.etapa !== "edicion" || !video.entrega_edicion) return null;
  const e = estadoEntrega(video.entrega_edicion);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", CLASE_TONO[e.tono], className)}>
      <CalendarClock className="h-3 w-3" /> {e.texto}
    </span>
  );
}

