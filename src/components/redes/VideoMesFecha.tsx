import { CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { actualizarVideo } from "@/lib/redes/videos";
import { fechaCorta, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { usoPlan } from "@/lib/redes/planes";
import type { Video } from "@/lib/redes/types";

/**
 * De qué mes del plan es el video y para cuándo se publica. Así lo que se planifica para el mes que viene
 * descuenta del plan de ese mes (y no se pasa el de este). Lo cambian producción y el admin hasta que se publica.
 */
export function VideoMesFecha({ video, editable, uid }: { video: Video; editable: boolean; uid: string }) {
  const { clienteById, planes, videos } = useRedes();
  const cliente = clienteById(video.proyecto_id);
  if (!editable || video.etapa === "publicado") return <span className="text-xs text-muted-foreground">{mesLabel(video.mes)}</span>;

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
      <label
        className="relative inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
        title="Para cuándo se publica (define el mes del plan)"
      >
        <CalendarDays className="h-3.5 w-3.5" />
        {video.fecha_deseada ? `Publicar ${fechaCorta(video.fecha_deseada)}` : "Fecha de publicación"}
        <input
          type="date"
          min={hoyISO()}
          value={video.fecha_deseada ?? ""}
          onChange={(e) => void cambiarFecha(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Fecha de publicación"
        />
      </label>
    </span>
  );
}
