import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Pause, Play, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AUDIO_MAX_SEG, duracionTexto, urlAudio } from "@/lib/redes/chat";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reproductor del mensaje de voz
// ---------------------------------------------------------------------------

/** Barras "de onda" fijas por audio (siempre las mismas para el mismo mensaje). */
function barras(id: string, n = 32): number[] {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = 0.35 + ((h >>> 8) % 1000) / 1600;
    return Math.min(1, base * (0.75 + 0.25 * Math.sin(i / 2.5)));
  });
}

export function AudioMensaje({
  chatId,
  audio,
  mio,
}: {
  chatId: string;
  audio: { id: string; mime: string; duracion: number };
  mio: boolean;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [cargando, setCargando] = useState(false);
  const [sonando, setSonando] = useState(false);
  const [t, setT] = useState(0);
  const forma = barras(audio.id);
  const progreso = audio.duracion ? Math.min(1, t / audio.duracion) : 0;

  useEffect(() => () => ref.current?.pause(), []);

  const toggle = async () => {
    if (sonando) {
      ref.current?.pause();
      return;
    }
    try {
      if (!ref.current) {
        setCargando(true);
        const url = await urlAudio(chatId, audio.id);
        const el = new Audio(url);
        el.ontimeupdate = () => setT(el.currentTime);
        el.onplay = () => setSonando(true);
        el.onpause = () => setSonando(false);
        el.onended = () => {
          setSonando(false);
          setT(0);
        };
        ref.current = el;
      }
      await ref.current.play();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reproducir");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex min-w-[210px] items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95",
          mio ? "bg-white text-primary" : "bg-primary text-primary-foreground"
        )}
        aria-label={sonando ? "Pausar" : "Escuchar"}
      >
        {cargando ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : sonando ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" />
        )}
      </button>
      <div className="flex-1">
        <div className="flex h-7 items-center gap-[2px]" aria-hidden>
          {forma.map((v, i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] rounded-full transition-colors",
                i / forma.length < progreso
                  ? mio
                    ? "bg-white"
                    : "bg-primary"
                  : mio
                    ? "bg-white/40"
                    : "bg-muted-foreground/35"
              )}
              style={{ height: `${Math.round(v * 100)}%` }}
            />
          ))}
        </div>
        <p className={cn("text-[10px] tabular-nums", mio ? "text-primary-foreground/80" : "text-muted-foreground")}>
          {duracionTexto(sonando || t > 0 ? t : audio.duracion)}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grabador (barra que reemplaza al cuadro de texto mientras se graba)
// ---------------------------------------------------------------------------

const TIPOS = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

export function useGrabadorVoz() {
  const [grabando, setGrabando] = useState(false);
  const [seg, setSeg] = useState(0);
  const [niveles, setNiveles] = useState<number[]>(Array(24).fill(0.1));
  const rec = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const inicio = useRef(0);
  const limpiar = useRef<() => void>(() => undefined);
  const resolver = useRef<((b: Blob | null) => void) | null>(null);
  /** Audio que se cortó solo al llegar a los 3 minutos (espera que lo manden o descarten). */
  const cortado = useRef<Blob | null>(null);

  const terminar = () => {
    limpiar.current();
    setGrabando(false);
  };

  const empezar = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Este navegador no permite grabar audio");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast.error("Permití el micrófono en el navegador para mandar audios");
      return;
    }
    const mimeType = TIPOS.find((t) => MediaRecorder.isTypeSupported?.(t));
    const r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24000 });
    partes.current = [];
    r.ondataavailable = (e) => {
      if (e.data.size) partes.current.push(e.data);
    };
    cortado.current = null;
    r.onstop = () => {
      const blob = partes.current.length ? new Blob(partes.current, { type: r.mimeType || mimeType || "audio/webm" }) : null;
      if (resolver.current) resolver.current(blob);
      else cortado.current = blob;
      resolver.current = null;
    };

    // Medidor de volumen para las barras que se mueven mientras habla.
    let raf = 0;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteFrequencyData(buf);
        const v = Array.from(buf.slice(0, 24), (x) => Math.max(0.1, x / 255));
        setNiveles(v);
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* sin medidor */
    }

    inicio.current = Date.now();
    const timer = window.setInterval(() => {
      const s = Math.min((Date.now() - inicio.current) / 1000, AUDIO_MAX_SEG);
      setSeg(s);
      if (s >= AUDIO_MAX_SEG && r.state === "recording") {
        r.stop();
        limpiar.current();
        toast.message("Llegaste a los 3 minutos: mandalo o descartalo");
      }
    }, 200);
    limpiar.current = () => {
      window.clearInterval(timer);
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => undefined);
      stream.getTracks().forEach((t) => t.stop());
    };
    r.start(250);
    rec.current = r;
    setSeg(0);
    setGrabando(true);
  };

  /** Termina y devuelve el audio (o null si se canceló). */
  const detener = (cancelar = false): Promise<{ blob: Blob; duracion: number } | null> =>
    new Promise((resolve) => {
      const r = rec.current;
      const duracion = (Date.now() - inicio.current) / 1000;
      if (!r || r.state === "inactive") {
        const blob = cortado.current;
        cortado.current = null;
        terminar();
        resolve(!cancelar && blob ? { blob, duracion: AUDIO_MAX_SEG } : null);
        return;
      }
      resolver.current = (blob) => {
        terminar();
        resolve(!cancelar && blob ? { blob, duracion: Math.min(duracion, AUDIO_MAX_SEG) } : null);
      };
      r.stop();
    });

  useEffect(() => () => limpiar.current(), []);

  return { grabando, seg, niveles, empezar, detener };
}

export function BarraGrabando({
  seg,
  niveles,
  enviando,
  onCancelar,
  onEnviar,
}: {
  seg: number;
  niveles: number[];
  enviando: boolean;
  onCancelar: () => void;
  onEnviar: () => void;
}) {
  return (
    <div className="flex flex-1 items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
      <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0 rounded-full text-destructive" onClick={onCancelar} aria-label="Descartar audio">
        <Trash2 className="h-5 w-5" />
      </Button>
      <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-2xl border bg-card px-3">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
        </span>
        <span className="w-10 shrink-0 text-sm tabular-nums">{duracionTexto(seg)}</span>
        <div className="flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden>
          {niveles.map((v, i) => (
            <span key={i} className="w-[3px] shrink-0 rounded-full bg-primary transition-[height] duration-75" style={{ height: `${Math.round(v * 100)}%` }} />
          ))}
        </div>
        {seg > AUDIO_MAX_SEG - 20 && <span className="shrink-0 text-[11px] text-warning">máx. 3:00</span>}
      </div>
      <Button size="icon" className="h-11 w-11 shrink-0 rounded-full" onClick={onEnviar} disabled={enviando} aria-label="Enviar audio">
        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function BotonMic({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="icon" className="h-11 w-11 shrink-0 rounded-full" onClick={onClick} disabled={disabled} aria-label="Grabar audio">
      <Mic className="h-5 w-5" />
    </Button>
  );
}
