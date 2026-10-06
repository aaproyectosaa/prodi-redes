import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  genUploadLocalId,
  runDriveUploadBatch,
  type DriveUploadBatchParams,
} from "@/lib/driveUploadRunner";
import { validateFile } from "@/utils/drive/fileValidation";
import {
  subscribePickerPreparing,
  waitForFilesReady,
} from "@/utils/pickMediaFiles";
import type {
  DriveAttachment,
  DriveConnection,
  MaterialSlot,
} from "@/utils/drive/types";

export interface DriveUploadJob {
  fileId: string;
  name: string;
  size: number;
  progress: number;
  status: "queued" | "uploading" | "done" | "error" | "cancelled";
  error?: string;
  attachment?: DriveAttachment;
  taskId: string;
  slot: MaterialSlot;
  taskLabel?: string;
}

interface EnqueueParams {
  taskId: string;
  collectionName?: string;
  slot: MaterialSlot;
  connection: DriveConnection;
  projectName: string;
  taskTipo: string | null;
  taskFecha: string | null;
  uploaderUid: string | null;
  taskLabel?: string;
  onAttachmentsAdded?: (attachments: DriveAttachment[]) => void;
}

interface DriveUploadContextValue {
  jobs: DriveUploadJob[];
  enqueueUpload: (params: EnqueueParams, files: File[]) => Promise<DriveAttachment[]>;
  cancelUpload: (fileId: string) => void;
  cancelAllActive: () => void;
  removeJob: (fileId: string) => void;
  clearCompleted: () => void;
  hasActiveUploads: boolean;
  preparingPicker: boolean;
  preparingUpload: boolean;
}

const DriveUploadContext = createContext<DriveUploadContextValue | null>(null);

export function DriveUploadProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<DriveUploadJob[]>([]);
  const [preparingPicker, setPreparingPicker] = useState(false);
  const [preparingUpload, setPreparingUpload] = useState(false);
  const abortControllers = useRef<Map<string, AbortController>>(new Map());
  const cancelledIds = useRef<Set<string>>(new Set());
  const backgroundToastShown = useRef(false);

  const updateJob = useCallback((fileId: string, patch: Partial<DriveUploadJob>) => {
    setJobs((prev) =>
      prev.map((job) => (job.fileId === fileId ? { ...job, ...patch } : job))
    );
  }, []);

  const hasActiveUploads = useMemo(
    () => jobs.some((j) => j.status === "queued" || j.status === "uploading"),
    [jobs]
  );

  useEffect(() => {
    return subscribePickerPreparing(setPreparingPicker);
  }, []);

  useEffect(() => {
    if (!hasActiveUploads && !preparingPicker && !preparingUpload) {
      backgroundToastShown.current = false;
      return;
    }

    if (!backgroundToastShown.current && (hasActiveUploads || preparingUpload)) {
      backgroundToastShown.current = true;
      toast.info("Subiendo archivos… Podés seguir navegando en la app.", {
        duration: 5000,
      });
    }
  }, [hasActiveUploads, preparingPicker, preparingUpload]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasActiveUploads && !preparingPicker && !preparingUpload) return;
      event.preventDefault();
      event.returnValue =
        "Hay archivos subiendo. Si cerrás la pestaña, la subida se interrumpe.";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasActiveUploads, preparingPicker, preparingUpload]);

  const enqueueUpload = useCallback(
    async (params: EnqueueParams, files: File[]): Promise<DriveAttachment[]> => {
      if (files.length === 0) return [];

      const provisionalIds = files.map(() => genUploadLocalId());
      setPreparingUpload(true);
      setJobs((prev) => [
        ...prev,
        ...files.map((f, idx) => ({
          fileId: provisionalIds[idx],
          name: f.name || "Archivo…",
          size: f.size,
          progress: 0,
          status: "queued" as const,
          taskId: params.taskId,
          slot: params.slot,
          taskLabel: params.taskLabel,
        })),
      ]);

      try {
        const readyFiles = await waitForFilesReady(files);
        if (readyFiles.length === 0) {
          setJobs((prev) => prev.filter((j) => !provisionalIds.includes(j.fileId)));
          toast.error(
            "Los archivos no se pudieron leer. Esperá unos segundos e intentá de nuevo."
          );
          return [];
        }
        if (readyFiles.length < files.length) {
          toast.message(
            `Solo se pudieron preparar ${readyFiles.length} de ${files.length} archivos.`
          );
        }

        const readySet = new Set(readyFiles);
        const validEntries: { file: File; localId: string }[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!readySet.has(file)) continue;
          const v = validateFile(file);
          if (!v.ok) {
            toast.error(v.error ?? "Archivo inválido");
            continue;
          }
          validEntries.push({
            file,
            localId: provisionalIds[i] ?? genUploadLocalId(),
          });
        }

        if (validEntries.length === 0) {
          setJobs((prev) => prev.filter((j) => !provisionalIds.includes(j.fileId)));
          toast.error("Ningún archivo es válido para subir.");
          return [];
        }

        const newJobs: DriveUploadJob[] = validEntries.map(({ file, localId }) => ({
          fileId: localId,
          name: file.name || "video",
          size: file.size,
          progress: 0,
          status: "queued" as const,
          taskId: params.taskId,
          slot: params.slot,
          taskLabel: params.taskLabel,
        }));

        setJobs((prev) => {
          const withoutProvisional = prev.filter(
            (j) => !provisionalIds.includes(j.fileId)
          );
          return [...withoutProvisional, ...newJobs];
        });

        for (const job of newJobs) {
          abortControllers.current.set(job.fileId, new AbortController());
        }

        const batchParams: DriveUploadBatchParams = {
          taskId: params.taskId,
          collectionName: params.collectionName,
          slot: params.slot,
          connection: params.connection,
          projectName: params.projectName,
          taskTipo: params.taskTipo,
          taskFecha: params.taskFecha,
          uploaderUid: params.uploaderUid,
          onFileComplete: (attachment) => {
            params.onAttachmentsAdded?.([attachment]);
          },
          onJobUpdate: (fileId, patch) => updateJob(fileId, patch),
          getAbortSignal: (fileId) => abortControllers.current.get(fileId)?.signal,
          isCancelled: (fileId) => cancelledIds.current.has(fileId),
        };

        const result = await runDriveUploadBatch(
          batchParams,
          validEntries.map((e) => e.file),
          validEntries.map((e) => e.localId)
        );

        const okCount = result.attachments.length;
        const failCount = result.validCount - okCount - result.cancelledCount;

        if (okCount > 0) {
          toast.success(
            `${okCount} archivo${okCount > 1 ? "s" : ""} subido${
              okCount > 1 ? "s" : ""
            } a Drive`
          );
        }
        if (result.cancelledCount > 0) {
          toast.message(
            `${result.cancelledCount} subida${result.cancelledCount > 1 ? "s" : ""} cancelada${result.cancelledCount > 1 ? "s" : ""}`
          );
        }
        if (failCount > 0) {
          const detail = result.errors[0];
          toast.error(
            detail
              ? `No se pudo subir ${failCount === 1 ? "el archivo" : `${failCount} archivos`}: ${detail}`
              : `${failCount} archivo${failCount > 1 ? "s" : ""} fallaron`
          );
        }

        return result.attachments;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
        setJobs((prev) =>
          prev.map((job) =>
            provisionalIds.includes(job.fileId)
              ? { ...job, status: "error", error: msg }
              : job
          )
        );
        return [];
      } finally {
        setPreparingUpload(false);
        for (const id of provisionalIds) {
          abortControllers.current.delete(id);
          cancelledIds.current.delete(id);
        }
      }
    },
    [updateJob]
  );

  const cancelUpload = useCallback((fileId: string) => {
    cancelledIds.current.add(fileId);
    abortControllers.current.get(fileId)?.abort();
    setJobs((prev) =>
      prev.map((job) =>
        job.fileId === fileId &&
        (job.status === "queued" || job.status === "uploading")
          ? { ...job, status: "cancelled", error: "Cancelado", progress: 0 }
          : job
      )
    );
  }, []);

  const cancelAllActive = useCallback(() => {
    jobs
      .filter((j) => j.status === "queued" || j.status === "uploading")
      .forEach((j) => cancelUpload(j.fileId));
  }, [jobs, cancelUpload]);

  const removeJob = useCallback((fileId: string) => {
    cancelledIds.current.delete(fileId);
    abortControllers.current.delete(fileId);
    setJobs((prev) => prev.filter((j) => j.fileId !== fileId));
  }, []);

  const clearCompleted = useCallback(() => {
    setJobs((prev) =>
      prev.filter(
        (j) =>
          j.status !== "done" &&
          j.status !== "cancelled" &&
          j.status !== "error"
      )
    );
  }, []);

  const value = useMemo(
    () => ({
      jobs,
      enqueueUpload,
      cancelUpload,
      cancelAllActive,
      removeJob,
      clearCompleted,
      hasActiveUploads,
      preparingPicker,
      preparingUpload,
    }),
    [jobs, enqueueUpload, cancelUpload, cancelAllActive, removeJob, clearCompleted, hasActiveUploads, preparingPicker, preparingUpload]
  );

  return (
    <DriveUploadContext.Provider value={value}>{children}</DriveUploadContext.Provider>
  );
}

export function useDriveUploadContext() {
  const ctx = useContext(DriveUploadContext);
  if (!ctx) {
    throw new Error("useDriveUploadContext debe usarse dentro de DriveUploadProvider");
  }
  return ctx;
}
