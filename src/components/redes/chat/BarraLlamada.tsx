// Barra de la llamada de voz en curso (como WhatsApp): queda arriba aunque cambies de pantalla.
// Muestra quién está, quién habla, y deja silenciarte o colgar.

import { Headphones, Loader2, Mic, MicOff, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { salirDelChatDeVoz, silenciar, useLlamada } from "@/lib/redes/chatVoz";
import { cn } from "@/lib/utils";

export function BarraLlamada() {
  const ll = useLlamada();
  if (!ll) return null;
  const conectados = ll.personas.filter((p) => p.estado === "conectado").length;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-2">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-primary/30 bg-card/95 p-2 pl-3 shadow-xl backdrop-blur">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-shadow",
            ll.yoHablando && "ring-4 ring-primary/30"
          )}
        >
          <Headphones className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Chat de voz · {ll.chatNombre}</p>
          <p className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            {ll.personas.length === 0 ? (
              "Esperando a que entre alguien…"
            ) : (
              ll.personas.map((p, i) => (
                <span key={p.uid} className={cn("shrink-0", p.hablando && "font-semibold text-primary")}>
                  {p.estado === "conectando" && <Loader2 className="mr-0.5 inline h-3 w-3 animate-spin" />}
                  {(p.nombre || "Alguien").split(" ")[0]}
                  {p.estado === "sin-conexion" && " (sin conexión)"}
                  {i < ll.personas.length - 1 ? "," : ""}
                </span>
              ))
            )}
            {ll.personas.length > 0 && conectados < ll.personas.length && <span className="shrink-0">· conectando…</span>}
          </p>
        </div>
        <Button
          size="icon"
          variant={ll.muteado ? "secondary" : "ghost"}
          className="h-10 w-10 shrink-0 rounded-full"
          onClick={() => silenciar()}
          aria-label={ll.muteado ? "Activar micrófono" : "Silenciarme"}
          title={ll.muteado ? "Activar micrófono" : "Silenciarme"}
        >
          {ll.muteado ? <MicOff className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="destructive"
          className="h-10 w-10 shrink-0 rounded-full"
          onClick={() => void salirDelChatDeVoz()}
          aria-label="Salir del chat de voz"
          title="Salir del chat de voz"
        >
          <PhoneOff className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
