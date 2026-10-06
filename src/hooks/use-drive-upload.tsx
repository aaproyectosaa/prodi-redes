import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useDriveUploadContext } from "@/contexts/drive-upload-context";
import type {
  DriveAttachment,
  DriveConnection,
  MaterialSlot,
  UploadProgress,
} from "@/utils/drive/types";

interface UseDriveUploadParams {
  taskId: string;
  collectionName?: string;
  slot: MaterialSlot;
  connection: DriveConnection | null;
  projectName: string;
  taskTipo: string | null;
  taskFecha: string | null;
  uploaderUid: string | null;
  taskLabel?: string;
  onAttachmentsAdded?: (attachments: DriveAttachment[]) => void;
}

export function useDriveUpload(params: UseDriveUploadParams) {
  const {
    taskId,
    collectionName,
    slot,
    connection,
    projectName,
    taskTipo,
    taskFecha,
    uploaderUid,
    taskLabel,
    onAttachmentsAdded,
  } = params;

  const { jobs, enqueueUpload, cancelUpload, cancelAllActive, removeJob, clearCompleted, hasActiveUploads } =
    useDriveUploadContext();

  const uploads: UploadProgress[] = useMemo(
    () =>
      jobs
        .filter((j) => j.taskId === taskId && j.slot === slot)
        .map(({ fileId, name, size, progress, status, error, attachment }) => ({
          fileId,
          name,
          size,
          progress,
          status,
          error,
          attachment,
        })),
    [jobs, taskId, slot]
  );

  const isUploading = useMemo(
    () =>
      uploads.some((u) => u.status === "queued" || u.status === "uploading"),
    [uploads]
  );

  const upload = useCallback(
    async (files: File[]): Promise<DriveAttachment[]> => {
      if (!connection || connection.status !== "connected") {
        toast.error(
          "Google Drive no está conectado. Pedile al admin que lo conecte en Ajustes."
        );
        return [];
      }

      return enqueueUpload(
        {
          taskId,
          collectionName,
          slot,
          connection,
          projectName,
          taskTipo,
          taskFecha,
          uploaderUid,
          taskLabel,
          onAttachmentsAdded,
        },
        files
      );
    },
    [
      connection,
      enqueueUpload,
      taskId,
      collectionName,
      slot,
      projectName,
      taskTipo,
      taskFecha,
      uploaderUid,
      taskLabel,
      onAttachmentsAdded,
    ]
  );

  return {
    upload,
    cancelUpload,
    cancelAllActive,
    removeJob,
    clearCompleted,
    uploads,
    isUploading,
    hasActiveUploads,
  };
}
