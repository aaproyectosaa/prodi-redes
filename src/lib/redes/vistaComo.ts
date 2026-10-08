/**
 * Modo "ver como": el super admin mira el sistema como otro usuario. Por defecto en solo lectura
 * (todas las acciones que escriben datos llaman a assertEditable()). Con "Permitir cambios" puede
 * modificar, y lo que escribe queda a SU nombre, no al de la persona que está mirando (ver `autoria`).
 */
let soloLectura = false;
let nombreVista = "";
let uidVista = "";
let uidReal = "";

const KEY_EDITAR = "prodi-ver-como-editar";
let editable = leerEditable();

function leerEditable(): boolean {
  try {
    return sessionStorage.getItem(KEY_EDITAR) === "1";
  } catch {
    return false;
  }
}

export function setModoVista(activo: boolean, nombre = "", ids: { vista?: string; real?: string } = {}) {
  soloLectura = activo;
  nombreVista = nombre;
  uidVista = activo ? ids.vista ?? "" : "";
  uidReal = ids.real ?? "";
}

export function enModoVista(): boolean {
  return soloLectura;
}

/** ¿Está viendo como otro y con "Permitir cambios" prendido? */
export const cambiosPermitidos = () => soloLectura && editable;

/** Prende o apaga "Permitir cambios" (dura lo que la pestaña). */
export function permitirCambios(v: boolean) {
  editable = v;
  try {
    if (v) sessionStorage.setItem(KEY_EDITAR, "1");
    else sessionStorage.removeItem(KEY_EDITAR);
  } catch {
    /* ignore */
  }
}

export class ModoVistaError extends Error {
  constructor() {
    super(`Estás viendo como ${nombreVista || "otro usuario"}: es solo lectura. Prendé «Permitir cambios» arriba o volvé a tu cuenta.`);
  }
}

export function assertEditable(): void {
  if (soloLectura && !editable) throw new ModoVistaError();
}

// Campos que dicen quién hizo algo (by, created_by, solicitado_por, autor…).
const ES_AUTOR = /^(by|por|autor|de)$|_(by|por)$/;

/**
 * Lo que se escribe en "ver como" con cambios permitidos queda a nombre del super admin: los campos de
 * autor con el uid de la persona que se mira pasan al del admin, y las claves con su uid (ej. `leido.<uid>`
 * de un chat) también, así mirar no le marca nada como leído a la otra persona.
 */
export function autoria<T>(data: T): T {
  if (!cambiosPermitidos() || !uidVista || !uidReal) return data;
  const cambiar = (x: unknown, clave = ""): unknown => {
    if (typeof x === "string") return x === uidVista && ES_AUTOR.test(clave) ? uidReal : x;
    if (Array.isArray(x)) return x.map((y) => cambiar(y, clave));
    if (x && typeof x === "object") {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>).map(([k, v]) => [k.split(uidVista).join(uidReal), cambiar(v, k === "v" ? clave : k)])
      );
    }
    return x;
  };
  return cambiar(data) as T;
}

const KEY = "prodi-ver-como";
export function guardarVistaComo(uid: string | null) {
  try {
    if (uid) sessionStorage.setItem(KEY, uid);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  // Al entrar a mirar a otro (o al salir), se vuelve a solo lectura.
  permitirCambios(false);
}
export function leerVistaComo(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
