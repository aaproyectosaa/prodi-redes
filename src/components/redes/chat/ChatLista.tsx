import { RachaChip } from "./RachaRespuestas";
import { useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  Star, Archive, ArchiveRestore, ArrowLeft, Headphones, ListTodo, MoreHorizontal, Pin, PinOff, Search, SquarePen, Tag, Trash2, UsersRound, X } from "lucide-react";
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
import { abrirDirecto, noLeido, PRODI_ID, tituloChat, useConteoSinLeer } from "@/lib/redes/chat";
import {
  archivar,
  asignarEtiqueta,
  borrarEtiqueta,
  COLORES_ETIQUETA,
  alternarGuardado,
  crearEtiqueta,
  fijar,
  MAX_FIJADOS,
  useChatPrefs,
  type ChatPrefs,
} from "@/lib/redes/chatPrefs";
import { cn } from "@/lib/utils";
import { textoEscribiendo, useEscriben } from "@/lib/redes/escribiendo";
import { useChatVoz } from "@/lib/redes/chatVoz";
import { useProyectosSoftware } from "@/lib/redes/clientesSoftware";
import { fechaAR, formatearFecha, hoyAR } from "@/lib/fecha";
import type { Chat as ChatT } from "@/lib/redes/types";

function horaCorta(iso: string) {
  if (fechaAR(iso) === hoyAR()) return formatearFecha(iso, { hour: "2-digit", minute: "2-digit" });
  return formatearFecha(iso, { day: "numeric", month: "short" });
}

type Filtro = "todos" | "no-leidos" | "sin-responder" | "grupos" | "software" | `e:${string}`;

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
  // "escribiendo…" en la fila del chat, como WhatsApp.
  const escriben = useEscriben();
  const { enVoz } = useChatVoz();
  // Clientes de Redes que también son de Software: su grupo lleva la etiqueta "Software" (solo para el equipo).
  const proyectosSw = useProyectosSoftware(role !== "cliente" && role !== "contacto");
  const esDeSoftware = (c: ChatT) => c.tipo === "software" || c.area === "software" || (c.tipo === "cliente" && !!c.proyecto_id && proyectosSw.has(c.proyecto_id));
  const prefs = useChatPrefs(uid);
  const [verGuardados, setVerGuardados] = useState(false);
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
  // Al bajar por la lista, el encabezado se achica (título chico, sin buscador ni filtros); al subir, vuelve.
  const [plegado, setPlegado] = useState(false);
  const ultimoScroll = useRef(0);
  const inputBuscar = useRef<HTMLInputElement | null>(null);
  const refBuscar = (el: HTMLInputElement | null) => {
    inputBuscar.current = el;
    if (typeof buscarRef === "function") buscarRef(el);
    else if (buscarRef) (buscarRef as { current: HTMLInputElement | null }).current = el;
  };
  // Mientras se achica o se agranda el encabezado (300 ms), la lista se corre sola: eso no cuenta como scroll.
  const animando = useRef(0);
  const plegar = (v: boolean) => {
    setPlegado((antes) => {
      if (antes !== v) animando.current = Date.now() + 350;
      return v;
    });
  };
  const alScrollear = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const y = el.scrollTop;
    const antes = ultimoScroll.current;
    ultimoScroll.current = y;
    // El rebote del iPhone al llegar arriba o abajo de todo no es scroll.
    if (y < 0 || y > el.scrollHeight - el.clientHeight) return;
    if (Date.now() < animando.current) return;
    if (y < 12) plegar(false);
    else if (y > antes + 4 && y > 48) plegar(true);
    else if (y < antes - 14) plegar(false);
  };
  const abrirBuscador = () => {
    plegar(false);
    window.setTimeout(() => inputBuscar.current?.focus(), 200);
  };

  const titulo = (c: ChatT) => tituloChat(c, uid, profiles, role);
  // Cliente que escribió y nadie del equipo le contestó en más de 3 horas: arriba de todo y en rojo (solo el equipo lo ve).
  const esEquipo = role !== "cliente";
  const SIN_RESPONDER_MS = 3 * 3600_000;
  const esDelCliente = (c: ChatT, by: string) =>
    (c.contactos ?? []).includes(by) || profiles.find((p) => p.id === by)?.role === "cliente";
  const esperando = (c: ChatT): number | null => {
    if (!esEquipo || c.tipo !== "cliente" || !c.ultimo || c.ultimo.by === PRODI_ID || !esDelCliente(c, c.ultimo.by)) return null;
    const ms = Date.now() - new Date(c.ultimo.at).getTime();
    return ms >= SIN_RESPONDER_MS ? ms : null;
  };
  /** A quién le toca contestar: la productora del cliente (la que lleva la cuenta). En los de Software, nadie fijo. */
  const aCargo = (c: ChatT): { id: string; nombre: string } | null => {
    if (c.area === "software") return null;
    const ids = clienteById(c.proyecto_id)?.team_roles?.productor ?? [];
    const p = ids.map((id) => profiles.find((x) => x.id === id)).find((x) => x && x.activo !== false);
    return p ? { id: p.id, nombre: (p.nombre ?? "").split(" ")[0] } : null;
  };
  const horasEspera = (ms: number) => {
    const h = Math.floor(ms / 3600_000);
    return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
  };
  // Cuántos mensajes sin leer tiene cada chat (el número verde de WhatsApp; mientras llega, el puntito).
  const conteos = useConteoSinLeer(chats, uid);
  const etiquetaPorId = useMemo(() => new Map(prefs.etiquetas.map((e) => [e.id, e])), [prefs.etiquetas]);
  // Un filtro de una etiqueta que se borró vuelve a "Todos".
  const filtroOk: Filtro = filtro.startsWith("e:") && !etiquetaPorId.has(filtro.slice(2)) ? "todos" : filtro;
  const archivados = new Set(prefs.archivados);
  const pasa = (c: ChatT) =>
    filtroOk === "todos"
      ? true
      : filtroOk === "no-leidos"
        ? noLeido(c, uid)
        : filtroOk === "sin-responder"
          ? esperando(c) != null
        : filtroOk === "software"
          ? esDeSoftware(c)
        : filtroOk === "grupos"
          ? c.tipo !== "directo" && c.tipo !== "prodi"
          : (prefs.asignaciones[c.id] ?? []).includes(filtroOk.slice(2));

  const buscando = q.trim().length > 0;
  // Buscando, el encabezado no se pliega.
  const plegarHeader = plegado && !buscando;
  let lista: ChatT[];
  if (buscando) {
    // La búsqueda mira todos (también los archivados).
    lista = chats.filter((c) => titulo(c).toLowerCase().includes(q.trim().toLowerCase()));
  } else if (verArchivados) {
    lista = chats.filter((c) => archivados.has(c.id) && pasa(c));
  } else {
    const visibles = chats.filter((c) => !archivados.has(c.id) && pasa(c));
    const fijados = prefs.fijados.map((id) => visibles.find((c) => c.id === id)).filter(Boolean) as ChatT[];
    const resto = visibles.filter((c) => !prefs.fijados.includes(c.id));
    // Los que esperan respuesta van primero (el que más espera, arriba).
    const enEspera = resto.filter((c) => esperando(c) != null).sort((a, b) => (esperando(b) ?? 0) - (esperando(a) ?? 0));
    lista = [...fijados, ...enEspera, ...resto.filter((c) => esperando(c) == null)];
  }
  const enArchivo = chats.filter((c) => archivados.has(c.id));
  const archivoSinLeer = enArchivo.filter((c) => noLeido(c, uid)).length;

  const guardar = (p: Promise<unknown>, ok?: string) =>
    p.then(
      () => ok && toast.success(ok),
      (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar")
    );

  const sinLeer = chats.filter((c) => !archivados.has(c.id) && noLeido(c, uid)).length;
  const sinResponder = chats.filter((c) => !archivados.has(c.id) && esperando(c) != null).length;
  const chips: { id: Filtro; label: string; color?: string; n?: number; alerta?: boolean }[] = [
    { id: "todos", label: "Todos" },
    ...(sinResponder ? [{ id: "sin-responder" as Filtro, label: "Sin responder", n: sinResponder, alerta: true }] : []),
    { id: "no-leidos", label: "No leídos", n: sinLeer },
    { id: "grupos", label: "Grupos" },
    ...(chats.some(esDeSoftware) ? [{ id: "software" as Filtro, label: "Software" }] : []),
    ...prefs.etiquetas.map((e) => ({ id: `e:${e.id}` as Filtro, label: e.nombre, color: e.color })),
  ];

  const Titulo = compacto ? "h2" : "h1";
  const soloLectura = !!viewingAs;

  return (
    <>
      <div
        className={cn(
          "shrink-0 transition-[padding,box-shadow] duration-300",
          compacto ? "px-3" : "px-4",
          plegarHeader ? "border-b pb-2 pt-2 shadow-sm" : compacto ? "pb-2 pt-3" : "pb-3 pt-4"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          {verArchivados && !buscando ? (
            <button type="button" onClick={() => setVerArchivados(false)} className="-ml-1 flex items-center gap-2 rounded-full px-1 py-1 hover:bg-accent">
              <ArrowLeft className="h-5 w-5" />
              <Titulo id={tituloId} className={cn("font-bold tracking-tight transition-all duration-300", compacto || plegarHeader ? "text-lg" : "text-2xl")}>
                Archivados
              </Titulo>
            </button>
          ) : (
            <Titulo id={tituloId} className={cn("font-bold tracking-tight transition-all duration-300", compacto || plegarHeader ? "text-lg" : "text-2xl")}>
              Chats
            </Titulo>
          )}
          <div className="flex items-center gap-1">
            {plegarHeader && (
              <button
                type="button"
                onClick={abrirBuscador}
                className="flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted active:scale-95 animate-in fade-in zoom-in-75"
                aria-label="Buscar conversación"
                title="Buscar"
              >
                <Search className="h-5 w-5" />
              </button>
            )}
            {["admin", "productor", "editor", "pauta", "diseno", "administracion"].includes(role ?? "") && !soloLectura && <RachaChip />}
            <button
              type="button"
              onClick={() => setVerGuardados(true)}
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted active:scale-95"
              aria-label="Mensajes guardados"
              title="Mensajes guardados"
            >
              <Star className={cn("h-5 w-5", prefs.guardados.length > 0 && "fill-amber-400 text-amber-400")} />
            </button>
            <button
              type="button"
              onClick={onTareas}
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted active:scale-95"
              aria-label="Tareas"
              title="Tareas"
            >
              <ListTodo className="h-5 w-5" />
              {tareasPendientes > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-background">
                  {tareasPendientes}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setNuevo(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-transform hover:bg-primary/90 active:scale-95"
              aria-label="Nueva conversación"
              title="Nueva conversación"
            >
              <SquarePen className="h-[18px] w-[18px]" />
            </button>
            {acciones}
          </div>
        </div>
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
            plegarHeader ? "mt-0 grid-rows-[0fr] opacity-0" : "mt-3 grid-rows-[1fr] opacity-100"
          )}
          aria-hidden={plegarHeader}
        >
        <div className="min-h-0 space-y-3 overflow-hidden">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={refBuscar}
            tabIndex={plegarHeader ? -1 : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
            aria-label="Buscar conversación"
            className={cn(
              "rounded-full border-0 bg-muted/70 pl-10 pr-9 shadow-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0",
              compacto ? "h-9" : "h-10"
            )}
          />
          {buscando && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/20 text-muted-foreground hover:bg-muted-foreground/30"
              aria-label="Borrar búsqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {!buscando && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="tablist" aria-label="Filtrar conversaciones">
            {chips.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filtroOk === f.id}
                onClick={() => setFiltro(f.id)}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors active:scale-95",
                  f.alerta
                    ? filtroOk === f.id
                      ? "bg-red-500 text-white"
                      : "bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400"
                    : filtroOk === f.id
                      ? "bg-primary/15 text-primary"
                      : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {f.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: f.color }} />}
                {f.label}
                {!!f.n && (
                  <span
                    className={cn(
                      "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                      f.alerta ? (filtroOk === f.id ? "bg-white text-red-600" : "bg-red-500 text-white") : "bg-primary text-primary-foreground"
                    )}
                  >
                    {f.n}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        </div>
        </div>
      </div>
      <div onScroll={alScrollear} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-y-contain", compacto ? "safe-area-pb" : "pb-mobile-nav md:pb-0")}>
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
          const espera = esperando(c);
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
                  "relative flex w-full select-none items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors [-webkit-touch-callout:none] hover:bg-muted/50",
                  espera != null && "bg-red-500/[0.05] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-red-500",
                  activoId === c.id && "bg-accent"
                )}
              >
                <ChatIcon chat={c} profiles={profiles} uid={uid} color={clienteById(c.proyecto_id)?.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("flex min-w-0 items-center gap-1 truncate text-sm", unread ? "font-bold" : "font-medium")}>
                      <span className="truncate">{titulo(c)}</span>
                      {esDeSoftware(c) && (
                        <span className="shrink-0 rounded-md bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
                          Software
                        </span>
                      )}
                    </p>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground md:group-hover/fila:invisible">
                      {enVoz.some((v) => v.chat_id === c.id) && (
                        <Headphones className="h-3.5 w-3.5 animate-pulse text-primary" aria-label="Chat de voz en curso" />
                      )}
                      {fijado && <Pin className="h-3 w-3 rotate-45 text-primary" aria-label="Fijado" />}
                      {espera != null ? (
                        <span className="rounded-full bg-red-500 px-1.5 py-px text-[10px] font-semibold text-white" title={`El cliente escribió y nadie le contestó${aCargo(c) ? `. Le toca a ${aCargo(c)!.id === uid ? "vos" : aCargo(c)!.nombre} (lleva la cuenta)` : ""}`}>
                          Sin responder · {horasEspera(espera)}
                          {(() => {
                            const quien = aCargo(c);
                            return quien ? ` · ${quien.id === uid ? "te toca" : quien.nombre}` : "";
                          })()}
                        </span>
                      ) : (
                        c.ultimo && horaCorta(c.ultimo.at)
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {textoEscribiendo(escriben, c.id, c.tipo === "directo") ? (
                      <p className="min-w-0 truncate text-xs font-medium text-primary">{textoEscribiendo(escriben, c.id, c.tipo === "directo")}</p>
                    ) : (
                    <p className={cn("min-w-0 truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                      {c.ultimo
                        ? `${c.ultimo.by === uid ? "Vos: " : c.ultimo.by === PRODI_ID ? "Prodi: " : c.tipo !== "directo" ? `${(profiles.find((p) => p.id === c.ultimo!.by)?.nombre ?? c.nombres?.[c.ultimo.by] ?? "").split(" ")[0]}: ` : ""}${c.ultimo.texto}`
                        : c.tipo === "cliente"
                          ? "Grupo del cliente con el equipo"
                          : c.tipo === "grupo"
                            ? "Grupo"
                            : "Sin mensajes"}
                    </p>
                    )}
                    {unread &&
                      (conteos[c.id] ? (
                        <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-foreground" aria-label={`${conteos[c.id]} sin leer`}>
                          {conteos[c.id] > 99 ? "99+" : conteos[c.id]}
                        </span>
                      ) : (
                        <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Sin leer" />
                      ))}
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
      <Dialog open={verGuardados} onOpenChange={setVerGuardados}>
        <DialogContent className="max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-hidden rounded-2xl p-0">
          <DialogHeader className="border-b px-5 pb-3 pt-5 text-left">
            <DialogTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" /> Mensajes guardados
            </DialogTitle>
            <DialogDescription>Lo importante de todos tus chats, en un solo lugar.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[65dvh] space-y-2 overflow-y-auto p-4">
            {prefs.guardados.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Todavía no guardaste nada. En cualquier mensaje, abrí su menú (mantenelo apretado o tocá la hora) y tocá <b>Guardar</b>.
              </p>
            ) : (
              prefs.guardados.map((g) => {
                const chatG = chats.find((c) => c.id === g.chat_id);
                return (
                  <div key={`${g.chat_id}_${g.msg_id}`} className="group/g relative rounded-xl border bg-card transition-colors hover:border-primary/40">
                    <button
                      type="button"
                      onClick={() => {
                        setVerGuardados(false);
                        onAbrir(g.chat_id);
                      }}
                      className="block w-full p-3 pr-10 text-left"
                    >
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="truncate font-semibold text-foreground">{chatG ? titulo(chatG) : "Chat"}</span>
                        <span>·</span>
                        <span className="shrink-0">{g.by_nombre}</span>
                        <span>·</span>
                        <span className="shrink-0">{new Date(g.at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</span>
                      </p>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm">{g.texto}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        guardar(alternarGuardado(uid, { chat_id: g.chat_id, msg_id: g.msg_id, texto: g.texto, by_nombre: g.by_nombre, at: g.at }), "Sacado de guardados")
                      }
                      className="absolute right-2 top-2 rounded-full p-1.5 text-amber-400 transition-colors hover:bg-muted hover:text-muted-foreground"
                      aria-label="Sacar de guardados"
                      title="Sacar de guardados"
                    >
                      <Star className="h-4 w-4 fill-current" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
