// Copia local (IndexedDB) de lo que cada pantalla ya bajó de la base, con su marca (`rev`). Al volver a
// abrir la app se muestra al toque y se piden solo los cambios desde esa marca: así no se vuelve a bajar
// todo cada vez (es lo que más tráfico le saca a la base). Es por usuario, y se borra al cerrar sesión.
// Si el navegador no deja guardar (modo privado), simplemente no hay copia y se baja todo como antes.

export interface CopiaLocal {
  rev: number;
  /** Cuándo se bajó todo completo por última vez (ms). */
  completo: number;
  docs: [string, Record<string, unknown>][];
}

const BASE = "prodi-cache";
const VERSION = 1;
const TABLA = "consultas";

let abriendo: Promise<IDBDatabase | null> | null = null;
function abrir(): Promise<IDBDatabase | null> {
  if (abriendo) return abriendo;
  abriendo = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(BASE, VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(TABLA);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return abriendo;
}

export async function leerCopia(clave: string): Promise<CopiaLocal | null> {
  const db = await abrir();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(TABLA, "readonly").objectStore(TABLA).get(clave);
      req.onsuccess = () => resolve((req.result as CopiaLocal | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const pendientes = new Map<string, ReturnType<typeof setTimeout>>();
/** Guarda la copia (con una pausa corta: si llegan varios cambios seguidos, se escribe una vez). */
export function guardarCopia(clave: string, copia: () => CopiaLocal) {
  clearTimeout(pendientes.get(clave));
  pendientes.set(
    clave,
    setTimeout(async () => {
      pendientes.delete(clave);
      const db = await abrir();
      if (!db) return;
      try {
        db.transaction(TABLA, "readwrite").objectStore(TABLA).put(copia(), clave);
      } catch {
        /* sin lugar o bloqueado: la próxima vez se baja todo */
      }
    }, 1500)
  );
}

/** Al cerrar sesión: que no quede nada guardado en el dispositivo. */
export async function borrarCopias() {
  pendientes.forEach((t) => clearTimeout(t));
  pendientes.clear();
  const db = await abrir();
  if (!db) return;
  try {
    db.transaction(TABLA, "readwrite").objectStore(TABLA).clear();
  } catch {
    /* nada */
  }
}
