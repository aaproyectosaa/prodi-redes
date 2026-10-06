import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, LogOut } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import UserAvatar from "@/components/UserAvatar";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { defaultRouteForRole, getRoleInfo, normalizeRole } from "@/lib/roles";
import type { UserRole } from "@/integrations/firebase/types";

/** Hook para entrar/salir del modo "ver como" y llevar a la pantalla de ese rol. */
export function useVerComo() {
  const navigate = useNavigate();
  const { verComo } = useUserProfileContext();
  const { profiles } = useAppData();
  return {
    entrar: (uid: string) => {
      const p = profiles.find((x) => x.id === uid);
      verComo(uid);
      navigate(defaultRouteForRole(normalizeRole(p?.role as UserRole)));
    },
    salir: () => {
      verComo(null);
      navigate("/tablero");
    },
  };
}

/** Franja fija arriba cuando el admin mira como otro usuario. */
export function VerComoBanner() {
  const { viewingAs } = useUserProfileContext();
  const { salir } = useVerComo();
  if (!viewingAs) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm">
      <Eye className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1 truncate">
        Estás viendo como <b>{viewingAs.nombre}</b>{" "}
        <span className="text-muted-foreground">
          · {getRoleInfo(viewingAs.role).label} · solo lectura
        </span>
      </p>
      <button
        type="button"
        onClick={salir}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-xs font-semibold text-background hover:opacity-90"
      >
        <LogOut className="h-3.5 w-3.5" /> Volver a mi cuenta
      </button>
    </div>
  );
}

/** Buscador de personas para "ver como" (solo super admin). */
export function VerComoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { profiles } = useAppData();
  const { realUser } = useUserProfileContext();
  const { entrar } = useVerComo();
  const grupos: { titulo: string; roles: string[] }[] = [
    { titulo: "Equipo", roles: ["productor", "editor", "pauta"] },
    { titulo: "Clientes", roles: ["cliente"] },
  ];
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="¿Con qué usuario querés ver el sistema?" />
      <CommandList>
        <CommandEmpty>No hay nadie con ese nombre.</CommandEmpty>
        {grupos.map((g) => (
          <CommandGroup key={g.titulo} heading={g.titulo}>
            {profiles
              .filter((p) => g.roles.includes(p.role ?? "") && p.id !== realUser?.uid)
              .sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""))
              .map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.nombre} ${p.email}`}
                  onSelect={() => {
                    onOpenChange(false);
                    entrar(p.id);
                  }}
                  className="gap-3"
                >
                  <UserAvatar profile={p} size="sm" />
                  <span className="flex-1 truncate">{p.nombre}</span>
                  <span className="text-xs text-muted-foreground">{getRoleInfo(p.role).label}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

export function VerComoBoton({ collapsed = false }: { collapsed?: boolean }) {
  const { realRole, viewingAs } = useUserProfileContext();
  const [open, setOpen] = useState(false);
  if (realRole !== "admin" || viewingAs) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ver el sistema como otro usuario"
        className={`flex h-9 w-full items-center gap-2.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${
          collapsed ? "justify-center" : "px-3"
        }`}
      >
        <Eye className="h-4 w-4" />
        {!collapsed && <span>Ver como…</span>}
      </button>
      <VerComoDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
