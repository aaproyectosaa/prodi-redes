import { useEffect, useRef, useState, type TouchEvent } from "react";
import { asset } from "@/lib/asset";
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Play,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { DriveVideoPlayer } from "@/components/DriveVideoPlayer";
import { cn } from "@/lib/utils";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";

function isImage(mime: string) {
  return mime.startsWith("image/");
}
function isVideo(mime: string) {
  return mime.startsWith("video/");
}
function thumbUrl(fileId: string, size = 1200) {
  if (fileId.startsWith("demo/")) return asset(fileId); // datos de ejemplo
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

function preloadThumb(fileId: string, size: number) {
  if (typeof window === "undefined") return;
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.src = thumbUrl(fileId, size);
}

/** Carrusel del panel cliente: diseño original + video como en mis tareas. */
export function ClientMediaCarousel({
  attachments,
  driveAvailable,
}: {
  attachments: DriveAttachmentRef[];
  driveAvailable: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [hiResReady, setHiResReady] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setIndex(0);
    setLightboxOpen(false);
  }, [attachments]);

  useEffect(() => {
    if (!driveAvailable || attachments.length === 0) return;
    attachments.forEach((file) => {
      if (isImage(file.mime_type) || isVideo(file.mime_type)) {
        preloadThumb(file.drive_file_id, 240);
      }
    });
  }, [attachments, driveAvailable]);

  useEffect(() => {
    if (!driveAvailable) return;
    const current = attachments[index];
    if (!current || !isImage(current.mime_type)) return;
    preloadThumb(current.drive_file_id, 1200);
    const prev = attachments[index - 1];
    const next = attachments[index + 1];
    if (prev && isImage(prev.mime_type)) preloadThumb(prev.drive_file_id, 1200);
    if (next && isImage(next.mime_type)) preloadThumb(next.drive_file_id, 1200);
  }, [attachments, driveAvailable, index]);

  useEffect(() => {
    if (!lightboxOpen) return;
    setHiResReady(false);
    const current = attachments[index];
    if (!current || !isImage(current.mime_type)) return;
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => setHiResReady(true);
    img.src = thumbUrl(current.drive_file_id, 1600);
    for (const file of [attachments[index - 1], attachments[index + 1]]) {
      if (file && isImage(file.mime_type)) preloadThumb(file.drive_file_id, 1600);
    }
  }, [lightboxOpen, index, attachments]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIndex((v) => Math.max(0, v - 1));
      else if (e.key === "ArrowRight")
        setIndex((v) => Math.min(attachments.length - 1, v + 1));
      else if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, attachments.length]);

  if (attachments.length === 0) {
    return (
      <div className="aspect-video rounded-2xl border border-dashed border-border bg-secondary/25 flex flex-col items-center justify-center gap-2 text-muted-foreground px-4 text-center">
        <ImageIcon className="w-8 h-8 opacity-40" />
        <p className="text-sm font-medium text-foreground/80">Sin vista previa</p>
        <p className="text-xs max-w-xs">
          El equipo todavía no subió el material final. Podés revisar el texto abajo.
        </p>
      </div>
    );
  }

  if (!driveAvailable) {
    return (
      <div className="aspect-video rounded-2xl border border-border bg-secondary/25 flex flex-col items-center justify-center gap-3 text-muted-foreground px-4 text-center">
        <ImageIcon className="w-8 h-8 opacity-40" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/80">
            Material no disponible por ahora
          </p>
          <p className="text-xs max-w-xs">
            Cuando esté listo, lo vas a poder ver acá mismo.
          </p>
        </div>
      </div>
    );
  }

  const safeIndex = Math.min(index, attachments.length - 1);
  const current = attachments[safeIndex];
  const goPrev = () => setIndex((v) => Math.max(0, v - 1));
  const goNext = () => setIndex((v) => Math.min(attachments.length - 1, v + 1));

  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const delta = end - start;
    if (Math.abs(delta) < 48) return;
    if (delta > 0) goPrev();
    else goNext();
  };

  const openLightbox = () => {
    setLightboxOpen(true);
  };

  return (
    <div className="space-y-2.5">
      {/* Escena principal — diseño original del cliente */}
      <div
        className={cn(
          "relative rounded-2xl border border-border bg-card group",
          isImage(current.mime_type) && "overflow-hidden"
        )}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {isImage(current.mime_type) ? (
          <button
            type="button"
            className="relative block w-full aspect-video cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={openLightbox}
            aria-label="Ver imagen más grande"
          >
            {/* object-contain: imagen completa, sin crop/zoom */}
            <img
              src={thumbUrl(current.drive_file_id, 1200)}
              alt={current.name}
              referrerPolicy="no-referrer"
              decoding="async"
              className="absolute inset-0 m-auto max-w-full max-h-full w-auto h-auto object-contain"
            />
            <span className="absolute bottom-2 right-2 rounded-full bg-black/55 text-white text-[11px] font-medium px-2.5 py-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity pointer-events-none">
              Ampliar
            </span>
          </button>
        ) : isVideo(current.mime_type) ? (
          <button
            type="button"
            className="relative block w-full aspect-video cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={openLightbox}
            aria-label="Reproducir video"
          >
            <img
              src={thumbUrl(current.drive_file_id, 1200)}
              alt={current.name}
              referrerPolicy="no-referrer"
              decoding="async"
              className="absolute inset-0 m-auto max-w-full max-h-full w-auto h-auto object-contain bg-black/40"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/25">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-black shadow-lg">
                <Play className="h-7 w-7 fill-current ml-0.5" />
              </span>
            </span>
            <span className="absolute bottom-2 right-2 rounded-full bg-black/55 text-white text-[11px] font-medium px-2.5 py-1">
              Ver video
            </span>
          </button>
        ) : (
          <div className="aspect-video flex flex-col items-center justify-center text-muted-foreground p-4 space-y-2">
            <VideoIcon className="w-8 h-8 opacity-50" />
            <p className="text-sm font-medium text-foreground/80">{current.name}</p>
            <p className="text-xs max-w-xs text-center">
              Este tipo de archivo no se puede previsualizar acá.
            </p>
          </div>
        )}
      </div>

      {attachments.length > 1 && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            disabled={safeIndex <= 0}
            onClick={goPrev}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 flex gap-2 overflow-x-auto py-0.5 px-0.5 scrollbar-none snap-x">
            {attachments.map((file, i) => (
              <button
                key={file.drive_file_id}
                type="button"
                onClick={() => setIndex(i)}
                className={cn(
                  "relative h-14 w-14 shrink-0 rounded-xl overflow-hidden border-2 transition-all snap-start",
                  i === safeIndex
                    ? "border-primary scale-[1.03] shadow-md shadow-primary/20"
                    : "border-transparent opacity-65 hover:opacity-100"
                )}
                title={file.name}
              >
                {isImage(file.mime_type) || isVideo(file.mime_type) ? (
                  <img
                    src={thumbUrl(file.drive_file_id, 240)}
                    alt=""
                    referrerPolicy="no-referrer"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-secondary text-[10px] text-muted-foreground">
                    Archivo
                  </span>
                )}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            disabled={safeIndex >= attachments.length - 1}
            onClick={goNext}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      <Dialog
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
      >
        <DialogContent
          className={cn(
            "max-w-[100vw] w-full h-[100dvh] max-h-[100dvh] p-0 border-0 rounded-none",
            "bg-black translate-y-0 top-0 left-0 translate-x-0 sm:rounded-none",
            "flex flex-col gap-0 overflow-hidden [&>button]:hidden"
          )}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">
            Vista ampliada · {current.name}
          </DialogTitle>

          <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
            <span className="pointer-events-auto rounded-full bg-white/10 backdrop-blur-md text-white text-xs font-medium tabular-nums px-3 py-1.5 border border-white/10">
              {attachments.length > 1
                ? `${safeIndex + 1} / ${attachments.length}`
                : "Vista ampliada"}
            </span>
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="pointer-events-auto h-10 w-10 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="relative flex-1 min-h-0 flex items-center justify-center touch-pan-y px-12 sm:px-16">
            {attachments.length > 1 && (
              <button
                type="button"
                onClick={goPrev}
                disabled={safeIndex <= 0}
                className="absolute left-2 sm:left-4 z-10 h-11 w-11 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white flex items-center justify-center hover:bg-white/20 disabled:opacity-25 disabled:pointer-events-none"
                aria-label="Anterior"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {isImage(current.mime_type) ? (
              <div className="relative max-w-full max-h-[calc(100dvh-9rem)]">
                <img
                  src={thumbUrl(current.drive_file_id, 800)}
                  alt=""
                  referrerPolicy="no-referrer"
                  className={cn(
                    "max-w-full max-h-[calc(100dvh-9rem)] w-auto h-auto object-contain transition-opacity",
                    hiResReady ? "opacity-0 absolute inset-0 m-auto" : "opacity-100"
                  )}
                />
                <img
                  src={thumbUrl(current.drive_file_id, 1600)}
                  alt={current.name}
                  referrerPolicy="no-referrer"
                  className={cn(
                    "max-w-full max-h-[calc(100dvh-9rem)] w-auto h-auto object-contain transition-opacity",
                    hiResReady ? "opacity-100 relative" : "opacity-0 absolute"
                  )}
                />
              </div>
            ) : isVideo(current.mime_type) ? (
              <DriveVideoPlayer
                fileId={current.drive_file_id}
                mimeType={current.mime_type}
                poster={thumbUrl(current.drive_file_id, 1200)}
                autoPlay
                className="w-full max-w-3xl mx-auto max-h-[calc(100dvh-9rem)] object-contain"
              />
            ) : null}

            {attachments.length > 1 && (
              <button
                type="button"
                onClick={goNext}
                disabled={safeIndex >= attachments.length - 1}
                className="absolute right-2 sm:right-4 z-10 h-11 w-11 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white flex items-center justify-center hover:bg-white/20 disabled:opacity-25 disabled:pointer-events-none"
                aria-label="Siguiente"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {attachments.length > 1 && (
            <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 px-3 bg-gradient-to-t from-black via-black/90 to-transparent">
              <div className="mx-auto max-w-lg rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md px-2.5 py-2.5">
                <div className="flex gap-2 justify-center overflow-x-auto scrollbar-none">
                  {attachments.map((file, i) => (
                    <button
                      key={file.drive_file_id}
                      type="button"
                      onClick={() => setIndex(i)}
                      className={cn(
                        "relative h-14 w-14 shrink-0 rounded-xl overflow-hidden transition-all duration-150",
                        i === safeIndex
                          ? "ring-2 ring-white scale-105"
                          : "opacity-50 hover:opacity-90"
                      )}
                    >
                      {isImage(file.mime_type) || isVideo(file.mime_type) ? (
                        <img
                          src={thumbUrl(file.drive_file_id, 240)}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-white/10 text-[9px] text-white/70">
                          Archivo
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
