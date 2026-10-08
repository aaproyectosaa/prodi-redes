import { useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { pickMediaFiles } from "@/utils/pickMediaFiles";
import { enModoVista } from "@/lib/redes/vistaComo";
import {
  avisarMaterialListo,
  cancelarSubidaMaterial,
  MATERIAL_MAX_GB,
  pesoTexto,
  reintentarSubidaMaterial,
  subirMaterial,
  useSubidasMaterial,
} from "@/lib/redes/materialCliente";
import { cn } from "@/lib/utils";
import { useRedes } from "@/contexts/redes-data-context";
import { soloPauta } from "@/lib/redes/etapas";
import type { Video } from "@/lib/redes/types";

/**
 * El cliente sube lo que filmó (o material extra) para un video. Va directo a la carpeta de Drive
 * del equipo, sin que el cliente tenga acceso a Drive. Con "Listo, ya subí todo" pasa a edición.
 */
export function SubirMaterial({ video }: { video: Video }) {
  const { user } = useUserProfileContext();
  const subidas = useSubidasMaterial(video.id);
  const [arrastrando, setArrastrando] = useState(false);
  const [avisando, setAvisando] = useState(false);
  const espera = video.etapa === "material_cliente";
  const { clienteById } = useRedes();
  // Solo pauta: lo que sube es el video terminado (no se edita, se publica y se pauta).
  const pauta = soloPauta(clienteById(video.proyecto_id));
  const mios = (video.attachments_crudo ?? []).filter((a) => a.origen === "cliente" || a.uploaded_by === user?.uid);
  const desde = video.material_cliente_avisado_at ?? "";
  const sinAvisar = mios.filter((a) => (a.uploaded_at ?? "") > desde).length;
  const subiendo = subidas.some((s) => s.estado === "subiendo" || s.estado === "esperando");

  const elegir = (files: File[]) => {
    if (enModoVista()) {
      toast.error("Estás en modo 'ver como': es solo lectura.");
      return;
    }
    if (files.length) subirMaterial(video.id, files);
  };

  const listo = async () => {
    setAvisando(true);
    try {
      await avisarMaterialListo(video.id);
      toast.success(espera ? (pauta ? "¡Gracias! Ya lo preparamos para publicar y pautar." : "¡Gracias! Ya lo empezamos a editar.") : "Listo, le avisamos al equipo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo avisar");
    } finally {
      setAvisando(false);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        elegir(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        "space-y-3 rounded-xl border p-3.5 transition-colors",
        espera ? "border-primary/40 bg-primary/[0.06]" : "bg-muted/20",
        arrastrando && "border-primary bg-primary/10"
      )}
    >
      <div>
        <p className="text-sm font-semibold">{espera ? "Subí lo que filmaste" : "¿Tenés material para este video?"}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {espera
            ? pauta
              ? "Subí el video terminado (o arrastralo acá). Cuando esté, tocá “Listo, ya subí todo” y lo publicamos y pautamos."
              : "Elegí los videos y fotos del celular (o arrastralos acá). Cuando esté todo, tocá “Listo, ya subí todo” y lo empezamos a editar."
            : "Si filmaste algo que quieras sumar, subilo acá y avisanos. Lo usamos en la edición."}
        </p>
      </div>

      {mios.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Ya subiste {mios.length} archivo{mios.length === 1 ? "" : "s"}
        </p>
      )}

      {subidas.length > 0 && (
        <ul className="space-y-2">
          {subidas.map((s) => (
            <li key={s.id} className="rounded-lg border bg-card px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.nombre}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {s.estado === "listo"
                    ? "Subido"
                    : s.estado === "esperando"
                      ? "En espera"
                      : s.estado === "error"
                        ? "Error"
                        : `${s.progreso}% de ${pesoTexto(s.size)}`}
                </span>
                {s.estado === "error" && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => reintentarSubidaMaterial(s.id)} aria-label="Reintentar">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
                {s.estado !== "listo" && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cancelarSubidaMaterial(s.id)} aria-label="Cancelar">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {s.estado === "error" ? (
                <p className="mt-1 text-[11px] text-destructive">{s.error}</p>
              ) : (
                <Progress value={s.progreso} className="mt-1.5 h-1.5" />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant={espera && mios.length ? "outline" : "default"} className="sm:flex-1" onClick={() => pickMediaFiles(elegir)}>
          <Upload className="mr-2 h-4 w-4" /> {mios.length ? "Subir más" : "Subir material"}
        </Button>
        {(espera || sinAvisar > 0) && (
          <Button
            className="sm:flex-1"
            variant={espera && mios.length ? "default" : "outline"}
            disabled={!mios.length || subiendo || avisando}
            title={subiendo ? "Esperá a que terminen de subir" : !mios.length ? "Primero subí al menos un archivo" : undefined}
            onClick={listo}
          >
            {avisando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {espera ? "Listo, ya subí todo" : "Avisar al equipo"}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Hasta {MATERIAL_MAX_GB} GB por archivo. Mientras sube, no cierres esta pestaña.
      </p>
    </div>
  );
}
