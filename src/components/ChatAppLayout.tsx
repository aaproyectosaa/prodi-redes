import { PedirFotoPerfil } from "@/components/redes/PedirFotoPerfil";
import { useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Check, ChevronRight, ExternalLink, LayoutGrid, LogOut, Menu, Moon, Palette, Sun, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { asset } from "@/lib/asset";
import { signOut } from "@/lib/auth";
import { auth } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import UserAvatar from "@/components/UserAvatar";
import { AvisoActivarAvisos } from "@/components/InstalarApp";
import { RecorridoAuto } from "@/components/recorrido/Recorrido";
import { BarraInstalarChat, BotonInstalarChat, InstalarChatHost } from "@/components/InstalarChat";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { RedesDataProvider } from "@/contexts/redes-data-context";
import { AvisoTarde } from "@/components/AvisoTarde";
import { LeerAvisosALaVista } from "@/components/LeerAvisosALaVista";
import { LatidoMiTiempo } from "@/components/LatidoMiTiempo";
import { BadgeApp } from "@/components/BadgeApp";
import { useInAppNotifications } from "@/hooks/use-in-app-notifications";
import { useTheme } from "@/hooks/use-theme";
import { esContacto, getRoleInfo } from "@/lib/roles";
import { toast } from "sonner";
import { useAltoVisible } from "@/hooks/use-alto-visible";
import {
  abrirEnSistema,
  CHAT_APP,
  CHAT_APP_AVISOS,
  CHAT_APP_INGRESAR,
  CHAT_APP_PERFIL,
  enModoChat,
  esRutaChatApp,
  rutaEnChatApp,
} from "@/lib/chatApp";

/**
 * Envuelve las rutas: en Prodi Chat, lo que es del chat (/, /chat, /auth, /profile, /notificaciones) se pasa a
 * su equivalente en /chat-app, y el resto del sistema (un "Ver reunión", un aviso de un video) se abre aparte
 * en Prodi, sin romper la app de chats.
 */
export function ModoChat({ children }: { children: ReactNode }) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const { user, role } = useUserProfileContext();
  // Los contactos (solo chat) no entran al sistema: todo los lleva a Prodi Chat, en cualquier ventana.
  const soloChat = !!user && esContacto(role);
  const activo = enModoChat(pathname) || soloChat;
  const destino = activo && !esRutaChatApp(pathname) ? rutaEnChatApp(pathname, search) ?? (soloChat ? CHAT_APP : null) : null;
  const fuera = activo && !esRutaChatApp(pathname) && !destino ? pathname + search + hash : null;
  const [pendiente, setPendiente] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("modo-chat", activo);
  }, [activo]);

  useEffect(() => {
    if (destino) navigate(destino, { replace: true });
    else if (fuera) {
      // Una navegación del código (no un toque en un link): se ofrece abrirla en Prodi con un toque.
      setPendiente(fuera);
      navigate(CHAT_APP, { replace: true });
    }
  }, [destino, fuera, navigate]);

  // Los links a otras partes del sistema se abren en Prodi (ventana aparte), en el mismo toque.
  useEffect(() => {
    if (!activo) return;
    const alTocar = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (rutaEnChatApp(url.pathname, url.search)) return;
      e.preventDefault();
      e.stopPropagation();
      if (soloChat) toast.info("Eso es del sistema de Prodi: con tu usuario tenés solo el chat.");
      else abrirEnSistema(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", alTocar, true);
    return () => document.removeEventListener("click", alTocar, true);
  }, [activo, soloChat]);

  return (
    <>
      {destino || fuera ? null : children}
      <Dialog open={!!pendiente} onOpenChange={(v) => !v && setPendiente(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl">
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <LayoutGrid className="h-6 w-6" />
            </span>
            <DialogTitle>Esto está en Prodi</DialogTitle>
            <DialogDescription>Prodi Chat es solo para los chats. Lo abrimos en el sistema completo.</DialogDescription>
            <Button
              className="mt-1 w-full"
              onClick={() => {
                if (pendiente) abrirEnSistema(pendiente);
                setPendiente(null);
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" /> Abrir en Prodi
            </Button>
            <button type="button" onClick={() => setPendiente(null)} className="text-sm text-muted-foreground hover:text-foreground">
              Seguir en el chat
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Una opción del menú de Prodi Chat: ícono de color, título, una línea de ayuda y la flecha. */
function FilaMenu({
  icono: Icono,
  color,
  titulo,
  sub,
  badge,
  externo,
  onClick,
}: {
  icono: React.ElementType;
  color: string;
  titulo: string;
  sub?: string;
  badge?: number;
  externo?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 border-b px-3.5 py-3 text-left transition-colors last:border-0 hover:bg-muted/60 active:bg-muted">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", color)}>
        <Icono className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{titulo}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {!!badge && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">{badge > 99 ? "99+" : badge}</span>
      )}
      {externo ? <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/** Encabezado de Prodi Chat: sin la navegación del sistema; perfil, avisos y salir en el menú. */
function ChatAppHeader() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { profile, role } = useUserProfileContext();
  const { unreadCount } = useInAppNotifications(profile?.id);
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const enSubpagina = pathname !== CHAT_APP && pathname !== CHAT_APP + "/";
  const titulo = pathname.startsWith(CHAT_APP_PERFIL) ? "Mi perfil" : pathname.startsWith(CHAT_APP_AVISOS) ? "Avisos" : null;

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      <header className="safe-area-pt sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-2 px-3">
          {enSubpagina ? (
            <button type="button" onClick={() => navigate(CHAT_APP)} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
              <span className="font-semibold">{titulo ?? "Chats"}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-1">
              <img src={asset("/icons/icon-chat-192.png")} alt="" className="h-7 w-7 rounded-lg" />
              <span className="font-semibold">Prodi Chat</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate(CHAT_APP_AVISOS)}
              className="relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-accent"
              aria-label="Avisos"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-destructive-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-accent"
              aria-label="Menú"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-[86vw] max-w-sm flex-col gap-0 overflow-y-auto border-l-0 p-0 [&>button:last-child]:right-3 [&>button:last-child]:top-[max(env(safe-area-inset-top),0.75rem)] [&>button:last-child]:z-10 [&>button:last-child]:text-white">
          <SheetTitle className="sr-only">Menú</SheetTitle>
          {/* Tarjeta de perfil. */}
          <SheetHeader className="relative overflow-hidden bg-gradient-to-br from-primary via-violet-600 to-fuchsia-500 px-5 pb-5 pt-[max(env(safe-area-inset-top),1.25rem)] text-left text-white">
            <span className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/15 blur-2xl" aria-hidden />
            <span className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-fuchsia-300/20 blur-2xl" aria-hidden />
            <button type="button" onClick={() => go(CHAT_APP_PERFIL)} className="relative mt-6 flex items-center gap-3.5 text-left">
              <span className="rounded-full ring-[3px] ring-white/40 ring-offset-0">
                {profile ? <UserAvatar profile={profile} size="lg" className="h-16 w-16" /> : <User className="h-16 w-16 p-3" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-lg font-bold leading-tight">{profile?.nombre ?? "Mi perfil"}</span>
                <span className="mt-1 inline-flex rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold backdrop-blur">{getRoleInfo(role).label}</span>
                {profile?.email && <span className="mt-1 block truncate text-xs text-white/75">{profile.email}</span>}
              </span>
            </button>
          </SheetHeader>

          <div className="flex-1 space-y-5 p-4">
            {/* Opciones. */}
            <div className="overflow-hidden rounded-2xl border bg-card">
              <FilaMenu icono={User} color="from-sky-500 to-blue-600" titulo="Mi perfil" sub="Foto, nombre y datos" onClick={() => go(CHAT_APP_PERFIL)} />
              <FilaMenu
                icono={Bell}
                color="from-amber-400 to-orange-500"
                titulo="Avisos y notificaciones"
                sub={unreadCount ? `${unreadCount} sin leer` : "Todo al día"}
                badge={unreadCount}
                onClick={() => go(CHAT_APP_AVISOS)}
              />
              {!esContacto(role) && (
                <FilaMenu
                  icono={LayoutGrid}
                  color="from-primary to-fuchsia-500"
                  titulo="Abrir Prodi"
                  sub="El sistema completo"
                  externo
                  onClick={() => {
                    setOpen(false);
                    abrirEnSistema("/");
                  }}
                />
              )}
            </div>

            {/* Tema: claro, oscuro o violeta, con una muestra de cada uno. */}
            <div className="space-y-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Apariencia</p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { k: "light", label: "Claro", icon: Sun, fondo: "bg-[#f7f7fb]", barra: "bg-[#e6e4f0]", burbuja: "bg-[#6F40FC]" },
                    { k: "dark", label: "Oscuro", icon: Moon, fondo: "bg-[#0a0a0c]", barra: "bg-[#1c1c22]", burbuja: "bg-[#7b4dff]" },
                    { k: "violeta", label: "Violeta", icon: Palette, fondo: "bg-[#150e24]", barra: "bg-[#2a1f45]", burbuja: "bg-[#a77bff]" },
                  ] as const
                ).map((x) => (
                  <button
                    key={x.k}
                    type="button"
                    onClick={() => setTheme(x.k)}
                    className={cn(
                      "group rounded-2xl border-2 p-1.5 text-center transition-all active:scale-95",
                      theme === x.k ? "border-primary bg-primary/5" : "border-transparent bg-muted/50 hover:bg-muted"
                    )}
                    aria-pressed={theme === x.k}
                  >
                    {/* Mini chat de muestra. */}
                    <span className={cn("flex h-14 flex-col justify-end gap-1 rounded-xl border border-black/5 p-1.5", x.fondo)}>
                      <span className={cn("h-2 w-3/5 rounded-full", x.barra)} />
                      <span className={cn("ml-auto h-2 w-1/2 rounded-full", x.burbuja)} />
                    </span>
                    <span className={cn("mt-1.5 flex items-center justify-center gap-1 text-xs font-semibold", theme === x.k ? "text-primary" : "text-muted-foreground")}>
                      {theme === x.k ? <Check className="h-3.5 w-3.5" /> : <x.icon className="h-3.5 w-3.5" />}
                      {x.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border bg-card [&>button]:h-12 [&>button]:rounded-none [&>button]:px-4 [&>button]:text-foreground" onClick={() => setOpen(false)}>
              <BotonInstalarChat className="gap-3" />
            </div>
          </div>

          <div className="border-t p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await signOut(auth);
                navigate(CHAT_APP_INGRESAR, { replace: true });
              }}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-destructive/10 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15 active:scale-[0.98]"
            >
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">Prodi Chat</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Pantalla de Prodi Chat: lista de chats y conversación, sin la navegación del sistema. */
export function ChatAppLayout() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { user, authChecked, viewingAs } = useUserProfileContext();
  // En el celular, con una conversación abierta, la conversación ocupa toda la pantalla (tiene su propio "atrás").
  const conversacion = pathname.replace(/\/$/, "") === CHAT_APP && new URLSearchParams(search).has("c");
  useAltoVisible();

  useEffect(() => {
    if (authChecked && !user) navigate(CHAT_APP_INGRESAR, { replace: true });
  }, [authChecked, user, navigate]);

  if (!authChecked) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <img src={asset("/icons/icon-chat-192.png")} alt="" className="h-12 w-12 animate-pulse rounded-2xl" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <RedesDataProvider>
      <BadgeApp />
      <div className="alto-app seguro-costados flex flex-col overflow-hidden bg-background">
        <div className={conversacion ? "hidden md:block" : undefined}>
          <ChatAppHeader />
          <BarraInstalarChat />
        </div>
        <main className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain ${conversacion ? "safe-area-pt md:pt-0" : ""}`}>
          <Outlet />
        </main>
        <InstalarChatHost />
        <AvisoActivarAvisos uid={viewingAs ? undefined : user?.uid} />
        <RecorridoAuto enChat />
        <AvisoTarde />
        <LeerAvisosALaVista uid={viewingAs ? undefined : user?.uid} />
        <LatidoMiTiempo />
        <PedirFotoPerfil />
      </div>
    </RedesDataProvider>
  );
}
