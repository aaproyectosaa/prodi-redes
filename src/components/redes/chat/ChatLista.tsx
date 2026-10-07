import { useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Archive, ArchiveRestore, ArrowLeft, ListTodo, MoreHorizontal, Pin, PinOff, Plus, Search, Tag, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import UserAvatar from "@/components/UserAvatar";
import { ChatIcon } from "@/components/redes/chat/ChatIcon";
export { ChatIcon };
import { NuevoGrupo, useContactos } from "@/components/redes/chat/Grupos";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { abrirDirecto, noLeido, PRODI_ID, tituloChat } from "@/lib/redes/chat";
import {
  archivar,
  asignarEtiqueta,
  borrarEtiqueta,
  COLORES_ETIQUETA,
  crearEtiqueta,
  fijar,
  MAX_FIJADOS,
  useChatPrefs,
  type ChatPrefs,
} from "@/lib/redes/chatPrefs";
import { cn } from "@/lib/utils";
import { fechaAR, formatearFecha, hoyAR } from "@/lib/fecha";
import type { Chat as ChatT } from "@/lib/redes/types";

function horaCorta(iso: string) {
  if (fechaAR(iso) === hoyAR()) return formatearFecha(iso, { hour: "2-digit", minute: "2-digit" });
  return formatearFecha(iso, { day: "numeric", month: "short" });
}

type Filtro = "todos" | "no-leidos" | "grupos" | `e:${string}`;

/** Etiquetas de un chat: crear (nombre + color), asignar varias y borrar. */
function EtiquetasDialog({
  uid,
  chat,
  prefs,
  titulo,
  onClose,
}: {
  uid: string;
  chat: ChatT | null;
  prefs: ChatPrefs;
  titulo: string;
  onClose: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [color, setColor] = useState(COLORES_ETIQUETA[0]);
  const asignadas = chat ? prefs.asignaciones[chat.id] ?? [] : [];
  const hacer = (p: Promise<unknown>) => p.catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar"));
  return (
    <Dialog open={!!chat} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Etiquetas</DialogTitle>
          <DialogDescription className="truncate">{titulo} · solo las ves vos</DialogDescription>
        </DialogHeader>
        {prefs.etiquetas.length > 0 && (
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {prefs.etiquetas.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-lg px-1 hover:bg-muted/50">
                <label className="flex min-h-10 flex-1 cursor-pointer items-center gap-3">
                  <Checkbox
                    checked={asignadas.includes(e.id)}
                    onCheckedChange={(v) => chat && void hacer(asignarEtiqueta(uid, chat.id, e.id, !!v))}
                  />
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                  <span className="truncate text-sm">{e.nombre}</span>
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Borrar la etiqueta ${e.nombre}`}
                  title="Borrar etiqueta (de todos los chats)"
                  onClick={() => void hacer(borrarEtiqueta(uid, e.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!chat) return;
            void crearEtiqueta(uid, nombre, color, chat.id).then(
              () => setNombre(""),
              (err) => toast.error(err instanceof Error ? err.message : "No se pudo crear")
            );
          }}
        >
          <p className="text-xs font-semibold text-muted-foreground">Nueva etiqueta</p>
          <div className="flex gap-2">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={30} placeholder="Ej: Urgente, Proveedores" aria-label="Nombre de la etiqueta" />
            <Button type="submit" variant="outline" disabled={!nombre.trim()}>
              Crear
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COLORES_ETIQUETA.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn("h-6 w-6 rounded-full ring-offset-2 ring-offset-background", color === c && "ring-2 ring-foreground")}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Lista de conversaciones con buscador, filtros, fijados, archivados y "Nuevo" (la usan /chat, Prodi Chat y el chat flotante). */
export function ChatLista({
  activoId,
  onAbrir,
  onTareas,
  tareasPendientes,
  compacto,
  acciones,
  tituloId,
  buscarRef,
}: {
  activoId: string | null;
  onAbrir: (id: string) => void;
  onTareas: () => void;
  tareasPendientes: number;
  /** En el chat flotante: botones solo con ícono y sin el espacio de la barra del celular. */
  compacto?: boolean;
  /** Botones extra en el encabezado (minimizar, pantalla completa). */
  acciones?: ReactNode;
  tituloId?: string;
  buscarRef?: Ref<HTMLInputElement>;
}) {
  const { chats, clienteById } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile, viewingAs } = useUserProfileContext();
  const uid = user?.uid;
  const prefs = useChatPrefs(uid);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [verArchivados, setVerArchivados] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [nuevoGrupo, setNuevoGrupo] = useState(false);
  const [menuDe, setMenuDe] = useState<string | null>(null);
  const [etiquetasDe, setEtiquetasDe] = useState<ChatT | null>(null);
  const personas = useContactos();
  const tMantener = useRef<ReturnType<typeof setTimeout>>();
  const mantenido = useRef(false);

  const titulo = (c: ChatT) => tituloChat(c, uid, profiles, role);
  const etiquetaPorId = useMemo(() => new Map(prefs.etiquetas.map((e) => [e.id, e])), [prefs.etiquetas]);
  // Un filtro de una etiqueta que se borró vuelve a "Todos".
  const filtroOk: Filtro = filtro.startsWith("e:") && !etiquetaPorId.has(filtro.slice(2)) ? "todos" : filtro;
  const archivados = new Set(prefs.archivados);
  const pasa = (c: ChatT) =>
    filtroOk === "todos"
      ? true
      : filtroOk === "no-leidos"
        ? noLeido(c, uid)
        : filtroOk === "grupos"
          ? c.tipo !== "directo"
          : (prefs.asignaciones[c.id] ?? []).includes(filtroOk.slice(2));

  const buscando = q.trim().length > 0;
  let lista: ChatT[];
  if (buscando) {
    // La búsqueda mira todos (también los archivados).
    lista = chats.filter((c) => titulo(c).toLowerCase().includes(q.trim().toLowerCase()));
  } else if (verArchivados) {
    lista = chats.filter((c) => archivados.has(c.id) && pasa(c));
  } else {
    const visibles = chats.filter((c) => !archivados.has(c.id) && pasa(c));
    const fijados = prefs.fijados.map((id) => visibles.find((c) => c.id === id)).filter(Boolean) as ChatT[];
    lista = [...fijados, ...visibles.filter((c) => !prefs.fijados.includes(c.id))];
  }
  const enArchivo = chats.filter((c) => archivados.has(c.id));
  const archivoSinLeer = enArchivo.filter((c) => noLeido(c, uid)).length;

  const guardar = (p: Promise<unknown>, ok?: string) =>
    p.then(
      () => ok && toast.success(ok),
      (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar")
    );

  const chips: { id: Filtro; label: string; color?: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "no-leidos", label: "No leídos" },
    { id: "grupos", label: "Grupos" },
    ...prefs.etiquetas.map((e) => ({ id: `e:${e.id}` as Filtro, label: e.nombre, color: e.color })),
  ];

  const Titulo = compacto ? "h2" : "h1";
  const soloLectura = !!viewingAs;

  return (
    <>
      <div className={cn("shrink-0 space-y-3 border-b", compacto ? "p-3" : "p-4")}>
        <div className="flex items-center justify-between gap-2">
          {verArchivados && !buscando ? (
            <button type="button" onClick={() => setVerArchivados(false)} className="-ml-1 flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
              <Titulo id={tituloId} className={cn("font-bold", compacto ? "text-base" : "text-xl")}>
                Archivados
              </Titulo>
            </button>
          ) : (
            <Titulo id={tituloId} className={cn("font-bold", compacto ? "text-base" : "text-xl")}>
              Chat
            </Titulo>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onTareas}
              className={cn("relative", compacto && "h-10 w-10 px-0 md:h-8 md:w-auto md:px-2")}
              aria-label="Tareas"
              title="Tareas"
            >
              <ListTodo className={cn("h-4 w-4", !compacto && "sm:mr-1")} />
              {!compacto && <span className="hidden sm:inline">Tareas</span>}
              {tareasPendientes > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {tareasPendientes}
                </span>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNuevo(true)}
              className={cn(compacto && "h-10 w-10 px-0 md:h-8 md:w-auto md:px-2")}
              aria-label="Nueva conversación"
              title="Nueva conversación"
            >
              <Plus className={cn("h-4 w-4", !compacto && "mr-1")} />
              {!compacto && "Nuevo"}
            </Button>
            {acciones}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={buscarRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conversación"
            aria-label="Buscar conversación"
            className={cn("pl-9", compacto && "h-9")}
          />
        </div>
        {!buscando && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="tablist" aria-label="Filtrar conversaciones">
            {chips.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filtroOk === f.id}
                onClick={() => setFiltro(f.id)}
                className={cn(
                  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                  filtroOk === f.id ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
                )}
              >
                {f.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: f.color }} />}
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-y-contain", compacto ? "safe-area-pb" : "pb-mobile-nav md:pb-0")}>
        {lista.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {buscando
              ? "No hay conversaciones con ese nombre."
              : filtroOk !== "todos"
                ? "No hay conversaciones con este filtro."
                : verArchivados
                  ? "No tenés chats archivados."
                  : chats.length
                    ? "Todos tus chats están archivados."
                    : "Todavía no hay conversaciones. Los grupos de cada cliente se crean solos cuando el admin asigna el equipo."}
          </p>
        )}
        {lista.map((c) => {
          const unread = noLeido(c, uid);
          const fijado = prefs.fijados.includes(c.id);
          const archivado = archivados.has(c.id);
          const etiquetas = (prefs.asignaciones[c.id] ?? []).map((id) => etiquetaPorId.get(id)).filter(Boolean) as ChatPrefs["etiquetas"];
          const cancelar = () => clearTimeout(tMantener.current);
          return (
            <div key={c.id} className="group/fila relative">
              <button
                type="button"
                onClick={() => {
                  if (mantenido.current) {
                    mantenido.current = false;
                    return;
                  }
                  onAbrir(c.id);
                }}
                // Celular: mantener apretado abre el menú (fijar, archivar, etiquetas).
                onTouchStart={() => {
                  cancelar();
                  mantenido.current = false;
                  if (soloLectura) return;
                  tMantener.current = setTimeout(() => {
                    mantenido.current = true;
                    navigator.vibrate?.(10);
                    setMenuDe(c.id);
                  }, 500);
                }}
                onTouchMove={cancelar}
                onTouchEnd={cancelar}
                onTouchCancel={cancelar}
                onContextMenu={(e) => {
                  if (soloLectura) return;
                  e.preventDefault();
                  setMenuDe(c.id);
                }}
                className={cn(
                  "flex w-full select-none items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors [-webkit-touch-callout:none] hover:bg-muted/50",
                  activoId === c.id && "bg-accent"
                )}
              >
                <ChatIcon chat={c} profiles={profiles} uid={uid} color={clienteById(c.proyecto_id)?.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("flex min-w-0 items-center gap-1 truncate text-sm", unread ? "font-bold" : "font-medium")}>
                      <span className="truncate">{titulo(c)}</span>
                    </p>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground md:group-hover/fila:invisible">
                      {fijado && <Pin className="h-3 w-3 rotate-45 text-primary" aria-label="Fijado" />}
                      {c.ultimo && horaCorta(c.ultimo.at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={cn("min-w-0 truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                      {c.ultimo
                        ? `${c.ultimo.by === uid ? "Vos: " : c.ultimo.by === PRODI_ID ? "Prodi: " : c.tipo !== "directo" ? `${(profiles.find((p) => p.id === c.ultimo!.by)?.nombre ?? c.nombres?.[c.ultimo.by] ?? "").split(" ")[0]}: ` : ""}${c.ultimo.texto}`
                        : c.tipo === "cliente"
                          ? "Grupo del cliente con el equipo"
                          : c.tipo === "grupo"
                            ? "Grupo"
                            : "Sin mensajes"}
                    </p>
                    {unread && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Sin leer" />}
                  </div>
                  {(etiquetas.length > 0 || (buscando && archivado)) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {buscando && archivado && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">Archivado</span>
                      )}
                      {etiquetas.map((e) => (
                        <span
                          key={e.id}
                          className="flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium"
                          style={{ backgroundColor: `${e.color}22`, color: e.color }}
                        >
                          {e.nombre}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
              {!soloLectura && uid && (
                <DropdownMenu open={menuDe === c.id} onOpenChange={(o) => setMenuDe(o ? c.id : null)}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Opciones de ${titulo(c)}`}
                      title="Opciones"
                      className={cn(
                        "absolute right-2 top-2.5 flex h-7 w-7 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground",
                        // En el celular no se ve (se abre manteniendo apretado); en la compu, al pasar el mouse.
                        "pointer-events-none opacity-0 md:pointer-events-auto md:group-hover/fila:opacity-100 md:focus-visible:opacity-100",
                        menuDe === c.id && "md:opacity-100"
                      )}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => void guardar(fijar(uid, c.id, !fijado))} disabled={!fijado && prefs.fijados.length >= MAX_FIJADOS}>
                      {fijado ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                      {fijado ? "Desfijar" : prefs.fijados.length >= MAX_FIJADOS ? `Fijar (máx. ${MAX_FIJADOS})` : "Fijar arriba"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void guardar(archivar(uid, c.id, !archivado), archivado ? "Chat desarchivado" : "Chat archivado")}>
                      {archivado ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
                      {archivado ? "Desarchivar" : "Archivar"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setEtiquetasDe(c)}>
                      <Tag className="mr-2 h-4 w-4" /> Etiquetas…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
        {!buscando && !verArchivados && enArchivo.length > 0 && (
          <button
            type="button"
            onClick={() => setVerArchivados(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-muted-foreground hover:bg-muted/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <Archive className="h-4 w-4" />
            </span>
            <span className="flex-1 font-medium">Archivados ({enArchivo.length})</span>
            {archivoSinLeer > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground" aria-label={`${archivoSinLeer} sin leer`}>
                {archivoSinLeer}
              </span>
            )}
          </button>
        )}
      </div>

      <CommandDialog open={nuevo} onOpenChange={setNuevo}>
        <CommandInput placeholder="¿Con quién querés hablar?" />
        <CommandList>
          <CommandEmpty>No hay nadie con ese nombre.</CommandEmpty>
          <CommandGroup>
            <CommandItem
              value="nuevo grupo"
              className="gap-3"
              onSelect={() => {
                setNuevo(false);
                setNuevoGrupo(true);
              }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <UsersRound className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1 font-medium">Nuevo grupo</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Mensaje privado">
            {personas.map(({ profile: p, etiqueta }) => (
              <CommandItem
                key={p.id}
                value={`${p.nombre} ${p.email} ${etiqueta}`}
                className="gap-3"
                onSelect={async () => {
                  setNuevo(false);
                  if (!uid) return;
                  try {
                    onAbrir(await abrirDirecto(uid, p.id, { [uid]: profile?.nombre ?? "", [p.id]: p.nombre ?? "" }));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "No se pudo abrir");
                  }
                }}
              >
                <UserAvatar profile={p} size="sm" />
                <span className="flex-1 truncate">{p.nombre}</span>
                {etiqueta && <span className="text-xs text-muted-foreground">{etiqueta}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <NuevoGrupo open={nuevoGrupo} onOpenChange={setNuevoGrupo} onCreado={onAbrir} />
      {uid && (
        <EtiquetasDialog
          uid={uid}
          chat={etiquetasDe ? chats.find((c) => c.id === etiquetasDe.id) ?? etiquetasDe : null}
          prefs={prefs}
          titulo={etiquetasDe ? titulo(etiquetasDe) : ""}
          onClose={() => setEtiquetasDe(null)}
        />
      )}
    </>
  );
}
