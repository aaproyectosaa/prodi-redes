// Chat flotante: abierto o minimizado, y qué conversación. Se guarda por dispositivo.
import { useSyncExternalStore } from "react";

export interface EstadoDock {
  /** Panel desplegado (si no, queda el botón minimizado). */
  abierto: boolean;
  /** Conversación abierta en el panel (null: la lista de chats). */
  chatId: string | null;
}

const KEY = "prodi-chat-dock";

function leer(): EstadoDock {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<EstadoDock> | null;
    return { abierto: d?.abierto === true, chatId: typeof d?.chatId === "string" ? d.chatId : null };
  } catch {
    return { abierto: false, chatId: null };
  }
}

let estado = leer();
/** El chat flotante está montado y visible (se puede abrir una conversación ahí en vez de ir a /chat). */
let disponible = false;
const subs = new Set<() => void>();

function set(parcial: Partial<EstadoDock>) {
  estado = { ...estado, ...parcial };
  try {
    localStorage.setItem(KEY, JSON.stringify(estado));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

const suscribir = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function useChatDock(): EstadoDock {
  return useSyncExternalStore(suscribir, () => estado);
}

export const dock = {
  abrir: (chatId?: string | null) => set(chatId === undefined ? { abierto: true } : { abierto: true, chatId }),
  minimizar: () => set({ abierto: false }),
  /** Vuelve a la lista (el panel sigue abierto). */
  lista: () => set({ chatId: null }),
  /** Cierra la conversación y minimiza. */
  cerrar: () => set({ abierto: false, chatId: null }),
  /** Deja una conversación lista en el botón, sin desplegarla. */
  recordar: (chatId: string) => set({ chatId }),
  setDisponible: (v: boolean) => {
    disponible = v;
  },
};

// Conversaciones a la vista ahora mismo (página /chat o chat flotante abierto).
const enPantalla = new Set<string>();
export const chatEnPantalla = {
  entrar: (id: string) => void enPantalla.add(id),
  salir: (id: string) => void enPantalla.delete(id),
};

/** ¿El aviso es de un chat que ya se está mirando? Entonces no hace falta cartel ni sonido. */
export function avisoDeChatVisible(link: string | null | undefined): boolean {
  const id = chatDeLink(link);
  return !!id && enPantalla.has(id) && document.visibilityState === "visible";
}

/** Id del chat de un link del sistema ("/chat?c=…"), o null. */
export function chatDeLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname.replace(/\/$/, "") !== "/chat") return null;
    return url.searchParams.get("c");
  } catch {
    return null;
  }
}

/**
 * Abre la conversación en el chat flotante si está disponible (dentro del sistema, fuera de /chat).
 * Devuelve false si no: el que llama navega como siempre.
 */
export function abrirEnDock(chatId: string | null | undefined): boolean {
  if (!chatId || !disponible) return false;
  dock.abrir(chatId);
  return true;
}
