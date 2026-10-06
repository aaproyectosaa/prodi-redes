import { useEffect, useState } from "react";
import { asset } from "@/lib/asset";
import { File as FileIcon, Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { detectMediaType, isImageMime, isVideoMime } from "@/lib/ratings";
import type { DriveAttachmentRef, Task } from "@/integrations/firebase/types";

export type TaskPreviewThumbSize = "xs" | "mobile" | "desktop";

function getThumbUrl(fileId: string, size = 400): string {
  if (fileId.startsWith("demo/")) return asset(fileId); // datos de ejemplo
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}

const ICON_SIZE: Record<TaskPreviewThumbSize, string> = {
  xs: "w-4 h-4",
  mobile: "w-6 h-6",
  desktop: "w-8 h-8",
};

const PIXEL_SIZE: Record<TaskPreviewThumbSize, number> = {
  xs: 120,
  mobile: 200,
  desktop: 480,
};

/**
 * Miniatura pública de Drive (foto o video). Los archivos se suben con
 * permiso "anyone with link", así que el CM no necesita tener Drive conectado.
 */
export function shouldUseDriveThumbnail(
  _task: Task,
  thumb: DriveAttachmentRef | undefined,
  _driveAvailable?: boolean
): boolean {
  return Boolean(thumb?.drive_file_id);
}

export function shouldUseAttachmentThumbnail(
  attachment: DriveAttachmentRef | undefined,
  _driveAvailable?: boolean,
  _task?: Task
): boolean {
  return Boolean(attachment?.drive_file_id);
}

function resolveIsVideo(task: Task, attachment?: DriveAttachmentRef): boolean {
  if (attachment && isVideoMime(attachment.mime_type)) return true;
  return detectMediaType(task, attachment ? [attachment] : undefined) === "video";
}

const PreviewPlaceholder = ({
  isVideo,
  iconSize,
  showVideoLabel,
  className,
}: {
  isVideo: boolean;
  iconSize: string;
  showVideoLabel?: boolean;
  className?: string;
}) => {
  const PreviewIcon = isVideo ? VideoIcon : ImageIcon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 bg-muted/25 text-muted-foreground",
        className
      )}
    >
      <PreviewIcon className={cn(iconSize, "opacity-45")} />
      {isVideo && showVideoLabel && (
        <span className="text-[8px] font-medium uppercase tracking-wide opacity-50">
          Video
        </span>
      )}
    </div>
  );
};

/** Miniatura de la tarea (primer adjunto finalizado) con fallback a ícono. */
export function TaskPreviewThumb({
  task,
  driveAvailable: _driveAvailable = true,
  size = "desktop",
  showVideoLabel = false,
  className,
}: {
  task: Task;
  driveAvailable?: boolean;
  size?: TaskPreviewThumbSize;
  showVideoLabel?: boolean;
  className?: string;
}) {
  const thumb = task.attachments_finalizado?.[0];
  const [thumbFailed, setThumbFailed] = useState(false);
  const isVideo = resolveIsVideo(task, thumb);
  const canShowThumb =
    shouldUseDriveThumbnail(task, thumb) && !thumbFailed;
  const iconSize = ICON_SIZE[size];

  useEffect(() => {
    setThumbFailed(false);
  }, [task.id, thumb?.drive_file_id]);

  if (canShowThumb && thumb) {
    // URL pública de Drive. thumbnail_link de la API suele pedir auth/expirar
    // (por eso el video andaba y las fotos no).
    const thumbSrc = getThumbUrl(thumb.drive_file_id, PIXEL_SIZE[size]);

    return (
      <div className={cn("absolute inset-0", className)}>
        <img
          src={thumbSrc}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setThumbFailed(true)}
        />
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
            <VideoIcon
              className={cn(
                iconSize,
                "text-white drop-shadow",
                size === "xs" ? "opacity-90" : "opacity-95"
              )}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <PreviewPlaceholder
      isVideo={isVideo}
      iconSize={iconSize}
      showVideoLabel={showVideoLabel}
      className={cn("absolute inset-0", className)}
    />
  );
}

/** Miniatura de un adjunto puntual (p. ej. strip de galería PM). */
export function AttachmentPreviewThumb({
  attachment,
  task,
  driveAvailable: _driveAvailable = true,
  size = "xs",
  className,
}: {
  attachment: DriveAttachmentRef;
  task?: Task;
  driveAvailable?: boolean;
  size?: TaskPreviewThumbSize;
  className?: string;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const isVideo = task
    ? resolveIsVideo(task, attachment)
    : isVideoMime(attachment.mime_type);
  const canShowThumb =
    shouldUseAttachmentThumbnail(attachment) && !thumbFailed;
  const iconSize = ICON_SIZE[size];

  useEffect(() => {
    setThumbFailed(false);
  }, [attachment.drive_file_id]);

  if (canShowThumb) {
    const thumbSrc = getThumbUrl(attachment.drive_file_id, PIXEL_SIZE[size]);

    return (
      <div className={cn("relative h-full w-full", className)}>
        <img
          src={thumbSrc}
          alt={attachment.name}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setThumbFailed(true)}
        />
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
            <VideoIcon className={cn(iconSize, "text-white drop-shadow")} />
          </div>
        )}
      </div>
    );
  }

  if (isVideo) {
    return (
      <PreviewPlaceholder
        isVideo
        iconSize={iconSize}
        className={cn("h-full w-full", className)}
      />
    );
  }

  if (attachment.mime_type && !isImageMime(attachment.mime_type)) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-secondary text-muted-foreground",
          className
        )}
      >
        <FileIcon className={iconSize} />
      </div>
    );
  }

  return (
    <PreviewPlaceholder
      isVideo={false}
      iconSize={iconSize}
      className={cn("h-full w-full", className)}
    />
  );
}
