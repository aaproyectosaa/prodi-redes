import { useEffect, useState } from "react";
import { Bell, Download, Loader2, Maximize, MoreVertical, PlusSquare, Share, Smartphone, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { asset } from "@/lib/asset";
import { APK_URL, esSafariIOS, useInstalarApp, type Plataforma } from "@/lib/instalar";
import { cn } from "@/lib/utils";

/** Pasos para cada dispositivo cuando el navegador no permite instalar con un toque. */
function Pasos({ plataforma }: { plataforma: Plataforma }) {
  const pasos: { icon: React.ElementType; texto: React.ReactNode }[] =
    plataforma === "iphone"
      ? [
          ...(esSafariIOS()
            ? []
            : [{ icon: Smartphone, texto: <>Abrí este link en <b>Safari</b> (en otros navegadores de iPhone no siempre aparece).</> }]),
          { icon: Share, texto: <>Tocá el botón <b>Compartir</b> (el cuadradito con la flecha para arriba).</> },
          { icon: PlusSquare, texto: <>Elegí <b>“Agregar a inicio”</b> y después <b>“Agregar”</b>.</> },
          { icon: Smartphone, texto: <>Listo: Prodi aparece en tu pantalla de inicio como una app más.</> },
        ]
      : plataforma === "android"
        ? [
            { icon: MoreVertical, texto: <>Tocá el menú <b>⋮</b> de Chrome (arriba a la derecha).</> },
            { icon: Download, texto: <>Elegí <b>“Instalar app”</b> (o “Agregar a pantalla principal”).</> },
            { icon: Smartphone, texto: <>Listo: Prodi queda en tus apps, con su ícono.</> },
          ]
        : [
            { icon: Download, texto: <>En Chrome o Edge, tocá el ícono de <b>instalar</b> que aparece a la derecha de la barra de direcciones.</> },
            { icon: MoreVertical, texto: <>Si no lo ves: menú <b>⋮</b> → <b>“Transmitir, guardar y compartir”</b> → <b>“Instalar página como app”</b>.</> },
            { icon: Smartphone, texto: <>Se abre en su propia ventana y queda en el escritorio y en el menú de inicio.</> },
          ];
  return (
    <ol className="space-y-2.5">
      {pasos.map((p, i) => (
        <li key={i} className="flex items-start gap-3 rounded-xl border bg-card p-3 text-sm">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {i + 1}
          </span>
          <span className="pt-0.5">{p.texto}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstalarDialog({
  open,
  onOpenChange,
  invitacion = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Se abrió solo (popup): muestra los beneficios y el botón "Más tarde". */
  invitacion?: boolean;
}) {
  const app = useInstalarApp();
  const [plat, setPlat] = useState<Plataforma>(app.plataforma);
  useEffect(() => {
    if (open) setPlat(app.plataforma);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const instalar = async () => {
    const r = await app.instalar();
    if (r === "aceptada") {
      toast.success("¡Listo! Prodi ya está instalada.");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <img src={asset("/icons/icon-192.png")} alt="" className="h-16 w-16 rounded-2xl shadow-lg" />
          <DialogTitle className="text-xl">{invitacion ? "Instalá la app de Prodi" : "Instalá Prodi como app"}</DialogTitle>
          <DialogDescription>
            Se abre a pantalla completa, con su ícono y avisos, como cualquier app. Sin Play Store ni App Store, y se
            actualiza sola.
          </DialogDescription>
        </div>
        {invitacion && !app.instalada && (
          <ul className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
            {[
              [Bell, "Avisos al instante"],
              [Zap, "Un toque desde tu inicio"],
              [Maximize, "Pantalla completa"],
            ].map(([I, t]) => {
              const Icono = I as React.ElementType;
              return (
                <li key={t as string} className="flex flex-col items-center gap-1.5 rounded-xl border bg-card p-2.5">
                  <Icono className="h-4 w-4 text-primary" />
                  {t as string}
                </li>
              );
            })}
          </ul>
        )}

        {app.instalada ? (
          <p className="rounded-xl border border-success/40 bg-success/10 p-3 text-center text-sm">Ya la estás usando como app 👌</p>
        ) : (
          <div className="space-y-4">
            {app.directa && (
              <Button size="lg" className="w-full" onClick={() => void instalar()}>
                <Download className="mr-2 h-4 w-4" /> Instalar ahora
              </Button>
            )}

            <div className="grid grid-cols-3 gap-1 rounded-xl border bg-muted/40 p-1" role="tablist">
              {(
                [
                  ["android", "Android"],
                  ["iphone", "iPhone"],
                  ["compu", "Compu"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={plat === v}
                  onClick={() => setPlat(v)}
                  className={cn(
                    "rounded-lg py-1.5 text-sm font-medium transition-all",
                    plat === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>

            {app.directa && plat === app.plataforma ? (
              <p className="text-center text-xs text-muted-foreground">Con el botón de arriba se instala en un toque.</p>
            ) : (
              <Pasos plataforma={plat} />
            )}
            {invitacion && (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              >
                Más tarde
              </button>
            )}

            {plat === "android" && APK_URL && (
              <a
                href={APK_URL}
                className="flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
              >
                <Download className="h-4 w-4" /> Descargar instalador para Android (.apk)
              </a>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Un solo diálogo para toda la app (los menús se cierran al tocar y no deben llevárselo puesto).
const abridores = new Set<() => void>();
export const abrirInstalar = () => abridores.forEach((f) => f());

/** Botón para el menú lateral y el menú del celular. */
export function BotonInstalar({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  const app = useInstalarApp();
  if (app.instalada) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => abrirInstalar()}
        className={cn(
          "flex h-9 w-full items-center gap-2.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          collapsed ? "justify-center" : "px-3",
          className
        )}
        title="Instalar app"
      >
        <Smartphone className="h-4 w-4" />
        {!collapsed && <span>Instalar app</span>}
      </button>
    </>
  );
}

const CLAVE_POPUP = "prodi-popup-instalar";
const CLAVE_AVISOS = "prodi-popup-avisos";

/** Espera a que no haya otro diálogo abierto (por ejemplo, la bienvenida del cliente). */
function cuandoNoHayDialogo(cb: () => void): () => void {
  let t = 0;
  const probar = () => {
    if (document.querySelector('[role="dialog"]')) t = window.setTimeout(probar, 1500);
    else cb();
  };
  t = window.setTimeout(probar, 1800);
  return () => window.clearTimeout(t);
}

const yaMostrado = (clave: string) => {
  try {
    return !!sessionStorage.getItem(clave);
  } catch {
    return false;
  }
};
const marcarMostrado = (clave: string) => {
  try {
    sessionStorage.setItem(clave, "1");
  } catch {
    /* nada */
  }
};

/**
 * Popup para instalar la app: aparece en cada visita (una vez por sesión) mientras no la tengan instalada.
 * También es el diálogo que abre el botón "Instalar app" de los menús.
 */
export function AvisoInstalar() {
  const app = useInstalarApp();
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    const f = () => {
      setAuto(false);
      setOpen(true);
    };
    abridores.add(f);
    return () => {
      abridores.delete(f);
    };
  }, []);

  useEffect(() => {
    if (app.instalada || yaMostrado(CLAVE_POPUP)) return;
    return cuandoNoHayDialogo(() => {
      marcarMostrado(CLAVE_POPUP);
      setAuto(true);
      setOpen(true);
    });
  }, [app.instalada]);

  return <InstalarDialog open={open} onOpenChange={setOpen} invitacion={auto} />;
}

/**
 * Con la app instalada, si todavía no activaron los avisos en este equipo,
 * se lo pedimos con un toque. Una vez por sesión, se puede dejar para después.
 */
export function AvisoActivarAvisos({ uid }: { uid?: string }) {
  const app = useInstalarApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid || typeof Notification === "undefined" || Notification.permission !== "default") return;
    // Primero que instalen la app (el popup de instalar va antes); después, los avisos.
    // En iPhone además es obligatorio: los avisos solo funcionan con la app instalada.
    if (!app.instalada) return;
    if (yaMostrado(CLAVE_AVISOS)) return;
    let cancel = () => undefined as void;
    void import("@/lib/webPush").then(async ({ isWebPushSupported }) => {
      if (!(await isWebPushSupported())) return;
      cancel = cuandoNoHayDialogo(() => {
        marcarMostrado(CLAVE_AVISOS);
        setOpen(true);
      });
    });
    return () => cancel();
  }, [uid, app.instalada, app.plataforma]);

  const activar = async () => {
    if (!uid) return;
    setBusy(true);
    try {
      const { subscribeWebPush } = await import("@/lib/webPush");
      await subscribeWebPush(uid);
      toast.success("¡Listo! Te vamos a avisar de todo.");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron activar los avisos");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl">
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary animate-in zoom-in-50 duration-500">
            <Bell className="h-7 w-7" />
          </span>
          <DialogTitle className="text-xl">Activá los avisos</DialogTitle>
          <DialogDescription>
            Te avisamos al instante cuando haya un video para ver, un mensaje en el chat o un rodaje al día siguiente.
          </DialogDescription>
          <Button size="lg" className="mt-1 w-full" onClick={() => void activar()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
            Activar avisos
          </Button>
          <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">
            Más tarde
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
