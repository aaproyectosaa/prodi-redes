/* Drive simulado: conexión siempre activa y subidas en memoria. */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { arrayUnion, doc, updateDoc } from "./firestore-mock";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";
import { asset } from "@/lib/asset";

export function useDriveConnection() {
  return {
    connection: { status: "connected", email: "prodi.redes@gmail.com", project_id: "", owner_uid: "", google_sub: "", root_folder_id: "", connected_at: "", last_used_at: "" },
    status: "connected" as const,
    loading: false,
    error: null,
    isOwner: true,
    connect: async () => toast.message("Demo: Drive ya está conectado"),
    disconnect: async () => toast.message("Demo: no se desconecta"),
    reconnect: async () => undefined,
    ensureToken: async () => "demo",
  };
}

export function useDriveUpload(params: { taskId: string; collectionName?: string; slot: "crudo" | "finalizado" }) {
  const [busy, setBusy] = useState(false);
  const upload = useCallback(
    async (files: File[]) => {
      setBusy(true);
      const field = params.slot === "crudo" ? "attachments_crudo" : "attachments_finalizado";
      const atts = files.map((f) => {
        const url = URL.createObjectURL(f);
        return {
          drive_file_id: `blob:${url}`,
          name: f.name,
          mime_type: f.type || "video/mp4",
          size: f.size,
          thumbnail_link: url,
          web_view_link: url,
          web_content_link: url,
          uploaded_at: new Date().toISOString(),
          uploaded_by: "demo",
          folder_path: "Progreso/Demo",
        };
      });
      await new Promise((r) => setTimeout(r, 700));
      await updateDoc(doc({}, params.collectionName ?? "tasks", params.taskId), { [field]: arrayUnion(...atts) });
      setBusy(false);
      toast.success(`${files.length} archivo${files.length === 1 ? "" : "s"} subido${files.length === 1 ? "" : "s"} (demo)`);
      return atts;
    },
    [params.collectionName, params.taskId, params.slot]
  );
  return {
    upload,
    uploads: [],
    isUploading: busy,
    hasActiveUploads: busy,
    cancelUpload: () => undefined,
    cancelAllActive: () => undefined,
    removeJob: () => undefined,
    clearCompleted: () => undefined,
  };
}

function src(a: DriveAttachmentRef) {
  if (a.drive_file_id.startsWith("demo/")) return asset(a.drive_file_id);
  return a.thumbnail_link ?? "";
}

function Gallery({ attachments }: { attachments: DriveAttachmentRef[] }) {
  const [i, setI] = useState(0);
  const a = attachments[Math.min(i, attachments.length - 1)];
  if (!a) return null;
  const isVideo = a.mime_type.startsWith("video/") && a.drive_file_id.startsWith("blob:");
  return (
    <div className="bg-black">
      <div className="flex max-h-[420px] items-center justify-center">
        {isVideo ? (
          <video src={a.web_content_link} controls className="max-h-[420px]" />
        ) : (
          <img src={src(a)} alt={a.name} className="max-h-[420px] object-contain" />
        )}
      </div>
      {attachments.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto p-2">
          {attachments.map((x, idx) => (
            <button key={idx} type="button" onClick={() => setI(idx)} className={`h-12 w-12 shrink-0 overflow-hidden rounded border-2 ${idx === i ? "border-primary" : "border-transparent"}`}>
              <img src={src(x)} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskMediaGallery({ attachments }: { attachments: DriveAttachmentRef[] }) {
  return <Gallery attachments={attachments} />;
}
export function ClientMediaCarousel({ attachments }: { attachments: DriveAttachmentRef[] }) {
  return (
    <div className="overflow-hidden rounded-xl">
      <Gallery attachments={attachments} />
    </div>
  );
}
