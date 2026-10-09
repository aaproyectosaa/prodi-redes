// "Ocultar montos" (el ojito): tapa la plata y difumina los gráficos, por ejemplo para mostrar la pantalla.
// Queda guardado en este dispositivo. formatARS lo respeta; los gráficos se difuminan con la clase `ocultar-montos`.

import { useSyncExternalStore } from "react";

const CLAVE = "prodi-ocultar-montos";
const oyentes = new Set<() => void>();

let oculto = (() => {
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
})();

const aplicarClase = () => {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("ocultar-montos", oculto);
};
aplicarClase();

export const montosOcultos = () => oculto;

export function setMontosOcultos(v: boolean) {
  oculto = v;
  try {
    localStorage.setItem(CLAVE, v ? "1" : "0");
  } catch {
    /* sin almacenamiento: dura hasta recargar */
  }
  aplicarClase();
  oyentes.forEach((f) => f());
}

export function useMontosOcultos(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => oculto
  );
  return [v, setMontosOcultos];
}

export const MONTO_OCULTO = "$ •••••";
