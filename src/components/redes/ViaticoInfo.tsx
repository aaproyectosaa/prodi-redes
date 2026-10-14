import { useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { callApi } from "@/lib/redes/api";
import { formatARS } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/redes/types";

/** Dónde se filma un video pedido por el cliente y cómo están los viáticos. El cliente puede pagarlos si quedaron pendientes. */
export function ViaticoInfo({ video, esCliente }: { video: Video; esCliente: boolean }) {
  const v = video.viatico;
  const [pagando, setPagando] = useState(false);
  if (!v || v.estado === "sin_cargo") return null;
  const lugar = `${v.localidad}${v.km != null ? ` (${v.km} km)` : ""}`;
  const texto = {
    pagado: `Viáticos pagos${v.monto ? ` (${formatARS(v.monto)})` : ""}.`,
    cubierto: "El viaje ya está pago: se filma en la misma jornada que otro video.",
    pendiente: `Faltan pagar los viáticos: ${formatARS(Number(v.monto))}.`,
    cotizar: esCliente ? "Los viáticos te los pasamos por el chat." : "Viáticos a coordinar con el cliente (más lejos, cruzando el río o sin monto en Ajustes).",
  }[v.estado];
  const pagar = async () => {
    setPagando(true);
    try {
      const r = await callApi<{ init_point: string }>("/api/pagos/crear", { tipo: "viatico", video_id: video.id });
      window.location.href = r.init_point;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo abrir el pago");
      setPagando(false);
    }
  };
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-xs",
        v.estado === "pendiente" ? "border-orange-500/40 bg-orange-500/[0.07]" : "bg-muted/30"
      )}
    >
      <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        Se filma en <b>{lugar}</b>. {texto}
      </span>
      {esCliente && v.estado === "pendiente" && (
        <Button size="sm" className="h-8" onClick={() => void pagar()} disabled={pagando}>
          {pagando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Pagar viáticos
        </Button>
      )}
    </div>
  );
}
