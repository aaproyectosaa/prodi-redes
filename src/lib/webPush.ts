// Avisos push con Web Push estándar (claves VAPID), sin Firebase.
import { doc, updateDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { guardarPush } from "@/lib/auth";

const SW_PATH = "/sw.js";

export type PushPlatform = "android" | "ios" | "desktop" | "unsupported";

export function detectPushPlatform(): PushPlatform {
  if (typeof navigator === "undefined") return "unsupported";
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Chrome|Firefox|Edge|Opera|SamsungBrowser/i.test(ua)) return "desktop";
  return "unsupported";
}

/** iOS solo recibe Web Push si la PWA está en la pantalla de inicio. */
export function isRunningAsInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = Boolean(
    (navigator as Navigator & { standalone?: boolean }).standalone
  );
  return standalone || iosStandalone;
}

export async function isWebPushSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return false;
  }
  return "PushManager" in window;
}

async function registerMessagingServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_PATH, { scope: "/" });
}

/** Quita comillas/espacios que a veces se pegan al copiar en Vercel. */
function normalizeVapidKey(raw: string | undefined): string {
  return (raw || "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
}

export async function subscribeWebPush(userId: string): Promise<string> {
  const vapidKey = normalizeVapidKey(
    import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
  );
  if (!vapidKey) {
    throw new Error("Falta VITE_VAPID_PUBLIC_KEY (la clave pública de los avisos push). Ver docs/DESPLIEGUE.md.");
  }
  if (vapidKey.length < 80 || !vapidKey.startsWith("B")) {
    throw new Error(
      "La VAPID key parece inválida. En Vercel pegala sin comillas y redeploy."
    );
  }

  const supported = await isWebPushSupported();
  if (!supported) {
    throw new Error("Este navegador no soporta notificaciones push.");
  }

  const platform = detectPushPlatform();
  if (platform === "ios" && !isRunningAsInstalledPwa()) {
    throw new Error(
      "En iPhone/iPad: tocá Compartir → Agregar a pantalla de inicio, abrí Prodi desde ahí y activá de nuevo."
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("No diste permiso para notificaciones.");
  }

  const registration = await registerMessagingServiceWorker();
  await navigator.serviceWorker.ready;

  // Si quedó una suscripción vieja con otra VAPID, el push service falla.
  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
  } catch {
    // ignore
  }

  let sub: PushSubscription;
  try {
    sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ABytes(vapidKey) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`El navegador no pudo activar los avisos (${msg}). Borrá los datos del sitio y probá de nuevo.`);
  }
  await guardarPush(sub.toJSON());
  await updateDoc(doc(db, "profiles", userId), { push_enabled: true });
  return sub.endpoint;
}

function base64ABytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function unsubscribeWebPush(userId: string, _token?: string | null) {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await guardarPush(null, sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {
    /* igual se apaga en el perfil */
  }
  await updateDoc(doc(db, "profiles", userId), { push_enabled: false });
}

/** Toast en primer plano cuando llega un push con la app abierta. */
export function listenForegroundPush(
  onPayload: (payload: {
    title: string;
    body: string;
    url?: string;
  }) => void
): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => undefined;
  // El service worker manda el aviso a la pantalla abierta en vez de mostrar la notificación del sistema.
  const handler = (e: MessageEvent) => {
    const d = e.data as { tipo?: string; title?: string; body?: string; url?: string } | null;
    if (d?.tipo === "prodi-push") onPayload({ title: d.title || "Prodi", body: d.body || "", url: d.url });
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
