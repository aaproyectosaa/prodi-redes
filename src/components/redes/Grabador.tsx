import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MonitorUp, Square, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import { useDriveConnection } from "@/hooks/use-drive-connection";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { aInputAR } from "@/lib/fecha";
import { enModoVista } from "@/lib/redes/vistaComo";
import { pickMediaFiles } from "@/utils/pickMediaFiles";
import type { Reunion } from "@/lib/redes/types";

function elegirMime(): string {
  const opciones = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];
  for (const m of opciones) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Graba el audio de la reunión en el navegador (gratis, sin apps extra):
 * - "Videollamada": comparte la pestaña de la llamada con su audio + tu micrófono.
 * - "Presencial": solo el micrófono.
 * La grabación se sube a Drive y después la IA arma la minuta.
 */
export function Grabador({ reunion, clienteNombre }: { reunion: Reunion; clienteNombre: string }) {
  const { user } = useUserProfileContext();
  const { connection } = useDriveConnection();
  const [estado, setEstado] = useState<"listo" | "grabando" | "subiendo">("listo");
  const [segundos, setSegundos] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const ctx = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number>();

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

  useEffect(() => () => detenerTodo(), []);

  function detenerTodo() {
    window.clearInterval(timer.current);
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
  }

  async function iniciar(modo: "llamada" | "presencial") {
    if (enModoVista()) {
      toast.error("Estás en modo 'ver como': es solo lectura.");
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streams.current.push(mic);
      let stream: MediaStream = mic;
      if (modo === "llamada") {
        const pantalla = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        streams.current.push(pantalla);
        if (pantalla.getAudioTracks().length === 0) {
          toast.message("No se compartió el audio de la pestaña: se graba solo tu micrófono. Elegí la pestaña de la llamada y tildá «Compartir audio».");
        }
        const ac = new AudioContext();
        ctx.current = ac;
        const destino = ac.createMediaStreamDestination();
        ac.createMediaStreamSource(mic).connect(destino);
        if (pantalla.getAudioTracks().length) {
          ac.createMediaStreamSource(new MediaStream(pantalla.getAudioTracks())).connect(destino);
        }
        // Si cortan el compartir pantalla, se termina la grabación.
        pantalla.getVideoTracks()[0]?.addEventListener("ended", () => detener());
        stream = destino.stream;
      }
      const mime = elegirMime();
      const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24_000 });
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => void subir(new Blob(chunks.current, { type: r.mimeType || "audio/webm" }));
      r.start(5000);
      rec.current = r;
      setSegundos(0);
      timer.current = window.setInterval(() => setSegundos((s) => s + 1), 1000);
      setEstado("grabando");
    } catch (err) {
      detenerTodo();
      toast.error(
        err instanceof Error && /denied|permission|NotAllowed/i.test(err.message + err.name)
          ? "No diste permiso para el micrófono o la pantalla."
          : "Este navegador no permite grabar acá. Probá desde Chrome en la compu, o subí el audio."
      );
    }
  }

  function detener() {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    detenerTodo();
  }

  async function subir(blob: Blob) {
    setEstado("subiendo");
    const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
    const file = new File([blob], `reunion-${aInputAR().replace(/[:T]/g, "-")}.${ext}`, {
      type: blob.type || "audio/webm",
    });
    try {
      await upload([file]);
      toast.success("Grabación guardada. Ya podés generar la minuta.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir la grabación");
    } finally {
      setEstado("listo");
    }
  }

  if (estado === "grabando") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/[0.06] p-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
        </span>
        <span className="font-mono text-sm tabular-nums">{fmt(segundos)}</span>
        <span className="flex-1 text-xs text-muted-foreground">Grabando… dejá esta pestaña abierta.</span>
        <Button size="sm" variant="destructive" onClick={detener}>
          <Square className="mr-1.5 h-3.5 w-3.5" /> Terminar
        </Button>
      </div>
    );
  }

  if (estado === "subiendo") {
    return (
      <div className="flex items-center gap-2 rounded-xl border p-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Guardando la grabación en Drive…
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => iniciar("llamada")} className="hidden md:inline-flex">
        <MonitorUp className="mr-1.5 h-4 w-4" /> Grabar videollamada
      </Button>
      <Button size="sm" variant="secondary" onClick={() => iniciar("presencial")}>
        <Mic className="mr-1.5 h-4 w-4" /> Grabar reunión presencial
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          pickMediaFiles((files) => {
            if (enModoVista()) return toast.error("Estás en modo 'ver como': es solo lectura.");
            if (files.length) void upload(files);
          })
        }
      >
        <Upload className="mr-1.5 h-4 w-4" /> Subir audio
      </Button>
    </div>
  );
}
