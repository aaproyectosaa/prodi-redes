import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MensajeDemo, SalaDemo } from "@/lib/demoVivo";

/** Re-dibuja cuando la sala cambia (llegó un video, un mensaje, alguien entró). */
export function useSala(sala: SalaDemo | null) {
  const [, forzar] = useState(0);
  useEffect(() => {
    if (!sala) return;
    return sala.suscribir(() => forzar((n) => n + 1));
  }, [sala]);
  return sala;
}

/** Video en vivo de un MediaStream. */
export function VideoVivo({ stream, className, espejo, contain = true }: { stream: MediaStream | null; className?: string; espejo?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn("h-full w-full bg-black", contain ? "object-contain" : "object-cover", espejo && "-scale-x-100", className)}
    />
  );
}

/** Audio del presentador. Si el navegador no deja reproducir sin un toque, avisa para mostrar el botón. */
export function AudioVivo({ stream, onBloqueado }: { stream: MediaStream | null; onBloqueado: (b: boolean) => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a || !stream) return;
    a.srcObject = stream;
    a.play()
      .then(() => onBloqueado(false))
      .catch(() => onBloqueado(true));
  }, [stream, onBloqueado]);
  return <audio ref={ref} autoPlay playsInline />;
}

/** Audio de otra persona (sin controles; en el presentador: la voz del lead que prendió el micrófono). */
export function SonidoRemoto({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.srcObject = stream;
    void a.play().catch(() => undefined);
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

/** Una persona en un círculo (presentador, cliente o uno mismo). */
export function Circulo({ stream, nombre, espejo, className }: { stream: MediaStream | null; nombre?: string; espejo?: boolean; className?: string }) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <div className="h-full w-full overflow-hidden rounded-full bg-zinc-900 shadow-2xl ring-2 ring-white/80">
        <VideoVivo stream={stream} contain={false} espejo={espejo} />
      </div>
      {nombre && (
        <span className="absolute -bottom-1.5 left-1/2 max-w-[120%] -translate-x-1/2 truncate rounded-full bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          {nombre}
        </span>
      )}
    </div>
  );
}

/** ¿Este stream trae video? */
export const tieneVideo = (s: MediaStream | null | undefined) => !!s?.getVideoTracks().some((t) => t.readyState === "live");

export function PildoraVivo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-red-500/30", className)}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      En vivo
    </span>
  );
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/** Chat de la demo (preguntas del lead, respuestas de la empresa y avisos). */
export function ChatDemo({ sala, yo, className, placeholder = "Escribí tu pregunta…" }: { sala: SalaDemo; yo: string; className?: string; placeholder?: string }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const lista = useRef<HTMLDivElement>(null);
  const mensajes: MensajeDemo[] = useSyncExternalStore(
    (f) => sala.suscribir(f),
    () => sala.mensajes
  );
  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: "smooth" });
  }, [mensajes.length]);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setTexto("");
    await sala.enviarMensaje(t).catch(() => setTexto(t));
    setEnviando(false);
  };
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div ref={lista} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {mensajes.length === 0 && <p className="py-6 text-center text-sm text-white/40">Las preguntas aparecen acá.</p>}
        {mensajes.map((m) =>
          m.tipo === "sistema" || m.tipo === "privado" ? (
            <p key={m.id} className={cn("text-center text-xs", m.texto.startsWith("🔥") ? "font-semibold text-amber-300" : "text-white/40")}>
              {m.texto}
            </p>
          ) : (
            <div key={m.id} className={cn("flex flex-col", m.pid === yo ? "items-end" : "items-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.pid === yo ? "rounded-br-md bg-violet-600 text-white" : "rounded-bl-md bg-white/10 text-white")}>
                {m.pid !== yo && <p className="mb-0.5 text-[11px] font-semibold text-violet-300">{m.nombre}</p>}
                <p className="whitespace-pre-wrap break-words">{m.texto}</p>
              </div>
              <span className="mt-0.5 px-1 text-[10px] text-white/30">{hora(m.creado)}</span>
            </div>
          )
        )}
      </div>
      <form onSubmit={enviar} className="flex shrink-0 items-center gap-2 border-t border-white/10 p-2.5">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={placeholder}
          maxLength={500}
          className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 text-[16px] text-white placeholder:text-white/35 focus:border-violet-400 focus:outline-none"
        />
        <button type="submit" disabled={!texto.trim()} aria-label="Enviar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white transition hover:bg-violet-500 disabled:opacity-40">
          <Send className="h-[18px] w-[18px]" />
        </button>
      </form>
    </div>
  );
}

/** Fecha linda: "hoy 17:00", "mañana 10:30", "jue 13 nov 18:00". */
export function fechaDemo(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const hoy = new Date();
  const man = new Date();
  man.setDate(hoy.getDate() + 1);
  const h = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoy.toDateString()) return `hoy ${h}`;
  if (d.toDateString() === man.toDateString()) return `mañana ${h}`;
  return `${d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })} ${h}`;
}

/** Fondo oscuro con un brillo violeta (las tres pantallas de la demo). */
export function FondoDemo({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative min-h-dvh overflow-hidden bg-[#07060c] text-white", className)}>
      <div className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-violet-600/25 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 -right-40 h-[30rem] w-[30rem] rounded-full bg-fuchsia-600/15 blur-[130px]" />
      <div className="relative">{children}</div>
    </div>
  );
}
