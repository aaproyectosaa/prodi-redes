import { useEffect } from "react";

/**
 * iPhone (Safari y app instalada): el teclado no achica la pantalla (100dvh sigue igual, `interactive-widget` no
 * se respeta) y tapa lo que está abajo, como la caja de escribir del chat. Mientras el alto visible es bastante
 * menor que la pantalla, lo publicamos en --alto-app para que el layout (.alto-app) entre justo arriba del teclado.
 * En Android, con `resizes-content`, la pantalla ya se achica sola y esto no se activa.
 */
export function useAltoVisible() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const raiz = document.documentElement;
    const ajustar = () => {
      // (Con zoom de pellizco el alto visible también baja: eso no es el teclado.)
      const tapado = window.innerWidth < 768 && vv.scale < 1.05 && vv.height < window.innerHeight * 0.85;
      if (tapado) {
        raiz.style.setProperty("--alto-app", `${Math.round(vv.height)}px`);
        // Safari corre la página para mostrar el campo: la volvemos arriba, que ahora entra entera.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      } else raiz.style.removeProperty("--alto-app");
    };
    vv.addEventListener("resize", ajustar);
    ajustar();
    return () => {
      vv.removeEventListener("resize", ajustar);
      raiz.style.removeProperty("--alto-app");
    };
  }, []);
}
