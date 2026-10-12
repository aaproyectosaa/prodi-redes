// Llamada de voz en curso: burbuja flotante abajo a la derecha (no tapa encabezados ni la isla del iPhone).
// Late cuando alguien habla; al tocarla se abre la tarjeta con quién está, silenciar y colgar.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Headphones, Loader2, Mic, MicOff, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { salirDelChatDeVoz, silenciar, useLlamada } from "@/lib/redes/chatVoz";
import { cn } from "@/lib/utils";

export function BarraLlamada() {
  const ll = useLlamada();
  const [abierta, setAbierta] = useState(true);
  const chatAntes = useRef<string | null>(null);
  // Al entrar a una llamada, la tarjeta arranca abierta.
  useEffect(() => {
    if (ll?.chatId && ll.chatId !== chatAntes.current) setAbierta(true);
    chatAntes.current = ll?.chatId ?? null;
  }, [ll?.chatId]);
  if (!ll) return null;

  const conectados = ll.personas.filter((p) => p.estado === "conectado").length;
  const alguienHabla = ll.yoHablando || ll.personas.some((p) => p.hablando);

  return (
    <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] right-3 z-[100] flex flex-col items-end gap-2 md:bottom-6 md:right-6">
      {abierta && (
        <div className="pointer-events-auto w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border bg-card/95 p-3 shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-primary">Chat de voz</p>
              <p className="truncate text-sm font-semibold">{ll.chatNombre}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                {ll.grabando && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />}
                {ll.grabando ? "Grabando para la minuta · al salir queda en el chat" : "Se graba para la minuta del chat"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAbierta(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              aria-label="Minimizar"
              title="Minimizar"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2 space-y-1.5">
            {ll.personas.length === 0 ? (
              <p className="text-xs text-muted-foreground">Esperando a que entre alguien…</p>
            ) : (
              ll.personas.map((p) => (
                <div key={p.uid} className="flex items-center gap-2 text-sm">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold transition-shadow",
                      p.hablando && "bg-primary/20 text-primary ring-2 ring-primary"
                    )}
                  >
                    {(p.nombre || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{(p.nombre || "Alguien").split(" ")[0]}</span>
                  {p.estado === "conectando" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  {p.estado === "sin-conexion" && <span className="text-[11px] text-destructive">sin conexión</span>}
                </div>
              ))
            )}
            {ll.personas.length > 0 && conectados < ll.personas.length && <p className="text-[11px] text-muted-foreground">Conectando…</p>}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button
              variant={ll.muteado ? "secondary" : "outline"}
              className="h-10 flex-1 rounded-full"
              onClick={() => silenciar()}
              aria-label={ll.muteado ? "Activar micrófono" : "Silenciarme"}
            >
              {ll.muteado ? <MicOff className="mr-1.5 h-4 w-4 text-destructive" /> : <Mic className="mr-1.5 h-4 w-4" />}
              {ll.muteado ? "Silenciado" : "Micrófono"}
            </Button>
            <Button variant="destructive" className="h-10 flex-1 rounded-full" onClick={() => void salirDelChatDeVoz()} aria-label="Salir del chat de voz">
              <PhoneOff className="mr-1.5 h-4 w-4" />
              Salir
            </Button>
          </div>
        </div>
      )}

      {/* Burbuja: siempre a mano mientras dura la llamada. */}
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className={cn(
          "pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/40 transition-transform active:scale-95",
          alguienHabla && "ring-4 ring-primary/40"
        )}
        aria-label={abierta ? "Ocultar la llamada" : "Ver la llamada"}
      >
        {alguienHabla && <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />}
        {ll.muteado ? <MicOff className="relative h-6 w-6" /> : <Headphones className="relative h-6 w-6" />}
        {ll.personas.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-success px-1 text-[11px] font-bold text-white ring-2 ring-background">
            {conectados + 1}
          </span>
        )}
      </button>
    </div>
  );
}
