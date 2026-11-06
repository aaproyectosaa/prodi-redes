import { useEffect, useState } from "react";

const CLAVE = "prodi-medidas-pantalla-vistas";

/** Temporal: en el iPhone con la app instalada muestra una vez las medidas de la pantalla, para ajustar la franja de abajo. */
export function MedidasPantalla() {
  const [filas, setFilas] = useState<[string, string][] | null>(null);

  useEffect(() => {
    const instalada = (navigator as { standalone?: boolean }).standalone === true;
    if (!instalada || !/iPhone/.test(navigator.userAgent)) return;
    try {
      if (localStorage.getItem(CLAVE)) return;
    } catch {
      return;
    }
    const espera = setTimeout(() => {
      const medir = (css: string, dato: (el: HTMLElement) => string) => {
        const el = document.createElement("div");
        el.style.cssText = `visibility:hidden;pointer-events:none;width:1px;${css}`;
        document.body.appendChild(el);
        const valor = dato(el);
        el.remove();
        return valor;
      };
      const alto = (el: HTMLElement) => String(Math.round(el.getBoundingClientRect().height));
      const raiz = document.documentElement;
      setFilas([
        ["iOS", /OS (\d+[_\d]*)/.exec(navigator.userAgent)?.[1]?.replace(/_/g, ".") ?? "?"],
        ["Pantalla", `${screen.width} x ${screen.height}`],
        ["innerHeight", String(window.innerHeight)],
        ["Visible", String(Math.round(window.visualViewport?.height ?? 0))],
        ["Fija", medir("position:fixed;top:0;bottom:0;left:0", alto)],
        ["100vh", medir("position:fixed;top:0;left:0;height:100vh", alto)],
        ["100dvh", medir("position:fixed;top:0;left:0;height:100dvh", alto)],
        ["Zona segura", medir("position:fixed;top:0;left:0;padding-bottom:env(safe-area-inset-bottom)", (el) => getComputedStyle(el).paddingBottom)],
        ["Falta abajo", getComputedStyle(raiz).getPropertyValue("--falta-abajo").trim() || "0"],
      ]);
    }, 1500);
    return () => clearTimeout(espera);
  }, []);

  if (!filas) return null;
  const cerrar = () => {
    try {
      localStorage.setItem(CLAVE, "1");
    } catch {
      /* si no se puede guardar, vuelve a aparecer la próxima vez */
    }
    setFilas(null);
  };
  return (
    <div className="fixed inset-x-4 top-24 z-[200] rounded-2xl border bg-card p-4 text-sm text-card-foreground shadow-2xl">
      <p className="font-semibold">Medidas de tu pantalla</p>
      <p className="mb-2 text-xs text-muted-foreground">Sacale una captura y pasásela a Claude.</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-xs">
        {filas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={cerrar} className="mt-3 h-9 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        Cerrar
      </button>
    </div>
  );
}
