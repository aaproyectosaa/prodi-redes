import { Mic, MonitorUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import { useDriveConnection } from "@/hooks/use-drive-connection";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { enModoVista } from "@/lib/redes/vistaComo";
import { pickMediaFiles } from "@/utils/pickMediaFiles";
import { fmtDuracion, segundosGrabados, useGrabacion } from "@/lib/redes/grabacion";
import { abrirVistaGrabacion, grabarReunion } from "@/lib/redes/grabarReunion";
import { Ondas } from "@/components/redes/GrabacionEnCurso";
import { cn } from "@/lib/utils";
import type { Reunion } from "@/lib/redes/types";

/**
 * Grabación de la reunión, gratis y en el navegador:
 * - Presencial: el micrófono del celular o la compu (sigue con la pantalla bloqueada en Android).
 * - Videollamada (compu): la pestaña de la llamada con su audio + tu micrófono.
 * - Subir un audio grabado con otra app.
 * Al terminar se sube a Drive y la IA arma la minuta sola.
 */
export function Grabador({ reunion, clienteNombre }: { reunion: Reunion; clienteNombre: string }) {
  const { user } = useUserProfileContext();
  const { connection } = useDriveConnection();
  const g = useGrabacion();
  const estaGrabando = g.fase !== "inactiva" && g.meta?.reunionId === reunion.id;
  const otraGrabando = g.fase !== "inactiva" && !estaGrabando;

  const { upload } = useDriveUpload({
    taskId: reunion.id,
    collectionName: "reuniones",
    slot: "crudo",
    connection,
    projectName: clienteNombre || "Interno",
    taskTipo: "Reuniones",
    taskFecha: reunion.fecha,
    uploaderUid: user?.uid ?? null,
    taskLabel: reunion.titulo,
  });

  if (estaGrabando) {
    return (
      <button
        type="button"
        onClick={abrirVistaGrabacion}
        className="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-primary to-fuchsia-600 p-3.5 text-left text-white shadow-lg shadow-primary/25"
      >
        <span className="relative flex h-3 w-3">
          {g.fase === "grabando" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />}
          <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
        </span>
        <span className="font-mono text-base font-bold tabular-nums">{fmtDuracion(segundosGrabados(g))}</span>
        <Ondas niveles={g.niveles.slice(-16)} className="h-6 flex-1" barra="bg-white/80" />
        <span className="text-xs font-semibold">{g.fase === "pausada" ? "En pausa" : "Grabando"} · abrir</span>
      </button>
    );
  }

  const Opcion = ({ icono: Icono, titulo, detalle, onClick, className }: { icono: typeof Mic; titulo: string; detalle: string; onClick: () => void; className?: string }) => (
    <button
      type="button"
      disabled={otraGrabando}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-50",
        className
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icono className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{detalle}</span>
      </span>
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Opcion icono={Mic} titulo="Grabar presencial" detalle="Con el micrófono del celu o la compu" onClick={() => void grabarReunion(reunion, clienteNombre, "presencial")} />
        <Opcion
          icono={MonitorUp}
          titulo="Grabar videollamada"
          detalle="La pestaña de la llamada + tu voz"
          className="hidden md:flex"
          onClick={() => void grabarReunion(reunion, clienteNombre, "llamada")}
        />
        <Opcion
          icono={Upload}
          titulo="Subir audio"
          detalle="Grabado con otra app"
          onClick={() =>
            pickMediaFiles((files) => {
              if (enModoVista()) return toast.error("Estás en modo 'ver como': es solo lectura.");
              if (files.length) void upload(files);
            })
          }
        />
      </div>
      {otraGrabando && <p className="text-[11px] text-muted-foreground">Hay otra reunión grabándose: terminala primero.</p>}
    </div>
  );
}
