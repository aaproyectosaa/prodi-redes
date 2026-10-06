/**
 * Modo "ver como": el super admin mira el sistema como otro usuario, en solo
 * lectura. Todas las acciones que escriben datos llaman a assertEditable().
 */
let soloLectura = false;
let nombreVista = "";

export function setModoVista(activo: boolean, nombre = "") {
  soloLectura = activo;
  nombreVista = nombre;
}

export function enModoVista(): boolean {
  return soloLectura;
}

export class ModoVistaError extends Error {
  constructor() {
    super(`Estás viendo como ${nombreVista || "otro usuario"}: es solo lectura. Volvé a tu cuenta para hacer cambios.`);
  }
}

export function assertEditable(): void {
  if (soloLectura) throw new ModoVistaError();
}

const KEY = "prodi-ver-como";
export function guardarVistaComo(uid: string | null) {
  try {
    if (uid) sessionStorage.setItem(KEY, uid);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
export function leerVistaComo(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
