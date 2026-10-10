import { useState } from "react";
import { Bell, ChevronsUpDown, Eye, EyeOff, HelpCircle, LogOut, MessageCircle, Moon, Smartphone, Sun, User, UserRound } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import UserAvatar from "@/components/UserAvatar";
import { RoleBadge } from "@/components/RoleBadge";
import { VerComoDialog } from "@/components/redes/VerComo";
import { abrirInstalar } from "@/components/InstalarApp";
import { abrirInstalarChat } from "@/components/InstalarChat";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useTheme } from "@/hooks/use-theme";
import { useInstalarApp } from "@/lib/instalar";
import { useMontosOcultos } from "@/lib/privacidad";
import { EVENTO_RECORRIDO } from "@/lib/novedades";
import { cn } from "@/lib/utils";
import type { Profile } from "@/integrations/firebase/types";

/**
 * Pie del menú lateral: arriba los accesos rápidos (avisos, ocultar montos, tema) y abajo la tarjeta de la persona,
 * que abre el resto (perfil, ver como, ayuda, instalar, cerrar sesión).
 */
export function PieSidebar({
  collapsed,
  profile,
  roleLabel,
  avisos,
  avisosActivo,
  onAvisos,
  onPerfil,
  onSalir,
  extraTarjeta,
}: {
  collapsed: boolean;
  profile: Profile | undefined;
  roleLabel: string;
  avisos: number;
  avisosActivo: boolean;
  onAvisos: () => void;
  onPerfil: () => void;
  onSalir: () => void;
  /** Algo más en la tarjeta (ej. el anillo de perfil completo del cliente). */
  extraTarjeta?: React.ReactNode;
}) {
  const { role, roles, realRole, viewingAs } = useUserProfileContext();
  const { theme, setTheme } = useTheme();
  const [ocultos, setOcultos] = useMontosOcultos();
  const app = useInstalarApp();
  const [verComo, setVerComo] = useState(false);
  const finanzas = role === "admin" || roles.includes("administracion");
  const puedeVerComo = realRole === "admin" && !viewingAs;
  const oscuro = theme === "dark";

  const rapido = "relative flex h-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";
  const Rapidos = (
    <div className={cn("flex gap-1", collapsed ? "flex-col" : "items-center")}>
      <button
        type="button"
        onClick={onAvisos}
        className={cn(rapido, collapsed ? "w-full" : "flex-1", avisosActivo && "bg-primary/10 text-primary")}
        title="Avisos"
        aria-label={avisos ? `Avisos (${avisos} sin leer)` : "Avisos"}
      >
        <Bell className="h-4 w-4" />
        {avisos > 0 && (
          <span className="absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
            {avisos > 99 ? "99+" : avisos}
          </span>
        )}
      </button>
      {finanzas && (
        <button
          type="button"
          onClick={() => setOcultos(!ocultos)}
          className={cn(rapido, collapsed ? "w-full" : "flex-1", ocultos && "text-primary")}
          title={ocultos ? "Mostrar montos" : "Ocultar montos"}
          aria-pressed={ocultos}
        >
          {ocultos ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={() => setTheme(oscuro ? "light" : "dark")}
        className={cn(rapido, collapsed ? "w-full" : "flex-1")}
        title={oscuro ? "Modo claro" : "Modo oscuro"}
        data-tema
      >
        {oscuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(EVENTO_RECORRIDO))}
        className={cn(rapido, collapsed ? "w-full" : "flex-1")}
        title="¿Cómo se usa?"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="space-y-1.5 border-t border-border p-2">
      {Rapidos}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center rounded-xl border border-transparent py-2 text-left transition-colors hover:border-border hover:bg-accent data-[state=open]:border-border data-[state=open]:bg-accent",
              collapsed ? "justify-center" : "gap-2.5 px-2"
            )}
            title={collapsed ? `${profile?.nombre ?? "Mi perfil"} · ${roleLabel}` : undefined}
          >
            {profile ? (
              <UserAvatar profile={profile} size="sm" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            {!collapsed && (
              <>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="truncate text-sm font-semibold leading-none">{profile?.nombre || "Mi perfil"}</p>
                  <RoleBadge label={roleLabel} />
                </div>
                {extraTarjeta}
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={collapsed ? "right" : "top"} align={collapsed ? "end" : "start"} className="w-60">
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-semibold">{profile?.nombre || "Mi perfil"}</p>
            {profile?.email && <p className="truncate text-xs text-muted-foreground">{profile.email}</p>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onPerfil}>
            <UserRound className="mr-2 h-4 w-4" /> Mi perfil
          </DropdownMenuItem>
          {puedeVerComo && (
            <DropdownMenuItem onClick={() => setVerComo(true)}>
              <Eye className="mr-2 h-4 w-4" /> Ver como…
            </DropdownMenuItem>
          )}
          {!app.instalada && (
            <DropdownMenuItem onClick={() => abrirInstalar()}>
              <Smartphone className="mr-2 h-4 w-4" /> Instalar la app
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => abrirInstalarChat()}>
            <MessageCircle className="mr-2 h-4 w-4" /> Instalar Prodi Chat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSalir} className="text-destructive focus:text-destructive">
            <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {puedeVerComo && <VerComoDialog open={verComo} onOpenChange={setVerComo} />}
    </div>
  );
}
