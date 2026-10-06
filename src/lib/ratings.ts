import type { DriveAttachmentRef, Profile, Task, UserRole } from "@/integrations/firebase/types";
import { fechaAR, hoyAR } from "@/lib/fecha";

/** Roles que pueden recibir calificación por el PM (prioridad al resolver responsable). */
export const RATEABLE_ROLES: UserRole[] = ["productor", "editor", "disenador"];

/** Roles para los que existe una rúbrica de calificación. */
const EVALUABLE_ROLES: UserRole[] = [
  "productor",
  "editor",
  "disenador",
  "cm",
  "pm",
  "admin",
];

export type ContentMediaType = "video" | "image";

export type EvalType =
  | "productor_video"
  | "productor_image"
  | "editor_video"
  | "designer_image";

export interface RatingCriterion {
  key: string;
  label: string;
}

export const RATING_CRITERIA: Record<EvalType, RatingCriterion[]> = {
  productor_video: [
    { key: "tomas", label: "Tomas" },
    { key: "audio", label: "Audio" },
    { key: "guion", label: "Guion" },
  ],
  productor_image: [{ key: "fotografia", label: "Fotografía" }],
  editor_video: [
    { key: "edicion_general", label: "Edición general" },
    { key: "colorimetria", label: "Colorimetría" },
    { key: "edicion_sonido", label: "Edición de sonido" },
  ],
  designer_image: [{ key: "diseno", label: "Diseño" }],
};

export interface ContentRating {
  id: string;
  task_id: string;
  rated_user_id: string;
  rated_user_role: UserRole;
  eval_type: EvalType;
  content_media: ContentMediaType;
  scores: Record<string, number>;
  average_score: number;
  rated_by: string;
  reviewed_at: string;
  updated_at?: string;
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Infiere video/imagen desde adjuntos o tipo de contenido. */
export function detectMediaType(
  task: Task,
  attachments: DriveAttachmentRef[] = task.attachments_finalizado ?? []
): ContentMediaType {
  for (const att of attachments) {
    if (isVideoMime(att.mime_type)) return "video";
    if (isImageMime(att.mime_type)) return "image";
  }
  if (task.tipo === "Reel" || task.tipo === "Historia Audiovisual") return "video";
  return "image";
}

export function getEvalType(role: UserRole | undefined, media: ContentMediaType): EvalType | null {
  const effectiveRole = role ?? "editor";
  if (effectiveRole === "productor") {
    return media === "video" ? "productor_video" : "productor_image";
  }
  if (effectiveRole === "disenador") {
    return "designer_image";
  }
  if (effectiveRole === "editor") {
    return media === "video" ? "editor_video" : "designer_image";
  }
  if (EVALUABLE_ROLES.includes(effectiveRole)) {
    return media === "video" ? "editor_video" : "designer_image";
  }
  return null;
}

export function getCriteriaForEvalType(evalType: EvalType): RatingCriterion[] {
  return RATING_CRITERIA[evalType];
}

/** Usuario a calificar: uploader del material final o primer responsable evaluable. */
export function resolveRatedUser(
  task: Task,
  profilesById: Map<string, Profile>
): Profile | null {
  const finalAttachments = task.attachments_finalizado ?? [];
  if (finalAttachments.length > 0) {
    const sorted = [...finalAttachments].sort(
      (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    );
    const uploader = profilesById.get(sorted[0].uploaded_by);
    if (uploader && RATEABLE_ROLES.includes(uploader.role ?? "editor")) {
      return uploader;
    }
  }

  for (const uid of task.responsible_user_ids ?? []) {
    const profile = profilesById.get(uid);
    if (profile && RATEABLE_ROLES.includes(profile.role ?? "editor")) {
      return profile;
    }
  }

  // Fallback: cualquier responsable asignado (p. ej. CM) para no ocultar la tarea.
  for (const uid of task.responsible_user_ids ?? []) {
    const profile = profilesById.get(uid);
    if (profile) return profile;
  }

  return null;
}

export function computeAverageScore(scores: Record<string, number>): number {
  const values = Object.values(scores).filter((v) => v >= 1 && v <= 5);
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function isRatingComplete(
  evalType: EvalType,
  scores: Record<string, number>
): boolean {
  return isRatingCompleteForCriteria(getCriteriaForEvalType(evalType), scores);
}

export function isRatingCompleteForCriteria(
  criteria: RatingCriterion[],
  scores: Record<string, number>
): boolean {
  return criteria.every((c) => {
    const v = scores[c.key];
    return typeof v === "number" && v >= 1 && v <= 5;
  });
}

export function emptyScoresForEvalType(evalType: EvalType): Record<string, number> {
  return emptyScoresForCriteria(getCriteriaForEvalType(evalType));
}

export function emptyScoresForCriteria(
  criteria: RatingCriterion[]
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const c of criteria) {
    scores[c.key] = 0;
  }
  return scores;
}

export function isToday(isoDate: string): boolean {
  return fechaAR(isoDate) === hoyAR();
}

export function getRatingLabel(avg: number): string {
  if (avg >= 4.5) return "Excelente";
  if (avg >= 3.5) return "Muy buena";
  if (avg >= 2.5) return "Buena";
  if (avg >= 1.5) return "Regular";
  if (avg >= 1) return "Necesita mejorar";
  return "Sin calificar";
}
