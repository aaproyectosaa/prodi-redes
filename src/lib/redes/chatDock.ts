// Chat flotante: varias conversaciones abiertas (minimizadas o desplegadas) y la lista. Se guarda por dispositivo.
import { useSyncExternalStore } from "react";

/** En `desplegados`: la lista de chats. */
export const LISTA = "lista";
/** Conversaciones abiertas a la vez; al abrir otra se cierra la menos usada. */
export const MAX_ABIERTOS = 4;
/** Ancho de cada panel desplegado en la compu. */
export const ANCHO_PANEL = 372;

export interface EstadoDock {
  /** Conversaciones abiertas, en el orden en que se ven (0: la de más a la derecha). */
  abiertos: string[];
  /** Desplegadas ahora (la última enfocada primero). Puede incluir LISTA. */
  desplegados: string[];
  /** De la más usada a la menos usada (para saber cuál cerrar). */
  recientes: string[];
  /** Hay algún panel desplegado. */
  abierto: boolean;
}

const KEY = "prodi-chat-dock";

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))] : [];

function armar(abiertos: string[], desplegados: string[], recientes: string[]): EstadoDock {
  const a = abiertos.slice(0, MAX_ABIERTOS);
  const d = desplegados.filter((id) => id === LISTA || a.includes(id));
  const r = [...recientes.filter((id) => a.includes(id)), ...a.filter((id) => !recientes.includes(id))];
  return { abiertos: a, desplegados: d, recientes: r, abierto: d.length > 0 };
}

function leer(): EstadoDock {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, unknown> | null;
    if (d && Array.isArray(d.abiertos)) return armar(ids(d.abiertos), ids(d.desplegados), ids(d.recientes));
    // Formato anterior: una sola conversación.
    const viejo = typeof d?.chatId === "string" ? d.chatId : null;
    const abierto = d?.abierto === true;
    return armar(viejo ? [viejo] : [], abierto ? [viejo ?? LISTA] : [], []);
  } catch {
    return armar([], [], []);
  }
}

let estado = leer();
/** El chat flotante está montado y visible (se puede abrir una conversación ahí en vez de ir a /chat). */
let disponible = false;
/** Paneles desplegados a la vez que entran en la pantalla (en el celular, 1). */
let capacidad = 1;
const subs = new Set<() => void>();

function set(abiertos: string[], desplegados: string[], recientes = estado.recientes) {
  const nuevo = armar(abiertos, desplegados.slice(0, capacidad), recientes);
  if (
    nuevo.abiertos.join() === estado.abiertos.join() &&
    nuevo.desplegados.join() === estado.desplegados.join() &&
    nuevo.recientes.join() === estado.recientes.join()
  )
    return;
  estado = nuevo;
  try {
    localStorage.setItem(KEY, JSON.stringify({ abiertos: estado.abiertos, desplegados: estado.desplegados, recientes: estado.recientes }));
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

/** Suma la conversación a las abiertas (si ya son 4, sale la menos usada). */
function sumar(id: string, alFrente = false): { abiertos: string[]; desplegados: string[] } {
  let abiertos = estado.abiertos;
  let desplegados = estado.desplegados;
  if (alFrente) abiertos = abiertos.filter((x) => x !== id);
  if (!abiertos.includes(id)) {
    if (abiertos.length >= MAX_ABIERTOS) {
      const sale = estado.recientes[estado.recientes.length - 1] ?? abiertos[abiertos.length - 1];
      abiertos = abiertos.filter((x) => x !== sale);
      desplegados = desplegados.filter((x) => x !== sale);
    }
    abiertos = [id, ...abiertos];
  }
  return { abiertos, desplegados };
}

const usar = (id: string) => [id, ...estado.recientes.filter((x) => x !== id)];

export const dock = {
  /** Abre (o trae) la conversación y la despliega. */
  abrir: (id: string) => {
    const { abiertos, desplegados } = sumar(id);
    set(abiertos, [id, ...desplegados.filter((x) => x !== id)], usar(id));
  },
  /** Igual que abrir, pero la pone primera en la fila (para las que estaban en "+N"). */
  traer: (id: string) => {
    const { abiertos, desplegados } = sumar(id, true);
    set(abiertos, [id, ...desplegados.filter((x) => x !== id)], usar(id));
  },
  /** Despliega la lista de chats. */
  lista: () => set(estado.abiertos, [LISTA, ...estado.desplegados.filter((x) => x !== LISTA)]),
  /** Minimiza un panel (conversación o LISTA). */
  minimizar: (id: string) => set(estado.abiertos, estado.desplegados.filter((x) => x !== id)),
  /** Saca la conversación del chat flotante. */
  cerrar: (id: string) =>
    set(
      estado.abiertos.filter((x) => x !== id),
      estado.desplegados.filter((x) => x !== id)
    ),
  /** Deja una conversación lista en la fila, sin desplegarla. */
  recordar: (id: string) => {
    const { abiertos, desplegados } = sumar(id);
    set(abiertos, desplegados, usar(id));
  },
  /** Saca las conversaciones a las que ya no tiene acceso. */
  quitar: (sinAcceso: (id: string) => boolean) => {
    const fuera = estado.abiertos.filter(sinAcceso);
    if (!fuera.length) return;
    set(
      estado.abiertos.filter((x) => !fuera.includes(x)),
      estado.desplegados.filter((x) => !fuera.includes(x))
    );
  },
  setCapacidad: (n: number) => {
    capacidad = Math.max(1, n);
    set(estado.abiertos, estado.desplegados);
  },
  setDisponible: (v: boolean) => {
    disponible = v;
  },
};

// Mensajes sin leer de cada conversación abierta en el chat flotante (los cuenta la conversación montada).
let sinLeer: Record<string, number> = {};
const subsSinLeer = new Set<() => void>();
export function setSinLeerDock(id: string, n: number) {
  if (sinLeer[id] === n) return;
  sinLeer = { ...sinLeer, [id]: n };
  subsSinLeer.forEach((f) => f());
}
export function useSinLeerDock(): Record<string, number> {
  return useSyncExternalStore(
    (f) => {
      subsSinLeer.add(f);
      return () => subsSinLeer.delete(f);
    },
    () => sinLeer
  );
}

// Conversaciones a la vista ahora mismo (página /chat o paneles desplegados del chat flotante).
const enPantalla = new Map<string, number>();
export const chatEnPantalla = {
  entrar: (id: string) => void enPantalla.set(id, (enPantalla.get(id) ?? 0) + 1),
  salir: (id: string) => {
    const n = (enPantalla.get(id) ?? 0) - 1;
    if (n > 0) enPantalla.set(id, n);
    else enPantalla.delete(id);
  },
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

// Mensaje a medio escribir para cuando se abre una conversación desde otra pantalla
// (por ejemplo "Hablarlo con el cliente" desde una corrección): la caja aparece con ese texto.
const borradores = new Map<string, string>();
export function prepararBorrador(chatId: string, texto: string) {
  borradores.set(chatId, texto);
}
export function tomarBorrador(chatId: string): string | null {
  const t = borradores.get(chatId) ?? null;
  borradores.delete(chatId);
  return t;
}
