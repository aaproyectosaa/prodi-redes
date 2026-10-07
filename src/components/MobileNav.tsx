import { useEffect, useState } from "react";
import { asset } from "@/lib/asset";
import { useLocation, useNavigate } from "react-router-dom";
import { signOut } from "@/lib/auth";
import { Bell, LogOut, Menu, Moon, Sun, User } from "lucide-react";
import { auth } from "@/integrations/firebase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import UserAvatar from "@/components/UserAvatar";
import { RoleBadge } from "@/components/RoleBadge";
import { getRoleInfo } from "@/lib/roles";
import { navForRole } from "@/lib/redes/nav";
import { useInAppNotifications } from "@/hooks/use-in-app-notifications";
import { useTheme } from "@/hooks/use-theme";
import { isNavItemActive } from "@/components/AppSidebar";
import { cn } from "@/lib/utils";
import { usePendientes } from "@/hooks/use-pendientes";
import { VerComoBoton } from "@/components/redes/VerComo";
import { BotonInstalar } from "@/components/InstalarApp";
import { BotonInstalarChat } from "@/components/InstalarChat";
import type { Profile, UserRole } from "@/integrations/firebase/types";
import { TituloSeccion, useSeccionesPlegables } from "@/components/SeccionNav";

interface Props {
  profile?: Profile;
  role?: UserRole;
}

/** Encabezado del celular: logo, avisos y menú completo. */
export const MobileAppHeader = ({ profile, role }: Props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const { unreadCount } = useInAppNotifications(profile?.id);
  const sections = navForRole(role);
  const plegables = useSeccionesPlegables();
  const pendientes = usePendientes();

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <>
      <header className="safe-area-pt sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur md:hidden">
        <button type="button" onClick={() => navigate("/")} className="flex items-center gap-2">
          <img src={asset("/brand/logo-horizontal-blanco.png")} alt="Prodi" className="hidden h-5 w-auto dark:block" />
          <img src={asset("/brand/logo-horizontal-negro.png")} alt="Prodi" className="h-5 w-auto dark:hidden" />
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate("/notificaciones")}
            className="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-accent"
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
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-accent"
            aria-label="Menú"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-[82vw] max-w-xs flex-col p-0">
          <SheetHeader className="border-b p-4 text-left">
            <SheetTitle className="sr-only">Menú</SheetTitle>
            <button type="button" onClick={() => go("/profile")} className="flex items-center gap-3">
              {profile ? (
                <UserAvatar profile={profile} size="md" />
              ) : (
                <User className="h-8 w-8 text-muted-foreground" />
              )}
              <div className="min-w-0 text-left">
                <p className="truncate font-semibold">{profile?.nombre ?? "Mi perfil"}</p>
                <RoleBadge label={getRoleInfo(role).label} />
              </div>
            </button>
          </SheetHeader>
          <nav className="flex-1 space-y-3 overflow-y-auto p-3">
            {sections.map((s, i) => (
              <div key={i} className="space-y-0.5">
                {s.title && (
                  <TituloSeccion
                    titulo={s.title}
                    abierta={plegables.abierta(s)}
                    activa={plegables.activa(s)}
                    pendientes={s.items.reduce((a, it) => a + (pendientes[it.path] ?? 0), 0)}
                    onClick={() => plegables.alternar(s)}
                    className="py-2"
                  />
                )}
                {plegables.abierta(s) && s.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(item, location.pathname, location.search);
                  return (
                    <button
                      key={item.path + item.label}
                      type="button"
                      onClick={() => go(item.path)}
                      className={cn(
                        "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm",
                        active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {!!pendientes[item.path] && (
                        <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                          {pendientes[item.path]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="space-y-0.5 border-t p-3 safe-area-pb" onClick={() => setOpen(false)}>
            <VerComoBoton />
            <BotonInstalar className="h-10 gap-3 text-foreground" />
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
                navigate("/auth");
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
};

const esCampoDeTexto = (el: Element | null) =>
  !!el &&
  (el.tagName === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable ||
    (el.tagName === "INPUT" && !["checkbox", "radio", "range", "color", "file", "button", "submit"].includes((el as HTMLInputElement).type)));

/** Con el teclado abierto en el celular la barra de abajo se esconde (si no, queda flotando arriba del teclado). */
export function useTecladoAbierto() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const revisar = () => {
      const si = window.innerWidth < 768 && esCampoDeTexto(document.activeElement);
      setAbierto(si);
      document.documentElement.classList.toggle("teclado-abierto", si);
    };
    // Entrar a un campo esconde la barra al toque. Salir (o tocar un botón) espera un poco: si el toque fue en
    // "Guardar" o "Enviar", que el click caiga antes de que la barra vuelva y mueva todo.
    let espera: ReturnType<typeof setTimeout> | undefined;
    const alSalir = () => {
      clearTimeout(espera);
      espera = setTimeout(revisar, 350);
    };
    const alEntrar = (e: FocusEvent) => {
      if (esCampoDeTexto(e.target as Element)) {
        clearTimeout(espera);
        revisar();
      } else alSalir();
    };
    // En Android, cerrar el teclado con "atrás" no saca el foco del campo: nos fijamos en el alto visible.
    // Si vuelve a ser (casi) el completo, el teclado se cerró y la barra vuelve aunque el campo siga enfocado.
    const vv = window.visualViewport;
    let alto = vv?.height ?? window.innerHeight;
    let ancho = vv?.width ?? window.innerWidth;
    const alCambiarAlto = () => {
      if (!vv) return;
      // Si giró la pantalla, el alto de referencia es otro.
      if (Math.abs(vv.width - ancho) > 1) {
        ancho = vv.width;
        alto = vv.height;
      }
      alto = Math.max(alto, vv.height);
      if (vv.height >= alto * 0.85) {
        clearTimeout(espera);
        setAbierto(false);
        document.documentElement.classList.remove("teclado-abierto");
      } else revisar();
    };
    document.addEventListener("focusin", alEntrar);
    document.addEventListener("focusout", alSalir);
    vv?.addEventListener("resize", alCambiarAlto);
    return () => {
      clearTimeout(espera);
      document.removeEventListener("focusin", alEntrar);
      document.removeEventListener("focusout", alSalir);
      vv?.removeEventListener("resize", alCambiarAlto);
      document.documentElement.classList.remove("teclado-abierto");
    };
  }, []);
  return abierto;
}

/** Barra inferior del celular con los accesos principales del rol. */
export const MobileTabBar = ({ role }: { role?: UserRole }) => {
  const teclado = useTecladoAbierto();
  const navigate = useNavigate();
  const location = useLocation();
  const pendientes = usePendientes();
  const items = navForRole(role)
    .flatMap((s) => s.items)
    .filter((i) => i.mobile)
    .slice(0, 4);
  if (items.length === 0 || teclado) return null;
  return (
    <nav className="safe-area-pb fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur md:hidden">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = isNavItemActive(item, location.pathname, location.search);
          return (
            <button
              key={item.path + item.label}
              type="button"
              onClick={() => navigate(item.path)}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-[11px]",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span className="relative">
                <Icon className={cn("h-5 w-5", active && "drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]")} />
                {!!pendientes[item.path] && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                    {pendientes[item.path]}
                  </span>
                )}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export const MobileNav = MobileAppHeader;
