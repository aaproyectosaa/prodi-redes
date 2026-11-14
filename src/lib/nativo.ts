// Prodi Chat dentro de la app de las tiendas (Capacitor, apps/chat-movil): la app abre esta misma web y le inyecta
// el puente nativo (window.Capacitor). Acá va lo que cambia ahí: avisos por Firebase en vez de Web Push, el botón
// atrás de Android, las letras de la barra de arriba según el tema. En el navegador nada de esto corre.

import type { PluginListenerHandle } from "@capacitor/core";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}
const cap = () => (typeof window === "undefined" ? undefined : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor);

/** ¿Corre dentro de la app de App Store / Google Play? */
export const esNativo = () => !!cap()?.isNativePlatform?.();
export const plataformaNativa = (): "ios" | "android" => (cap()?.getPlatform?.() === "ios" ? "ios" : "android");

// --- Plugins (los nombres tienen que coincidir con los nativos de apps/chat-movil) ---

type Permiso = "prompt" | "prompt-with-rationale" | "granted" | "denied";
interface Notificacion {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}
interface FirebaseMessaging {
  checkPermissions(): Promise<{ receive: Permiso }>;
  requestPermissions(): Promise<{ receive: Permiso }>;
  getToken(): Promise<{ token: string }>;
  deleteToken(): Promise<void>;
  removeAllDeliveredNotifications(): Promise<void>;
  createChannel(o: { id: string; name: string; description?: string; importance?: number; visibility?: number; vibration?: boolean }): Promise<void>;
  addListener(e: "tokenReceived", f: (x: { token: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: "notificationReceived", f: (x: { notification: Notificacion }) => void): Promise<PluginListenerHandle>;
  addListener(e: "notificationActionPerformed", f: (x: { notification: Notificacion }) => void): Promise<PluginListenerHandle>;
}
interface AppPlugin {
  addListener(e: "backButton", f: (x: { canGoBack: boolean }) => void): Promise<PluginListenerHandle>;
  minimizeApp(): Promise<void>;
}
interface SystemBarsPlugin {
  setStyle(o: { style: "DARK" | "LIGHT" | "DEFAULT" }): Promise<void>;
}

const plugins = new Map<string, unknown>();
async function plugin<T>(nombre: string): Promise<T> {
  if (!plugins.has(nombre)) {
    const { registerPlugin } = await import("@capacitor/core");
    if (!plugins.has(nombre)) plugins.set(nombre, registerPlugin<T>(nombre));
  }
  return plugins.get(nombre) as T;
}
const mensajeria = () => plugin<FirebaseMessaging>("FirebaseMessaging");

// --- Avisos ---

export async function permisoAvisosNativo(): Promise<Permiso> {
  try {
    return (await (await mensajeria()).checkPermissions()).receive;
  } catch {
    return "denied";
  }
}

/** Pide permiso (si hace falta) y devuelve el token de Firebase de este celular. */
export async function tokenAvisosNativo(pedirPermiso: boolean): Promise<string> {
  const fm = await mensajeria();
  let permiso = (await fm.checkPermissions()).receive;
  if (permiso !== "granted" && pedirPermiso) permiso = (await fm.requestPermissions()).receive;
  if (permiso !== "granted") throw new Error("No diste permiso para notificaciones. Activalos en Ajustes del teléfono → Prodi Chat → Notificaciones.");
  const { token } = await fm.getToken();
  if (!token) throw new Error("El teléfono no dio un código para los avisos. Probá de nuevo en un rato.");
  return token;
}

export async function borrarTokenNativo() {
  try {
    await (await mensajeria()).deleteToken();
  } catch {
    /* nada */
  }
}

/** Ruta del aviso dentro de la app (el servidor ya manda solo la ruta; por las dudas se le saca el dominio). */
function rutaDelAviso(n: Notificacion): string | null {
  const url = typeof n.data?.url === "string" ? n.data.url : "";
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

let iniciado = false;
/**
 * Una vez al abrir la app: canal de avisos (Android), tocar un aviso abre ese chat, el token se renueva solo,
 * y con la app abierta el aviso se muestra adentro (`alLlegar`). Devuelve para dejar de escuchar.
 */
export async function iniciarAvisosNativos(opciones: {
  alLlegar: (a: { title: string; body: string; url?: string }) => void;
  alRenovarToken: (token: string) => void;
}): Promise<() => void> {
  if (!esNativo() || iniciado) return () => undefined;
  iniciado = true;
  const fm = await mensajeria();
  if (plataformaNativa() === "android") {
    await fm.createChannel({ id: "avisos", name: "Mensajes y avisos", description: "Mensajes del chat, menciones y avisos de Prodi", importance: 4, visibility: 1, vibration: true }).catch(() => undefined);
  }
  const manejadores = await Promise.all([
    fm.addListener("notificationActionPerformed", ({ notification }) => {
      const ruta = rutaDelAviso(notification);
      if (ruta && ruta !== window.location.pathname + window.location.search) window.location.href = ruta;
    }),
    fm.addListener("notificationReceived", ({ notification }) => {
      opciones.alLlegar({ title: notification.title || "Prodi", body: notification.body || "", url: rutaDelAviso(notification) ?? undefined });
    }),
    fm.addListener("tokenReceived", ({ token }) => opciones.alRenovarToken(token)),
  ]);
  // Al abrir la app se limpian los avisos viejos de la bandeja (ya se ven adentro).
  fm.removeAllDeliveredNotifications().catch(() => undefined);
  return () => {
    iniciado = false;
    manejadores.forEach((m) => void m.remove());
  };
}

// --- Botón atrás (Android) y barras ---

/**
 * Botón atrás de Android: primero cierra lo que esté abierto (menú, diálogo), después vuelve atrás en la app y,
 * en la pantalla principal, minimiza (como WhatsApp: no cierra la app).
 */
export async function iniciarBotonAtras(): Promise<() => void> {
  if (!esNativo() || plataformaNativa() !== "android") return () => undefined;
  const app = await plugin<AppPlugin>("App");
  const h = await app.addListener("backButton", ({ canGoBack }) => {
    const abierto = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]');
    if (abierto) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      (abierto as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      return;
    }
    const enInicio = window.location.pathname.replace(/\/$/, "") === "/chat-app" && !window.location.search;
    if (canGoBack && !enInicio) window.history.back();
    else void app.minimizeApp();
  });
  return () => void h.remove();
}

/** Letras de la barra de arriba (hora, batería) según el tema de la web: claras en oscuro/violeta, oscuras en claro. */
export function seguirTemaEnBarras(): () => void {
  if (!esNativo()) return () => undefined;
  const raiz = document.documentElement;
  let ultimo = "";
  const aplicar = () => {
    const estilo = raiz.classList.contains("dark") || raiz.classList.contains("violeta") ? "DARK" : "LIGHT";
    if (estilo === ultimo) return;
    ultimo = estilo;
    void plugin<SystemBarsPlugin>("SystemBars").then((p) => p.setStyle({ style: estilo })).catch(() => undefined);
  };
  aplicar();
  const obs = new MutationObserver(aplicar);
  obs.observe(raiz, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
