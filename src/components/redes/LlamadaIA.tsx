import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, Mic, MicOff, PhoneOff } from "lucide-react";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

// Llamada de voz con la IA (en cualquier "Pedile a la IA"): la persona habla, la IA entiende, contesta corto y lo dice
// en voz alta; después vuelve a escuchar. Lo que se dice queda escrito en el chat (con sus propuestas).
// Escuchar: el reconocimiento de voz del navegador si lo tiene (Chrome, Edge, Safari) y, si no, se graba hasta que
// la persona hace una pausa y lo pasa a texto el servidor (/api/ia/voz-escuchar). Hablar: la voz natural del servidor
// (/api/ia/voz-hablar) y, si no hay, la del navegador.

type Estado = "conectando" | "escuchando" | "pensando" | "hablando" | "silenciado" | "error";

const TEXTO: Record<Estado, string> = {
  conectando: "Conectando…",
  escuchando: "Te escucho…",
  pensando: "Pensando…",
  hablando: "Hablando…",
  silenciado: "Micrófono apagado",
  error: "No pude usar el micrófono",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Reconocimiento = (): any => (typeof window === "undefined" ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

const aBase64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

/** Voz del navegador en castellano (la de Argentina si está). */
function hablarNavegador(texto: string, alTerminar: () => void): () => void {
  const s = window.speechSynthesis;
  if (!s) {
    alTerminar();
    return () => undefined;
  }
  const u = new SpeechSynthesisUtterance(texto);
  const voces = s.getVoices();
  u.voice = voces.find((v) => v.lang === "es-AR") ?? voces.find((v) => v.lang.startsWith("es")) ?? null;
  u.lang = u.voice?.lang ?? "es-AR";
  u.rate = 1.05;
  u.onend = alTerminar;
  u.onerror = alTerminar;
  s.cancel();
  s.speak(u);
  return () => s.cancel();
}

export function LlamadaIA({
  titulo,
  onDecir,
  onCortar,
}: {
  titulo: string;
  /** Manda lo que dijo la persona al chat y devuelve lo que contesta la IA (null si falló). */
  onDecir: (texto: string) => Promise<string | null>;
  onCortar: () => void;
}) {
  const [estado, setEstado] = useState<Estado>("conectando");
  const [parcial, setParcial] = useState("");
  const [nivel, setNivel] = useState(0);
  const activa = useRef(true);
  const silenciado = useRef(false);
  const stream = useRef<MediaStream | null>(null);
  const contexto = useRef<AudioContext | null>(null);
  const analizador = useRef<AnalyserNode | null>(null);
  const rec = useRef<{ stop: () => void } | null>(null);
  const callar = useRef<() => void>(() => undefined);
  const escucharRef = useRef<() => void>(() => undefined);

  /** Volumen del micrófono (0 a 1), para la animación y para saber cuándo hay una pausa. */
  const volumen = useCallback(() => {
    const a = analizador.current;
    if (!a) return 0;
    const datos = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(datos);
    let suma = 0;
    for (const v of datos) suma += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(suma / datos.length) * 4);
  }, []);

  // Animación de la esfera con el volumen.
  useEffect(() => {
    let id = 0;
    const tick = () => {
      setNivel((n) => n * 0.6 + volumen() * 0.4);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [volumen]);

  const responder = useCallback(
    async (texto: string) => {
      if (!activa.current) return;
      setParcial(texto);
      setEstado("pensando");
      const r = await onDecir(texto);
      if (!activa.current) return;
      if (!r) {
        escucharRef.current();
        return;
      }
      setEstado("hablando");
      const seguir = () => {
        if (activa.current) escucharRef.current();
      };
      try {
        const v = await callApi<{ audio: { data: string; mime: string } | null }>("/api/ia/voz-hablar", { texto: r });
        if (!activa.current) return;
        if (v.audio) {
          const audio = new Audio(`data:${v.audio.mime};base64,${v.audio.data}`);
          callar.current = () => {
            audio.pause();
            seguir();
          };
          audio.onended = seguir;
          audio.onerror = () => {
            callar.current = hablarNavegador(r, seguir);
          };
          await audio.play();
          return;
        }
      } catch {
        /* sin voz natural: la del navegador */
      }
      callar.current = hablarNavegador(r, seguir);
    },
    [onDecir]
  );

  /** Escucha con el reconocimiento del navegador. */
  const escucharNavegador = useCallback(() => {
    const R = Reconocimiento();
    const r = new R();
    r.lang = "es-AR";
    r.interimResults = true;
    r.continuous = false;
    let final = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else t += e.results[i][0].transcript;
      }
      setParcial((final + t).trim());
    };
    r.onerror = () => undefined;
    r.onend = () => {
      rec.current = null;
      if (!activa.current || silenciado.current) return;
      const dicho = final.trim();
      if (dicho) void responder(dicho);
      else escucharRef.current();
    };
    rec.current = { stop: () => r.abort() };
    r.start();
  }, [responder]);

  /** Escucha grabando hasta una pausa y lo pasa a texto el servidor. */
  const escucharGrabando = useCallback(() => {
    const s = stream.current;
    if (!s) return;
    const mr = new MediaRecorder(s);
    const partes: Blob[] = [];
    let hablo = false;
    let ultimaVoz = Date.now();
    const inicio = Date.now();
    mr.ondataavailable = (e) => e.data.size && partes.push(e.data);
    const vigilar = window.setInterval(() => {
      const v = volumen();
      if (v > 0.08) {
        hablo = true;
        ultimaVoz = Date.now();
      }
      const pausa = hablo && Date.now() - ultimaVoz > 1300;
      if (pausa || Date.now() - inicio > 30_000 || !activa.current || silenciado.current) {
        window.clearInterval(vigilar);
        if (mr.state !== "inactive") mr.stop();
      }
    }, 120);
    mr.onstop = async () => {
      rec.current = null;
      if (!activa.current || silenciado.current) return;
      if (!hablo) {
        escucharRef.current();
        return;
      }
      setEstado("pensando");
      try {
        const blob = new Blob(partes, { type: mr.mimeType || "audio/webm" });
        const r = await callApi<{ texto: string }>("/api/ia/voz-escuchar", { data: await aBase64(blob), mime: blob.type });
        if (r.texto) void responder(r.texto);
        else escucharRef.current();
      } catch {
        escucharRef.current();
      }
    };
    rec.current = {
      stop: () => {
        window.clearInterval(vigilar);
        if (mr.state !== "inactive") mr.stop();
      },
    };
    mr.start(250);
  }, [responder, volumen]);

  const escuchar = useCallback(() => {
    if (!activa.current) return;
    if (silenciado.current) {
      setEstado("silenciado");
      return;
    }
    setParcial("");
    setEstado("escuchando");
    try {
      if (Reconocimiento()) escucharNavegador();
      else escucharGrabando();
    } catch {
      escucharGrabando();
    }
  }, [escucharNavegador, escucharGrabando]);
  escucharRef.current = escuchar;

  // Al empezar: pedir el micrófono (para el volumen y, si hace falta, para grabar).
  useEffect(() => {
    activa.current = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (!activa.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        const ctx = new AudioContext();
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(a);
        contexto.current = ctx;
        analizador.current = a;
        escucharRef.current();
      } catch {
        setEstado("error");
      }
    })();
    return () => {
      activa.current = false;
      rec.current?.stop();
      callar.current();
      window.speechSynthesis?.cancel();
      stream.current?.getTracks().forEach((t) => t.stop());
      void contexto.current?.close().catch(() => undefined);
    };
  }, []);

  const interrumpir = () => {
    callar.current();
    callar.current = () => undefined;
  };
  const alternarMicro = () => {
    silenciado.current = !silenciado.current;
    if (silenciado.current) {
      rec.current?.stop();
      setEstado("silenciado");
    } else escuchar();
  };
  const cortar = () => {
    activa.current = false;
    rec.current?.stop();
    callar.current();
    onCortar();
  };

  const escala = estado === "escuchando" ? 1 + nivel * 0.5 : estado === "hablando" ? 1.08 : 1;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#2a1468] via-[#3b1a8a] to-[#6b1f6e] p-5 text-white">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-fuchsia-400/20 blur-3xl" aria-hidden />
      <p className="relative text-center text-[11px] font-semibold uppercase tracking-wider text-white/70">Llamada con la IA</p>
      <p className="relative text-center text-[11px] text-white/55">{titulo}</p>

      {/* La esfera: late con tu voz cuando escucha y gira cuando piensa o habla. */}
      <div className="relative mx-auto my-5 flex h-28 w-28 items-center justify-center">
        <span
          className={cn("absolute inset-0 rounded-full bg-gradient-to-br from-[#8b5cf6] to-[#ec4899] opacity-40 blur-xl transition-transform duration-100", estado === "hablando" && "animate-pulse")}
          style={{ transform: `scale(${escala * 1.15})` }}
        />
        <span
          className={cn(
            "relative h-24 w-24 rounded-full bg-gradient-to-br from-[#a78bfa] via-[#8b5cf6] to-[#ec4899] shadow-[0_0_40px_rgba(236,72,153,0.45)] transition-transform duration-100",
            (estado === "pensando" || estado === "conectando") && "animate-spin [animation-duration:2.5s]"
          )}
          style={{ transform: estado === "pensando" || estado === "conectando" ? undefined : `scale(${escala})` }}
        >
          <span className="absolute inset-3 rounded-full bg-white/15 blur-[2px]" />
        </span>
      </div>

      <p className="relative text-center text-sm font-semibold" aria-live="polite">
        {TEXTO[estado]}
      </p>
      <p className="relative mx-auto mt-1 min-h-[2.5rem] max-w-md text-center text-xs leading-relaxed text-white/75">
        {estado === "error" ? "Revisá que el navegador tenga permiso para usar el micrófono." : parcial ? `“${parcial}”` : estado === "escuchando" ? "Hablá tranquilo; cuando hagas una pausa, te contesto." : ""}
      </p>

      <div className="relative mt-3 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={alternarMicro}
          disabled={estado === "error"}
          className={cn("flex h-11 w-11 items-center justify-center rounded-full transition-colors", estado === "silenciado" ? "bg-white text-[#3b1a8a]" : "bg-white/15 hover:bg-white/25")}
          aria-label={estado === "silenciado" ? "Prender el micrófono" : "Apagar el micrófono"}
          title={estado === "silenciado" ? "Prender el micrófono" : "Apagar el micrófono"}
        >
          {estado === "silenciado" ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        {estado === "hablando" && (
          <button
            type="button"
            onClick={interrumpir}
            className="flex h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-medium transition-colors hover:bg-white/25"
            title="Cortarla y hablar vos"
          >
            <Hand className="h-4 w-4" /> Interrumpir
          </button>
        )}
        <button
          type="button"
          onClick={cortar}
          className="flex h-11 items-center gap-1.5 rounded-full bg-red-500 px-5 text-sm font-semibold shadow-lg shadow-red-500/30 transition-transform hover:scale-105"
        >
          <PhoneOff className="h-4 w-4" /> Cortar
        </button>
      </div>
    </div>
  );
}
