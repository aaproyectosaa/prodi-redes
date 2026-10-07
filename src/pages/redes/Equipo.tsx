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
import { LEGACY_ROLES, ROLES, getRoleInfo } from "@/lib/roles";
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
      title="Equipo y usuarios"
      subtitle="Altas, bajas, roles y a qué clientes tiene acceso cada persona."
      actions={
        <Button onClick={() => setEditar("nuevo")}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo usuario
        </Button>
      }
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o mail" className="pl-9" />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {FILTROS.map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setFiltro(f.v)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filtro === f.v ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50"
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
        <div className="divide-y rounded-xl border bg-card">
          {filtrados.map((p) => {
            const pendiente = esPendiente(p);
            const inactivo = p.activo === false;
            const cls = clientesDe(p);
            const yo = p.id === realUser?.uid;
            return (
              <div key={p.id} className={cn("flex items-center gap-3 px-4 py-3", inactivo && "opacity-60")}>
                <UserAvatar profile={p} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <p className="truncate font-medium">{p.nombre}</p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        pendiente ? "bg-warning/20 text-warning" : "bg-primary/12 text-primary"
                      )}
                    >
                      {pendiente ? (LEGACY_ROLES.includes(p.role ?? "pending") ? getRoleInfo(p.role).label : "Sin rol") : getRoleInfo(p.role).label}
                    </span>
                    {inactivo && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">Desactivado</span>}
                    {yo && <span className="text-[10px] text-muted-foreground">(vos)</span>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.email}
                    {cls.length > 0 && ` · ${cls.map((c) => c.nombre).join(", ")}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    {p.ultimo_acceso ? `Entró ${hace(p.ultimo_acceso)}` : "Nunca entró al sistema nuevo"}
                  </p>
                </div>
                {pendiente && (
                  <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => setEditar(p)}>
                    Asignar rol
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" aria-label={`Acciones para ${p.nombre}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
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
          {filtrados.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No hay usuarios con ese filtro.</p>}
        </div>
      </Section>

      <UsuarioDialog
        persona={editar}
        onClose={() => setEditar(null)}
        onCreado={(texto) => setCredenciales({ titulo: "Usuario creado. Pasale estos datos:", texto })}
      />

      <AlertDialog open={!!borrar} onOpenChange={(o) => !o && setBorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {borrar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra su cuenta y se lo saca de todos los clientes y chats. Los videos y el historial quedan. Si solo querés
              que no entre más, mejor desactivalo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{credenciales?.titulo}</DialogTitle>
            <DialogDescription>Pasáselo por un medio privado. No lo vas a poder ver de nuevo.</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap break-all rounded-lg border bg-muted/40 p-3 text-sm">{credenciales?.texto}</pre>
          <DialogFooter>
            <Button
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
  const [rol, setRol] = useState("productor");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!persona) return;
    if (p) {
      setNombre(p.nombre ?? "");
      setEmail(p.email ?? "");
      setRol(!p.role || LEGACY_ROLES.includes(p.role) ? "pending" : p.role);
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
      setRol("productor");
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
          clientes: Array.from(sel),
        });
        onClose();
        onCreado(`Entrá a ${window.location.origin}\nMail: ${email}\nContraseña: ${r.password}`);
      } else if (p) {
        await callApi("/api/usuarios/editar", { uid: p.id, nombre, email, rol, clientes: Array.from(sel) });
        toast.success("Usuario actualizado");
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const usaClientes = ["productor", "editor", "pauta", "cliente"].includes(rol);

  return (
    <Dialog open={!!persona} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{nuevo ? "Nuevo usuario" : `Editar a ${p?.nombre}`}</DialogTitle>
          <DialogDescription>
            {nuevo ? "Se crea la cuenta con una contraseña temporal para pasarle." : "Los cambios aplican al instante."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-nombre">Nombre</Label>
              <Input id="u-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-mail">Mail</Label>
              <Input id="u-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Rol</Label>
            <Select value={rol} onValueChange={setRol}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label} · <span className="text-muted-foreground">{r.description.split(".")[0]}</span>
                  </SelectItem>
                ))}
                {!nuevo && <SelectItem value="pending">Sin rol (bloqueado)</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {usaClientes && (
            <div className="space-y-1.5">
              <Label>{rol === "cliente" ? "Marca a la que pertenece" : "Clientes en los que trabaja"}</Label>
              <div className="space-y-1 rounded-lg border p-2 sm:max-h-56 sm:overflow-y-auto">
                {clientes.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">Todavía no hay clientes. Cuando des de alta uno, lo asignás desde acá o desde la ficha del cliente.</p>
                )}
                {clientes.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60">
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
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="text-sm">{c.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !nombre.trim() || !email.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {nuevo ? "Crear usuario" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
