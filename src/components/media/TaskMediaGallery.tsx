import { useEffect, useState } from "react";
import { asset } from "@/lib/asset";
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  ExternalLink,
  File as FileIcon,
  Trash2,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { DriveVideoPlayer } from "@/components/DriveVideoPlayer";
import { AttachmentPreviewThumb } from "@/components/tasks/TaskPreviewThumb";
import type { DriveAttachmentRef, Task } from "@/integrations/firebase/types";

function getThumbUrl(fileId: string, size = 400): string {
  if (fileId.startsWith("demo/")) return asset(fileId); // datos de ejemplo
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

function isVideo(mime: string): boolean {
  return mime.startsWith("video/");
}

export interface TaskMediaGalleryProps {
  attachments: DriveAttachmentRef[];
  driveAvailable: boolean;
  task?: Task;
  /**
   * `team` = PM / interno (puede mostrar links externos).
   * `client` = panel cliente (sin mencionar almacenamiento externo).
   */
  audience?: "team" | "client";
  className?: string;
  /** Si viene, aparece "Sacar" (el que se está viendo, o varios marcados con "Elegir varios"). */
  onQuitar?: (atts: DriveAttachmentRef[]) => Promise<void> | void;
}

/** Misma reproducción de media que usa el panel PM (ahí el video se ve bien). */
export function TaskMediaGallery({
  attachments,
  driveAvailable,
  task,
  audience = "team",
  className,
  onQuitar,
}: TaskMediaGalleryProps) {
  const [quitando, setQuitando] = useState(false);
  // Modo "elegir varios" para sacarlos juntos.
  const [marcados, setMarcados] = useState<Set<string> | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const isClient = audience === "client";

  useEffect(() => {
    setCurrentIndex(0);
    setFullscreenOpen(false);
    setMarcados(null);
  }, [attachments]);

  if (!attachments || attachments.length === 0) {
    return (
      <div className="flex min-h-[160px] items-center justify-center text-muted-foreground text-sm">
        <div className="text-center space-y-2 px-4">
          <ImageIcon className="w-10 h-10 mx-auto opacity-30" />
          <p>Sin vista previa</p>
          <p className="text-xs">
            {isClient
              ? "El equipo todavía no subió el material final."
              : "El editor aún no subió archivos."}
          </p>
        </div>
      </div>
    );
  }

  if (!driveAvailable) {
    return (
      <div className="flex min-h-[160px] items-center justify-center text-muted-foreground text-sm p-4">
        <div className="text-center space-y-2">
          <ImageIcon className="w-10 h-10 mx-auto opacity-30" />
          <p>
            {isClient
              ? "Material no disponible por ahora"
              : "Conexión a Drive inactiva"}
          </p>
          <p className="text-xs">
            {isClient
              ? "Cuando esté listo, lo vas a poder ver acá mismo."
              : "Reconectá Drive para ver los archivos."}
          </p>
        </div>
      </div>
    );
  }

  const current = attachments[Math.min(currentIndex, attachments.length - 1)];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < attachments.length - 1;
  const isCurrentImage = isImage(current.mime_type);
  const isCurrentVideo = isVideo(current.mime_type);
  const canExpand = isCurrentImage || isCurrentVideo;

  const renderMedia = (mode: "preview" | "fullscreen") => {
    const imageSize = mode === "fullscreen" ? 2400 : 1200;
    const imageClass =
      mode === "fullscreen"
        ? "max-w-full max-h-[85dvh] w-auto h-auto object-contain mx-auto rounded-md"
        : "max-w-full max-h-[40dvh] w-auto h-auto object-contain rounded-md sm:max-h-[42dvh] md:max-h-full";
    // Clases idénticas al panel PM / AttachmentPreview (donde el video se ve).
    const videoClass =
      mode === "fullscreen"
        ? "w-full max-w-3xl mx-auto max-h-[85dvh] aspect-video object-contain"
        : "w-full max-w-3xl mx-auto max-h-[40dvh] aspect-video object-contain sm:max-h-[42dvh]";

    if (isCurrentImage) {
      return (
        <img
          src={getThumbUrl(current.drive_file_id, imageSize)}
          alt={current.name}
          referrerPolicy="no-referrer"
          className={imageClass}
        />
      );
    }

    if (isCurrentVideo) {
      return (
        <DriveVideoPlayer
          fileId={current.drive_file_id}
          mimeType={current.mime_type}
          className={videoClass}
        />
      );
    }

    return (
      <div className="text-center space-y-3 p-4">
        <FileIcon className="w-12 h-12 mx-auto text-muted-foreground" />
        <p className="text-sm font-medium">{current.name}</p>
        {!isClient && current.web_view_link && (
          <Button asChild size="sm" variant="outline">
            <a href={current.web_view_link} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Abrir archivo
            </a>
          </Button>
        )}
        {isClient && (
          <p className="text-xs text-muted-foreground">
            Este tipo de archivo no se puede previsualizar acá.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className={className}>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentIndex + 1} de {attachments.length}
          </span>
          <div className="flex items-center gap-1">
            {onQuitar && marcados && (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={quitando || !marcados.size}
                  onClick={async () => {
                    const lista = attachments.filter((x) => marcados.has(x.drive_file_id));
                    if (!window.confirm(`¿Sacar ${lista.length === 1 ? "1 archivo" : `${lista.length} archivos`} del video? (Quedan guardados en Drive)`)) return;
                    setQuitando(true);
                    try {
                      await onQuitar(lista);
                      setMarcados(null);
                    } finally {
                      setQuitando(false);
                    }
                  }}
                  className="h-7 gap-1 text-xs"
                >
                  <Trash2 className="h-3 w-3" /> Sacar {marcados.size || ""}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMarcados(null)}>
                  Cancelar
                </Button>
              </>
            )}
            {onQuitar && !marcados && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={quitando}
                  onClick={async () => {
                    if (!window.confirm(`¿Sacar «${current.name}» del video? (Queda guardado en Drive)`)) return;
                    setQuitando(true);
                    try {
                      await onQuitar([current]);
                    } finally {
                      setQuitando(false);
                    }
                  }}
                  className="h-7 gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Sacar</span>
                </Button>
                {attachments.length > 1 && (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMarcados(new Set())}>
                    Elegir varios
                  </Button>
                )}
              </>
            )}
            {canExpand && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFullscreenOpen(true)}
                className="h-7 text-xs gap-1"
              >
                <Expand className="w-3 h-3" />
                <span className="hidden sm:inline">Ampliar</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setCurrentIndex((i) => i - 1)}
              className="h-7 w-7 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasNext}
              onClick={() => setCurrentIndex((i) => i + 1)}
              className="h-7 w-7 p-0"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-[200px] max-h-[42dvh] items-center justify-center overflow-hidden bg-black/5 p-3 dark:bg-black/20 sm:max-h-[48dvh]">
          {renderMedia("preview")}
        </div>

        {attachments.length > 1 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-border px-3 py-3 scrollbar-none">
            {attachments.map((att, idx) => (
              <button
                key={att.drive_file_id}
                type="button"
                onClick={() => {
                  if (!marcados) return setCurrentIndex(idx);
                  const n = new Set(marcados);
                  if (n.has(att.drive_file_id)) n.delete(att.drive_file_id);
                  else n.add(att.drive_file_id);
                  setMarcados(n);
                }}
                className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-all ${
                  marcados
                    ? marcados.has(att.drive_file_id)
                      ? "border-destructive ring-2 ring-destructive/40"
                      : "border-border opacity-70"
                    : idx === currentIndex
                      ? "border-primary ring-1 ring-primary/30"
                      : "border-border hover:border-muted-foreground/50"
                }`}
              >
                {marcados?.has(att.drive_file_id) && (
                  <span className="absolute inset-0 z-10 flex items-center justify-center bg-destructive/40">
                    <Trash2 className="h-4 w-4 text-white" />
                  </span>
                )}
                {isImage(att.mime_type) || isVideo(att.mime_type) ? (
                  <AttachmentPreviewThumb
                    attachment={att}
                    task={task}
                    driveAvailable={driveAvailable}
                    size="xs"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-secondary">
                    <FileIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {!isClient && (
          <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span className="truncate font-medium">{current.name}</span>
            {current.size && (
              <span className="shrink-0">
                {(current.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            )}
            {current.web_view_link && (
              <a
                href={current.web_view_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Drive
              </a>
            )}
          </div>
        )}
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-[95vw] border-border bg-background p-4 sm:max-w-5xl">
          <VisuallyHidden>
            <DialogTitle>{current.name}</DialogTitle>
          </VisuallyHidden>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-semibold">{current.name}</h3>
              {!isClient && current.web_view_link && (
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={current.web_view_link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir archivo
                  </a>
                </Button>
              )}
            </div>
            <div className="flex items-center justify-center">
              {renderMedia("fullscreen")}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
