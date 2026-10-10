import { useState } from "react";
import { asset } from "@/lib/asset";
import { useLocation, useNavigate } from "react-router-dom";
import { signOut } from "@/lib/auth";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { auth } from "@/integrations/firebase/client";
import { getRoleInfo } from "@/lib/roles";
import { navForRoles, type NavItem } from "@/lib/redes/nav";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useInAppNotifications } from "@/hooks/use-in-app-notifications";
import { cn } from "@/lib/utils";
import { usePendientes } from "@/hooks/use-pendientes";
import type { Profile, UserRole } from "@/integrations/firebase/types";
import { TituloSeccion, useSeccionesPlegables } from "@/components/SeccionNav";
import { useRedes } from "@/contexts/redes-data-context";
import { AnilloPerfilMenu } from "@/components/redes/cliente/PerfilCompleto";
import { PieSidebar } from "@/components/PieSidebar";

const STORAGE_KEY = "sidebar-collapsed";

export function isNavItemActive(item: NavItem, pathname: string, search: string): boolean {
  const url = new URL(item.path, "http://local");
  const tab = url.searchParams.get("tab");
  const locTab = new URLSearchParams(search).get("tab");
  if (url.pathname !== pathname) return false;
  if (tab) return tab === locTab;
  // Sin tab: activo si la ubicación tampoco tiene un tab que otro ítem represente.
  return !locTab || pathname !== "/cliente";
}

interface AppSidebarProps {
  profile?: Profile;
  role?: UserRole;
  children?: React.ReactNode;
}

export const AppSidebar = ({ profile, role, children }: AppSidebarProps) => {
  const navigate = useNavigate();
  // Cliente: su negocio, para el anillo de "perfil completo".
  const { clientes } = useRedes();
  const location = useLocation();
  const { unreadCount } = useInAppNotifications(profile?.id);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/auth");
  };

  const { roles } = useUserProfileContext();
  const sections = navForRoles(role, roles);
  const pendientes = usePendientes();
  const plegables = useSeccionesPlegables();
  const roleLabel = getRoleInfo(role).label;

  const itemBtn = (item: NavItem, active: boolean, badge?: number) => {
    const Icon = item.icon;
    return (
      <button
        key={item.path + item.label}
        type="button"
        onClick={() => navigate(item.path)}
        title={collapsed ? item.label : undefined}
        className={cn(
          "relative flex h-9 w-full items-center gap-2.5 rounded-lg text-sm transition-colors",
          collapsed ? "justify-center px-0" : "px-3",
          active
            ? "bg-primary text-primary-foreground shadow-[0_6px_18px_-8px_hsl(var(--primary)/0.8)]"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        <span className="relative shrink-0">
          <Icon className="h-4 w-4" />
          {collapsed && !!badge && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-destructive-foreground ring-2 ring-card">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </span>
        {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
        {!collapsed && !!badge && (
          <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside
      className={cn(
        "relative hidden h-full shrink-0 flex-col border-r border-border bg-sidebar transition-all duration-200 md:flex",
        collapsed ? "w-[64px]" : "w-60"
      )}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        className="absolute -right-3.5 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-primary text-primary-foreground shadow-lg transition-all hover:scale-110"
        aria-label={collapsed ? "Expandir panel" : "Contraer panel"}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>

      <div className={cn("flex h-14 items-center border-b", collapsed ? "justify-center" : "px-4")}>
        {collapsed ? (
          <img src={asset("/brand/isotipo.png")} alt="Prodi" className="h-6 w-auto" />
        ) : (
          <div className="flex items-center gap-2">
            <img src={asset("/brand/logo-horizontal-blanco.png")} alt="Prodi" className="hidden h-6 w-auto dark:block" />
            <img src={asset("/brand/logo-horizontal-negro.png")} alt="Prodi" className="h-6 w-auto dark:hidden" />
            <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              Redes
            </span>
          </div>
        )}
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {sections.map((section, idx) => {
          const abierta = collapsed || plegables.abierta(section);
          return (
            <div key={idx} className={cn("space-y-0.5 px-2", section.title ? "py-0.5" : "p-2")}>
              {!collapsed && section.title && (
                <TituloSeccion
                  titulo={section.title}
                  abierta={abierta}
                  activa={plegables.activa(section)}
                  pendientes={section.items.reduce((a, i) => a + (pendientes[i.path] ?? 0), 0)}
                  onClick={() => plegables.alternar(section)}
                />
              )}
              {collapsed && idx > 0 && <div className="mx-2 my-1 border-t border-border" />}
              {abierta && (
                <div className={cn("space-y-0.5", section.title && !collapsed && "pb-1 animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none")}>
                  {section.items.map((item) =>
                    itemBtn(item, isNavItemActive(item, location.pathname, location.search), pendientes[item.path])
                  )}
                </div>
              )}
            </div>
          );
        })}
        {children && !collapsed && (
          <>
            <div className="my-2 border-t border-border" />
            {children}
          </>
        )}
      </div>

      <PieSidebar
        collapsed={collapsed}
        profile={profile}
        roleLabel={roleLabel}
        avisos={unreadCount}
        avisosActivo={location.pathname === "/notificaciones"}
        onAvisos={() => navigate("/notificaciones")}
        onPerfil={() => navigate("/profile")}
        onSalir={() => void handleLogout()}
        extraTarjeta={role === "cliente" ? <AnilloPerfilMenu cliente={clientes[0]} /> : undefined}
      />
    </aside>
  );
};
