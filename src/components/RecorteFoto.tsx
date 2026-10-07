import { useEffect, useRef, useState } from "react";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { abrirImagen, limitarEncuadre, recorteCuadrado, zonaRecorte, type Encuadre, type Fuente } from "@/lib/imagen";
import { cn } from "@/lib/utils";

const VISTA = 256;

/**
 * Elegiste una foto: la encuadrás (arrastrar + zoom) y sale un cuadrado chico en JPEG (data URL).
 * Sirve para la foto de perfil y la de los grupos.
 */
export function RecorteFoto({
  file,
  onListo,
  onCancelar,
  titulo = "Encuadrá la foto",
  lado = 256,
  maxChars = 60_000,
  redondo = true,
}: {
  file: File | null;
  onListo: (dataUrl: string) => void | Promise<void>;
  onCancelar: () => void;
  titulo?: string;
  lado?: number;
  maxChars?: number;
  redondo?: boolean;
}) {
  const [img, setImg] = useState<Fuente | null>(null);
  const [e, setE] = useState<Encuadre>({ zoom: 1, x: 0, y: 0 });
  const [guardando, setGuardando] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const arrastre = useRef<{ x: number; y: number; e: Encuadre } | null>(null);

  useEffect(() => {
    setImg(null);
    setE({ zoom: 1, x: 0, y: 0 });
    if (!file) return;
    let vivo = true;
    abrirImagen(file)
      .then((i) => vivo && setImg(i))
      .catch((err) => {
        if (!vivo) return;
        toast.error(err instanceof Error ? err.message : "No se pudo abrir la imagen");
        onCancelar();
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !img) return;
    const { sx, sy, lado: l } = zonaRecorte(img, e);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, VISTA, VISTA);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, l, l, 0, 0, VISTA, VISTA);
  }, [img, e]);

  const mover = (dx: number, dy: number) => {
    const a = arrastre.current;
    if (!a || !img) return;
    const ancho = canvas.current?.getBoundingClientRect().width || VISTA;
    setE(limitarEncuadre(img, { zoom: a.e.zoom, x: a.e.x - dx / ancho, y: a.e.y - dy / ancho }));
  };

  const zoom = (z: number) => img && setE((p) => limitarEncuadre(img, { ...p, zoom: Math.min(4, Math.max(1, z)) }));

  const listo = async () => {
    if (!img) return;
    setGuardando(true);
    try {
      await onListo(recorteCuadrado(img, e, lado, maxChars));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la foto");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && !guardando && onCancelar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>Arrastrá para mover y usá el zoom para acercar.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div className="relative aspect-square w-64 max-w-full">
            {!img && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-muted">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            <canvas
              ref={canvas}
              width={VISTA}
              height={VISTA}
              className={cn(
                "h-full w-full touch-none select-none bg-muted",
                redondo ? "rounded-full" : "rounded-xl",
                img ? "cursor-grab active:cursor-grabbing" : "invisible"
              )}
              onPointerDown={(ev) => {
                (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
                arrastre.current = { x: ev.clientX, y: ev.clientY, e };
              }}
              onPointerMove={(ev) => arrastre.current && mover(ev.clientX - arrastre.current.x, ev.clientY - arrastre.current.y)}
              onPointerUp={() => (arrastre.current = null)}
              onPointerCancel={() => (arrastre.current = null)}
              onWheel={(ev) => zoom(e.zoom * (ev.deltaY < 0 ? 1.1 : 0.9))}
            />
          </div>
          <div className="flex w-full items-center gap-3">
            <ZoomOut className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Slider
              value={[e.zoom]}
              min={1}
              max={4}
              step={0.01}
              onValueChange={([z]) => zoom(z)}
              disabled={!img}
              aria-label="Zoom"
            />
            <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void listo()} disabled={!img || guardando}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Usar foto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
