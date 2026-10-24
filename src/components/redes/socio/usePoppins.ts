import { useEffect } from "react";

/** Carga Poppins (la tipografía de la marca) solo en las pantallas del socio comercial. */
export function usePoppins() {
  useEffect(() => {
    const id = "fuente-poppins";
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);
}
