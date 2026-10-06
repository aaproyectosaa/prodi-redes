import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Flag, Loader2, MapPin, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DriveVideoPlayer } from "@/components/DriveVideoPlayer";
import { asset } from "@/lib/asset";
import { segundos } from "@/lib/redes/format";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";
import type { MarcaCorreccion, Video } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

/** Si no hay un video de verdad (vista previa en imagen), se usa una línea de tiempo de 30 s. */
const DURACION_SIN_VIDEO = 30;

type Fuente = { tipo: "drive" } | { tipo: "url"; url: string } | { tipo: "imagen"; url: string };

function fuenteDe(a: DriveAttachmentRef): Fuente {
  if (a.drive_file_id.startsWith("demo/")) return { tipo: "imagen", url: asset(a.drive_file_id) };
  if (a.drive_file_id.startsWith("blob:")) {
    const url = a.web_content_link ?? a.drive_file_id.slice(5);
    return a.mime_type?.startsWith("video/") ? { tipo: "url", url } : { tipo: "imagen", url: a.thumbnail_link ?? url };
  }
  if (!a.mime_type?.startsWith("video/")) return { tipo: "imagen", url: a.thumbnail_link ?? "" };
  return { tipo: "drive" };
}

/** El último video final subido (la versión que se está corrigiendo). */
export const versionActual = (v: Video): DriveAttachmentRef | null => {
  const f = v.attachments_finalizado ?? [];
  return [...f].reverse().find((a) => a.mime_type?.startsWith("video/")) ?? f[f.length - 1] ?? null;
};

/**
 * Video con línea de tiempo: muestra las marcas de corrección y permite saltar a cada una.
 * `irRef` expone "ir al segundo X" para la lista de correcciones.
 */
export function ReproductorMarcas({
  attachment,
  marcas,
  onTiempo,
  irRef,
  className,
}: {
  attachment: DriveAttachmentRef;
  marcas: MarcaCorreccion[];
  onTiempo?: (t: number) => void;
  irRef?: MutableRefObject<((t: number) => void) | null>;
  className?: string;
}) {
  const fuente = fuenteDe(attachment);
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(DURACION_SIN_VIDEO);
  const [reproduciendo, setReproduciendo] = useState(false);
  const linea = useRef<HTMLDivElement>(null);
  const sinVideo = fuente.tipo === "imagen";

  useEffect(() => {
    if (!el) return;
    const tiempo = () => setT(el.currentTime);
    const meta = () => {
      if (isFinite(el.duration) && el.duration > 0) setDur(el.duration);
    };
    const play = () => setReproduciendo(true);
    const pausa = () => setReproduciendo(false);
    meta();
    el.addEventListener("timeupdate", tiempo);
    el.addEventListener("seeked", tiempo);
    el.addEventListener("loadedmetadata", meta);
    el.addEventListener("play", play);
    el.addEventListener("pause", pausa);
    return () => {
      el.removeEventListener("timeupdate", tiempo);
      el.removeEventListener("seeked", tiempo);
      el.removeEventListener("loadedmetadata", meta);
      el.removeEventListener("play", play);
      el.removeEventListener("pause", pausa);
    };
  }, [el]);

  // Sin video real: "reproducir" avanza la barra para poder practicar el marcado.
  useEffect(() => {
    if (!sinVideo || !reproduciendo) return;
    const id = window.setInterval(() => {
      setT((x) => {
        if (x + 0.25 >= dur) {
          setReproduciendo(false);
          return dur;
        }
        return x + 0.25;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [sinVideo, reproduciendo, dur]);

  useEffect(() => onTiempo?.(t), [t, onTiempo]);

  const ir = (s: number) => {
    const x = Math.max(0, Math.min(dur, s));
    if (el) {
      el.currentTime = x;
      el.pause();
    }
    setReproduciendo(false);
    setT(x);
  };
  if (irRef) irRef.current = ir;

  const tocarLinea = (clientX: number) => {
    const r = linea.current?.getBoundingClientRect();
    if (!r) return;
    ir(((clientX - r.left) / r.width) * dur);
  };
  const pct = (x: number) => `${Math.min(100, Math.max(0, (x / dur) * 100))}%`;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex max-h-[42vh] items-center justify-center overflow-hidden rounded-xl bg-black">
        {fuente.tipo === "drive" ? (
          <DriveVideoPlayer fileId={attachment.drive_file_id} mimeType={attachment.mime_type} className="max-h-[42vh] w-full" onVideoEl={setEl} />
        ) : fuente.tipo === "url" ? (
          <video ref={setEl} src={fuente.url} controls playsInline preload="metadata" className="max-h-[42vh] w-full object-contain" />
        ) : (
          <img src={fuente.url} alt="" className="max-h-[42vh] object-contain" />
        )}
      </div>

      <div className="flex items-center gap-2">
        {sinVideo && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              if (t >= dur) setT(0);
              setReproduciendo((r) => !r);
            }}
            aria-label={reproduciendo ? "Pausa" : "Reproducir"}
          >
            {reproduciendo ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        )}
        <div
          ref={linea}
          role="slider"
          tabIndex={0}
          aria-label="Línea de tiempo"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(t)}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            tocarLinea(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && tocarLinea(e.clientX)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") ir(t + 1);
            if (e.key === "ArrowLeft") ir(t - 1);
          }}
          className="relative h-9 flex-1 cursor-pointer touch-none select-none"
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
          <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/60" style={{ width: pct(t) }} />
          {marcas.map((m, i) => (
            <button
              key={`${m.t}-${i}`}
              type="button"
              title={`${segundos(m.t)} · ${m.texto}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => ir(m.t)}
              className="absolute top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background bg-orange-500 text-[9px] font-bold text-white shadow transition-transform hover:scale-125"
              style={{ left: pct(m.t) }}
            >
              {i + 1}
            </button>
          ))}
          <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow" style={{ left: pct(t) }} />
        </div>
        <span className="shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums text-muted-foreground">
          {segundos(t)} / {segundos(dur)}
        </span>
      </div>
      {sinVideo && (
        <p className="text-[11px] text-muted-foreground">Vista previa sin video: mové la barra o tocá ▶ para elegir el segundo.</p>
      )}
    </div>
  );
}

/** Para edición: las correcciones en la línea de tiempo; tocando una salta a ese segundo. */
export function MarcasEdicion({ video, marcas }: { video: Video; marcas: MarcaCorreccion[] }) {
  const att = versionActual(video);
  const irRef = useRef<((t: number) => void) | null>(null);
  const [activa, setActiva] = useState<number | null>(null);
  const orden = useMemo(() => [...marcas].sort((a, b) => a.t - b.t), [marcas]);
  return (
    <div className="mt-3 space-y-3">
      {att && <ReproductorMarcas attachment={att} marcas={orden} irRef={irRef} />}
      <ol className="space-y-1.5">
        {orden.map((m, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => {
                setActiva(i);
                irRef.current?.(m.t);
              }}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border bg-background/70 p-2 text-left text-sm transition-colors hover:border-orange-500/60",
                activa === i && "border-orange-500 bg-orange-500/10"
              )}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">{i + 1}</span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums">{segundos(m.t)}</span>
              <span className="min-w-0 flex-1">{m.texto}</span>
              {m.de === "cliente" && <span className="shrink-0 text-[10px] text-muted-foreground">cliente</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface MarcaEditable extends MarcaCorreccion {
  id: string;
}

/**
 * Pedir cambios marcando el segundo exacto: se mira el video, se toca "Marcar acá"
 * y se escribe qué cambiar en ese momento. También se puede dejar una nota general.
 */
export function CorreccionesDialog({
  video,
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  confirmLabel,
  onConfirm,
}: {
  video: Video;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel: string;
  onConfirm: (nota: string, marcas: MarcaCorreccion[]) => Promise<void>;
}) {
  const att = versionActual(video);
  const [marcas, setMarcas] = useState<MarcaEditable[]>([]);
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const tiempo = useRef(0);
  const [, refrescar] = useState(0);
  const irRef = useRef<((t: number) => void) | null>(null);
  const onTiempo = useRef((t: number) => {
    tiempo.current = t;
    refrescar((n) => n + 1);
  }).current;

  useEffect(() => {
    if (!open) return;
    setMarcas([]);
    setNota("");
    setIntentado(false);
  }, [open]);

  const marcar = () => {
    const t = Math.round(tiempo.current);
    setMarcas((prev) => [...prev, { id: `m${Date.now()}`, t, texto: "" }].sort((a, b) => a.t - b.t));
  };
  const orden = marcas;

  const go = async () => {
    setIntentado(true);
    const vacias = marcas.some((m) => !m.texto.trim());
    if (vacias) {
      toast.error("Escribí qué cambiar en cada marca (o borrala)");
      return;
    }
    if (!marcas.length && !nota.trim()) {
      toast.error("Marcá un momento del video o escribí qué hay que cambiar");
      return;
    }
    setSaving(true);
    try {
      await onConfirm(nota.trim(), marcas.map(({ t, texto }) => ({ t, texto: texto.trim() })));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {att ? (
          <div className="space-y-3">
            <ReproductorMarcas attachment={att} marcas={orden} onTiempo={onTiempo} irRef={irRef} />
            <Button type="button" variant="secondary" className="w-full border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20" onClick={marcar}>
              <MapPin className="mr-2 h-4 w-4 text-orange-600" /> Marcar un cambio en {segundos(tiempo.current)}
            </Button>
            {orden.length > 0 && (
              <ol className="space-y-2">
                {orden.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <button
                      type="button"
                      onClick={() => irRef.current?.(m.t)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 font-mono text-xs tabular-nums hover:border-orange-500"
                      title="Ver ese momento"
                    >
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 font-sans text-[9px] font-bold text-white">{i + 1}</span>
                      {segundos(m.t)}
                    </button>
                    <Input
                      autoFocus={i === orden.length - 1}
                      value={m.texto}
                      onChange={(e) => setMarcas((prev) => prev.map((x) => (x.id === m.id ? { ...x, texto: e.target.value } : x)))}
                      placeholder="Qué cambiar acá"
                      maxLength={300}
                      className={cn("h-9", intentado && !m.texto.trim() && "border-destructive")}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setMarcas((prev) => prev.filter((x) => x.id !== m.id))}
                      aria-label="Borrar marca"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
            <Flag className="h-3.5 w-3.5" /> No hay video para marcar: escribí los cambios abajo.
          </p>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-medium">{att ? "Algo general (opcional)" : "Qué hay que cambiar"}</p>
          <Textarea
            rows={att ? 2 : 5}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder={placeholder ?? "Ej.: la música más tranqui en todo el video"}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void go()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
            {marcas.length > 0 && ` (${marcas.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
