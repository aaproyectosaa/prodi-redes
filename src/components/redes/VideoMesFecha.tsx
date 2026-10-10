import { useRef } from "react";
import { CalendarDays, X } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { actualizarVideo } from "@/lib/redes/videos";
import { fechaCorta, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { usoPlan } from "@/lib/redes/planes";
import type { Video } from "@/lib/redes/types";

/**
 * De qué mes del plan es el video y para cuándo se publica. Así lo que se planifica para el mes que viene
 * descuenta del plan de ese mes (y no se pasa el de este). Lo cambian producción y el admin; ya publicado, solo el mes
 * (por si quedó contado en otro mes) y no la fecha.
 */
export function VideoMesFecha({ video, editable, uid }: { video: Video; editable: boolean; uid: string }) {
  const { clienteById, planes, videos } = useRedes();
  const fechaRef = useRef<HTMLInputElement>(null);
  const cliente = clienteById(video.proyecto_id);
  if (!editable) return <span className="text-xs text-muted-foreground">{mesLabel(video.mes)}</span>;
  const publicado = video.etapa === "publicado";

  const meses = Array.from(new Set([sumarMeses(mesActual(), -1), mesActual(), sumarMeses(mesActual(), 1), sumarMeses(mesActual(), 2), sumarMeses(mesActual(), 3), video.mes])).sort();
  const cupo = (m: string) => {
    const u = usoPlan(cliente, planes, videos, m);
    return u.cupo ? ` · ${u.usados}/${u.cupo}` : "";
  };

  const cambiarMes = async (mes: string) => {
    if (mes === video.mes) return;
    try {
      // Si tenía una fecha de publicación de otro mes, se saca (no tendría sentido).
      const fueraDeMes = video.fecha_deseada && video.fecha_deseada.slice(0, 7) !== mes;
      await actualizarVideo(video.id, { mes, ...(fueraDeMes ? { fecha_deseada: null } : {}) }, uid, `Pasado al plan de ${mesLabel(mes)}`);
      toast.success(`Ahora cuenta para el plan de ${mesLabel(mes)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar");
    }
  };

  const cambiarFecha = async (fecha: string) => {
    try {
      // La fecha manda: si es de otro mes, el video pasa al plan de ese mes.
      const mes = fecha ? fecha.slice(0, 7) : video.mes;
      await actualizarVideo(
        video.id,
        { fecha_deseada: fecha || null, ...(mes !== video.mes ? { mes } : {}) },
        uid,
        fecha ? `Para publicar el ${fechaCorta(fecha)}${mes !== video.mes ? ` (pasa al plan de ${mesLabel(mes)})` : ""}` : "Sin fecha de publicación"
      );
      if (mes !== video.mes) toast.success(`Fecha guardada · pasa al plan de ${mesLabel(mes)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la fecha");
    }
  };

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Select value={video.mes} onValueChange={(m) => void cambiarMes(m)}>
        <SelectTrigger className="h-7 w-auto gap-1 rounded-full border-dashed px-2.5 text-xs" title="De qué mes del plan es este video">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {meses.map((m) => (
            <SelectItem key={m} value={m} className="text-xs">
              Plan de {mesLabel(m)}
              {cupo(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!publicado && (
      <span className="inline-flex items-center">
        {/* El "botón" es solo el dibujo: encima va el campo de fecha real, transparente y del mismo tamaño. Así el toque
            cae en el campo y el iPhone muestra su calendario (Safari no abre un campo escondido). */}
        <span className="group relative inline-flex">
          <span
            aria-hidden
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground transition-colors group-hover:border-primary/50 group-hover:text-foreground"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {video.fecha_deseada ? `Publicar ${fechaCorta(video.fecha_deseada)}` : "Fecha de publicación"}
          </span>
          <input
            ref={fechaRef}
            type="date"
            min={hoyISO()}
            value={video.fecha_deseada ?? ""}
            onChange={(e) => void cambiarFecha(e.target.value)}
            // En la compu el calendario sale solo con el ícono del campo: así se abre tocando en cualquier parte.
            onClick={(e) => {
              try {
                e.currentTarget.showPicker();
              } catch {
                /* el navegador lo abre solo */
              }
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            title="Para cuándo se publica (define el mes del plan)"
            aria-label="Fecha de publicación"
          />
        </span>
        {video.fecha_deseada && (
          <button type="button" onClick={() => void cambiarFecha("")} className="ml-0.5 rounded-full p-1 text-muted-foreground hover:text-destructive" aria-label="Sacar la fecha">
            <X className="h-3 w-3" />
          </button>
        )}
      </span>
      )}
    </span>
  );
}
