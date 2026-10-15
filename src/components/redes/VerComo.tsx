import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, LogOut, Pencil, Search } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cambiosPermitidos, permitirCambios } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

/** Franja fija arriba cuando el admin mira como otro usuario. Con "Permitir cambios" puede modificar (queda a su nombre). */
export function VerComoBanner() {
  const { viewingAs, realUser } = useUserProfileContext();
  const { salir } = useVerComo();
  const [editar, setEditar] = useState(() => cambiosPermitidos());
  if (!viewingAs) return null;
  const cambiar = (v: boolean) => {
    permitirCambios(v);
    setEditar(v);
  };
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-sm",
        editar ? "border-primary/40 bg-primary/15" : "border-amber-500/40 bg-amber-500/15"
      )}
    >
      {editar ? <Pencil className="h-4 w-4 shrink-0 text-primary" /> : <Eye className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />}
      <p className="min-w-0 flex-1 truncate">
        Estás viendo como <b>{viewingAs.nombre}</b>{" "}
        <span className="text-muted-foreground">
          · {getRoleInfo(viewingAs.role).label} ·{" "}
          {editar ? `podés hacer cambios: quedan a nombre de ${realUser?.displayName || "vos"}` : "solo lectura"}
        </span>
      </p>
      <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium">
        <Switch checked={editar} onCheckedChange={cambiar} aria-label="Permitir cambios" />
        Permitir cambios
      </label>
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

/** Color de cada rol (pastilla y filtro). */
const TONO_ROL: Record<string, string> = {
  admin: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  productor: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  editor: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  pauta: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  diseno: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
  administracion: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  programador: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  cliente: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  contacto: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};
const CLAVE_RECIENTES = "prodi-vercomo-recientes";
const leerRecientes = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_RECIENTES) ?? "[]");
  } catch {
    return [];
  }
};
const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** "Ver como": buscador de personas con filtro por rol, recientes y la empresa de cada cliente (solo super admin). */
export function VerComoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { profiles, projects } = useAppData();
  const { realUser } = useUserProfileContext();
  const { entrar } = useVerComo();
  const [q, setQ] = useState("");
  const [rol, setRol] = useState<string>("todos");
  const [recientes, setRecientes] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setRol("todos");
    setRecientes(leerRecientes());
  }, [open]);

  // De qué cliente es cada persona del lado del cliente (para reconocerla).
  const empresaDe = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) for (const uid of p.team_roles?.cliente ?? []) if (!m.has(uid)) m.set(uid, p.nombre);
    return m;
  }, [projects]);

  const gente = useMemo(() => profiles.filter((p) => p.id !== realUser?.uid), [profiles, realUser?.uid]);
  const rolDe = (r?: string | null) => normalizeRole(r as UserRole) as string;
  // Filtros: solo los roles que hay.
  const roles = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const p of gente) cuenta.set(rolDe(p.role), (cuenta.get(rolDe(p.role)) ?? 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1]);
  }, [gente]);

  const lista = useMemo(() => {
    const b = normal(q.trim());
    return gente
      .filter((p) => rol === "todos" || rolDe(p.role) === rol)
      .filter((p) => !b || normal(`${p.nombre} ${p.email ?? ""} ${empresaDe.get(p.id) ?? ""}`).includes(b))
      .sort((a, b2) => (a.nombre ?? "").localeCompare(b2.nombre ?? ""));
  }, [gente, rol, q, empresaDe]);
  const recientesP = recientes.map((id) => gente.find((p) => p.id === id)).filter((p): p is (typeof gente)[number] => !!p).slice(0, 4);

  const elegir = (id: string) => {
    try {
      localStorage.setItem(CLAVE_RECIENTES, JSON.stringify([id, ...leerRecientes().filter((x) => x !== id)].slice(0, 6)));
    } catch {
      /* sin almacenamiento */
    }
    onOpenChange(false);
    entrar(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
        <div className="border-b bg-gradient-to-r from-primary/[0.08] via-background to-fuchsia-500/[0.06] px-5 pb-4 pt-5">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="flex items-center gap-2.5 text-lg">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Eye className="h-5 w-5" />
              </span>
              Ver como otra persona
            </DialogTitle>
            <DialogDescription>Mirá la app exactamente como la ve. Es solo lectura, salvo que actives "Permitir cambios".</DialogDescription>
          </DialogHeader>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lista[0] && elegir(lista[0].id)}
              placeholder="Buscar por nombre, mail o empresa…"
              className="h-11 rounded-xl bg-background pl-10"
            />
          </div>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[["todos", gente.length] as [string, number], ...roles].map(([r, n]) => (
              <button
                key={r}
                type="button"
                onClick={() => setRol(r)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  rol === r ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50"
                )}
              >
                {r === "todos" ? "Todos" : getRoleInfo(r as UserRole).label} <span className="opacity-70">{n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!q && rol === "todos" && recientesP.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recientes</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {recientesP.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => elegir(p.id)}
                    className="flex flex-col items-center gap-1.5 rounded-xl border bg-card px-2 py-3 text-center transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm"
                  >
                    <UserAvatar profile={p} size="md" />
                    <span className="w-full truncate text-xs font-semibold">{(p.nombre ?? "").split(" ")[0]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {lista.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No hay nadie con ese nombre.</p>
          ) : (
            <div className="space-y-1">
              {lista.map((p) => {
                const r = rolDe(p.role);
                const empresa = empresaDe.get(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => elegir(p.id)}
                    className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted/70"
                  >
                    <UserAvatar profile={p} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.nombre || "Sin nombre"}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{empresa ?? p.email ?? ""}</span>
                    </span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", TONO_ROL[r] ?? "bg-muted text-muted-foreground")}>
                      {getRoleInfo(p.role).label}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * `onAbrir`: el buscador lo monta quien llama (el menú del celular se cierra al tocar y, si el buscador
 * estuviera adentro, se cerraría con él).
 */
export function VerComoBoton({ collapsed = false, onAbrir }: { collapsed?: boolean; onAbrir?: () => void }) {
  const { realRole, viewingAs } = useUserProfileContext();
  const [open, setOpen] = useState(false);
  if (realRole !== "admin" || viewingAs) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => (onAbrir ? onAbrir() : setOpen(true))}
        title="Ver el sistema como otro usuario"
        className={`flex h-9 w-full items-center gap-2.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${
          collapsed ? "justify-center" : "px-3"
        }`}
      >
        <Eye className="h-4 w-4" />
        {!collapsed && <span>Ver como…</span>}
      </button>
      {!onAbrir && <VerComoDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
