import { doc, updateDoc, arrayUnion, getDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { fechaAR, hoyAR } from "@/lib/fecha";
import { ensureAccessToken } from "@/utils/drive/tokenStore";
import { DriveAuthError } from "@/utils/drive/auth";
import {
  ensureFolderPath,
  uploadAndShare,
  sanitizeDriveAttachment,
  DriveApiError,
} from "@/utils/drive/driveApi";
import { loadFolderCache, saveFolderCache } from "@/utils/drive/folderCache";
import { validateFile } from "@/utils/drive/fileValidation";
import type {
  DriveAttachment,
  DriveConnection,
  MaterialSlot,
  UploadProgress,
} from "@/utils/drive/types";

const ROOT_FOLDER_NAME = "Progreso";
const MAX_CONCURRENT = 2;

function formatDate(iso: string | null): string {
  return (iso && fechaAR(iso)) || hoyAR();
}

export function genUploadLocalId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isUploadCancelledError(err: unknown): boolean {
  if (err instanceof DriveApiError && err.message === "Upload cancelado") {
    return true;
  }
  return err instanceof Error && err.name === "AbortError";
}

export interface DriveUploadBatchParams {
  taskId: string;
  /** Colección del documento destino (default "tasks"; Prodi Redes usa "videos"). */
  collectionName?: string;
  slot: MaterialSlot;
  connection: DriveConnection;
  projectName: string;
  taskTipo: string | null;
  taskFecha: string | null;
  uploaderUid: string | null;
  onFileComplete?: (attachment: DriveAttachment) => void;
  onJobUpdate?: (fileId: string, patch: Partial<UploadProgress>) => void;
  getAbortSignal?: (fileId: string) => AbortSignal | undefined;
  isCancelled?: (fileId: string) => boolean;
}

export interface DriveUploadBatchResult {
  attachments: DriveAttachment[];
  errors: string[];
  cancelledCount: number;
  validCount: number;
}

type SlotOutcome =
  | { kind: "ok"; attachment: DriveAttachment }
  | { kind: "skip" };

/**
 * Sube en paralelo (rápido) pero escribe en Firestore en el orden de
 * selección/arrastre, para que el carrusel no quede aleatorio.
 */
export async function runDriveUploadBatch(
  params: DriveUploadBatchParams,
  files: File[],
  localIds?: string[]
): Promise<DriveUploadBatchResult> {
  const {
    taskId,
    collectionName = "tasks",
    slot,
    connection,
    projectName,
    taskTipo,
    taskFecha,
    uploaderUid,
    onFileComplete,
    onJobUpdate,
    getAbortSignal,
    isCancelled,
  } = params;

  const valid: File[] = [];
  for (const f of files) {
    const v = validateFile(f);
    if (!v.ok) {
      continue;
    }
    valid.push(f);
  }

  if (valid.length === 0) {
    return { attachments: [], errors: [], cancelledCount: 0, validCount: 0 };
  }

  let accessToken: string;
  try {
    accessToken = await ensureAccessToken(connection.email);
  } catch (err) {
    const msg =
      err instanceof DriveAuthError && err.code === "refresh_revoked"
        ? "La conexión a Drive expiró. Pedile al dueño que reconecte."
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(msg);
  }

  const folderCache = loadFolderCache();
  const pathParts = [
    ROOT_FOLDER_NAME,
    projectName,
    taskTipo ?? "Sin Tipo",
    formatDate(taskFecha),
  ];
  const folderPath = pathParts.join("/");
  const folderId = await ensureFolderPath(pathParts, accessToken, folderCache);
  saveFolderCache(folderCache);

  const field = slot === "crudo" ? "attachments_crudo" : "attachments_finalizado";
  const attachments: DriveAttachment[] = [];
  const errors: string[] = [];
  let cancelledCount = 0;

  const queue = valid.map((file, idx) => ({
    file,
    localId: localIds?.[idx] ?? genUploadLocalId(),
    index: idx,
  }));

  const outcomes: Array<SlotOutcome | undefined> = Array.from({
    length: valid.length,
  });
  let flushedUntil = -1;
  let nextEmit = 0;
  let writeChain: Promise<void> = Promise.resolve();

  const flushContiguous = () => {
    writeChain = writeChain.then(async () => {
      let end = flushedUntil + 1;
      while (end < outcomes.length && outcomes[end] !== undefined) {
        end += 1;
      }
      if (end === flushedUntil + 1) return;

      const toAppend: ReturnType<typeof sanitizeDriveAttachment>[] = [];
      for (let i = flushedUntil + 1; i < end; i++) {
        const outcome = outcomes[i];
        if (outcome?.kind === "ok") {
          toAppend.push(sanitizeDriveAttachment(outcome.attachment));
        }
      }
      flushedUntil = end - 1;

      if (toAppend.length === 0) return;

      // arrayUnion con varios args los agrega al final en ese orden.
      await updateDoc(doc(db, collectionName, taskId), {
        [field]: arrayUnion(...toAppend),
      });
    });
    return writeChain;
  };

  const emitContiguous = () => {
    while (nextEmit < outcomes.length && outcomes[nextEmit] !== undefined) {
      const outcome = outcomes[nextEmit];
      if (outcome?.kind === "ok") {
        onFileComplete?.(outcome.attachment);
        attachments.push(outcome.attachment);
      }
      nextEmit += 1;
    }
  };

  const uploadOne = async (file: File, localId: string, index: number) => {
    if (isCancelled?.(localId) || getAbortSignal?.(localId)?.aborted) {
      onJobUpdate?.(localId, { status: "cancelled", error: "Cancelado" });
      cancelledCount += 1;
      outcomes[index] = { kind: "skip" };
      emitContiguous();
      await flushContiguous();
      return;
    }

    onJobUpdate?.(localId, { status: "uploading", progress: 0 });

    try {
      const attachment = await uploadAndShare({
        file,
        folderId,
        folderPath,
        uploaderUid: uploaderUid ?? "unknown",
        accessToken,
        signal: getAbortSignal?.(localId),
        onProgress: (pct) => {
          onJobUpdate?.(localId, { progress: pct, status: "uploading" });
        },
      });

      onJobUpdate?.(localId, {
        status: "done",
        progress: 100,
        attachment,
      });
      outcomes[index] = { kind: "ok", attachment };
      emitContiguous();
      await flushContiguous();
    } catch (err) {
      if (isUploadCancelledError(err) || isCancelled?.(localId)) {
        onJobUpdate?.(localId, { status: "cancelled", error: "Cancelado" });
        cancelledCount += 1;
        outcomes[index] = { kind: "skip" };
        emitContiguous();
        await flushContiguous();
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      onJobUpdate?.(localId, { status: "error", error: msg });
      errors.push(msg);
      outcomes[index] = { kind: "skip" };
      emitContiguous();
      await flushContiguous();
    }
  };

  const workers = Array.from({ length: MAX_CONCURRENT }).map(async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      if (isCancelled?.(next.localId) || getAbortSignal?.(next.localId)?.aborted) {
        onJobUpdate?.(next.localId, { status: "cancelled", error: "Cancelado" });
        cancelledCount += 1;
        outcomes[next.index] = { kind: "skip" };
        emitContiguous();
        await flushContiguous();
        continue;
      }
      await uploadOne(next.file, next.localId, next.index);
    }
  });

  await Promise.all(workers);
  await writeChain;

  return { attachments, errors, cancelledCount, validCount: valid.length };
}

/** Reordena el array de adjuntos de una tarea (carrusel). */
export async function reorderTaskAttachments(
  taskId: string,
  slot: MaterialSlot,
  ordered: DriveAttachment[],
  collectionName = "tasks"
): Promise<void> {
  const field = slot === "crudo" ? "attachments_crudo" : "attachments_finalizado";
  await updateDoc(doc(db, collectionName, taskId), {
    [field]: ordered.map((att) => sanitizeDriveAttachment(att)),
  });
}

/** Lee el orden actual (útil para merges). */
export async function getTaskAttachments(
  taskId: string,
  slot: MaterialSlot
): Promise<DriveAttachment[]> {
  const field = slot === "crudo" ? "attachments_crudo" : "attachments_finalizado";
  const snap = await getDoc(doc(db, "tasks", taskId));
  if (!snap.exists()) return [];
  const data = snap.data();
  return (data?.[field] as DriveAttachment[] | undefined) ?? [];
}
