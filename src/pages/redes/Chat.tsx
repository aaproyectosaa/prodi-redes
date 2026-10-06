import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, limit, onSnapshot, orderBy, query } from "@/lib/db";
import {
  ArrowLeft,
  FileText,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Send,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { abrirDirecto, enviarAudio, enviarMensaje, marcarLeido, noLeido, tituloChat } from "@/lib/redes/chat";
import { AudioMensaje, BarraGrabando, BotonMic, useGrabadorVoz } from "@/components/redes/chat/Voz";
import { crearReunion } from "@/lib/redes/reuniones";
import { getRoleInfo } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { fechaAR, formatearFecha, hoyAR, sumarDias } from "@/lib/fecha";
import type { Chat as ChatT, Mensaje } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";

function horaCorta(iso: string) {
  if (fechaAR(iso) === hoyAR()) return formatearFecha(iso, { hour: "2-digit", minute: "2-digit" });
  return formatearFecha(iso, { day: "numeric", month: "short" });
}

function diaLabel(iso: string) {
  const dia = fechaAR(iso);
  const hoy = hoyAR();
  if (dia === hoy) return "Hoy";
  if (dia === sumarDias(hoy, -1)) return "Ayer";
  return formatearFecha(iso, { weekday: "long", day: "numeric", month: "long" });
}

function ChatIcon({ chat, profiles, uid, color }: { chat: ChatT; profiles: Profile[]; uid?: string; color?: string }) {
  if (chat.tipo === "directo") {
    const otro = profiles.find((p) => p.id === chat.miembros.find((m) => m !== uid));
    return otro ? <UserAvatar profile={otro} size="md" /> : <div className="h-10 w-10 rounded-full bg-muted" />;
  }
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
      style={{ backgroundColor: chat.tipo === "equipo" ? "#6F40FC" : color || "#6F40FC" }}
    >
      {chat.tipo === "equipo" ? <Users className="h-5 w-5" /> : (chat.nombre ?? "?").slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function Chat() {
  const { chats, clienteById, clientes, settings } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile } = useUserProfileContext();
  const uid = user?.uid;
  const [params, setParams] = useSearchParams();
  const activoId = params.get("c");
  const activo = chats.find((c) => c.id === activoId) ?? null;
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);

  const abrir = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("c", id);
    else next.delete("c");
    setParams(next, { replace: !!activoId });
  };

  // En escritorio, abrir la primera conversación si no hay ninguna elegida.
  useEffect(() => {
    if (!activoId && chats.length && window.matchMedia("(min-width: 768px)").matches) abrir(chats[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats.length, activoId]);

  const lista = chats.filter((c) =>
    !q ? true : tituloChat(c, uid, profiles, role).toLowerCase().includes(q.toLowerCase())
  );

  // Con quién puede iniciar una conversación privada.
  const contactos = useMemo(() => {
    if (role === "cliente") {
      const ids = new Set(
        clientes.flatMap((c) => [...(c.team_roles?.productor ?? []), ...(c.team_roles?.pauta ?? []), ...(c.team_roles?.editor ?? [])])
      );
      profiles.filter((p) => p.role === "admin").forEach((p) => ids.add(p.id));
      return profiles.filter((p) => ids.has(p.id) && p.id !== uid);
    }
    return profiles.filter((p) => p.id !== uid && p.role && p.role !== "pending" && !["cm", "pm", "disenador"].includes(p.role));
  }, [role, clientes, profiles, uid]);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Lista */}
      <aside
        className={cn(
          "flex min-h-0 w-full flex-col border-r md:w-80 md:shrink-0",
          activo && "hidden md:flex"
        )}
      >
        <div className="space-y-3 border-b p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Chat</h1>
            <Button size="sm" variant="outline" onClick={() => setNuevo(true)}>
              <Plus className="mr-1 h-4 w-4" /> Nuevo
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversación" className="pl-9" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-mobile-nav md:pb-0">
          {lista.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Todavía no hay conversaciones. Los grupos de cada cliente se crean solos cuando el admin asigna el equipo.
            </p>
          )}
          {lista.map((c) => {
            const unread = noLeido(c, uid);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => abrir(c.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  activoId === c.id && "bg-accent"
                )}
              >
                <ChatIcon chat={c} profiles={profiles} uid={uid} color={clienteById(c.proyecto_id)?.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("truncate text-sm", unread ? "font-bold" : "font-medium")}>
                      {tituloChat(c, uid, profiles, role)}
                    </p>
                    {c.ultimo && <span className="shrink-0 text-[11px] text-muted-foreground">{horaCorta(c.ultimo.at)}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                      {c.ultimo
                        ? `${c.ultimo.by === uid ? "Vos: " : c.tipo !== "directo" ? `${(profiles.find((p) => p.id === c.ultimo!.by)?.nombre ?? c.nombres?.[c.ultimo.by] ?? "").split(" ")[0]}: ` : ""}${c.ultimo.texto}`
                        : c.tipo === "cliente"
                          ? "Grupo del cliente con el equipo"
                          : "Sin mensajes"}
                    </p>
                    {unread && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Conversación */}
      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !activo && "hidden md:flex")}>
        {activo && uid ? (
          <Conversacion
            key={activo.id}
            chat={activo}
            uid={uid}
            nombre={profile?.nombre ?? ""}
            profiles={profiles}
            role={role}
            onBack={() => abrir(null)}
            jitsiBase={settings.jitsi_base}
            color={clienteById(activo.proyecto_id)?.color}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageCircle className="h-10 w-10 opacity-40" />
            <p className="text-sm">Elegí una conversación</p>
          </div>
        )}
      </section>

      <CommandDialog open={nuevo} onOpenChange={setNuevo}>
        <CommandInput placeholder="¿Con quién querés hablar?" />
        <CommandList>
          <CommandEmpty>No hay nadie con ese nombre.</CommandEmpty>
          <CommandGroup heading="Mensaje privado">
            {contactos.map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.nombre} ${p.email}`}
                className="gap-3"
                onSelect={async () => {
                  setNuevo(false);
                  if (!uid) return;
                  try {
                    abrir(await abrirDirecto(uid, p.id, { [uid]: profile?.nombre ?? "", [p.id]: p.nombre ?? "" }));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "No se pudo abrir");
                  }
                }}
              >
                <UserAvatar profile={p} size="sm" />
                <span className="flex-1 truncate">{p.nombre}</span>
                <span className="text-xs text-muted-foreground">{getRoleInfo(p.role).label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}

function Conversacion({
  chat,
  uid,
  nombre,
  profiles,
  role,
  onBack,
  jitsiBase,
  color,
}: {
  chat: ChatT;
  uid: string;
  nombre: string;
  profiles: Profile[];
  role?: string;
  onBack: () => void;
  jitsiBase?: string;
  color?: string;
}) {
  const { clienteById } = useRedes();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [llamando, setLlamando] = useState(false);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCargando(true);
    return onSnapshot(
      query(collection(db, "chats", chat.id, "mensajes"), orderBy("at", "desc"), limit(200)),
      (snap) => {
        setMensajes(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Mensaje)
            .sort((a, b) => a.at.localeCompare(b.at))
        );
        setCargando(false);
      },
      (err) => {
        console.error("[chat]", err);
        setCargando(false);
      }
    );
  }, [chat.id]);

  useEffect(() => {
    fin.current?.scrollIntoView({ block: "end" });
    void marcarLeido(chat, uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensajes.length, chat.id]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t) return;
    setEnviando(true);
    try {
      await enviarMensaje(chat, uid, t, { remitente: nombre });
      setTexto("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar");
    } finally {
      setEnviando(false);
    }
  };

  const voz = useGrabadorVoz();
  const enviarVoz = async () => {
    const r = await voz.detener();
    if (!r) return;
    setEnviando(true);
    try {
      await enviarAudio(chat, uid, r.blob, r.duracion, nombre);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el audio");
    } finally {
      setEnviando(false);
    }
  };

  const videollamada = async () => {
    setLlamando(true);
    try {
      const { link } = await crearReunion(
        {
          titulo: chat.tipo === "directo" ? `Llamada con ${tituloChat(chat, uid, profiles)}` : `Llamada ${chat.nombre ?? "equipo"}`,
          proyecto: chat.proyecto_id ? clienteById(chat.proyecto_id) ?? null : null,
          fecha: new Date().toISOString(),
          participantes: chat.miembros,
          chat,
          jitsiBase,
        },
        uid,
        nombre
      );
      window.open(link, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar la llamada");
    } finally {
      setLlamando(false);
    }
  };

  // Los clientes no leen los perfiles del equipo: se usan los nombres guardados en el chat.
  const perfilDe = (id: string): Profile | undefined =>
    profiles.find((p) => p.id === id) ?? (chat.nombres?.[id] ? ({ id, nombre: chat.nombres[id], email: "" } as Profile) : undefined);
  const nombreDe = (id: string, fallback?: string) => perfilDe(id)?.nombre || fallback || "Usuario";
  const miembros = chat.miembros.map(perfilDe).filter(Boolean) as Profile[];

  let ultimoDia = "";

  return (
    <>
      <header className="flex items-center gap-3 border-b px-3 py-2.5 md:px-5">
        <button type="button" onClick={onBack} className="rounded-full p-1.5 hover:bg-muted md:hidden" aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <ChatIcon chat={chat} profiles={profiles} uid={uid} color={color} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{tituloChat(chat, uid, profiles, role)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {chat.tipo === "directo"
              ? getRoleInfo(perfilDe(chat.miembros.find((m) => m !== uid) ?? "")?.role).label
              : miembros.map((m) => m.nombre?.split(" ")[0]).join(", ")}
          </p>
        </div>
        {(role !== "cliente" || chat.proyecto_id) && (
        <Button size="sm" onClick={videollamada} disabled={llamando} className="shrink-0">
          {llamando ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" /> : <Video className="h-4 w-4 sm:mr-1.5" />}
          <span className="hidden sm:inline">Videollamada</span>
        </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
        {cargando ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mensajes.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Escribí el primer mensaje.</p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {mensajes.map((m, i) => {
              const mio = m.by === uid;
              const dia = diaLabel(m.at);
              const mostrarDia = dia !== ultimoDia;
              ultimoDia = dia;
              const prev = mensajes[i - 1];
              const agrupado = prev && prev.by === m.by && !mostrarDia && new Date(m.at).getTime() - new Date(prev.at).getTime() < 5 * 60_000;
              return (
                <div key={m.id}>
                  {mostrarDia && (
                    <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{dia}</p>
                  )}
                  <div className={cn("flex items-end gap-2", mio ? "justify-end" : "justify-start", !agrupado && "mt-2")}>
                    {!mio && chat.tipo !== "directo" && (
                      <div className="w-7 shrink-0">
                        {!agrupado && (perfilDe(m.by) || m.by_nombre) && (
                          <UserAvatar profile={perfilDe(m.by) ?? ({ id: m.by, nombre: m.by_nombre, email: "" } as Profile)} size="sm" />
                        )}
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%]",
                        mio ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card border"
                      )}
                    >
                      {!mio && !agrupado && chat.tipo !== "directo" && (
                        <p className="mb-0.5 text-[11px] font-semibold text-primary">{nombreDe(m.by, m.by_nombre)}</p>
                      )}
                      {m.tipo === "llamada" ? (
                        <div className="space-y-2">
                          <p className="flex items-center gap-1.5 font-medium">
                            <Video className="h-4 w-4" /> {m.texto}
                          </p>
                          {m.link && (
                            <a
                              href={m.link}
                              target="_blank"
                              rel="noreferrer"
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                                mio ? "bg-white text-primary" : "bg-primary text-primary-foreground"
                              )}
                            >
                              Unirme a la llamada
                            </a>
                          )}
                        </div>
                      ) : m.tipo === "minuta" ? (
                        <div className="space-y-1">
                          <p className="flex items-center gap-1.5 text-xs font-semibold opacity-80">
                            <FileText className="h-3.5 w-3.5" /> Minuta de reunión
                          </p>
                          <p className="whitespace-pre-wrap">{m.texto}</p>
                        </div>
                      ) : m.tipo === "audio" && m.audio ? (
                        <AudioMensaje chatId={chat.id} audio={m.audio} mio={mio} />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                      )}
                      <p className={cn("mt-0.5 text-right text-[10px]", mio ? "text-primary-foreground/70" : "text-muted-foreground")}>
                        {formatearFecha(m.at, { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={fin} />
          </div>
        )}
      </div>

      <footer className="border-t bg-background p-3 pb-mobile-nav md:pb-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          {voz.grabando ? (
            <BarraGrabando
              seg={voz.seg}
              niveles={voz.niveles}
              enviando={enviando}
              onCancelar={() => void voz.detener(true)}
              onEnviar={() => void enviarVoz()}
            />
          ) : (
          <>
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={1}
            placeholder="Escribí un mensaje"
            className="max-h-40 min-h-[44px] resize-none rounded-2xl"
          />
          {/* Sin texto escrito: micrófono para mandar un audio (como en WhatsApp). */}
          {texto.trim() ? (
            <Button size="icon" className="h-11 w-11 shrink-0 rounded-full" onClick={enviar} disabled={enviando} aria-label="Enviar">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          ) : (
            <BotonMic onClick={() => void voz.empezar()} disabled={enviando} />
          )}
          </>
          )}
        </div>
      </footer>
    </>
  );
}
