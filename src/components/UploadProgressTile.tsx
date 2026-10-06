import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UploadProgress } from "@/utils/drive/types";

interface UploadProgressTileProps {
  upload: UploadProgress;
  onCancel?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function UploadProgressTile({
  upload,
  onCancel,
  onDismiss,
  className,
}: UploadProgressTileProps) {
  const canCancel =
    upload.status === "queued" || upload.status === "uploading";
  const canDismiss =
    upload.status === "cancelled" ||
    upload.status === "error" ||
    upload.status === "done";

  return (
    <div
      className={cn(
        "relative w-24 h-24 border border-dashed rounded-md flex flex-col items-center justify-center p-1 text-center",
        upload.status === "cancelled"
          ? "border-muted-foreground/40 bg-muted/30"
          : upload.status === "error"
            ? "border-destructive/40 bg-destructive/5"
            : "border-border",
        className
      )}
      title={upload.name}
    >
      {(canCancel || canDismiss) && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-0.5 right-0.5 h-5 w-5 text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (canCancel) onCancel?.();
            else onDismiss?.();
          }}
          aria-label={canCancel ? `Cancelar subida de ${upload.name}` : "Quitar"}
        >
          <X className="w-3 h-3" />
        </Button>
      )}

      {upload.status === "error" ? (
        <span className="text-[10px] text-destructive break-all px-1">Error</span>
      ) : upload.status === "cancelled" ? (
        <span className="text-[10px] text-muted-foreground break-all px-1">
          Cancelado
        </span>
      ) : (
        <>
          <Upload className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-[9px] text-muted-foreground mt-1 truncate max-w-full px-1">
            {upload.name}
          </span>
          <span className="text-[10px] font-medium text-primary mt-0.5">
            {upload.status === "queued" ? "En cola" : `${upload.progress}%`}
          </span>
        </>
      )}
    </div>
  );
}
