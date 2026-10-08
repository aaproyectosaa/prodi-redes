import { useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, ExternalLink, LayoutGrid, LogOut, Menu, Moon, Sun, User } from "lucide-react";
import { asset } from "@/lib/asset";
import { signOut } from "@/lib/auth";
import { auth } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import UserAvatar from "@/components/UserAvatar";
import { RoleBadge } from "@/components/RoleBadge";
import { AvisoActivarAvisos } from "@/components/InstalarApp";
import { BarraInstalarChat, BotonInstalarChat, InstalarChatHost } from "@/components/InstalarChat";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { RedesDataProvider } from "@/contexts/redes-data-context";
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
        <SheetContent side="right" className="flex w-[82vw] max-w-xs flex-col p-0">
          <SheetHeader className="border-b p-4 text-left">
            <SheetTitle className="sr-only">Menú</SheetTitle>
            <button type="button" onClick={() => go(CHAT_APP_PERFIL)} className="flex items-center gap-3">
              {profile ? <UserAvatar profile={profile} size="md" /> : <User className="h-8 w-8 text-muted-foreground" />}
              <div className="min-w-0 text-left">
                <p className="truncate font-semibold">{profile?.nombre ?? "Mi perfil"}</p>
                <RoleBadge label={getRoleInfo(role).label} />
              </div>
            </button>
          </SheetHeader>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
            <button type="button" onClick={() => go(CHAT_APP_PERFIL)} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent">
              <User className="h-4 w-4" /> Mi perfil
            </button>
            <button type="button" onClick={() => go(CHAT_APP_AVISOS)} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent">
              <Bell className="h-4 w-4" /> Avisos y notificaciones
            </button>
            {!esContacto(role) && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                abrirEnSistema("/");
              }}
              className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <ExternalLink className="h-4 w-4 shrink-0" /> Abrir Prodi (sistema completo)
            </button>
            )}
          </nav>
          <div className="space-y-0.5 border-t p-3" onClick={() => setOpen(false)}>
            <BotonInstalarChat className="h-10 gap-3 text-foreground" />
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === "dark" ? "Modo claro" : "Modo oscuro"}
            </button>
            <button
              type="button"
              onClick={async () => {
                await signOut(auth);
                navigate(CHAT_APP_INGRESAR, { replace: true });
              }}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent"
            >
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
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
      </div>
    </RedesDataProvider>
  );
}
