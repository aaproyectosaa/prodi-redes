import { useState } from "react";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  // Calendario propio (no el campo de fecha del navegador, que en el celular se trababa y ponía hoy solo).
  const [eligiendo, setEligiendo] = useState(false);
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
        <button
          type="button"
          onClick={() => setEligiendo(true)}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          title="Para cuándo se publica (define el mes del plan)"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {video.fecha_deseada ? `Publicar ${fechaCorta(video.fecha_deseada)}` : "Fecha de publicación"}
        </button>
        <Dialog open={eligiendo} onOpenChange={setEligiendo}>
          <DialogContent className="w-[calc(100vw-1.5rem)] max-w-sm rounded-3xl p-4">
            <DialogHeader>
              <DialogTitle>¿Cuándo se publica?</DialogTitle>
              <DialogDescription>Tocá el día. Si es de otro mes, el video pasa al plan de ese mes.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              <Calendar
                mode="single"
                locale={es}
                weekStartsOn={1}
                selected={video.fecha_deseada ? new Date(`${video.fecha_deseada}T12:00:00`) : undefined}
                defaultMonth={video.fecha_deseada ? new Date(`${video.fecha_deseada}T12:00:00`) : undefined}
                fromDate={new Date(`${hoyISO()}T12:00:00`)}
                onSelect={(dia) => {
                  if (!dia) return;
                  const iso = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}`;
                  setEligiendo(false);
                  if (iso !== video.fecha_deseada) void cambiarFecha(iso);
                }}
              />
            </div>
            {video.fecha_deseada && (
              <button
                type="button"
                onClick={() => {
                  setEligiendo(false);
                  void cambiarFecha("");
                }}
                className="w-full rounded-xl py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                Sacar la fecha
              </button>
            )}
          </DialogContent>
        </Dialog>
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
