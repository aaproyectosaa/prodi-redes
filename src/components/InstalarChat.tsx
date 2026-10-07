import { useEffect, useState } from "react";
import { Copy, Download, MessageCircle, MoreVertical, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { asset } from "@/lib/asset";
import { esSafariIOS, plataforma, useInstalarApp, type Plataforma } from "@/lib/instalar";
import {
  avisoChatCerrado,
  cerrarAvisoChat,
  chatAppInstalada,
  enModoChat,
  irAInstalarChat,
  urlChatApp,
} from "@/lib/chatApp";
import { cn } from "@/lib/utils";

/** Pasos para instalar Prodi Chat. `enPagina`: ya está en /chat-app (donde se instala). */
function PasosChat({ plat, enPagina }: { plat: Plataforma; enPagina: boolean }) {
  const link = urlChatApp().replace(/^https?:\/\//, "");
  const abrir = (nav: string) => ({
    icon: Smartphone,
    texto: (
      <>
        Abrí <b className="break-all">{link}</b> en <b>{nav}</b>.
      </>
    ),
  });
  const pasos: { icon: React.ElementType; texto: React.ReactNode }[] =
    plat === "iphone"
      ? [
          ...(!enPagina || !esSafariIOS() ? [abrir("Safari")] : []),
          { icon: Share, texto: <>Tocá <b>Compartir</b> (el cuadradito con la flecha para arriba).</> },
          { icon: PlusSquare, texto: <>Elegí <b>“Agregar a inicio”</b> y después <b>“Agregar”</b>.</> },
          { icon: MessageCircle, texto: <>Listo: <b>Prodi Chat</b> queda en tu inicio, al lado de Prodi.</> },
        ]
      : plat === "android"
        ? [
            ...(!enPagina ? [abrir("Chrome")] : []),
            { icon: MoreVertical, texto: <>Tocá el menú <b>⋮</b> de Chrome (arriba a la derecha).</> },
            { icon: Download, texto: <>Elegí <b>“Instalar app”</b> (o “Agregar a pantalla principal”).</> },
            { icon: MessageCircle, texto: <>Listo: <b>Prodi Chat</b> queda en tus apps, aparte de Prodi.</> },
          ]
        : [
            ...(!enPagina ? [abrir("Chrome o Edge")] : []),
            { icon: Download, texto: <>Tocá el ícono de <b>instalar</b> a la derecha de la barra de direcciones.</> },
            { icon: MessageCircle, texto: <>Prodi Chat se abre en su propia ventana.</> },
          ];
  return (
    <ol className="space-y-2.5">
      {pasos.map((p, i) => (
        <li key={i} className="flex items-start gap-3 rounded-xl border bg-card p-3 text-left text-sm">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {i + 1}
          </span>
          <span className="min-w-0 pt-0.5">{p.texto}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstalarChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const app = useInstalarApp();
  // En /chat-app el navegador ofrece instalar Prodi Chat; en el resto del sistema, la app Prodi.
  const enPagina = enModoChat();
  const [plat, setPlat] = useState<Plataforma>(app.plataforma);
  useEffect(() => {
    if (open) setPlat(app.plataforma);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const instalar = async () => {
    const r = await app.instalar();
    if (r === "aceptada") {
      toast.success("¡Listo! Prodi Chat ya está instalada.");
      onOpenChange(false);
    }
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(urlChatApp());
      toast.success("Link copiado");
    } catch {
      toast.error("No se pudo copiar: " + urlChatApp());
    }
  };
  const directa = enPagina && app.directa && !app.instalada;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <img src={asset("/icons/icon-chat-192.png")} alt="" className="h-16 w-16 rounded-2xl shadow-lg" />
          <DialogTitle className="text-xl">Descargá Prodi Chat</DialogTitle>
          <DialogDescription>
            Tus chats con el equipo en una app aparte, con su ícono y avisos. Entrás con la misma cuenta. Sin Play Store
            ni App Store.
          </DialogDescription>
        </div>

        {enPagina && app.instalada ? (
          <p className="rounded-xl border border-success/40 bg-success/10 p-3 text-center text-sm">Ya la estás usando como app 👌</p>
        ) : (
          <div className="space-y-4">
            {directa ? (
              <Button size="lg" className="w-full" onClick={() => void instalar()}>
                <Download className="mr-2 h-4 w-4" /> Instalar Prodi Chat
              </Button>
            ) : (
              !enPagina && (
                <Button size="lg" className="w-full" onClick={() => irAInstalarChat()}>
                  <MessageCircle className="mr-2 h-4 w-4" /> Abrir Prodi Chat para instalarla
                </Button>
              )
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

            {directa && plat === app.plataforma ? (
              <p className="text-center text-xs text-muted-foreground">Con el botón de arriba se instala en un toque.</p>
            ) : (
              <PasosChat plat={plat} enPagina={enPagina} />
            )}

            <button
              type="button"
              onClick={() => void copiar()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
            >
              <Copy className="h-4 w-4" /> Copiar el link de Prodi Chat
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Un solo diálogo para toda la app (los menús se cierran al tocar y no deben llevárselo puesto).
const abridores = new Set<() => void>();
export const abrirInstalarChat = () => abridores.forEach((f) => f());

/** Monta el diálogo de Prodi Chat (una vez por pantalla). */
export function InstalarChatHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const f = () => setOpen(true);
    abridores.add(f);
    return () => {
      abridores.delete(f);
    };
  }, []);
  return <InstalarChatDialog open={open} onOpenChange={setOpen} />;
}

/** Entrada "Instalar Prodi Chat" para los menús. */
export function BotonInstalarChat({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  const app = useInstalarApp();
  if (enModoChat() && app.instalada) return null;
  return (
    <button
      type="button"
      onClick={() => abrirInstalarChat()}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        collapsed ? "justify-center" : "px-3",
        className
      )}
      title="Instalar Prodi Chat"
    >
      <MessageCircle className="h-4 w-4" />
      {!collapsed && <span>Instalar Prodi Chat</span>}
    </button>
  );
}

/**
 * Aviso en el sistema, solo en celulares: "Descargá Prodi Chat". Se cierra y no vuelve en este equipo,
 * y no aparece si Prodi Chat ya se abrió como app acá.
 */
export function AvisoDescargarChat() {
  const [visible, setVisible] = useState(
    () => plataforma() !== "compu" && !enModoChat() && !chatAppInstalada() && !avisoChatCerrado()
  );
  if (!visible) return null;
  return (
    <div className="flex items-center gap-3 border-b bg-primary/10 px-4 py-2.5 md:hidden">
      <img src={asset("/icons/icon-chat-192.png")} alt="" className="h-9 w-9 shrink-0 rounded-xl" />
      <button type="button" onClick={() => abrirInstalarChat()} className="min-w-0 flex-1 text-left">
        <p className="text-sm font-semibold leading-tight">Descargá Prodi Chat</p>
        <p className="truncate text-xs text-muted-foreground">Tus chats en una app aparte, con avisos.</p>
      </button>
      <Button size="sm" onClick={() => abrirInstalarChat()}>
        Instalar
      </Button>
      <button
        type="button"
        onClick={() => {
          cerrarAvisoChat();
          setVisible(false);
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
        aria-label="Cerrar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const CLAVE_BARRA = "prodi-barra-instalar-chat";

/** Dentro de Prodi Chat abierta en el navegador: invita a instalarla (se puede cerrar por esta visita). */
export function BarraInstalarChat() {
  const app = useInstalarApp();
  const [cerrada, setCerrada] = useState(() => {
    try {
      return !!sessionStorage.getItem(CLAVE_BARRA);
    } catch {
      return false;
    }
  });
  if (app.instalada || cerrada) return null;
  return (
    <div className="flex items-center gap-3 border-b bg-primary/10 px-4 py-2">
      <Download className="h-4 w-4 shrink-0 text-primary" />
      <button type="button" onClick={() => abrirInstalarChat()} className="min-w-0 flex-1 truncate text-left text-sm">
<b>Instalá Prodi Chat</b> <span className="text-muted-foreground">como app</span>
      </button>
      <Button size="sm" onClick={() => (app.directa ? void app.instalar() : abrirInstalarChat())}>
        Instalar
      </Button>
      <button
        type="button"
        onClick={() => {
          try {
            sessionStorage.setItem(CLAVE_BARRA, "1");
          } catch {
            /* nada */
          }
          setCerrada(true);
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
        aria-label="Cerrar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
