// Grupos de chat: crear uno nuevo y la ficha de la conversación (miembros, nombre, foto, salir).

import { useMemo, useRef, useState } from "react";
import { Camera, Crown, Loader2, LogOut, Search, Trash2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import UserAvatar from "@/components/UserAvatar";
import { RecorteFoto } from "@/components/RecorteFoto";
import { ChatIcon } from "@/components/redes/chat/ChatIcon";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import {
  cambiarAdmin,
  contactosDe,
  crearGrupo,
  editarChat,
  esAdminDelGrupo,
  PRODI_ID,
  puedeEditarChat,
  sacarDelGrupo,
  salirDelGrupo,
  sumarAlGrupo,
  tituloChat,
} from "@/lib/redes/chat";
import { getRoleInfo, trabajaEnCliente } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { callApi } from "@/lib/redes/api";
import type { Chat } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";

const COLORES = ["#6F40FC", "#E040A0", "#ef4444", "#f97316", "#eab308", "#10b981", "#06b6d4", "#3b82f6"];
/** Foto del grupo: más chica que la de perfil (el documento del chat se lee seguido). */
const FOTO_GRUPO = { lado: 160, maxChars: 30_000 };
const LEGADO = ["cm", "pm", "disenador", "pending"];

export interface Persona {
  id: string;
  nombre: string;
  profile: Profile;
  etiqueta: string;
}

/**
 * Con quién puede hablar (privado o en grupo), igual que lo que valida el servidor:
 * - cliente: la gente con la que ya comparte un chat;
 * - equipo: todo el equipo y los usuarios de los clientes donde trabaja (super admin: todos; diseño: también los sin diseñadora).
 */
export function useContactos(): Persona[] {
  const { chats } = useRedes();
  const { profiles, projects } = useAppData();
  const { user, role } = useUserProfileContext();
  const uid = user?.uid;
  return useMemo(() => {
    if (!uid) return [];
    // Clientes y contactos (solo chat): la gente con la que ya comparten un chat (el equipo del cliente y su empresa).
    if (role === "cliente" || role === "contacto") {
      const contactos = contactosDe(chats);
      const m = new Map<string, string>();
      for (const c of chats) for (const id of c.miembros) if (id !== uid && id !== PRODI_ID && !m.has(id)) m.set(id, c.nombres?.[id] ?? "");
      return [...m]
        .filter(([, n]) => n)
        .map(([id, nombre]) => ({ id, nombre, profile: { id, nombre, email: "" } as Profile, etiqueta: contactos.has(id) ? "Contacto" : "" }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }
    const todos = role === "admin";
    const asignado = ["productor", "editor", "pauta", "diseno"].includes(role ?? "");
    const misProyectos = projects.filter(
      (p) => todos || (asignado && trabajaEnCliente(role, uid, p))
    );
    const misClientes = new Set(misProyectos.flatMap((p) => p.team_roles?.cliente ?? []));
    const misIds = new Set(misProyectos.map((p) => p.id));
    return profiles
      .filter((p) => p.id !== uid && p.role && !LEGADO.includes(p.role) && p.activo !== false && p.nombre?.trim())
      .filter((p) => (p.role === "cliente" ? misClientes.has(p.id) : p.role === "contacto" ? !!p.proyecto_id && misIds.has(p.proyecto_id) : true))
      .map((p) => {
        if (p.role === "contacto") {
          const de = projects.find((x) => x.id === p.proyecto_id)?.nombre;
          return { id: p.id, nombre: p.nombre, profile: p, etiqueta: de ? `Contacto · ${de}` : "Contacto" };
        }
        const de = p.role === "cliente" ? projects.find((x) => x.team_roles?.cliente?.includes(p.id))?.nombre : undefined;
        return { id: p.id, nombre: p.nombre, profile: p, etiqueta: de ? `Cliente · ${de}` : getRoleInfo(p.role).label };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [chats, profiles, projects, uid, role]);
}

/** Marca de "Contacto" (persona de un cliente que usa solo Prodi Chat). */
export function EtiquetaContacto({ className }: { className?: string }) {
  return (
    <span
      className={cn("rounded bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400", className)}
      title="Contacto del cliente: usa solo Prodi Chat"
    >
      Contacto
    </span>
  );
}

/** Lista para elegir personas (con buscador). */
function ElegirPersonas({
  personas,
  elegidas,
  onCambiar,
}: {
  personas: Persona[];
  elegidas: Set<string>;
  onCambiar: (s: Set<string>) => void;
}) {
  const [q, setQ] = useState("");
  const filtradas = personas.filter((p) => !q || `${p.nombre} ${p.etiqueta}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona" className="pl-9" aria-label="Buscar persona" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border">
        {filtradas.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No hay nadie para sumar.</p>}
        {filtradas.map((p) => {
          const si = elegidas.has(p.id);
          return (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50">
              <Checkbox
                checked={si}
                onCheckedChange={(v) => {
                  const n = new Set(elegidas);
                  if (v) n.add(p.id);
                  else n.delete(p.id);
                  onCambiar(n);
                }}
              />
              <UserAvatar profile={p.profile} size="sm" className="h-8 w-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.nombre}</span>
                {p.etiqueta && <span className="block truncate text-xs text-muted-foreground">{p.etiqueta}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Foto / emoji / color del grupo. */
function CaraGrupo({
  vista,
  foto,
  emoji,
  color,
  onFoto,
  onEmoji,
  onColor,
}: {
  vista: Chat;
  foto: string | null;
  emoji: string;
  color: string;
  onFoto: (f: string | null) => void;
  onEmoji?: (e: string) => void;
  onColor?: (c: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative shrink-0 rounded-full"
        aria-label="Elegir foto del grupo"
        title="Elegir foto"
      >
        <ChatIcon chat={{ ...vista, foto, emoji: emoji || null, color }} profiles={[]} className="h-16 w-16 text-lg" />
        <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
          <Camera className="h-3.5 w-3.5" />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setArchivo(f);
        }}
      />
      <RecorteFoto
        file={archivo}
        titulo="Foto del grupo"
        {...FOTO_GRUPO}
        onListo={(img) => {
          onFoto(img);
          setArchivo(null);
        }}
        onCancelar={() => setArchivo(null)}
      />
      <div className="min-w-0 flex-1 space-y-2">
        {onColor && (
          <div className="flex flex-wrap gap-1.5">
            {COLORES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onColor(c)}
                className={cn("h-6 w-6 rounded-full ring-offset-2 ring-offset-background", color === c && "ring-2 ring-foreground")}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {onEmoji && (
            <Input
              value={emoji}
              onChange={(e) => onEmoji(Array.from(e.target.value).slice(-2).join(""))}
              placeholder="😀"
              aria-label="Emoji del grupo"
              className="h-8 w-16 text-center"
            />
          )}
          {foto && (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => onFoto(null)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Sacar foto
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Nuevo grupo": nombre, foto/emoji/color y personas. Quien lo crea queda como admin. */
export function NuevoGrupo({ open, onOpenChange, onCreado }: { open: boolean; onOpenChange: (o: boolean) => void; onCreado: (id: string) => void }) {
  const { user, profile } = useUserProfileContext();
  const contactos = useContactos();
  const [nombre, setNombre] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [emoji, setEmoji] = useState("");
  const [color, setColor] = useState(COLORES[0]);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [creando, setCreando] = useState(false);

  const cerrar = (o: boolean) => {
    if (creando) return;
    onOpenChange(o);
    if (!o) {
      setNombre("");
      setFoto(null);
      setEmoji("");
      setColor(COLORES[0]);
      setElegidas(new Set());
    }
  };

  const crear = async () => {
    if (!user) return;
    setCreando(true);
    try {
      const miembros = Object.fromEntries(contactos.filter((p) => elegidas.has(p.id)).map((p) => [p.id, p.nombre]));
      const id = await crearGrupo(user.uid, profile?.nombre ?? "", { nombre, foto, emoji, color }, miembros);
      toast.success("Grupo creado");
      setCreando(false);
      cerrar(false);
      onCreado(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear el grupo");
      setCreando(false);
    }
  };

  const vista: Chat = { id: "nuevo", tipo: "grupo", proyecto_id: null, nombre: nombre || "?", miembros: [], ultimo: null, leido: {}, created_at: "" };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo grupo</DialogTitle>
          <DialogDescription>Vos quedás como admin: podés cambiar el nombre, la foto y quiénes están.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del grupo" maxLength={80} aria-label="Nombre del grupo" autoFocus />
          <CaraGrupo vista={vista} foto={foto} emoji={emoji} color={color} onFoto={setFoto} onEmoji={setEmoji} onColor={setColor} />
          <ElegirPersonas personas={contactos} elegidas={elegidas} onCambiar={setElegidas} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => cerrar(false)} disabled={creando}>
            Cancelar
          </Button>
          <Button onClick={() => void crear()} disabled={creando || !nombre.trim() || elegidas.size === 0}>
            {creando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Crear grupo{elegidas.size ? ` (${elegidas.size + 1})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ficha de la conversación: miembros y, si podés, nombre, foto y quiénes están. */
export function InfoChat({
  chat,
  open,
  onOpenChange,
  onSalio,
}: {
  chat: Chat;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSalio: () => void;
}) {
  const { profiles } = useAppData();
  const { chats } = useRedes();
  const { user, role, profile } = useUserProfileContext();
  const uid = user?.uid;
  const yo = profile?.nombre ?? "";
  const personas = useContactos();
  const contactos = useMemo(() => contactosDe(chats), [chats]);
  const esGrupo = chat.tipo === "grupo";
  const admin = esAdminDelGrupo(chat, uid, role);
  const editaFoto = puedeEditarChat(chat, uid, role);
  const [nombre, setNombre] = useState(chat.nombre ?? "");
  const [sumando, setSumando] = useState(false);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [confirmarSalir, setConfirmarSalir] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  /** Borrar el grupo (con todos sus mensajes): solo el super admin. */
  const puedeBorrar = role === "admin" && chat.tipo !== "directo";

  const persona = (id: string): Profile =>
    profiles.find((p) => p.id === id) ?? ({ id, nombre: chat.nombres?.[id] || "Usuario", email: "" } as Profile);
  const miembros = [...chat.miembros].sort((a, b) =>
    a === uid ? -1 : b === uid ? 1 : persona(a).nombre.localeCompare(persona(b).nombre)
  );

  const hacer = async (f: () => Promise<unknown>, ok?: string) => {
    if (!uid) return;
    setOcupado(true);
    try {
      await f();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setOcupado(false);
    }
  };

  const disponibles = personas.filter((p) => !chat.miembros.includes(p.id));

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
          <SheetHeader className="space-y-3 border-b p-5 text-left">
            <SheetTitle>{esGrupo ? "Grupo" : chat.tipo === "equipo" ? "Equipo Prodi" : "Grupo del cliente"}</SheetTitle>
            <SheetDescription className="sr-only">Miembros y datos de la conversación</SheetDescription>
            {editaFoto && uid ? (
              <CaraGrupo
                vista={chat}
                foto={chat.foto ?? null}
                emoji={chat.emoji ?? ""}
                color={chat.color ?? COLORES[0]}
                onFoto={(f) => void hacer(() => editarChat(chat, uid, yo, { foto: f }), f ? "Foto actualizada" : "Foto quitada")}
                onEmoji={esGrupo ? (e) => void hacer(() => editarChat(chat, uid, yo, { emoji: e })) : undefined}
                onColor={esGrupo ? (c) => void hacer(() => editarChat(chat, uid, yo, { color: c })) : undefined}
              />
            ) : (
              <div className="flex items-center gap-3">
                <ChatIcon chat={chat} profiles={profiles} uid={uid} className="h-16 w-16 text-lg" />
                <p className="text-lg font-semibold">{tituloChat(chat, uid, profiles, role)}</p>
              </div>
            )}
            {((esGrupo && admin) || (!esGrupo && editaFoto)) && uid && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void hacer(() => editarChat(chat, uid, yo, { nombre }), "Nombre cambiado");
                }}
              >
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} aria-label="Nombre del grupo" />
                <Button type="submit" variant="outline" disabled={ocupado || !nombre.trim() || nombre.trim() === chat.nombre}>
                  Guardar
                </Button>
              </form>
            )}
            {editaFoto && !esGrupo && <p className="text-xs text-muted-foreground">Como super admin podés cambiar el nombre y la foto de este grupo.</p>}
          </SheetHeader>

          <div className="flex-1 space-y-3 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{chat.miembros.length} miembros</p>
              {esGrupo && admin && (
                <Button size="sm" variant="outline" onClick={() => setSumando((v) => !v)}>
                  <UserPlus className="mr-1.5 h-4 w-4" /> Sumar
                </Button>
              )}
            </div>
            {sumando && uid && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <ElegirPersonas personas={disponibles} elegidas={elegidas} onCambiar={setElegidas} />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={ocupado || !elegidas.size}
                  onClick={() =>
                    void hacer(async () => {
                      await sumarAlGrupo(chat, uid, yo, Object.fromEntries(disponibles.filter((p) => elegidas.has(p.id)).map((p) => [p.id, p.nombre])));
                      setElegidas(new Set());
                      setSumando(false);
                    }, "Listo, ya están en el grupo")
                  }
                >
                  Sumar {elegidas.size || ""} al grupo
                </Button>
              </div>
            )}
            <ul className="divide-y rounded-lg border">
              {miembros.map((id) => {
                const p = persona(id);
                const esAdm = esGrupo && (chat.admins ?? []).includes(id);
                return (
                  <li key={id} className="flex items-center gap-3 px-3 py-2">
                    <UserAvatar profile={p} size="sm" className="h-8 w-8" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{id === uid ? `${p.nombre} (vos)` : p.nombre}</span>
                        {(p.role === "contacto" || contactos.has(id)) && <EtiquetaContacto className="shrink-0" />}
                      </span>
                      {p.role && p.role !== "contacto" && <span className="block truncate text-xs text-muted-foreground">{getRoleInfo(p.role).label}</span>}
                    </span>
                    {esAdm && (
                      <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <Crown className="h-3 w-3" /> Admin
                      </span>
                    )}
                    {esGrupo && admin && id !== uid && uid && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          disabled={ocupado}
                          title={esAdm ? "Quitar admin" : "Hacer admin"}
                          aria-label={esAdm ? `Quitar admin a ${p.nombre}` : `Hacer admin a ${p.nombre}`}
                          onClick={() => void hacer(() => cambiarAdmin(chat, id, !esAdm))}
                        >
                          <Crown className={cn("h-4 w-4", esAdm ? "text-primary" : "text-muted-foreground")} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          disabled={ocupado}
                          title="Sacar del grupo"
                          aria-label={`Sacar a ${p.nombre} del grupo`}
                          onClick={() => void hacer(() => sacarDelGrupo(chat, uid, yo, id, p.nombre))}
                        >
                          <UserMinus className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            {esGrupo && chat.miembros.includes(uid ?? "") && (
              <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={() => setConfirmarSalir(true)}>
                <LogOut className="mr-1.5 h-4 w-4" /> Salir del grupo
              </Button>
            )}
            {puedeBorrar && (
              <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={() => setConfirmarBorrar(true)}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Borrar el grupo
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog open={confirmarBorrar} onOpenChange={setConfirmarBorrar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{chat.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran el grupo y todos sus mensajes, fotos y audios para todos los miembros. No se puede deshacer.
              {chat.tipo !== "grupo" && " Este grupo lo arma el sistema: queda dado de baja y no se vuelve a crear solo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                void hacer(async () => {
                  await callApi("/api/usuarios/chat-borrar", { chat_id: chat.id });
                  onOpenChange(false);
                  onSalio();
                }, "Grupo borrado")
              }
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmarSalir} onOpenChange={setConfirmarSalir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Salir de «{chat.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>Dejás de ver los mensajes. Para volver, te tiene que sumar un admin del grupo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                void hacer(async () => {
                  if (!uid) return;
                  await salirDelGrupo(chat, uid, yo);
                  onOpenChange(false);
                  onSalio();
                }, "Saliste del grupo")
              }
            >
              Salir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
