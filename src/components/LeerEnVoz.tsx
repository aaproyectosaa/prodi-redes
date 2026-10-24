import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Leer en voz alta con la voz del dispositivo (sin IA, no cuesta nada). Suena uno por vez y la velocidad
// elegida queda guardada para todos.
const VELOCIDADES = [1, 1.25, 1.5, 2];
const CLAVE_VEL = "prodi-leer-vel";
const velGuardada = () => {
  try {
    const v = Number(localStorage.getItem(CLAVE_VEL));
    return VELOCIDADES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
};
let sonandoAhora: { current: () => void } | null = null;

/** La mejor voz en castellano del dispositivo (Argentina primero, las "naturales" antes que las robóticas). */
function vozEnCastellano(): SpeechSynthesisVoice | undefined {
  const voces = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("es"));
  const puntos = (v: SpeechSynthesisVoice) =>
    (/natural|neural/i.test(v.name) ? 100 : 0) +
    (/online/i.test(v.name) ? 40 : 0) +
    (/google/i.test(v.name) ? 30 : 0) +
    (/es-AR/i.test(v.lang) ? 20 : /es-(US|MX|419)/i.test(v.lang) ? 12 : 0);
  return [...voces].sort((a, b) => puntos(b) - puntos(a))[0];
}

/** De a frases: algunos navegadores cortan los textos largos a la mitad. */
function enFrases(texto: string): string[] {
  return (texto.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*/g) ?? [texto]).map((x) => x.trim()).filter(Boolean);
}

export function LeerEnVoz({ texto, className, etiqueta = "Escuchar" }: { texto: string; className?: string; etiqueta?: string }) {
  const [hablando, setHablando] = useState(false);
  const [vel, setVel] = useState(velGuardada);
  const cola = useRef<string[]>([]);
  const vivo = useRef(true);
  const yo = useRef<() => void>(() => {});
  const hay = typeof window !== "undefined" && "speechSynthesis" in window;

  const parar = () => {
    cola.current = [];
    window.speechSynthesis?.cancel();
    setHablando(false);
  };
  yo.current = parar;
  useEffect(
    () => () => {
      vivo.current = false;
      if (sonandoAhora === yo) {
        sonandoAhora = null;
        window.speechSynthesis?.cancel();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  if (!hay || !texto.trim()) return null;

  const decir = (velocidad: number) => {
    const frase = cola.current.shift();
    if (!frase || !vivo.current) return setHablando(false);
    const u = new SpeechSynthesisUtterance(frase);
    const voz = vozEnCastellano();
    if (voz) u.voice = voz;
    u.lang = voz?.lang ?? "es-AR";
    u.rate = velocidad;
    u.onend = () => cola.current.length ? decir(velocidad) : setHablando(false);
    u.onerror = () => setHablando(false);
    window.speechSynthesis.speak(u);
  };
  const arrancar = (velocidad: number, frases: string[]) => {
    window.speechSynthesis.cancel();
    cola.current = frases;
    setHablando(true);
    decir(velocidad);
  };
  const escuchar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hablando) return parar();
    if (sonandoAhora && sonandoAhora !== yo) sonandoAhora.current();
    sonandoAhora = yo;
    arrancar(vel, enFrases(texto));
  };
  // Cambiar la velocidad mientras suena: sigue desde la frase que estaba leyendo.
  const cambiarVel = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = VELOCIDADES[(VELOCIDADES.indexOf(vel) + 1) % VELOCIDADES.length];
    setVel(v);
    try {
      localStorage.setItem(CLAVE_VEL, String(v));
    } catch {
      /* sin almacenamiento */
    }
    if (hablando) {
      const resto = cola.current;
      arrancar(v, resto.length ? resto : enFrases(texto));
    }
  };

  return (
    <span className={cn("inline-flex items-center overflow-hidden rounded-full border text-[11px] font-medium", hablando && "border-primary", className)}>
      <button
        type="button"
        onClick={escuchar}
        className={cn("inline-flex items-center gap-1 px-2.5 py-1 transition-colors hover:bg-muted", hablando ? "text-primary" : "text-muted-foreground hover:text-foreground")}
        aria-label={hablando ? "Parar" : etiqueta}
      >
        {hablando ? <Square className="h-3 w-3 fill-current" /> : <Volume2 className="h-3.5 w-3.5" />}
        {hablando ? "Parar" : etiqueta}
      </button>
      <button
        type="button"
        onClick={cambiarVel}
        className="border-l px-2 py-1 tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Velocidad de la voz"
        aria-label={`Velocidad ${vel}x`}
      >
        {String(vel).replace(".", ",")}x
      </button>
    </span>
  );
}
