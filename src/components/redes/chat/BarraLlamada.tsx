// Llamada de voz en curso: burbuja flotante abajo a la derecha (no tapa encabezados ni la isla del iPhone).
// Late cuando alguien habla; al tocarla se abre la tarjeta con quién está, silenciar y colgar.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Headphones, Loader2, Maximize2, Mic, MicOff, Minimize2, MonitorUp, MonitorX, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { compartirPantalla, dejarDeCompartir, salirDelChatDeVoz, silenciar, useLlamada } from "@/lib/redes/chatVoz";
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
    <>
    {ll.pantallas.length > 0 && <PantallaCompartida pantallas={ll.pantallas} />}
    <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] right-3 z-[100] flex flex-col items-end gap-2 md:bottom-6 md:right-6">
      {abierta && (
        <div className="pointer-events-auto w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border bg-card/95 p-3 shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-primary">Chat de voz</p>
              <p className="truncate text-sm font-semibold">{ll.chatNombre}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                {ll.grabando && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />}
                {ll.grabando ? "Se transcribe para la minuta · al cortar queda en el chat" : "Se transcribe para la minuta del chat"}
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
          {ll.puedeCompartir && (
            <Button
              variant={ll.compartiendo ? "secondary" : "outline"}
              className={cn("mt-2 h-10 w-full rounded-full", ll.compartiendo && "text-primary")}
              onClick={() => {
                if (ll.compartiendo) dejarDeCompartir();
                else
                  void compartirPantalla().catch((err) => {
                    // Cancelar en el selector del navegador no es un error.
                    if (err instanceof DOMException && err.name === "NotAllowedError") return;
                    toast.error("No se pudo compartir la pantalla");
                  });
              }}
            >
              {ll.compartiendo ? <MonitorX className="mr-1.5 h-4 w-4" /> : <MonitorUp className="mr-1.5 h-4 w-4" />}
              {ll.compartiendo ? "Dejar de compartir" : "Compartir pantalla"}
            </Button>
          )}
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
    </>
  );
}

/** La pantalla que comparte alguien de la llamada: ventana flotante que se agranda a pantalla completa. */
function PantallaCompartida({ pantallas }: { pantallas: { uid: string; nombre: string; stream: MediaStream }[] }) {
  const [elegida, setElegida] = useState<string | null>(null);
  const [grande, setGrande] = useState(false);
  const [oculta, setOculta] = useState(false);
  const p = pantallas.find((x) => x.uid === elegida) ?? pantallas[0];
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== p.stream) v.srcObject = p.stream;
    void v.play().catch(() => undefined);
  }, [p.stream, oculta]);
  // Cuando alguien empieza a compartir, se muestra (aunque antes se haya ocultado otra).
  useEffect(() => setOculta(false), [p.uid]);
  const nombre = (p.nombre || "Alguien").split(" ")[0];

  if (oculta) {
    return (
      <button
        type="button"
        onClick={() => setOculta(false)}
        className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[101] flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xl animate-in fade-in slide-in-from-top-2"
      >
        <MonitorUp className="h-4 w-4" /> Ver la pantalla de {nombre}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "fixed z-[101] flex flex-col overflow-hidden border bg-black shadow-2xl animate-in fade-in zoom-in-95",
        grande
          ? "inset-0 rounded-none"
          : "left-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] rounded-2xl md:left-auto md:right-6 md:top-6 md:w-[min(46rem,calc(100vw-20rem))]"
      )}
    >
      <div className="flex items-center gap-2 bg-black/80 px-3 py-2 text-white">
        <MonitorUp className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">Pantalla de {nombre}</p>
        {pantallas.length > 1 &&
          pantallas.map((x) => (
            <button
              key={x.uid}
              type="button"
              onClick={() => setElegida(x.uid)}
              className={cn("rounded-full px-2 py-0.5 text-[11px]", x.uid === p.uid ? "bg-white text-black" : "bg-white/15 hover:bg-white/25")}
            >
              {(x.nombre || "?").split(" ")[0]}
            </button>
          ))}
        <button type="button" onClick={() => setGrande((g) => !g)} className="rounded-full p-1.5 hover:bg-white/15" aria-label={grande ? "Achicar" : "Agrandar"} title={grande ? "Achicar" : "Agrandar"}>
          {grande ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => setOculta(true)} className="rounded-full p-1.5 hover:bg-white/15" aria-label="Ocultar" title="Ocultar">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <video ref={video} autoPlay playsInline muted className={cn("w-full bg-black object-contain", grande ? "min-h-0 flex-1" : "aspect-video")} />
    </div>
  );
}
