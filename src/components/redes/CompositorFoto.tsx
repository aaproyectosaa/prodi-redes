import { useEffect, useRef, useState, type PointerEvent as PE } from "react";
import { Loader2, Minus, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import { driveThumb } from "@/components/redes/PiezaDialogs";
import { cn } from "@/lib/utils";

type Archivo = { drive_file_id: string; name: string };
type Caja = { x: number; y: number; w: number; h: number };

/** Carga un archivo de Drive como imagen local (blob), así el canvas se puede exportar. */
async function cargarImagen(fileId: string): Promise<HTMLImageElement> {
  const url = /^(demo\/|data:|blob:)/.test(fileId) ? driveThumb(fileId, 2000) : await getDriveMediaPlayUrl(fileId);
  const blob = await (await fetch(url)).blob();
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

/** ¿Es el magenta del hueco? (con margen para los bordes suavizados). */
const esMagenta = (r: number, g: number, b: number) => r > 170 && b > 170 && g < 110 && Math.abs(r - b) < 90;

/**
 * El diseño de la IA trae un hueco magenta: el diseño queda transparente ahí y debajo se pone la foto original,
 * píxel por píxel (las caras no las toca la IA). Devuelve el diseño "agujereado" y la caja del hueco.
 */
function prepararDiseno(img: HTMLImageElement): { capa: HTMLCanvasElement; caja: Caja | null } {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const datos = ctx.getImageData(0, 0, c.width, c.height);
  const p = datos.data;
  let [x0, y0, x1, y1, n] = [c.width, c.height, -1, -1, 0];
  for (let i = 0; i < p.length; i += 4) {
    if (!esMagenta(p[i], p[i + 1], p[i + 2])) continue;
    p[i + 3] = 0;
    const k = i / 4;
    const x = k % c.width;
    const y = (k - x) / c.width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    n++;
  }
  ctx.putImageData(datos, 0, 0);
  // Muy poco magenta: no hay hueco (la IA no lo dejó).
  if (n < c.width * c.height * 0.02) return { capa: c, caja: null };
  return { capa: c, caja: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

/**
 * Pega la foto original en el hueco que dejó la IA. Se acomoda arrastrando y con el zoom, y se guarda como
 * versión nueva (la de la IA no se toca).
 */
export function CompositorFoto({
  diseno,
  fotos,
  onGuardar,
  onClose,
}: {
  diseno: Archivo | null;
  fotos: Archivo[];
  onGuardar: (archivo: File) => Promise<void>;
  onClose: () => void;
}) {
  const [capa, setCapa] = useState<{ capa: HTMLCanvasElement; caja: Caja | null } | null>(null);
  const [fotoId, setFotoId] = useState<string | null>(fotos[0]?.drive_file_id ?? null);
  const [foto, setFoto] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const arrastre = useRef<{ x0: number; y0: number; px: number; py: number; k: number } | null>(null);

  useEffect(() => {
    setCapa(null);
    setError(null);
    if (!diseno) return;
    let vivo = true;
    cargarImagen(diseno.drive_file_id)
      .then((img) => vivo && setCapa(prepararDiseno(img)))
      .catch(() => vivo && setError("No se pudo abrir el diseño."));
    return () => {
      vivo = false;
    };
  }, [diseno]);

  // Las fotos pueden llegar después (o cambiar): si la elegida ya no está, va la primera.
  useEffect(() => {
    if (!fotos.some((f) => f.drive_file_id === fotoId)) setFotoId(fotos[0]?.drive_file_id ?? null);
  }, [fotos, fotoId]);

  useEffect(() => {
    setFoto(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    if (!fotoId) return;
    let vivo = true;
    cargarImagen(fotoId)
      .then((img) => vivo && setFoto(img))
      .catch(() => vivo && setError("No se pudo abrir la foto."));
    return () => {
      vivo = false;
    };
  }, [fotoId]);

  const caja = capa ? (capa.caja ?? { x: capa.capa.width * 0.15, y: capa.capa.height * 0.15, w: capa.capa.width * 0.7, h: capa.capa.height * 0.55 }) : null;

  // Dibuja: la foto (cubriendo el hueco, con zoom y movida) y el diseño agujereado encima.
  useEffect(() => {
    const c = lienzo.current;
    if (!c || !capa || !caja) return;
    c.width = capa.capa.width;
    c.height = capa.capa.height;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (foto) {
      const k = Math.max(caja.w / foto.naturalWidth, caja.h / foto.naturalHeight) * zoom;
      const [w, h] = [foto.naturalWidth * k, foto.naturalHeight * k];
      ctx.save();
      // Un poco más grande que el hueco, para cubrir los bordes suavizados.
      ctx.beginPath();
      ctx.rect(caja.x - 3, caja.y - 3, caja.w + 6, caja.h + 6);
      ctx.clip();
      ctx.drawImage(foto, caja.x + (caja.w - w) / 2 + pan.x, caja.y + (caja.h - h) / 2 + pan.y, w, h);
      ctx.restore();
    }
    ctx.drawImage(capa.capa, 0, 0);
  }, [capa, caja, foto, zoom, pan]);

  const bajar = (e: PE<HTMLCanvasElement>) => {
    const c = lienzo.current;
    if (!c) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Píxeles de pantalla → píxeles del diseño.
    arrastre.current = { x0: e.clientX, y0: e.clientY, px: pan.x, py: pan.y, k: c.width / c.getBoundingClientRect().width };
  };
  const mover = (e: PE<HTMLCanvasElement>) => {
    const a = arrastre.current;
    if (a) setPan({ x: a.px + (e.clientX - a.x0) * a.k, y: a.py + (e.clientY - a.y0) * a.k });
  };
  const acercar = (f: number) => setZoom((z) => Math.min(4, Math.max(1, Math.round(z * f * 100) / 100)));

  const guardar = async () => {
    const c = lienzo.current;
    if (!c || !foto) return;
    setGuardando(true);
    try {
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) throw new Error("No se pudo armar la imagen");
      await onGuardar(new File([blob], `pieza-foto-original-${Date.now()}.png`, { type: "image/png" }));
      toast.success("Listo: quedó como versión nueva, con la foto original");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={!!diseno} onOpenChange={(o) => !o && !guardando && onClose()}>
      <DialogContent className="flex h-[94dvh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl p-0 [&>button]:hidden">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">Pegar la foto original</DialogTitle>
            <DialogDescription className="text-xs">Arrastrá la foto para acomodarla en el hueco. Las caras quedan exactas: es la foto real.</DialogDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={guardando}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:24px_24px] p-3">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !capa ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <canvas
              ref={lienzo}
              onPointerDown={bajar}
              onPointerMove={mover}
              onPointerUp={() => (arrastre.current = null)}
              onWheel={(e) => acercar(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
              className="max-h-full max-w-full cursor-grab touch-none rounded-lg shadow-xl active:cursor-grabbing"
            />
          )}
        </div>
        <div className="space-y-2 border-t p-3">
          {capa && !capa.caja && <p className="text-xs text-amber-600">La IA no dejó el hueco esta vez: la foto va en el centro. Si queda mal, generá otra versión.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5 overflow-x-auto">
              {fotos.map((f) => (
                <button
                  key={f.drive_file_id}
                  type="button"
                  onClick={() => setFotoId(f.drive_file_id)}
                  className={cn("h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2", fotoId === f.drive_file_id ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}
                >
                  <img src={driveThumb(f.drive_file_id, 200)} alt={f.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => acercar(1 / 1.15)}>
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => acercar(1.15)}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button className="ml-2" onClick={() => void guardar()} disabled={!foto || guardando}>
                {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Guardar como versión
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
