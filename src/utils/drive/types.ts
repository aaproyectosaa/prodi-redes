// Tipos compartidos para la integración con Google Drive

export type DriveConnectionStatus = "connected" | "revoked" | "disconnected" | "loading";

export interface DriveConnection {
  project_id: string;
  owner_uid: string;
  email: string;
  google_sub: string;
  root_folder_id: string;
  status: Exclude<DriveConnectionStatus, "loading">;
  connected_at: string;
  disconnected_at?: string;
  last_used_at: string;
  last_error?: string;
  /** Permisos que dio Google al conectar (separados por espacio). */
  scopes?: string;
  /** Si la conexión incluye Google Calendar. */
  calendario?: boolean;
}

export interface DriveAttachment {
  drive_file_id: string;
  name: string;
  mime_type: string;
  size: number;
  thumbnail_link?: string;
  web_view_link: string;
  web_content_link?: string;
  uploaded_at: string;
  uploaded_by: string;
  folder_path: string;
}

export interface UploadProgress {
  fileId: string; // local id (uuid temporal)
  name: string;
  size: number;
  progress: number; // 0..100
  status: "queued" | "uploading" | "done" | "error" | "cancelled";
  error?: string;
  attachment?: DriveAttachment; // cuando status === 'done'
}

export type MaterialSlot = "crudo" | "finalizado";
