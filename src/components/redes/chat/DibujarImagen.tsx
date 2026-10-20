import { useEffect, useRef, useState } from "react";
import { Check, Eraser, Highlighter, Pencil, Undo2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Dibujar arriba de una foto antes de mandarla al chat (marcar algo en una captura, señalar un detalle).
// Lápiz o resaltador, colores, grosor, deshacer y borrar. Al guardar devuelve la foto con lo dibujado (PNG o JPEG).

const COLORES = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#111111"];
const GROSORES = [{ v: 0.004, label: "Fino" }, { v: 0.008, label: "Medio" }, { v: 0.016, label: "Grueso" }];

type Trazo = { color: string; ancho: number; resaltador: boolean; puntos: [number, number][] };

export function DibujarImagen({
  file,
  open,
  onOpenChange,
  onListo,
}: {
  file: File | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** La foto con el dibujo (mismo nombre). */
  onListo: (f: File) => void;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [trazos, setTrazos] = useState<Trazo[]>([]);
  const actual = useRef<Trazo | null>(null);
  const [color, setColor] = useState(COLORES[0]);
  const [grosor, setGrosor] = useState(GROSORES[1].v);
  const [resaltador, setResaltador] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Cargar la foto.
  useEffect(() => {
    if (!open || !file) return;
    setTrazos([]);
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [open, file]);

  const dibujar = (lista: Trazo[]) => {
    const c = lienzo.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const base = Math.max(c.width, c.height);
    for (const t of lista) {
      if (!t.puntos.length) continue;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.ancho * base * (t.resaltador ? 3 : 1);
      ctx.lineCap = t.resaltador ? "butt" : "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = t.resaltador ? 0.35 : 1;
      ctx.beginPath();
      ctx.moveTo(t.puntos[0][0] * c.width, t.puntos[0][1] * c.height);
      if (t.puntos.length === 1) ctx.lineTo(t.puntos[0][0] * c.width + 0.1, t.puntos[0][1] * c.height);
      for (const [x, y] of t.puntos.slice(1)) ctx.lineTo(x * c.width, y * c.height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // El lienzo con el tamaño real de la foto (hasta 2560 px), así no pierde calidad.
  useEffect(() => {
    const c = lienzo.current;
    if (!c || !img) return;
    const escala = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.round(img.naturalWidth * escala);
    c.height = Math.round(img.naturalHeight * escala);
    dibujar([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  useEffect(() => {
    dibujar(actual.current ? [...trazos, actual.current] : trazos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trazos]);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const empezar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    actual.current = { color, ancho: grosor, resaltador, puntos: [punto(e)] };
    dibujar([...trazos, actual.current]);
  };
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!actual.current) return;
    actual.current.puntos.push(punto(e));
    dibujar([...trazos, actual.current]);
  };
  const terminar = () => {
    if (!actual.current) return;
    const t = actual.current;
    actual.current = null;
    setTrazos((prev) => [...prev, t]);
  };

  const guardar = () => {
    const c = lienzo.current;
    if (!c || !file) return;
    setGuardando(true);
    const png = file.type === "image/png";
    c.toBlob(
      (b) => {
        setGuardando(false);
        if (!b) return;
        const nombre = file.name.replace(/\.[a-z0-9]+$/i, "") + (png ? ".png" : ".jpg");
        onListo(new File([b], nombre, { type: png ? "image/png" : "image/jpeg" }));
        onOpenChange(false);
      },
      png ? "image/png" : "image/jpeg",
      0.9
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl p-0 [&>button.absolute]:hidden">
        <DialogTitle className="sr-only">Dibujar sobre la foto</DialogTitle>
        {/* Herramientas */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
          <div className="flex rounded-full bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setResaltador(false)}
              className={cn("flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium", !resaltador ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              <Pencil className="h-3.5 w-3.5" /> Lápiz
            </button>
            <button
              type="button"
              onClick={() => setResaltador(true)}
              className={cn("flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium", resaltador ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              <Highlighter className="h-3.5 w-3.5" /> Resaltar
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {COLORES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn("h-7 w-7 rounded-full border-2 transition-transform", color === c ? "scale-110 border-primary" : "border-border")}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <div className="flex rounded-full bg-muted p-0.5">
            {GROSORES.map((g) => (
              <button
                key={g.v}
                type="button"
                onClick={() => setGrosor(g.v)}
                className={cn("flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs", grosor === g.v ? "bg-background shadow-sm" : "text-muted-foreground")}
                title={g.label}
              >
                <span className="rounded-full bg-current" style={{ width: 4 + g.v * 900, height: 4 + g.v * 900 }} />
                <span className="hidden sm:inline">{g.label}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setTrazos((t) => t.slice(0, -1))} disabled={!trazos.length} title="Deshacer">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTrazos([])} disabled={!trazos.length} title="Borrar todo">
              <Eraser className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* La foto: se dibuja con el mouse o el dedo. */}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-3">
          {!img ? (
            <p className="text-sm text-white/70">Cargando la foto…</p>
          ) : (
            <canvas
              ref={lienzo}
              onPointerDown={empezar}
              onPointerMove={mover}
              onPointerUp={terminar}
              onPointerCancel={terminar}
              className="max-h-full max-w-full cursor-crosshair touch-none rounded-lg shadow-2xl"
              style={{ aspectRatio: `${img.naturalWidth} / ${img.naturalHeight}` }}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-card px-3 py-2.5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="mr-1.5 h-4 w-4" /> Cancelar
          </Button>
          <Button onClick={guardar} disabled={!img || guardando} className="rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-5 font-semibold">
            <Check className="mr-1.5 h-4 w-4" /> Listo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
