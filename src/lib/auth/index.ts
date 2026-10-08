// Sesión del usuario en el navegador (reemplaza a Firebase Auth, con los mismos nombres
// para no tocar el resto de la app). La sesión es un token que da /api/auth y se guarda
// en este navegador; dura 30 días o hasta que cambies la contraseña.

const CLAVE = "prodi-sesion";

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  providerData: { providerId: string }[];
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

interface Guardado {
  token: string;
  uid: string;
  email: string | null;
  nombre: string | null;
}

class ErrorAuth extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

function leer(): Guardado | null {
  try {
    const raw = localStorage.getItem(CLAVE);
    return raw ? (JSON.parse(raw) as Guardado) : null;
  } catch {
    return null;
  }
}
function escribir(g: Guardado | null) {
  try {
    if (g) localStorage.setItem(CLAVE, JSON.stringify(g));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: la sesión dura lo que la pestaña */
  }
}

function usuarioDe(g: Guardado): User {
  return {
    uid: g.uid,
    email: g.email,
    displayName: g.nombre,
    providerData: [{ providerId: "password" }],
    getIdToken: async () => {
      const actual = leer();
      if (!actual || actual.uid !== g.uid) throw new ErrorAuth("auth/no-current-user", "Sesión vencida. Volvé a ingresar.");
      return actual.token;
    },
  };
}

let guardado = leer();
export const auth: { currentUser: User | null } = { currentUser: guardado ? usuarioDe(guardado) : null };

const oyentes = new Set<(u: User | null) => void>();
let validada = false;
let validando: Promise<void> | null = null;

function avisar() {
  oyentes.forEach((cb) => cb(auth.currentUser));
}
function setSesion(g: Guardado | null) {
  guardado = g;
  escribir(g);
  auth.currentUser = g ? usuarioDe(g) : null;
  avisar();
}

async function llamar<T>(accion: string, body: Record<string, unknown>, token?: string): Promise<T> {
  const res = await fetch(`/api/auth/${accion}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let data: { error?: string; code?: string } & Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* vacío */
  }
  if (!res.ok) {
    let code = data.code ?? (res.status === 401 ? "auth/session-expired" : `http/${res.status}`);
    if (code === "auth/email-already-exists") code = "auth/email-already-in-use";
    throw new ErrorAuth(code, data.error ?? `Error ${res.status}`);
  }
  return data as T;
}

/** Al abrir la app: confirma con el servidor que la sesión guardada sigue valiendo. */
function validar(): Promise<void> {
  if (validando) return validando;
  validando = (async () => {
    const g = leer();
    if (!g) {
      validada = true;
      return;
    }
    try {
      const r = await llamar<{ uid: string; email: string; nombre: string | null }>("yo", {}, g.token);
      setSesion({ ...g, email: r.email, nombre: r.nombre });
    } catch (err) {
      // Sin conexión no se cierra la sesión; solo si el servidor dice que venció.
      if ((err as ErrorAuth).code === "auth/session-expired") setSesion(null);
    } finally {
      validada = true;
    }
  })();
  return validando;
}

export function onAuthStateChanged(_auth: unknown, cb: (u: User | null) => void): () => void {
  oyentes.add(cb);
  if (validada) setTimeout(() => oyentes.has(cb) && cb(auth.currentUser), 0);
  else void validar().then(() => oyentes.has(cb) && cb(auth.currentUser));
  return () => oyentes.delete(cb);
}

/** Si alguna llamada a /api dice que la sesión venció, se cierra en todas las pantallas. */
export function sesionVencida() {
  if (auth.currentUser) setSesion(null);
}

export async function signInWithEmailAndPassword(_auth: unknown, email: string, password: string) {
  const r = await llamar<{ token: string; uid: string; email: string; nombre: string | null }>("login", { email, password });
  setSesion({ token: r.token, uid: r.uid, email: r.email, nombre: r.nombre });
  return { user: auth.currentUser! };
}

export async function createUserWithEmailAndPassword(_auth: unknown, email: string, password: string, nombre?: string, codigo?: string) {
  const r = await llamar<{ token: string; uid: string; email: string }>("registrar", { email, password, nombre: nombre ?? "", codigo: codigo ?? "" });
  setSesion({ token: r.token, uid: r.uid, email: r.email, nombre: nombre ?? null });
  return { user: auth.currentUser! };
}

export async function signOut(_auth?: unknown) {
  setSesion(null);
}

export async function updateProfile(user: User, datos: { displayName?: string | null }) {
  const g = leer();
  if (!g || g.uid !== user.uid) return;
  if (datos.displayName !== undefined) {
    await llamar("nombre", { nombre: datos.displayName ?? "" }, g.token);
    setSesion({ ...g, nombre: datos.displayName ?? null });
  }
}

// Cambiar la contraseña: primero se confirma la actual (como pedía Firebase) y después se cambia.
let claveActual: string | null = null;
export const EmailAuthProvider = {
  credential: (email: string, password: string) => ({ email, password }),
};
export async function reauthenticateWithCredential(_user: User, cred: { email: string; password: string }) {
  claveActual = cred.password;
}
export async function updatePassword(user: User, nueva: string) {
  const g = leer();
  if (!g || g.uid !== user.uid) throw new ErrorAuth("auth/no-current-user", "Sesión vencida. Volvé a ingresar.");
  if (!claveActual) throw new ErrorAuth("auth/requires-recent-login", "Confirmá tu contraseña actual");
  try {
    const r = await llamar<{ token: string }>("cambiar-clave", { actual: claveActual, nueva }, g.token);
    setSesion({ ...g, token: r.token });
  } finally {
    claveActual = null;
  }
}

/** Link para crear o cambiar la contraseña (lo genera el admin o llega por mail). */
export async function usarLinkDeClave(token: string, nueva: string) {
  const r = await llamar<{ token: string; email: string }>("usar-link", { token, nueva });
  const yo = await llamar<{ uid: string; email: string; nombre: string | null }>("yo", {}, r.token);
  setSesion({ token: r.token, uid: yo.uid, email: yo.email, nombre: yo.nombre });
  return { user: auth.currentUser! };
}

/** Avisos push de este dispositivo. */
export async function guardarPush(suscripcion: PushSubscriptionJSON | null, quitar?: string | true, app: "chat" | "sistema" = "sistema") {
  const g = leer();
  if (!g) return;
  await llamar("push", quitar ? { quitar } : { suscripcion, app }, g.token);
}

// Compatibilidad con la inicialización anterior.
export const getAuth = () => auth;
export const setPersistence = async () => undefined;
export const browserLocalPersistence = {};
