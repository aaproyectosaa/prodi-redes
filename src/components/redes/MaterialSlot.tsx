import { useCallback, useState } from "react";
import { Camera, CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { enModoVista } from "@/lib/redes/vistaComo";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import { useDriveConnection } from "@/hooks/use-drive-connection";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { pickCaptureMedia, pickMediaFiles } from "@/utils/pickMediaFiles";
import { downloadAttachmentsSequential } from "@/utils/drive/downloadDriveFile";
import { TaskMediaGallery } from "@/components/media/TaskMediaGallery";
import { ClientMediaCarousel } from "@/components/media/ClientMediaCarousel";
import { UploadProgressTile } from "@/components/UploadProgressTile";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";
import type { Video } from "@/lib/redes/types";

interface MaterialSlotProps {
  video: Video;
  slot: "crudo" | "finalizado";
  clienteNombre: string;
  canUpload: boolean;
  audience?: "team" | "client";
  emptyText?: string;
  /** Versión chica para la hoja de rodaje: sin galería, solo cuántos archivos hay y los botones. */
  compacto?: boolean;
  /** Se llama cuando alguien elige archivos para subir. */
  onSubir?: () => void;
}

/** Subida y vista del material de un video (Drive). */
export function MaterialSlot({
  video,
  slot,
  clienteNombre,
  canUpload,
  audience = "team",
  emptyText,
  compacto = false,
  onSubir,
}: MaterialSlotProps) {
  const { user } = useUserProfileContext();
  const { connection, ensureToken } = useDriveConnection();
  const driveAvailable = connection?.status === "connected";
  const attachments: DriveAttachmentRef[] =
    (slot === "crudo" ? video.attachments_crudo : video.attachments_finalizado) ?? [];
  const [dragOver, setDragOver] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { upload, uploads, isUploading, cancelUpload, removeJob } = useDriveUpload({
    taskId: video.id,
    collectionName: "videos",
    slot,
    connection,
    projectName: clienteNombre,
    taskTipo: slot === "crudo" ? "Videos - crudo" : "Videos - final",
    taskFecha: `${video.mes}-01`,
    uploaderUid: user?.uid ?? null,
    taskLabel: video.titulo,
  });

  const onFiles = useCallback(
    (files: File[]) => {
      if (enModoVista()) {
        toast.error("Estás en modo 'ver como': es solo lectura.");
        return;
      }
      if (files.length) {
        onSubir?.();
        void upload(files);
      }
    },
    [upload, onSubir]
  );

  const handleDownload = async () => {
    if (!attachments.length) return;
    setDownloading(true);
    try {
      await downloadAttachmentsSequential(attachments, {
        getAccessToken: driveAvailable ? ensureToken : undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar");
    } finally {
      setDownloading(false);
    }
  };

  const activeUploads = uploads.filter((u) => u.status !== "done");

  if (compacto) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {attachments.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> {attachments.length} archivo{attachments.length === 1 ? "" : "s"} subido{attachments.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Sin material todavía</span>
          )}
          {canUpload && (
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" className="h-8 md:hidden" disabled={!driveAvailable || isUploading} onClick={() => pickCaptureMedia(onFiles)}>
                <Camera className="mr-1.5 h-3.5 w-3.5" /> Filmar
              </Button>
              <Button size="sm" variant="secondary" className="h-8" disabled={!driveAvailable || isUploading} onClick={() => pickMediaFiles(onFiles)}>
                {isUploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                {attachments.length ? "Subir más" : "Subir"}
              </Button>
            </span>
          )}
        </div>
        {activeUploads.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeUploads.map((u) => (
              <UploadProgressTile key={u.fileId} upload={u} onCancel={() => cancelUpload(u.fileId)} onDismiss={() => removeJob(u.fileId)} />
            ))}
          </div>
        )}
        {canUpload && !driveAvailable && <p className="text-[11px] text-muted-foreground">Drive no está conectado: pedile al admin que lo conecte en Ajustes.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {attachments.length > 0 ? (
        audience === "client" ? (
          <ClientMediaCarousel attachments={attachments} driveAvailable={driveAvailable} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-black/90">
            <TaskMediaGallery attachments={attachments} driveAvailable={driveAvailable} />
          </div>
        )
      ) : (
        !canUpload && (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            {emptyText ?? "Todavía no hay archivos."}
          </p>
        )
      )}

      {activeUploads.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeUploads.map((u) => (
            <UploadProgressTile
              key={u.fileId}
              upload={u}
              onCancel={() => cancelUpload(u.fileId)}
              onDismiss={() => removeJob(u.fileId)}
            />
          ))}
        </div>
      )}

      {canUpload && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            "rounded-xl border border-dashed p-4 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border",
            !driveAvailable && "opacity-60"
          )}
        >
          <p className="text-xs text-muted-foreground">
            {driveAvailable
              ? slot === "crudo"
                ? "Arrastrá el material filmado o subilo desde el celular"
                : "Arrastrá el video editado (MP4) o elegilo"
              : "Drive no está conectado: pedile al admin que lo conecte en Ajustes."}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!driveAvailable}
              onClick={() => pickMediaFiles(onFiles)}
            >
              {isUploading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              Subir archivos
            </Button>
            {slot === "crudo" && (
              <Button
                size="sm"
                variant="outline"
                className="md:hidden"
                disabled={!driveAvailable}
                onClick={() => pickCaptureMedia(onFiles)}
              >
                <Camera className="mr-1.5 h-4 w-4" />
                Filmar
              </Button>
            )}
          </div>
        </div>
      )}

      {attachments.length > 0 && audience === "team" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          onClick={handleDownload}
          disabled={downloading}
        >
          {downloading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-3.5 w-3.5" />
          )}
          Descargar {attachments.length} archivo{attachments.length === 1 ? "" : "s"}
        </Button>
      )}
    </div>
  );
}
