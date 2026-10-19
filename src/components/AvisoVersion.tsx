import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useLlamada } from "@/lib/redes/chatVoz";

// Versión nueva publicada mientras la app estaba abierta (pasa mucho con la app instalada, que nunca se cierra).
// Cada build tiene su propio /assets/main-XXXX.js: se compara el que está corriendo con el del index.html publicado.
// Al encontrar una nueva: aviso con "Actualizar" y se recarga sola en el próximo cambio de pantalla o al volver a la app,
// nunca en medio de una llamada, con una ventana abierta o escribiendo algo.

const CADA = 5 * 60_000;
const MINIMO_ENTRE_CHEQUEOS = 60_000;
const RE_MAIN = /\/assets\/main-[\w-]+\.js/;

const mainCorriendo = () =>
  [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => s.src.match(RE_MAIN)?.[0]).find(Boolean) ?? null;

async function mainPublicado(): Promise<string | null> {
  try {
    const r = await fetch(`/?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "text/html" } });
    if (!r.ok) return null;
    return (await r.text()).match(RE_MAIN)?.[0] ?? null;
  } catch {
    return null; // sin conexión: se vuelve a probar después
  }
}

/** Si recargar ahora le haría perder algo a la persona (una ventana abierta o un campo con texto escrito). */
function ocupado(): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !!(el as HTMLInputElement).value;
}

export function AvisoVersion() {
  const [nueva, setNueva] = useState(false);
  const enLlamada = !!useLlamada();
  const location = useLocation();
  const primeraRuta = useRef(location.key);
  const enLlamadaRef = useRef(enLlamada);
  enLlamadaRef.current = enLlamada;

  const recargar = () => {
    if (enLlamadaRef.current || ocupado()) return false;
    window.location.reload();
    return true;
  };

  // Buscar versión nueva: cada 5 minutos con la app a la vista, al volver a la app y al recuperar la conexión.
  useEffect(() => {
    const actual = mainCorriendo();
    if (import.meta.env.DEV || !actual) return; // en desarrollo no hay main-XXXX.js
    let ultimo = 0;
    let hallada = false;
    const chequear = async () => {
      if (hallada || document.hidden || Date.now() - ultimo < MINIMO_ENTRE_CHEQUEOS) return;
      ultimo = Date.now();
      const publicado = await mainPublicado();
      if (publicado && publicado !== actual) {
        hallada = true;
        setNueva(true);
      }
    };
    const t = window.setInterval(chequear, CADA);
    const alVolver = () => !document.hidden && void chequear();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    window.addEventListener("online", alVolver);
    void chequear();
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener("online", alVolver);
    };
  }, []);

  // Con versión nueva: el aviso queda fijo hasta que se actualice.
  useEffect(() => {
    if (!nueva) return;
    toast("Hay una versión nueva de Prodi", {
      id: "version-nueva",
      description: "Actualizá para ver lo último. Se actualiza sola cuando cambies de pantalla.",
      duration: Infinity,
      action: { label: "Actualizar", onClick: () => window.location.reload() },
    });
  }, [nueva]);

  // Cambió de pantalla: buen momento para recargar sin que se note.
  useEffect(() => {
    if (nueva && location.key !== primeraRuta.current) recargar();
  }, [location.key, nueva]);

  // Vuelve a la app después de un rato afuera: se recarga si no estaba en medio de algo.
  useEffect(() => {
    if (!nueva) return;
    let oculta = 0;
    const cambio = () => {
      if (document.hidden) oculta = Date.now();
      else if (oculta && Date.now() - oculta > 60_000) recargar();
    };
    document.addEventListener("visibilitychange", cambio);
    return () => document.removeEventListener("visibilitychange", cambio);
  }, [nueva]);

  return null;
}
