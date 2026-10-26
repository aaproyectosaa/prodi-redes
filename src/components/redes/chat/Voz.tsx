import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Loader2, Mic, Pause, Play, Send, Trash2 } from "lucide-react";
import { callApi } from "@/lib/redes/api";
import { enModoVista } from "@/lib/redes/vistaComo";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AUDIO_MAX_SEG, descargarAudio, duracionTexto, urlAudio } from "@/lib/redes/chat";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reproductor del mensaje de voz
// ---------------------------------------------------------------------------

/** Barras de reserva mientras no está la forma de onda real (siempre las mismas para el mismo mensaje). */
function barras(id: string, n = 36): number[] {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = 0.35 + ((h >>> 8) % 1000) / 1600;
    return Math.min(1, base * (0.75 + 0.25 * Math.sin(i / 2.5)));
  });
}

/** Forma de onda real: picos del audio en `n` tramos (se calcula una vez por audio y se guarda en memoria). */
const ondas = new Map<string, number[]>();
async function formaDeOnda(id: string, url: string, n = 36): Promise<number[]> {
  const ya = ondas.get(id);
  if (ya) return ya;
  const buf = await (await fetch(url)).arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const datos = audio.getChannelData(0);
    const paso = Math.max(1, Math.floor(datos.length / n));
    const picos = Array.from({ length: n }, (_, i) => {
      let max = 0;
      for (let j = i * paso; j < Math.min(datos.length, (i + 1) * paso); j += 16) max = Math.max(max, Math.abs(datos[j]));
      return max;
    });
    const tope = Math.max(...picos, 0.01);
    const forma = picos.map((p) => Math.max(0.12, Math.min(1, p / tope)));
    ondas.set(id, forma);
    return forma;
  } finally {
    void ctx.close();
  }
}

const VELOCIDADES = [1, 1.5, 2];

// Como en WhatsApp: suena un audio por vez (tocar otro corta el anterior), la velocidad elegida queda para
// todos, y al terminar uno arranca solo el siguiente audio de la charla (si está justo abajo, como los audios
// seguidos). En la pantalla bloqueada se ve qué suena y se puede pausar.
const CLAVE_VEL = "prodi-audio-vel";
let velGlobal = (() => {
  try {
    const v = Number(localStorage.getItem(CLAVE_VEL));
    return VELOCIDADES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
})();
interface Reproductor {
  /** El chat del audio: el siguiente solo puede ser del mismo chat. */
  chat: string;
  nodo: () => HTMLElement | null;
  reproducir: () => Promise<void>;
  pausar: () => void;
  ponerVelocidad: (v: number) => void;
}
const reproductores = new Set<Reproductor>();
let sonandoAhora: Reproductor | null = null;
/**
 * El siguiente audio de la MISMA conversación y que se ve (el que está más abajo). Nunca uno de otro chat: la app
 * deja montadas, ocultas, las conversaciones minimizadas (y antes seguía con los audios de esas).
 */
function siguienteDe(r: Reproductor): Reproductor | null {
  const yo = r.nodo();
  if (!yo) return null;
  const lista = yo.closest(".fondo-chat");
  const seVe = (n: HTMLElement) => n.isConnected && n.getClientRects().length > 0;
  if (!lista || !seVe(yo)) return null;
  let mejor: Reproductor | null = null;
  for (const o of reproductores) {
    const n = o.nodo();
    if (o === r || o.chat !== r.chat || !n || !seVe(n) || n.closest(".fondo-chat") !== lista) continue;
    if (!(yo.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const m = mejor?.nodo();
    if (!m || n.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) mejor = o;
  }
  return mejor;
}

export function AudioMensaje({
  chatId,
  mensajeId,
  audio,
  mio,
  transcripcion,
  escuchado,
  nombreDe,
  at,
}: {
  chatId: string;
  mensajeId?: string;
  /** Fecha del mensaje (para el nombre del archivo al bajarlo). */
  at?: string;
  audio: { id: string; mime: string; duracion: number };
  mio: boolean;
  transcripcion?: string | null;
  escuchado?: Record<string, string> | null;
  nombreDe?: (uid: string) => string;
}) {
  const [texto, setTexto] = useState<string | null>(transcripcion ?? null);
  const [verTexto, setVerTexto] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const avisado = useRef(false);
  useEffect(() => {
    if (transcripcion) setTexto(transcripcion);
  }, [transcripcion]);
  const quienes = Object.keys(escuchado ?? {});
  const transcribir = async () => {
    if (texto) return setVerTexto(!verTexto);
    if (!mensajeId) return;
    setVerTexto(true);
    setTranscribiendo(true);
    try {
      const r = await callApi<{ texto: string }>("/api/ia/audio-transcribir", { chat_id: chatId, mensaje_id: mensajeId });
      setTexto(r.texto);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo transcribir");
      setVerTexto(false);
    } finally {
      setTranscribiendo(false);
    }
  };
  const ref = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [sonando, setSonando] = useState(false);
  const [t, setT] = useState(0);
  const [vel, setVel] = useState(velGlobal);
  const caja = useRef<HTMLDivElement | null>(null);
  const yo = useRef<Reproductor | null>(null);
  const arrastrando = useRef(false);
  const [forma, setForma] = useState<number[]>(() => ondas.get(audio.id) ?? barras(audio.id));
  const progreso = audio.duracion ? Math.min(1, t / audio.duracion) : 0;

  useEffect(() => {
    const r: Reproductor = {
      chat: chatId,
      nodo: () => caja.current,
      reproducir: async () => {
        try {
          setCargando(true);
          const el = await preparar();
          el.currentTime = 0;
          await el.play();
        } catch {
          /* sin permiso de reproducir solo: queda para tocarlo */
        } finally {
          setCargando(false);
        }
      },
      pausar: () => ref.current?.pause(),
      ponerVelocidad: (v) => {
        setVel(v);
        if (ref.current) ref.current.playbackRate = v;
      },
    };
    yo.current = r;
    reproductores.add(r);
    return () => {
      reproductores.delete(r);
      if (sonandoAhora === r) sonandoAhora = null;
      ref.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preparar = async () => {
    if (ref.current) return ref.current;
    if (!url.current) url.current = await urlAudio(chatId, audio.id);
    const el = new Audio(url.current);
    el.playbackRate = vel;
    el.ontimeupdate = () => !arrastrando.current && setT(el.currentTime);
    el.onplay = () => {
      // Uno por vez: el que estaba sonando se pausa.
      if (sonandoAhora && sonandoAhora !== yo.current) sonandoAhora.pausar();
      sonandoAhora = yo.current;
      el.playbackRate = velGlobal;
      setSonando(true);
      // "Escuchado": se le avisa al que lo mandó (una vez, y no en "ver como").
      if (!mio && mensajeId && !avisado.current && !enModoVista()) {
        avisado.current = true;
        void callApi("/api/ia/audio-escuchado", { chat_id: chatId, mensaje_id: mensajeId }).catch(() => {});
      }
      // Pantalla bloqueada / auriculares: qué suena y pausar o seguir.
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({ title: "Mensaje de voz", artist: "Prodi Chat" });
          navigator.mediaSession.setActionHandler("pause", () => el.pause());
          navigator.mediaSession.setActionHandler("play", () => void el.play());
        } catch {
          /* navegador sin controles */
        }
      }
    };
    el.onpause = () => {
      setSonando(false);
      if (sonandoAhora === yo.current) sonandoAhora = null;
    };
    el.onended = () => {
      setSonando(false);
      setT(0);
      if (sonandoAhora === yo.current) sonandoAhora = null;
      // El siguiente audio de la charla arranca solo.
      const sig = yo.current ? siguienteDe(yo.current) : null;
      if (sig) void sig.reproducir();
    };
    ref.current = el;
    // La forma de onda real, sin trabar el play.
    void formaDeOnda(audio.id, url.current)
      .then(setForma)
      .catch(() => undefined);
    return el;
  };

  const toggle = async () => {
    if (sonando) {
      ref.current?.pause();
      return;
    }
    try {
      setCargando(true);
      const el = await preparar();
      await el.play();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reproducir");
    } finally {
      setCargando(false);
    }
  };

  // Tocar o arrastrar sobre la onda: salta a ese momento (y arranca si estaba parado).
  const posicion = (clientX: number, r: DOMRect) => Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  const saltarA = async (p: number, arrancar: boolean) => {
    try {
      const el = await preparar();
      el.currentTime = p * (audio.duracion || el.duration || 0);
      setT(el.currentTime);
      if (arrancar && el.paused) await el.play();
    } catch {
      /* nada */
    }
  };
  const alApretar = (e: React.PointerEvent<HTMLDivElement>) => {
    arrastrando.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setT(posicion(e.clientX, e.currentTarget.getBoundingClientRect()) * audio.duracion);
  };
  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastrando.current) return;
    setT(posicion(e.clientX, e.currentTarget.getBoundingClientRect()) * audio.duracion);
  };
  const alSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastrando.current) return;
    arrastrando.current = false;
    void saltarA(posicion(e.clientX, e.currentTarget.getBoundingClientRect()), true);
  };

  // La velocidad queda elegida para todos los audios (como en WhatsApp).
  const cambiarVelocidad = () => {
    const v = VELOCIDADES[(VELOCIDADES.indexOf(vel) + 1) % VELOCIDADES.length];
    velGlobal = v;
    try {
      localStorage.setItem(CLAVE_VEL, String(v));
    } catch {
      /* sin almacenamiento */
    }
    reproductores.forEach((r) => r.ponerVelocidad(v));
  };

  return (
    <div className="space-y-1">
    <div ref={caja} className="flex min-w-[230px] items-center gap-2.5 py-0.5">
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
      <div className="min-w-0 flex-1">
        <div
          className="relative flex h-7 cursor-pointer touch-none items-center gap-[2px]"
          onPointerDown={alApretar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={() => (arrastrando.current = false)}
          role="slider"
          aria-label="Posición del audio"
          aria-valuenow={Math.round(progreso * 100)}
        >
          {forma.map((v, i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] shrink-0 rounded-full transition-colors",
                i / forma.length < progreso ? (mio ? "bg-white" : "bg-primary") : mio ? "bg-white/40" : "bg-muted-foreground/35"
              )}
              style={{ height: `${Math.round(v * 100)}%` }}
            />
          ))}
          {(sonando || t > 0) && (
            <span
              className={cn("pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow", mio ? "bg-white" : "bg-primary")}
              style={{ left: `${progreso * 100}%` }}
            />
          )}
        </div>
        <p className={cn("text-[10px] tabular-nums", mio ? "text-primary-foreground/80" : "text-muted-foreground")}>
          {duracionTexto(sonando || t > 0 ? t : audio.duracion)}
        </p>
      </div>
      <button
        type="button"
        onClick={cambiarVelocidad}
        className={cn(
          "shrink-0 rounded-full px-2 py-1 text-[11px] font-bold tabular-nums transition-colors",
          mio ? "bg-white/20 text-primary-foreground hover:bg-white/30" : "bg-muted text-foreground hover:bg-muted/70",
          vel !== 1 && (mio ? "bg-white text-primary" : "bg-primary text-primary-foreground")
        )}
        aria-label={`Velocidad ${vel}x`}
        title="Velocidad"
      >
        {vel === 1.5 ? "1,5" : vel}x
      </button>
    </div>
    <div className={cn("flex items-center gap-2 pl-[2.875rem] text-[10px]", mio ? "text-primary-foreground/75" : "text-muted-foreground")}>
      {mensajeId && (
        <button type="button" onClick={() => void transcribir()} className="inline-flex items-center gap-0.5 font-medium underline-offset-2 hover:underline">
          {transcribiendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className={cn("h-3 w-3 transition-transform", verTexto && "rotate-180")} />}
          {verTexto ? "Ocultar texto" : "Ver texto"}
        </button>
      )}
      <button
        type="button"
        onClick={() => void descargarAudio(chatId, audio, at).catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo descargar"))}
        className="inline-flex items-center gap-0.5 font-medium underline-offset-2 hover:underline"
      >
        <Download className="h-3 w-3" /> Descargar
      </button>
      {mio && (
        <span
          className={cn("ml-auto inline-flex items-center gap-0.5", quienes.length && "font-semibold text-sky-300")}
          title={quienes.length ? `Lo escuchó: ${quienes.map((u) => nombreDe?.(u) || "alguien").join(", ")}` : "Todavía nadie lo escuchó"}
        >
          <Mic className="h-3 w-3" /> {quienes.length ? "Escuchado" : "Sin escuchar"}
        </span>
      )}
    </div>
    {verTexto && (
      <p className={cn("whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed", mio ? "bg-white/15" : "bg-muted/70")}>
        {transcribiendo ? "Transcribiendo…" : texto}
      </p>
    )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grabador (barra que reemplaza al cuadro de texto mientras se graba)
// ---------------------------------------------------------------------------

const TIPOS = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

// Micrófono: si el navegador recuerda el permiso (Chrome, Android), se pide y se suelta en cada audio (no pregunta).
// En el iPhone, iOS vuelve a preguntar cada vez que se suelta (aunque diga que ya está permitido): ahí queda tomado
// (apagado) mientras la app está abierta y se suelta al salir de la app; así pregunta una vez por cada vez que se abre.
// En los demás que preguntan cada vez ("Solo esta vez"), queda guardado 10 minutos.
let micGuardado: MediaStream | null = null;
let soltarMic = 0;
const MIC_GUARDADO_MS = 10 * 60_000;
const ES_IOS = typeof navigator !== "undefined" && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
if (ES_IOS && typeof document !== "undefined") {
  // Al salir de la app (o bloquear el celular) se suelta: no queda el micrófono tomado de fondo.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || !micGuardado) return;
    const enUso = micGuardado.getAudioTracks().some((t) => t.enabled);
    if (enUso) return;
    micGuardado.getTracks().forEach((t) => t.stop());
    micGuardado = null;
  });
}
const CLAVE_AYUDA_MIC = "prodi-ayuda-mic-2";

async function permisoMic(): Promise<PermissionState | null> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return null;
  }
}

async function pedirMic(): Promise<MediaStream> {
  window.clearTimeout(soltarMic);
  if (micGuardado?.getAudioTracks().some((t) => t.readyState === "live")) {
    micGuardado.getAudioTracks().forEach((t) => (t.enabled = true));
    return micGuardado;
  }
  // Mensaje de voz (no es una llamada): sin cancelación de eco, que acá no hace falta y mete cortes y sonido metálico;
  // sí reducción de ruido y volumen automático. Mono a 48 kHz.
  micGuardado = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 },
  });
  return micGuardado;
}

async function guardarMic(stream: MediaStream) {
  stream.getAudioTracks().forEach((t) => (t.enabled = false));
  const soltar = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (micGuardado === stream) micGuardado = null;
  };
  // iPhone: queda tomado (y apagado) hasta que se sale de la app.
  if (!ES_IOS) {
    const permiso = await permisoMic();
    if (permiso === "granted") return soltar();
    soltarMic = window.setTimeout(soltar, MIC_GUARDADO_MS);
  }
  // Una sola vez: cómo dejarlo permitido para siempre.
  try {
    if (localStorage.getItem(CLAVE_AYUDA_MIC)) return;
    localStorage.setItem(CLAVE_AYUDA_MIC, "1");
  } catch {
    return;
  }
  toast.message("Para que no te pida el micrófono", {
    description: ES_IOS
      ? "Ahora te lo pide una vez cada vez que abrís la app. Para que no pregunte nunca: en Safari tocá «aA» en la barra de arriba → Configuración del sitio web → Micrófono → «Permitir» (o en Ajustes → Apps → Safari → Micrófono → «Permitir»)."
      : "Cuando el navegador pregunte, elegí «Permitir» (no «Solo esta vez»).",
    duration: 14_000,
  });
}

export function useGrabadorVoz() {
  const [grabando, setGrabando] = useState(false);
  const [seg, setSeg] = useState(0);
  const [niveles, setNiveles] = useState<number[]>(Array(24).fill(0.1));
  const rec = useRef<MediaRecorder | null>(null);
  /** Mientras pide el micrófono: un doble toque no arranca dos grabaciones. */
  const iniciando = useRef(false);
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
    // Ya está grabando (o arrancando): no se abre otra grabación. Antes un doble toque dejaba una grabando de fondo
    // que se metía en los audios siguientes, aunque fueran de otro chat.
    if (iniciando.current || rec.current?.state === "recording") return;
    iniciando.current = true;
    try {
      await arrancar();
    } finally {
      iniciando.current = false;
    }
  };

  const arrancar = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Este navegador no permite grabar audio");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await pedirMic();
    } catch {
      toast.error("Permití el micrófono en el navegador para mandar audios");
      return;
    }
    const mimeType = TIPOS.find((t) => MediaRecorder.isTypeSupported?.(t));
    // Calidad: Opus (Chrome, Android) a 48 kbps suena como WhatsApp; el AAC del iPhone necesita más (64 kbps).
    // Antes iba a 24 kbps y en el iPhone sonaba metálico. 3 minutos siguen entrando en el límite (~2 MB).
    const esAac = (mimeType ?? "").includes("mp4") || (!mimeType && /iPhone|iPad|Macintosh/i.test(navigator.userAgent));
    const r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: esAac ? 64000 : 48000 });
    // Los pedazos de ESTA grabación (cada grabación tiene los suyos: nunca se mezclan con otra).
    const partes: Blob[] = [];
    r.ondataavailable = (e) => {
      if (e.data.size) partes.push(e.data);
    };
    cortado.current = null;
    r.onstop = () => {
      // Una grabación que ya no es la actual (se descartó al cambiar de chat o al cerrar): no va a ningún lado.
      if (rec.current !== r) return;
      const blob = partes.length ? new Blob(partes, { type: r.mimeType || mimeType || "audio/webm" }) : null;
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
      void guardarMic(stream);
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

  /** Corta y tira la grabación en curso (al cambiar de chat o al cerrar la conversación). */
  const descartar = () => {
    const r = rec.current;
    rec.current = null;
    resolver.current = null;
    cortado.current = null;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* ya estaba parada */
      }
    }
    terminar();
  };

  useEffect(
    () => () => {
      // Al cerrar: si quedó grabando, se corta (no queda el micrófono abierto ni grabando de fondo).
      const r = rec.current;
      rec.current = null;
      if (r && r.state !== "inactive") {
        try {
          r.stop();
        } catch {
          /* nada */
        }
      }
      limpiar.current();
    },
    []
  );

  return { grabando, seg, niveles, empezar, detener, descartar };
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
