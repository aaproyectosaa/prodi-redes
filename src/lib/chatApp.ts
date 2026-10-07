// "Prodi Chat": la segunda app instalable (mismo sitio, mismo código) que abre solo los chats.
// Vive en /chat-app (chat-app.html trae su manifest y sus íconos). Cuando se abre así, la app muestra
// solo el chat, el perfil y los avisos; cualquier otra parte del sistema se abre aparte.

import { plataforma, yaInstalada } from "@/lib/instalar";

export const CHAT_APP = "/chat-app";
export const CHAT_APP_PERFIL = "/chat-app/perfil";
export const CHAT_APP_AVISOS = "/chat-app/avisos";
export const CHAT_APP_INGRESAR = "/chat-app/ingresar";

const CLAVE_SESION = "prodi-modo-chat";
/** Este equipo ya instaló (o abrió como app) Prodi Chat. */
const CLAVE_INSTALADA = "prodi-chat-instalada";
/** Cerraron el aviso "Descargá Prodi Chat". */
const CLAVE_AVISO = "prodi-aviso-chat-cerrado";

export const esRutaChatApp = (pathname: string) => pathname === CHAT_APP || pathname.startsWith(CHAT_APP + "/");

const leer = (s: Storage | undefined, k: string) => {
  try {
    return s?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const guardar = (s: Storage | undefined, k: string, v: string) => {
  try {
    s?.setItem(k, v);
  } catch {
    /* sin almacenamiento (modo privado): no pasa nada */
  }
};
const sesion = () => (typeof window === "undefined" ? undefined : window.sessionStorage);
const local = () => (typeof window === "undefined" ? undefined : window.localStorage);

/** Se llama al arrancar: si se abrió en /chat-app, esta ventana queda en modo chat. */
export function marcarArranqueChat() {
  if (typeof window === "undefined" || !esRutaChatApp(window.location.pathname)) return;
  guardar(sesion(), CLAVE_SESION, "1");
  if (yaInstalada()) guardar(local(), CLAVE_INSTALADA, "1");
  window.addEventListener("appinstalled", () => guardar(local(), CLAVE_INSTALADA, "1"));
}

/**
 * Modo chat: la ruta es /chat-app…, o esta ventana arrancó en /chat-app y corre como app instalada
 * (por ejemplo, un aviso la llevó a /chat?c=…: se vuelve a /chat-app?c=…).
 */
export function enModoChat(pathname = typeof window === "undefined" ? "" : window.location.pathname): boolean {
  if (esRutaChatApp(pathname)) return true;
  return leer(sesion(), CLAVE_SESION) === "1" && yaInstalada();
}

/** Ruta equivalente dentro de Prodi Chat, o null si es otra parte del sistema. */
export function rutaEnChatApp(pathname: string, search: string): string | null {
  if (esRutaChatApp(pathname)) return pathname + search;
  if (pathname === "/" || pathname === "/chat") return CHAT_APP + search;
  if (pathname === "/auth") return CHAT_APP_INGRESAR + search;
  if (pathname === "/profile") return CHAT_APP_PERFIL + search;
  if (pathname === "/notificaciones") return CHAT_APP_AVISOS + search;
  return null;
}

/** Ventana nueva (si el navegador la bloquea, en esta misma). */
function abrirVentana(url: string) {
  const w = window.open(url, "_blank");
  if (w) w.opener = null;
  else window.location.href = url;
}

/** Abre una parte del sistema fuera de Prodi Chat (en el navegador o en la app Prodi). */
export function abrirEnSistema(ruta: string) {
  const url = new URL(ruta, window.location.origin).href;
  abrirVentana(url);
}

export const chatAppInstalada = () => leer(local(), CLAVE_INSTALADA) === "1";
export const avisoChatCerrado = () => leer(local(), CLAVE_AVISO) === "1";
export const cerrarAvisoChat = () => guardar(local(), CLAVE_AVISO, "1");

export const urlChatApp = () => (typeof window === "undefined" ? CHAT_APP : window.location.origin + CHAT_APP);

/**
 * Ir a la página de Prodi Chat para instalarla. Tiene que ser una carga completa (no del router):
 * el navegador toma el manifest de la página. Desde la app Prodi ya instalada no se puede instalar otra,
 * así que en Android se abre en Chrome y en el resto en una ventana nueva del navegador.
 */
export function irAInstalarChat() {
  const url = urlChatApp();
  if (!yaInstalada()) {
    window.location.href = url;
    return;
  }
  if (plataforma() === "android") {
    const u = new URL(url);
    window.location.href = `intent://${u.host}${u.pathname}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    return;
  }
  abrirVentana(url);
}
