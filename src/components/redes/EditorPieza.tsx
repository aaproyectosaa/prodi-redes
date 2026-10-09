import { useEffect, useRef, useState, type PointerEvent as PE } from "react";
import {
  Contrast,
  Download,
  Hand,
  ImageIcon,
  Loader2,
  Maximize,
  Minus,
  Plus,
  RectangleVertical,
  Scaling,
  Sparkles,
  Square,
  SquareDashedMousePointer,
  Type,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import { cn } from "@/lib/utils";
import { driveThumb } from "@/components/redes/PiezaDialogs";

type Version = { id: string; drive_file_id: string; name: string; mime_type?: string | null };
type Zona = { x: number; y: number; w: number; h: number };
type Herramienta = "mover" | "zona";

/** Retoques de un toque (Opus arma la instrucción mirando la imagen y la marca; Gemini edita). */
const RETOQUES: { label: string; icono: React.ElementType; pedido: string; formato?: string; conZona?: boolean }[] = [
  { label: "Más luz y contraste", icono: Contrast, pedido: "Más luminosa y con más contraste, colores más vivos sin cambiar la paleta de la marca", conZona: true },
  { label: "Otro fondo", icono: ImageIcon, pedido: "Cambiá el fondo por otro más limpio y atractivo, acorde a la marca" },
  { label: "Texto más grande", icono: Type, pedido: "Hacé el texto principal más grande y legible en el celular" },
  { label: "Más simple", icono: Wand2, pedido: "Simplificá: menos elementos, más aire, un solo mensaje claro" },
  { label: "Pasar a historia", icono: RectangleVertical, pedido: "Adaptala a formato historia vertical", formato: "vertical" },
  { label: "Pasar a cuadrado", icono: Square, pedido: "Adaptala a formato posteo cuadrado", formato: "cuadrado" },
];

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;

/** La imagen con la zona pintada en rojo (JPEG base64, máx. 1280 px), para que la IA vea dónde cambiar. */
async function imagenMarcada(url: string, z: Zona): Promise<string | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const [x, y, w, h] = [z.x * c.width, z.y * c.height, z.w * c.width, z.h * c.height];
    ctx.fillStyle = "rgba(255,0,0,0.22)";
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = Math.max(4, c.width / 200);
    ctx.strokeStyle = "#ff0000";
    ctx.strokeRect(x, y, w, h);
    return c.toDataURL("image/jpeg", 0.85).split(",")[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Editor de una versión de la pieza, a pantalla completa: zoom y mover, marcar una zona y pedirle cambios a la
 * IA (todo o solo esa zona). Cada edición queda como versión nueva; la que se está viendo no se toca.
 */
export function EditorPieza({ v, titulo, piezaId, onClose }: { v: Version | null; titulo: string; piezaId: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [herramienta, setHerramienta] = useState<Herramienta>("mover");
  const [zona, setZona] = useState<Zona | null>(null);
  const [pedido, setPedido] = useState("");
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const arrastre = useRef<{ tipo: "mover" | "zona"; x0: number; y0: number; px: number; py: number } | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setZona(null);
    setHerramienta("mover");
    if (!v) return;
    // Piezas de ejemplo o recién subidas: no están en Drive.
    if (/^(demo\/|data:|blob:)/.test(v.drive_file_id)) {
      setUrl(driveThumb(v.drive_file_id, 2000));
      return;
    }
    let vivo = true;
    getDriveMediaPlayUrl(v.drive_file_id)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [v]);

  const acercar = (f: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * f * 100) / 100)));
  const ajustar = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  /** Punto del puntero en fracciones de la imagen (0 a 1). */
  const enImagen = (e: { clientX: number; clientY: number }) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const bajar = (e: PE<HTMLDivElement>) => {
    if (trabajando || !url) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (herramienta === "zona") {
      const p = enImagen(e);
      arrastre.current = { tipo: "zona", x0: p.x, y0: p.y, px: 0, py: 0 };
      setZona({ x: p.x, y: p.y, w: 0, h: 0 });
    } else arrastre.current = { tipo: "mover", x0: e.clientX, y0: e.clientY, px: pan.x, py: pan.y };
  };
  const mover = (e: PE<HTMLDivElement>) => {
    const a = arrastre.current;
    if (!a) return;
    if (a.tipo === "zona") {
      const p = enImagen(e);
      setZona({ x: Math.min(a.x0, p.x), y: Math.min(a.y0, p.y), w: Math.abs(p.x - a.x0), h: Math.abs(p.y - a.y0) });
    } else setPan({ x: a.px + (e.clientX - a.x0), y: a.py + (e.clientY - a.y0) });
  };
  const soltar = () => {
    if (arrastre.current?.tipo === "zona") {
      setZona((z) => (z && z.w > 0.02 && z.h > 0.02 ? z : null));
      setHerramienta("mover");
    }
    arrastre.current = null;
  };

  const editar = async (instruccion: string, formato?: string, etiqueta = "Aplicando tu pedido") => {
    if (!v || instruccion.trim().length < 3 || trabajando) return;
    setTrabajando(etiqueta);
    try {
      const marcada = zona && url ? await imagenMarcada(url, zona) : null;
      await callApi("/api/ia/pieza-editar", { pieza_id: piezaId, version_id: v.id, instruccion, formato: formato ?? null, zona, marcada });
      toast.success("¡Listo! Quedó como versión nueva");
      setPedido("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo editar");
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <Dialog open={!!v} onOpenChange={(o) => !o && !trabajando && onClose()}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">{titulo}</DialogTitle>
        <DialogDescription className="sr-only">Editor de la pieza con IA</DialogDescription>
        {/* Barra de arriba */}
        <div className="flex items-center gap-3 border-b bg-background px-4 py-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{titulo}</p>
            <p className="truncate text-[11px] text-muted-foreground">{v?.name}</p>
          </div>
          <Button variant="outline" size="sm" asChild disabled={!url}>
            <a href={url ?? "#"} download={v?.name ?? "pieza"} target="_blank" rel="noreferrer">
              <Download className="mr-1.5 h-4 w-4" /> Descargar
            </a>
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={!!trabajando} aria-label="Cerrar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Lienzo */}
          <div className="relative min-h-[45vh] flex-1 overflow-hidden bg-[#0f0f12]">
            <div
              className={cn("absolute inset-0 flex touch-none select-none items-center justify-center", herramienta === "zona" ? "cursor-crosshair" : zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
              onPointerDown={bajar}
              onPointerMove={mover}
              onPointerUp={soltar}
              onPointerCancel={soltar}
              onWheel={(e) => acercar(e.deltaY < 0 ? 1.12 : 1 / 1.12)}
              onDoubleClick={() => (zoom === 1 ? acercar(2) : ajustar())}
            >
              {error ? (
                <p className="text-sm text-white/70">No se pudo abrir la imagen.</p>
              ) : !url ? (
                <Loader2 className="h-7 w-7 animate-spin text-white/60" />
              ) : (
                <div className="relative" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: arrastre.current ? "none" : "transform 120ms ease-out" }}>
                  <img ref={imgRef} src={url} alt={v?.name} draggable={false} className="block max-h-[calc(100dvh-9rem)] max-w-[min(100vw,calc(100vw-24rem))] object-contain shadow-2xl" />
                  {zona && (
                    <div
                      className="pointer-events-none absolute rounded-sm border-2 border-[#ff3b6b] bg-[#ff3b6b]/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                      style={{ left: `${zona.x * 100}%`, top: `${zona.y * 100}%`, width: `${zona.w * 100}%`, height: `${zona.h * 100}%` }}
                    />
                  )}
                  {trabajando && (
                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#6F40FC]/25 to-[#E040A0]/25" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Herramientas flotantes */}
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/70 p-1 text-white shadow-xl backdrop-blur">
              <BotonLienzo activo={herramienta === "mover"} onClick={() => setHerramienta("mover")} titulo="Mover">
                <Hand className="h-4 w-4" />
              </BotonLienzo>
              <BotonLienzo activo={herramienta === "zona"} onClick={() => setHerramienta("zona")} titulo="Marcar una zona">
                <SquareDashedMousePointer className="h-4 w-4" />
              </BotonLienzo>
              <span className="mx-1 h-5 w-px bg-white/20" />
              <BotonLienzo onClick={() => acercar(1 / 1.25)} titulo="Alejar">
                <Minus className="h-4 w-4" />
              </BotonLienzo>
              <button type="button" onClick={ajustar} className="w-14 text-center text-xs tabular-nums hover:text-white/80" title="Ajustar a la pantalla">
                {Math.round(zoom * 100)}%
              </button>
              <BotonLienzo onClick={() => acercar(1.25)} titulo="Acercar">
                <Plus className="h-4 w-4" />
              </BotonLienzo>
              <BotonLienzo onClick={ajustar} titulo="Ajustar">
                <Maximize className="h-4 w-4" />
              </BotonLienzo>
            </div>
            {herramienta === "zona" && !zona && (
              <p className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
                Arrastrá sobre la imagen para marcar lo que querés cambiar
              </p>
            )}
          </div>

          {/* Panel de IA */}
          <aside className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto border-t bg-background p-4 md:w-96 md:border-l md:border-t-0">
            <div>
              <p className="flex items-center gap-2 font-semibold">
                <Sparkles className="h-4 w-4 text-primary" /> Editar con IA
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Cada cambio queda como versión nueva. Esta no se toca.</p>
            </div>

            <div className={cn("rounded-xl border p-3 transition-colors", zona ? "border-[#ff3b6b]/50 bg-[#ff3b6b]/[0.06]" : "border-dashed")}>
              {zona ? (
                <div className="flex items-center gap-2">
                  <SquareDashedMousePointer className="h-4 w-4 shrink-0 text-[#ff3b6b]" />
                  <p className="flex-1 text-sm">
                    <b>Zona marcada.</b> <span className="text-muted-foreground">Lo que pidas se cambia solo ahí.</span>
                  </p>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setZona(null)}>
                    Quitar
                  </Button>
                </div>
              ) : (
                <button type="button" onClick={() => setHerramienta("zona")} className="flex w-full items-center gap-2 text-left text-sm">
                  <SquareDashedMousePointer className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <b>¿Solo una parte?</b> <span className="text-muted-foreground">Marcá la zona en la imagen y la IA cambia solo eso.</span>
                  </span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Retoques rápidos</p>
              <div className="grid grid-cols-2 gap-2">
                {RETOQUES.filter((r) => !zona || r.conZona || !r.formato).map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    disabled={!!trabajando || !url}
                    onClick={() => void editar(r.pedido, zona ? undefined : r.formato, r.label)}
                    className="group flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-left text-xs font-medium transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-110">
                      <r.icono className="h-3.5 w-3.5" />
                    </span>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{zona ? "¿Qué cambio en la zona?" : "Pedí lo que quieras"}</p>
              <Textarea
                value={pedido}
                onChange={(e) => setPedido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void editar(pedido);
                  }
                }}
                rows={4}
                disabled={!!trabajando}
                placeholder={zona ? "Ej: sacá esto, poné una planta, cambiá el color a verde…" : "Ej: poné el logo más chico, fondo más cálido, sacá la chica de la izquierda…"}
                className="resize-none text-sm"
              />
              <Button className="h-10 w-full bg-gradient-to-r from-[#6F40FC] to-[#E040A0] text-white hover:opacity-90" onClick={() => void editar(pedido)} disabled={!!trabajando || pedido.trim().length < 3}>
                {trabajando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {trabajando ? "Editando…" : zona ? "Cambiar la zona" : "Aplicar"}
              </Button>
            </div>

            {trabajando && (
              <div className="rounded-xl border bg-primary/[0.05] p-3 text-xs">
                <p className="flex items-center gap-2 font-medium">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> {trabajando}…
                </p>
                <p className="mt-1 text-muted-foreground">Opus arma la instrucción y Gemini edita la imagen. Tarda unos 30 segundos.</p>
              </div>
            )}

            <p className="mt-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Scaling className="h-3.5 w-3.5" /> Rueda del mouse para acercar · doble clic para zoom · arrastrá para mover
            </p>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BotonLienzo({ children, onClick, activo, titulo }: { children: React.ReactNode; onClick: () => void; activo?: boolean; titulo: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={cn("flex h-8 w-8 items-center justify-center rounded-full transition-colors", activo ? "bg-white text-black" : "hover:bg-white/15")}
    >
      {children}
    </button>
  );
}
