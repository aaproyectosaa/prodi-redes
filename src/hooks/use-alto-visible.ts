import { useEffect } from "react";

export const esCampoDeTexto = (el: Element | null) =>
  !!el &&
  (el.tagName === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable ||
    (el.tagName === "INPUT" && !["checkbox", "radio", "range", "color", "file", "button", "submit"].includes((el as HTMLInputElement).type)));

/**
 * iPhone (Safari y app instalada): el teclado no achica la pantalla (100dvh sigue igual, `interactive-widget` no se
 * respeta). Safari además corre la parte visible (visualViewport.offsetTop) para mostrar el campo, así que una caja
 * pegada arriba con el alto visible queda corrida: se veía solo la caja de escribir flotando y un hueco negro.
 *
 * Mientras haya un campo enfocado y el alto visible sea bastante menor que la pantalla, la caja de la app (.alto-app,
 * position: fixed) sigue a la parte visible: --arriba-app = offsetTop, --alto-app = alto visible. Sin teclado vuelve a
 * top:0/bottom:0 (toda la pantalla), así un alto viejo nunca queda pegado (la lista cortada a la mitad).
 * En Android, con `resizes-content`, la pantalla ya se achica sola y esto no se activa.
 */
export function useAltoVisible() {
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.add("vista-fija");
    const vv = window.visualViewport;
    if (!vv) return () => raiz.classList.remove("vista-fija");
    let raf = 0;
    let espera: ReturnType<typeof setTimeout> | undefined;
    let estaba = false;

    const aplicar = () => {
      raf = 0;
      // Alto completo: el del layout viewport (no cambia con el teclado en iOS).
      const lleno = Math.max(window.innerHeight, raiz.clientHeight);
      // Con zoom de pellizco el alto visible también baja: eso no es el teclado.
      const teclado =
        window.innerWidth < 768 && vv.scale < 1.05 && esCampoDeTexto(document.activeElement) && vv.height < lleno * 0.85;
      if (teclado) {
        raiz.style.setProperty("--alto-app", `${Math.round(vv.height)}px`);
        raiz.style.setProperty("--arriba-app", `${Math.max(0, Math.round(vv.offsetTop))}px`);
        raiz.classList.add("teclado-ios");
        if (!estaba) window.dispatchEvent(new Event("teclado-ios"));
      } else {
        raiz.style.removeProperty("--alto-app");
        raiz.style.removeProperty("--arriba-app");
        raiz.classList.remove("teclado-ios");
        // Safari a veces deja la página corrida al cerrar el teclado.
        if (window.scrollY !== 0 || raiz.scrollTop !== 0) window.scrollTo(0, 0);
      }
      estaba = teclado;
    };
    const pedir = () => {
      if (!raf) raf = requestAnimationFrame(aplicar);
    };
    // Al salir de un campo el teclado tarda en irse: revisamos de nuevo cuando terminó.
    const alFoco = () => {
      pedir();
      clearTimeout(espera);
      espera = setTimeout(pedir, 400);
    };

    vv.addEventListener("resize", pedir);
    vv.addEventListener("scroll", pedir);
    window.addEventListener("resize", pedir);
    window.addEventListener("orientationchange", alFoco);
    window.addEventListener("pageshow", alFoco);
    document.addEventListener("visibilitychange", alFoco);
    document.addEventListener("focusin", alFoco);
    document.addEventListener("focusout", alFoco);
    aplicar();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(espera);
      vv.removeEventListener("resize", pedir);
      vv.removeEventListener("scroll", pedir);
      window.removeEventListener("resize", pedir);
      window.removeEventListener("orientationchange", alFoco);
      window.removeEventListener("pageshow", alFoco);
      document.removeEventListener("visibilitychange", alFoco);
      document.removeEventListener("focusin", alFoco);
      document.removeEventListener("focusout", alFoco);
      raiz.style.removeProperty("--alto-app");
      raiz.style.removeProperty("--arriba-app");
      raiz.classList.remove("teclado-ios", "vista-fija");
    };
  }, []);
}
