import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  Copy,
  Eye,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserCheck,
  UserX,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell, Section } from "@/components/redes/PageShell";
import { useVerComo } from "@/components/redes/VerComo";
import UserAvatar from "@/components/UserAvatar";
import { useAppData } from "@/contexts/app-data-context";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { callApi } from "@/lib/redes/api";
import { hace } from "@/lib/redes/format";
import { LEGACY_ROLES, ROLES, ROLES_ADICIONALES, getRoleInfo, rolesDe } from "@/lib/roles";
import type { Profile } from "@/integrations/firebase/types";
import { cn } from "@/lib/utils";

const FILTROS = [
  { v: "todos", l: "Todos" },
  { v: "equipo", l: "Equipo" },
  { v: "cliente", l: "Clientes" },
  { v: "pendientes", l: "Sin rol" },
  { v: "inactivos", l: "Desactivados" },
];

const esPendiente = (p: Profile) => !p.role || p.role === "pending" || LEGACY_ROLES.includes(p.role);

/** Campos suaves (mismo estilo que Reuniones y Pedir video). */
const SUAVE =
  "rounded-2xl border-transparent bg-muted/60 shadow-none transition-colors focus-visible:border-primary focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0 focus:ring-4 focus:ring-primary/15 focus:ring-offset-0";
const ETIQUETA = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/** Color de cada rol para las etiquetas (solo visual). */
const COLOR_ROL: Record<string, string> = {
  admin: "bg-primary/12 text-primary",
  productor: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  editor: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400",
  pauta: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  diseno: "bg-pink-500/12 text-pink-600 dark:text-pink-400",
  administracion: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  programador: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-400",
  cliente: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  contacto: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  pending: "bg-warning/20 text-warning",
};
const colorRol = (r: string | undefined) => COLOR_ROL[r ?? "pending"] ?? "bg-muted text-muted-foreground";
/** Orden de los grupos de la lista: primero los que esperan rol, después el equipo y al final clientes y contactos. */
const ORDEN_GRUPOS = ["pending", ...ROLES.map((r) => r.value as string), "contacto"];
const grupoDe = (p: Profile): string => (esPendiente(p) ? "pending" : (p.role as string));

export default function Equipo() {
  const navigate = useNavigate();
  const { profiles } = useAppData();
  const { clientes } = useRedes();
  const { realUser } = useUserProfileContext();
  const { entrar } = useVerComo();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [editar, setEditar] = useState<Profile | "nuevo" | null>(null);
  const [borrar, setBorrar] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [credenciales, setCredenciales] = useState<{ titulo: string; texto: string } | null>(null);

  const filtrados = profiles
    .filter((p) => !q || `${p.nombre} ${p.email}`.toLowerCase().includes(q.toLowerCase()))
    .filter((p) => {
      if (filtro === "equipo") return ["admin", "productor", "editor", "pauta", "diseno", "administracion"].includes(p.role ?? "");
      if (filtro === "cliente") return p.role === "cliente" || p.role === "contacto";
      if (filtro === "pendientes") return esPendiente(p);
      if (filtro === "inactivos") return p.activo === false;
      return true;
    })
    .sort((a, b) => Number(esPendiente(b)) - Number(esPendiente(a)) || (a.nombre ?? "").localeCompare(b.nombre ?? ""));

  const clientesDe = (p: Profile) =>
    clientes.filter((c) => Object.values(c.team_roles ?? {}).some((ids) => (ids ?? []).includes(p.id)));

  // La gente de los clientes va por empresa (una empresa tiene varias personas; alguien de varias empresas aparece
  // en cada una); el equipo, por rol.
  const empresasDe = (p: Profile): string[] | null => {
    if (p.role !== "cliente" && p.role !== "contacto") return null;
    const ids = p.role === "contacto" && p.proyecto_id ? [p.proyecto_id] : clientesDe(p).map((c) => c.id);
    return ids.length ? ids.map((id) => `empresa:${id}`) : ["empresa:-"];
  };
  const clavesGrupo = (p: Profile): string[] => (esPendiente(p) ? ["pending"] : empresasDe(p) ?? [grupoDe(p)]);
  const nombreEmpresa = (clave: string) => {
    const id = clave.slice(8);
    return id === "-" ? "Sin empresa asignada" : clientes.find((c) => c.id === id)?.nombre ?? "Empresa";
  };
  const colorEmpresa = (clave: string) => clientes.find((c) => c.id === clave.slice(8))?.color || "#6F40FC";
  const empresas = Array.from(new Set(filtrados.flatMap(clavesGrupo).filter((g) => g.startsWith("empresa:")))).sort(
    (a, b) => Number(a === "empresa:-") - Number(b === "empresa:-") || nombreEmpresa(a).localeCompare(nombreEmpresa(b))
  );
  const grupos = ORDEN_GRUPOS.filter((g) => g !== "cliente" && g !== "contacto")
    .concat(filtrados.flatMap(clavesGrupo).filter((g) => !ORDEN_GRUPOS.includes(g) && !g.startsWith("empresa:")))
    .concat(empresas)
    .filter((g, i, a) => a.indexOf(g) === i)
    .map((g) => [g, filtrados.filter((p) => clavesGrupo(p).includes(g))] as const)
    .filter(([, gente]) => gente.length > 0);

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo completar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title={<span className="text-[26px] font-bold tracking-tight">Equipo y usuarios</span>}
      subtitle="Altas, bajas, roles y a qué clientes tiene acceso cada persona."
      actions={
        <Button onClick={() => setEditar("nuevo")} className="h-11 rounded-2xl px-5 font-semibold shadow-lg shadow-primary/25">
          <Plus className="mr-2 h-4 w-4" /> Nuevo usuario
        </Button>
      }
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o mail" className={cn(SUAVE, "h-12 pl-11 text-[15px]")} />
        </div>
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:w-fit sm:rounded-2xl sm:bg-muted/60 sm:p-1 sm:px-1">
          {FILTROS.map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setFiltro(f.v)}
              className={cn(
                "inline-flex shrink-0 items-center rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors",
                filtro === f.v
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25 sm:bg-background sm:text-foreground sm:shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground sm:bg-transparent"
              )}
            >
              {f.l}
              {f.v === "pendientes" && profiles.filter(esPendiente).length > 0 && (
                <span className="ml-1 rounded-full bg-warning px-1.5 text-[10px] text-black">{profiles.filter(esPendiente).length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <Section title={`${filtrados.length} usuario${filtrados.length === 1 ? "" : "s"}`}>
        {filtrados.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-muted/60 px-6 py-12 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-muted-foreground shadow-sm">
              <Search className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">No hay usuarios con ese filtro.</p>
          </div>
        )}
        <div className="space-y-6">
          {grupos.map(([grupo, gente]) => (
            <section
              key={grupo}
              className={cn(grupo.startsWith("empresa:") ? "overflow-hidden rounded-3xl border-2 bg-card shadow-sm" : "space-y-2.5")}
            >
              {grupo.startsWith("empresa:") ? (
                // Empresa: una tarjeta con su color, y adentro su gente.
                <div
                  className="flex items-center gap-3 border-b px-4 py-3.5 sm:px-5"
                  style={{ background: `color-mix(in srgb, ${colorEmpresa(grupo)} 16%, transparent)` }}
                >
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-base font-bold text-white shadow-sm"
                    style={{ background: colorEmpresa(grupo) }}
                  >
                    {grupo === "empresa:-" ? <Building2 className="h-5 w-5" /> : nombreEmpresa(grupo).charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-bold leading-tight">{nombreEmpresa(grupo)}</p>
                    <p className="text-xs text-muted-foreground">
                      {gente.length} {gente.length === 1 ? "persona" : "personas"}
                    </p>
                  </div>
                  <Building2 className="h-5 w-5 shrink-0 text-muted-foreground/60" />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider", colorRol(grupo))}>
                    {grupo === "pending" ? "Sin rol" : getRoleInfo(grupo as Profile["role"]).label}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">{gente.length}</span>
                </div>
              )}
              <div className={cn("divide-y", grupo.startsWith("empresa:") ? "" : "overflow-hidden rounded-2xl border bg-card")}>
                {gente.map((p) => {
            const pendiente = esPendiente(p);
            const inactivo = p.activo === false;
            const cls = clientesDe(p);
            const yo = p.id === realUser?.uid;
            return (
              <div key={p.id} className={cn("flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:gap-4", inactivo && "opacity-60")}>
                <UserAvatar profile={p} size="md" className={cn(yo && "ring-2 ring-primary/40 ring-offset-2 ring-offset-card")} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate font-semibold">{p.nombre}</p>
                    {yo && <span className="text-[11px] font-medium text-muted-foreground">(vos)</span>}
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", colorRol(pendiente ? "pending" : p.role))}>
                      {pendiente ? (LEGACY_ROLES.includes(p.role ?? "pending") ? getRoleInfo(p.role).label : "Sin rol") : getRoleInfo(p.role).label}
                    </span>
                    {!pendiente &&
                      rolesDe(p.role, p.roles_extra)
                        .slice(1)
                        .map((r) => (
                          <span key={r} className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold opacity-80", colorRol(r))}>
                            + {getRoleInfo(r).label}
                          </span>
                        ))}
                    {inactivo && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Desactivado</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {p.email}
                    {cls.length > 0 && ` · ${cls.map((c) => c.nombre).join(", ")}`}
                    {cls.length === 0 && p.role === "diseno" && " · Sin clientes asignados (ve los sin diseñadora)"}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                    <span className={cn("h-1.5 w-1.5 rounded-full", p.ultimo_acceso ? "bg-success" : "bg-muted-foreground/40")} />
                    {p.ultimo_acceso ? `Entró ${hace(p.ultimo_acceso)}` : "Nunca entró al sistema nuevo"}
                  </p>
                </div>
                {pendiente && (
                  <Button size="sm" variant="outline" className="hidden h-9 rounded-xl font-semibold sm:inline-flex" onClick={() => setEditar(p)}>
                    Asignar rol
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="shrink-0 rounded-xl" aria-label={`Acciones para ${p.nombre}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-xl">
                    <DropdownMenuItem onClick={() => setEditar(p)}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar rol y clientes
                    </DropdownMenuItem>
                    {!yo && !pendiente && (
                      <DropdownMenuItem onClick={() => entrar(p.id)}>
                        <Eye className="mr-2 h-4 w-4" /> Ver como {p.nombre?.split(" ")[0]}
                      </DropdownMenuItem>
                    )}
                    {!pendiente && p.role !== "admin" && (
                      <DropdownMenuItem onClick={() => navigate(`/reportes/${p.id}`)}>
                        <BarChart3 className="mr-2 h-4 w-4" /> Ver reporte
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() =>
                        accion(async () => {
                          const r = await callApi<{ link: string }>("/api/usuarios/clave", { uid: p.id });
                          setCredenciales({
                            titulo: `Link para que ${p.nombre} elija su contraseña`,
                            texto: r.link,
                          });
                        }, "Link generado")
                      }
                    >
                      <KeyRound className="mr-2 h-4 w-4" /> Link para cambiar contraseña
                    </DropdownMenuItem>
                    {!yo && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            accion(
                              () => callApi("/api/usuarios/desactivar", { uid: p.id, activo: inactivo }),
                              inactivo ? `${p.nombre} puede entrar de nuevo` : `${p.nombre} ya no puede entrar`
                            )
                          }
                        >
                          {inactivo ? <UserCheck className="mr-2 h-4 w-4" /> : <UserX className="mr-2 h-4 w-4" />}
                          {inactivo ? "Reactivar" : "Desactivar (no borra nada)"}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setBorrar(p)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Eliminar usuario
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
                })}
              </div>
            </section>
          ))}
          {/* Clientes activos que todavía no tienen a nadie con usuario. */}
          {!q && (filtro === "todos" || filtro === "cliente") && (() => {
            const sinGente = clientes
              .filter((c) => c.enabled !== false && !profiles.some((p) => (p.role === "cliente" || p.role === "contacto") && clavesGrupo(p).includes(`empresa:${c.id}`)))
              .sort((a, b) => a.nombre.localeCompare(b.nombre));
            if (!sinGente.length) return null;
            return (
              <section className="rounded-3xl border-2 border-dashed p-4 sm:p-5">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Building2 className="h-4 w-4 text-muted-foreground" /> Clientes sin usuarios
                  <span className="text-xs font-normal text-muted-foreground">{sinGente.length}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Nadie de estas empresas entra todavía. Sumalos desde la ficha del cliente → Integrantes.</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {sinGente.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium">
                      <span className="h-2 w-2 rounded-full" style={{ background: c.color || "#6F40FC" }} />
                      {c.nombre}
                    </span>
                  ))}
                </div>
              </section>
            );
          })()}
        </div>
      </Section>

      <UsuarioDialog
        persona={editar}
        onClose={() => setEditar(null)}
        onCreado={(texto) => setCredenciales({ titulo: "Usuario creado. Pasale estos datos:", texto })}
      />

      <AlertDialog open={!!borrar} onOpenChange={(o) => !o && setBorrar(null)}>
        <AlertDialogContent className="sm:rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold tracking-tight">¿Eliminar a {borrar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra su cuenta y se lo saca de todos los clientes y chats. Los videos y el historial quedan. Si solo querés
              que no entre más, mejor desactivalo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-2xl font-semibold">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="h-11 rounded-2xl bg-destructive font-semibold text-destructive-foreground shadow-lg shadow-destructive/25 hover:bg-destructive/90"
              onClick={() => {
                const p = borrar;
                setBorrar(null);
                if (p) void accion(() => callApi("/api/usuarios/eliminar", { uid: p.id }), `${p.nombre} eliminado`);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!credenciales} onOpenChange={(o) => !o && setCredenciales(null)}>
        <DialogContent className="max-w-md sm:rounded-2xl">
          <DialogHeader className="space-y-3 text-left">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </span>
            <DialogTitle className="text-xl font-bold tracking-tight">{credenciales?.titulo}</DialogTitle>
            <DialogDescription>Pasáselo por un medio privado. No lo vas a poder ver de nuevo.</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap break-all rounded-2xl bg-muted/60 p-4 font-mono text-sm">{credenciales?.texto}</pre>
          <DialogFooter>
            <Button
              className="h-12 rounded-2xl px-6 font-semibold shadow-lg shadow-primary/25"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(credenciales?.texto ?? "");
                  toast.success("Copiado");
                } catch {
                  toast.error("Seleccioná el texto y copialo a mano");
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function UsuarioDialog({
  persona,
  onClose,
  onCreado,
}: {
  persona: Profile | "nuevo" | null;
  onClose: () => void;
  onCreado: (texto: string) => void;
}) {
  const { clientes } = useRedes();
  const nuevo = persona === "nuevo";
  const p = persona && persona !== "nuevo" ? persona : null;
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  /** Los roles que hace, en orden: el primero es el principal (su pantalla de inicio); los demás suman su módulo. */
  const [roles, setRoles] = useState<string[]>(["productor"]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  /** Socio comercial: su código de referido y la comisión (sin % o sin meses no se calcula). */
  const [socio, setSocio] = useState({ codigo: "", comision_pct: "", meses: "" });

  useEffect(() => {
    if (!persona) return;
    setSocio({
      codigo: p?.socio?.codigo ?? "",
      comision_pct: p?.socio?.comision_pct != null ? String(p.socio.comision_pct) : "",
      meses: p?.socio?.meses != null ? String(p.socio.meses) : "",
    });
    if (p) {
      setNombre(p.nombre ?? "");
      setEmail(p.email ?? "");
      const principal = !p.role || LEGACY_ROLES.includes(p.role) ? null : p.role;
      setRoles(principal && principal !== "pending" ? rolesDe(principal, p.roles_extra) : []);
      setSel(
        new Set(
          clientes
            .filter((c) => Object.values(c.team_roles ?? {}).some((ids) => (ids ?? []).includes(p.id)))
            .map((c) => c.id)
        )
      );
    } else {
      setNombre("");
      setEmail("");
      setRoles(["productor"]);
      setSel(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona]);

  const save = async () => {
    setSaving(true);
    try {
      if (nuevo) {
        const r = await callApi<{ password: string }>("/api/usuarios/crear", {
          nombre,
          email,
          rol,
          roles_extra: extrasValidos,
          clientes: Array.from(sel),
          ...(esSocio ? { socio } : {}),
        });
        onClose();
        onCreado(`Entrá a ${window.location.origin}\nMail: ${email}\nContraseña: ${r.password}`);
      } else if (p) {
        await callApi("/api/usuarios/editar", { uid: p.id, nombre, email, rol, roles_extra: extrasValidos, clientes: Array.from(sel), ...(esSocio ? { socio } : {}) });
        toast.success("Usuario actualizado");
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  // Solo el equipo interno combina roles: cliente y «solo chat» van solos.
  const SOLOS = ["cliente", "contacto"];
  const tocarRol = (r: string) =>
    setRoles((x) => {
      if (x.includes(r)) return x.filter((v) => v !== r);
      if (SOLOS.includes(r)) return [r];
      const sinSolos = x.filter((v) => !SOLOS.includes(v));
      // El super admin, si se suma, pasa a ser el de inicio.
      return r === "admin" ? [r, ...sinSolos] : [...sinSolos, r];
    });
  const rol = roles[0] ?? "pending";
  const extrasValidos = ["admin", ...ROLES_ADICIONALES].includes(rol as never) ? ROLES_ADICIONALES.filter((r) => r !== rol && roles.includes(r)) : [];
  const usaClientes = ["productor", "editor", "pauta", "diseno", "cliente"].includes(rol) || extrasValidos.some((r) => r !== "administracion" && r !== "socio");
  const esSocio = rol === "socio" || extrasValidos.includes("socio");
  const codigoOk = /^[a-z0-9][a-z0-9-]{2,29}$/.test(socio.codigo);

  return (
    <Dialog open={!!persona} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg overflow-y-auto sm:max-h-[92dvh] sm:rounded-2xl">
        <DialogHeader className="space-y-3 text-left">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {nuevo ? <Plus className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
          </span>
          <DialogTitle className="text-[22px] font-bold tracking-tight">{nuevo ? "Nuevo usuario" : `Editar a ${p?.nombre}`}</DialogTitle>
          <DialogDescription>
            {nuevo ? "Se crea la cuenta con una contraseña temporal para pasarle." : "Los cambios aplican al instante."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="u-nombre" className={ETIQUETA}>Nombre</Label>
              <Input id="u-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={cn(SUAVE, "h-12 text-[15px] font-medium")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-mail" className={ETIQUETA}>Mail</Label>
              <Input id="u-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(SUAVE, "h-12")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label className={ETIQUETA}>
              Roles <span className="font-normal normal-case tracking-normal">· tildá todos los que hace; cada uno le suma su módulo al menú</span>
            </Label>
            <div className="space-y-1.5">
              {[
                ...ROLES.map((r) => ({ value: r.value as string, label: r.label, texto: r.description.split(".")[0] })),
                { value: "contacto", label: "Solo chat", texto: "Entra solo a los grupos de chat donde lo sumes" },
              ].map((r) => {
                const on = roles.includes(r.value);
                const inicio = on && roles[0] === r.value && roles.length > 1;
                return (
                  <div
                    key={r.value}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors",
                      on ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : "bg-muted/50 hover:bg-muted"
                    )}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <Checkbox checked={on} onCheckedChange={() => tocarRol(r.value)} />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{r.label}</span>
                        <span className="block text-[11px] leading-snug text-muted-foreground">{r.texto}</span>
                      </span>
                    </label>
                    {inicio && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">Inicio</span>}
                    {on && !inicio && roles.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRoles((x) => [r.value, ...x.filter((v) => v !== r.value)])}
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:bg-background hover:text-foreground"
                        title="Que su pantalla de inicio sea la de este rol"
                      >
                        Usar de inicio
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {roles.length === 0 && (
              <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {nuevo ? "Elegí al menos un rol." : "Sin roles queda bloqueado: no entra al sistema hasta que le asignes uno."}
              </p>
            )}
            {roles.length > 1 && (
              <p className="text-[11px] text-muted-foreground">
                Ve el menú de cada rol como un módulo aparte (con su nombre), en los mismos clientes que elijas abajo. Entra a la pantalla de «Inicio».
              </p>
            )}
          </div>
          {rol === "contacto" && (
            <p className="rounded-2xl bg-muted/60 p-3.5 text-xs leading-relaxed text-muted-foreground">
              Usa solo Prodi Chat: no ve clientes, videos ni nada del sistema. Entra únicamente a los grupos donde lo sumes
              (en el chat: abrí el grupo → Sumar) y puede escribirle por privado a la gente de esos grupos.
            </p>
          )}
          {esSocio && (
            <div className="space-y-3 rounded-2xl bg-primary/5 p-3.5 ring-1 ring-inset ring-primary/20">
              <p className="text-sm font-semibold">Vendedor a comisión</p>
              <div className="space-y-1.5">
                <Label htmlFor="s-codigo" className={ETIQUETA}>Código de su link</Label>
                <Input
                  id="s-codigo"
                  value={socio.codigo}
                  onChange={(e) => setSocio((x) => ({ ...x, codigo: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  placeholder="juanperez"
                  maxLength={30}
                  className={cn(SUAVE, "h-11")}
                />
                <p className="text-[11px] text-muted-foreground">
                  Su link: somosprodi.com/?ref={socio.codigo || "codigo"}
                  {socio.codigo && !codigoOk && <span className="text-destructive"> · mínimo 3 letras o números</span>}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="s-pct" className={ETIQUETA}>Comisión (%)</Label>
                  <Input id="s-pct" type="number" inputMode="decimal" min={0} max={100} value={socio.comision_pct} onChange={(e) => setSocio((x) => ({ ...x, comision_pct: e.target.value }))} placeholder="Ej: 10" className={cn(SUAVE, "h-11")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-meses" className={ETIQUETA}>Durante (meses)</Label>
                  <Input id="s-meses" type="number" inputMode="numeric" min={1} max={120} value={socio.meses} onChange={(e) => setSocio((x) => ({ ...x, meses: e.target.value }))} placeholder="Ej: 12" className={cn(SUAVE, "h-11")} />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Sobre el abono neto cobrado (sin IVA, sin pauta ni reintegros), desde el alta de cada cliente que traiga.
                {(!socio.comision_pct || !socio.meses) && <b className="text-amber-600 dark:text-amber-400"> Sin porcentaje y meses no se le calcula comisión.</b>}
              </p>
            </div>
          )}
          {usaClientes && (
            <div className="space-y-2">
              <Label className={ETIQUETA}>
                {rol === "cliente" ? "Marca a la que pertenece" : "Clientes en los que trabaja"}
                {sel.size > 0 && <span className="font-normal normal-case tracking-normal"> · {sel.size}</span>}
              </Label>
              {rol === "diseno" && (
                <p className="text-xs text-muted-foreground">
                  Ve solo estos clientes y los que todavía no tienen diseñadora asignada (esos los ven todas).
                </p>
              )}
              <div className="space-y-0.5 rounded-2xl bg-muted/60 p-1.5 sm:max-h-56 sm:overflow-y-auto">
                {clientes.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">Todavía no hay clientes. Cuando des de alta uno, lo asignás desde acá o desde la ficha del cliente.</p>
                )}
                {clientes.map((c) => (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
                      sel.has(c.id) ? "bg-background shadow-sm" : "hover:bg-background/60"
                    )}
                  >
                    <Checkbox
                      checked={sel.has(c.id)}
                      onCheckedChange={() =>
                        setSel((prev) => {
                          const n = new Set(prev);
                          if (n.has(c.id)) n.delete(c.id);
                          else n.add(c.id);
                          return n;
                        })
                      }
                    />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="truncate text-sm font-medium">{c.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} className="h-12 rounded-2xl font-semibold">
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !nombre.trim() || !email.trim() || (nuevo && roles.length === 0) || (esSocio && !codigoOk)} className="h-12 rounded-2xl px-6 font-semibold shadow-lg shadow-primary/25">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {nuevo ? "Crear usuario" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
