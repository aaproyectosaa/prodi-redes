import { auth } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";
import { asset } from "@/lib/asset";

/** Llamadas que solo leen (permitidas en modo "ver como"). */
const SOLO_LECTURA = ["/api/pagos/verificar"];

/** Llama a una función de /api con el token del usuario logueado. */
export async function callApi<T = unknown>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  if (!SOLO_LECTURA.includes(path) && !body.solo_vista) assertEditable();
  const user = auth.currentUser;
  if (!user) throw new Error("Sesión vencida. Volvé a ingresar.");
  const idToken = await user.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta vacía */
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error ?? `Error ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** Llamadas sin usuario (página pública de aprobación del cliente). */
export async function callPublico<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta vacía */
  }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Error ${res.status}`);
  return data as T;
}

/** URL para reproducir el video final desde el link público. */
export function urlMediaPublica(token: string, fileId: string, mime: string): { url: string; tipo: "video" | "imagen" } {
  if (fileId.startsWith("demo/")) return { url: asset(fileId), tipo: "imagen" }; // datos de ejemplo
  return {
    url: `/api/publico/media?t=${encodeURIComponent(token)}&fileId=${encodeURIComponent(fileId)}`,
    tipo: mime.startsWith("image/") ? "imagen" : "video",
  };
}

/** Imagen (base64 sin encabezado) achicada a un máximo de lado, para subir logos y referencias. */
export async function imagenParaSubir(file: File, max = 1600): Promise<{ data: string; mime: string; nombre: string }> {
  const mime = file.type === "image/png" || file.type === "image/webp" ? "image/png" : "image/jpeg";
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL(mime, 0.9);
  return { data: url.split(",")[1] ?? "", mime, nombre: file.name };
}
