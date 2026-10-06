// Instalar el sistema como app (PWA): en Android y compu se instala con un toque;
// en iPhone se agrega a la pantalla de inicio desde Safari. No hace falta App Store ni Play Store.

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let promptGuardado: BeforeInstallPromptEvent | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

/** Se llama al arrancar la app: el navegador avisa una sola vez y temprano. */
export function escucharInstalacion() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptGuardado = e as BeforeInstallPromptEvent;
    avisar();
  });
  window.addEventListener("appinstalled", () => {
    promptGuardado = null;
    avisar();
  });
}

export type Plataforma = "android" | "iphone" | "compu";

export function plataforma(): Plataforma {
  if (typeof navigator === "undefined") return "compu";
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  return "compu";
}

/** iPhone: solo Safari (o Chrome en iOS 16.4+) puede agregarla a inicio. */
export function esSafariIOS(): boolean {
  const ua = navigator.userAgent || "";
  return plataforma() === "iphone" && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
}

export function yaInstalada(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

/** Link opcional al instalador de Android (.apk) para descargar directo. */
export const APK_URL = (import.meta.env.VITE_APK_URL as string | undefined) || "";

export function useInstalarApp() {
  const [, forzar] = useState(0);
  useEffect(() => {
    const f = () => forzar((n) => n + 1);
    oyentes.add(f);
    return () => {
      oyentes.delete(f);
    };
  }, []);
  return {
    instalada: yaInstalada(),
    /** El navegador permite instalar con un toque (Android y compu con Chrome/Edge). */
    directa: !!promptGuardado,
    plataforma: plataforma(),
    instalar: async (): Promise<"aceptada" | "cancelada" | "sin_prompt"> => {
      if (!promptGuardado) return "sin_prompt";
      await promptGuardado.prompt();
      const r = await promptGuardado.userChoice;
      promptGuardado = null;
      avisar();
      return r.outcome === "accepted" ? "aceptada" : "cancelada";
    },
  };
}
