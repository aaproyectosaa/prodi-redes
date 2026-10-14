// Ventana flotante con una pantalla compartida (la mía o la de otro): se arrastra desde la barra de arriba,
// se agranda o achica desde la esquina, se maximiza, se minimiza o se abre en una ventana aparte del sistema
// (imagen en imagen: queda arriba de todo aunque cambies de app o de pestaña).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Maximize2, Minimize2, MonitorUp, PictureInPicture2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_ANCHO = 220;

export function VentanaPantalla({
  stream,
  titulo,
  chip,
  anchoInicial,
  posicion,
  acciones,
  borde,
}: {
  stream: MediaStream;
  titulo: ReactNode;
  /** Texto del botón cuando está minimizada. */
  chip: string;
  anchoInicial: number;
  /** Dónde arranca: arriba a la derecha o arriba al centro. */
  posicion: "derecha" | "centro";
  /** Botones extra en la barra (ej. "Dejar de compartir"). */
  acciones?: ReactNode;
  /** Borde de color (la mía va en rojo, como "al aire"). */
  borde?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ancho, setAncho] = useState(() => Math.min(anchoInicial, window.innerWidth - 24));
  const [pos, setPos] = useState(() => {
    const w = Math.min(anchoInicial, window.innerWidth - 24);
    return { x: posicion === "derecha" ? window.innerWidth - w - 24 : (window.innerWidth - w) / 2, y: 16 };
  });
  const [grande, setGrande] = useState(false);
  const [oculta, setOculta] = useState(false);
  const [pip, setPip] = useState(false);
  const puedePip = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    void v.play().catch(() => undefined);
  }, [stream, oculta]);

  // Si cambia el tamaño de la ventana del navegador, que no quede afuera.
  useEffect(() => {
    const f = () => {
      setAncho((w) => Math.min(w, window.innerWidth - 16));
      setPos((p) => ({ x: Math.max(8, Math.min(p.x, window.innerWidth - 120)), y: Math.max(8, Math.min(p.y, window.innerHeight - 60)) }));
    };
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  // Arrastrar desde la barra.
  const arrastrar = (e: React.PointerEvent) => {
    if (grande || (e.target as HTMLElement).closest("button")) return;
    const ini = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const mover = (ev: PointerEvent) =>
      setPos({
        x: Math.max(8 - ancho + 120, Math.min(window.innerWidth - 120, ini.px + ev.clientX - ini.x)),
        y: Math.max(8, Math.min(window.innerHeight - 60, ini.py + ev.clientY - ini.y)),
      });
    const soltar = () => {
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerup", soltar);
    };
    el.addEventListener("pointermove", mover);
    el.addEventListener("pointerup", soltar);
  };

  // Agrandar o achicar desde la esquina de abajo a la derecha.
  const redimensionar = (e: React.PointerEvent) => {
    e.preventDefault();
    const ini = { x: e.clientX, w: ancho };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const mover = (ev: PointerEvent) => setAncho(Math.max(MIN_ANCHO, Math.min(window.innerWidth - 16, ini.w + ev.clientX - ini.x)));
    const soltar = () => {
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerup", soltar);
    };
    el.addEventListener("pointermove", mover);
    el.addEventListener("pointerup", soltar);
  };

  const ventanaAparte = async () => {
    const v = video.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement === v) await document.exitPictureInPicture();
      else {
        await v.requestPictureInPicture();
        setPip(true);
        v.addEventListener("leavepictureinpicture", () => setPip(false), { once: true });
      }
    } catch {
      /* el navegador no lo permitió */
    }
  };

  if (oculta) {
    return (
      <button
        type="button"
        onClick={() => setOculta(false)}
        className={cn(
          "fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[101] flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-xl animate-in fade-in slide-in-from-top-2",
          borde ? "bg-red-600 text-white" : "bg-primary text-primary-foreground"
        )}
      >
        <MonitorUp className="h-4 w-4" /> {chip}
        {/* El video sigue cargado (oculto) para la ventana aparte. */}
        <video ref={video} autoPlay playsInline muted className="hidden" />
      </button>
    );
  }

  return (
    <div
      className={cn("fixed z-[101] flex flex-col overflow-hidden border-2 bg-black shadow-2xl animate-in fade-in zoom-in-95", grande ? "inset-0 rounded-none" : "rounded-2xl", borde ?? "border-white/10")}
      style={grande ? undefined : { left: pos.x, top: pos.y, width: ancho }}
    >
      <div
        onPointerDown={arrastrar}
        className={cn("flex touch-none select-none items-center gap-1.5 bg-black/85 px-3 py-1.5 text-white", !grande && "cursor-grab active:cursor-grabbing")}
      >
        <MonitorUp className={cn("h-4 w-4 shrink-0", borde ? "text-red-400" : "text-primary")} />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{titulo}</div>
        {acciones}
        {puedePip && (
          <button type="button" onClick={() => void ventanaAparte()} className="rounded-full p-1.5 hover:bg-white/15" title="Abrir en una ventana aparte" aria-label="Abrir en una ventana aparte">
            <PictureInPicture2 className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={() => setGrande((g) => !g)} className="rounded-full p-1.5 hover:bg-white/15" title={grande ? "Achicar" : "Pantalla completa"} aria-label={grande ? "Achicar" : "Pantalla completa"}>
          {grande ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => setOculta(true)} className="rounded-full p-1.5 hover:bg-white/15" title="Minimizar" aria-label="Minimizar">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <div className="relative">
        <video ref={video} autoPlay playsInline muted className={cn("w-full bg-black object-contain", grande ? "h-[calc(100dvh-2.5rem)]" : "aspect-video")} />
        {pip && <p className="absolute inset-0 flex items-center justify-center bg-black/80 text-xs text-white/80">Se ve en una ventana aparte</p>}
        {!grande && (
          <span
            onPointerDown={redimensionar}
            className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none"
            style={{ background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.55) 50%)" }}
            title="Arrastrá para agrandar o achicar"
          />
        )}
      </div>
    </div>
  );
}
