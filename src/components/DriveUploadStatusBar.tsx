import { Loader2, Upload, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useDriveUploadContext } from "@/contexts/drive-upload-context";
import { cn } from "@/lib/utils";

function formatMb(bytes: number): string {
  if (bytes <= 0) return "…";
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function DriveUploadStatusBar() {
  const {
    jobs,
    hasActiveUploads,
    preparingPicker,
    preparingUpload,
    cancelUpload,
    cancelAllActive,
    removeJob,
    clearCompleted,
  } = useDriveUploadContext();

  const visibleJobs = jobs.filter((j) => j.status !== "done");
  const hasErrors = jobs.some((j) => j.status === "error");
  const hasCancelled = jobs.some((j) => j.status === "cancelled");
  const isPreparing = preparingPicker || preparingUpload;

  useEffect(() => {
    if (hasActiveUploads || hasErrors || hasCancelled || isPreparing) return;
    if (jobs.length === 0) return;
    const timer = window.setTimeout(() => clearCompleted(), 4000);
    return () => window.clearTimeout(timer);
  }, [hasActiveUploads, hasErrors, hasCancelled, isPreparing, jobs.length, clearCompleted]);

  if (!isPreparing && jobs.length === 0) return null;
  if (!isPreparing && !hasActiveUploads && !hasErrors && !hasCancelled) return null;

  const activeCount = jobs.filter(
    (j) => j.status === "queued" || j.status === "uploading"
  ).length;

  const title = preparingPicker
    ? "Esperando archivos…"
    : preparingUpload
      ? "Preparando archivos…"
      : hasActiveUploads
        ? `Subiendo ${activeCount} archivo${activeCount === 1 ? "" : "s"}…`
        : "Subidas";

  return (
    <div
      className={cn(
        "fixed z-[60] left-2 right-2 md:left-auto md:right-4 md:w-96",
        "bottom-[max(1rem,env(safe-area-inset-bottom,0px))] md:bottom-4",
        "rounded-lg border border-border bg-background/95 backdrop-blur shadow-lg",
        "supports-[backdrop-filter]:bg-background/90"
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          {isPreparing || hasActiveUploads ? (
            <Loader2 className="w-4 h-4 shrink-0 animate-spin text-primary" />
          ) : (
            <Upload className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
          <p className="text-xs font-medium truncate">{title}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasActiveUploads && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
              onClick={cancelAllActive}
            >
              Cancelar todo
            </Button>
          )}
          {!hasActiveUploads && !isPreparing && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={clearCompleted}
              aria-label="Cerrar"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {isPreparing && visibleJobs.length === 0 && (
        <p className="px-3 py-2 text-[10px] text-muted-foreground leading-tight">
          {preparingPicker
            ? "Elegí los archivos en el selector. Con videos pesados puede tardar un momento."
            : "Leyendo los archivos seleccionados…"}
        </p>
      )}

      {visibleJobs.length > 0 && (
        <ul className="max-h-40 overflow-y-auto px-3 py-2 space-y-2">
          {visibleJobs.map((job) => {
            const canCancel =
              job.status === "queued" || job.status === "uploading";
            const canDismiss =
              job.status === "cancelled" || job.status === "error";

            return (
              <li key={job.fileId} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate font-medium" title={job.name}>
                    {job.name}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-muted-foreground tabular-nums">
                      {job.status === "uploading"
                        ? `${job.progress}%`
                        : job.status === "cancelled"
                          ? "Cancelado"
                          : job.status === "error"
                            ? "Error"
                            : preparingUpload && job.size <= 0
                              ? "Preparando"
                              : "En cola"}
                    </span>
                    {(canCancel || canDismiss) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          if (canCancel) cancelUpload(job.fileId);
                          else removeJob(job.fileId);
                        }}
                        aria-label={
                          canCancel ? `Cancelar ${job.name}` : `Quitar ${job.name}`
                        }
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-300",
                      job.status === "error"
                        ? "bg-destructive"
                        : job.status === "cancelled"
                          ? "bg-muted-foreground/50"
                          : "bg-primary"
                    )}
                    style={{
                      width: `${job.status === "queued" ? 8 : job.progress}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground truncate">
                  {formatMb(job.size)}
                  {job.taskLabel ? ` · ${job.taskLabel}` : ""}
                </p>
                {job.status === "error" && job.error && (
                  <p className="text-[10px] text-destructive line-clamp-2">{job.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasActiveUploads && (
        <p className="px-3 pb-2 text-[10px] text-muted-foreground leading-tight">
          Podés cambiar de pantalla. No cierres la pestaña hasta que termine.
        </p>
      )}
    </div>
  );
}
