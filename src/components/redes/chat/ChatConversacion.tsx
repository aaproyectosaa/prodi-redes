import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { collection, limit, onSnapshot, orderBy, query } from "@/lib/db";
import { ArrowLeft, Camera, Check, CheckCheck, FileText, Loader2, Paperclip, Send, Sparkles, Upload, Video } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import {
  enviarAudio,
  enviarMensaje,
  lecturasDe,
  marcarLeido,
  mencionaProdi,
  pedirAProdi,
  PRODI_ID,
  tituloChat,
} from "@/lib/redes/chat";
import { limpiarSubidasListas, subirArchivosChat, useSubidasChat, CHAT_MAX_MB } from "@/lib/redes/chatArchivos";
import { AudioMensaje, BarraGrabando, BotonMic, useGrabadorVoz } from "@/components/redes/chat/Voz";
import { ArchivoMensaje, SubidaBurbuja } from "@/components/redes/chat/Archivo";
import { ChatIcon } from "@/components/redes/chat/ChatIcon";
import { InfoChat } from "@/components/redes/chat/Grupos";
import { CamaraDialog, camaraDelSistema } from "@/components/redes/chat/Camara";
import { comprimirFoto } from "@/lib/imagen";
import { crearReunion } from "@/lib/redes/reuniones";
import { getRoleInfo } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { chatEnPantalla } from "@/lib/redes/chatDock";
import { fechaAR, formatearFecha, hoyAR, sumarDias } from "@/lib/fecha";
import type { Chat as ChatT, Mensaje } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";

function diaLabel(iso: string) {
  const dia = fechaAR(iso);
  const hoy = hoyAR();
  if (dia === hoy) return "Hoy";
  if (dia === sumarDias(hoy, -1)) return "Ayer";
  return formatearFecha(iso, { weekday: "long", day: "numeric", month: "long" });
}

/** Avatar de Prodi, el asistente (distinto de las personas). */
function AvatarProdi() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white shadow-sm">
      <Sparkles className="h-3.5 w-3.5" />
    </div>
  );
}

/** Lo que se está escribiendo justo antes del cursor termina en "@pr…": se sugiere @prodi. */
function mencionEnCurso(texto: string, cursor: number): { desde: number } | null {
  const m = /(^|\s)@([a-záéíóú]*)$/i.exec(texto.slice(0, cursor));
  if (!m || !"prodi".startsWith(m[2].toLowerCase())) return null;
  return { desde: cursor - m[2].length - 1 };
}

/** Texto de ayuda de la caja de escribir, del más completo al más corto: se usa el primero que entra en una línea. */
const AYUDAS_CAJA = ["Escribí un mensaje · @prodi para pedirle algo", "Mensaje · @prodi", "Mensaje"];
let medidor: CanvasRenderingContext2D | null = null;
function ayudaQueEntra(el: HTMLTextAreaElement): string {
  const s = getComputedStyle(el);
  const libre = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 4;
  medidor ??= document.createElement("canvas").getContext("2d");
  if (!medidor || libre <= 0) return AYUDAS_CAJA[AYUDAS_CAJA.length - 1];
  medidor.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  return AYUDAS_CAJA.find((t) => medidor!.measureText(t).width <= libre) ?? AYUDAS_CAJA[AYUDAS_CAJA.length - 1];
}

const hora = (iso: string) => formatearFecha(iso, { hour: "2-digit", minute: "2-digit" });
const cuando = (iso: string) =>
  fechaAR(iso) === hoyAR() ? hora(iso) : formatearFecha(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Quiénes vieron el mensaje y el texto corto ("Visto 14:32", "Visto por 3 de 5"). */
function estadoVisto(chat: ChatT, m: Mensaje, uid: string) {
  const lecturas = lecturasDe(chat, m.at, uid);
  const vieron = lecturas.filter((l) => l.at);
  const todos = lecturas.length > 0 && vieron.length === lecturas.length;
  const ultimaVista = vieron.map((l) => l.at!).sort()[0];
  const resumen =
    chat.tipo === "directo"
      ? todos
        ? `Visto ${cuando(ultimaVista)}`
        : "Enviado"
      : todos
        ? "Visto por todos"
        : vieron.length
          ? `Visto por ${vieron.length} de ${lecturas.length}`
          : "Enviado";
  return { lecturas, vieron, todos, resumen };
}

/**
 * Estado de un mensaje propio (como WhatsApp): ✓ enviado, ✓✓ lo vio alguien, ✓✓ remarcado: lo vieron todos.
 * Sale de la última lectura de cada miembro (chat.leido): no se escribe nada por mensaje.
 * Tocándolo se ve quién lo vio y cuándo.
 */
function Visto({ chat, m, uid, nombreDe }: { chat: ChatT; m: Mensaje; uid: string; nombreDe: (id: string) => string }) {
  const { lecturas, vieron, todos, resumen } = estadoVisto(chat, m, uid);
  if (!lecturas.length) return null;
  const Icono = vieron.length ? CheckCheck : Check;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex items-center rounded-sm", todos ? "text-primary-foreground" : "text-primary-foreground/60")}
          aria-label={resumen}
          title={resumen}
        >
          <Icono className="h-3.5 w-3.5" strokeWidth={todos ? 3 : 2} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <p className="border-b px-3 py-2 text-xs font-semibold">{resumen}</p>
        <ul className="max-h-60 overflow-y-auto py-1 text-sm">
          {[...lecturas]
            .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
            .map((l) => (
              <li key={l.uid} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="truncate">{nombreDe(l.uid)}</span>
                {l.at ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-primary">
                    <CheckCheck className="h-3.5 w-3.5" /> {cuando(l.at)}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">Sin ver</span>
                )}
              </li>
            ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Debajo del último mensaje propio: "✓✓ Visto 14:32" / "Visto por 3 de 5", en violeta Prodi. */
function VistoLinea({ chat, m, uid }: { chat: ChatT; m: Mensaje; uid: string }) {
  const { vieron, resumen } = estadoVisto(chat, m, uid);
  if (!vieron.length) return null;
  return (
    <p className="mt-0.5 flex items-center justify-end gap-1 pr-1 text-[11px] font-medium text-primary">
      <CheckCheck className="h-3.5 w-3.5" /> {resumen}
    </p>
  );
}

export function ChatConversacion({
  chat,
  uid,
  nombre,
  profiles,
  role,
  onBack,
  onTareas,
  jitsiBase,
  color,
  activa = true,
  compacto,
  acciones,
}: {
  chat: ChatT;
  uid: string;
  nombre: string;
  profiles: Profile[];
  role?: string;
  onBack: () => void;
  onTareas: () => void;
  jitsiBase?: string;
  color?: string;
  /** Se está viendo (en el chat flotante minimizado no se marca como leído). */
  activa?: boolean;
  /** En el chat flotante: panel angosto, "volver" siempre visible. */
  compacto?: boolean;
  /** Botones extra en el encabezado (minimizar, pantalla completa, cerrar). */
  acciones?: ReactNode;
}) {
  const { clienteById } = useRedes();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [llamando, setLlamando] = useState(false);
  const [pensando, setPensando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [sugerir, setSugerir] = useState<{ desde: number } | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  const elegirArchivo = useRef<HTMLInputElement>(null);
  const capturaFoto = useRef<HTMLInputElement>(null);
  const capturaSelfie = useRef<HTMLInputElement>(null);
  const capturaVideo = useRef<HTMLInputElement>(null);
  const [camara, setCamara] = useState(false);
  const [info, setInfo] = useState(false);
  const enCelular = camaraDelSistema();
  const subidas = useSubidasChat(chat.id);
  // El texto de ayuda de la caja se acorta si no entra en una línea (celulares angostos, chat flotante).
  const [ayudaCaja, setAyudaCaja] = useState(AYUDAS_CAJA[0]);

  // Cuando aparece el mensaje que escribió el servidor, se saca la burbuja de "subiendo".
  useEffect(() => {
    if (subidas.some((s) => s.estado === "listo")) limpiarSubidasListas(new Set(mensajes.map((m) => m.id)));
  }, [mensajes, subidas]);

  const mandarArchivos = (files: File[]) => {
    if (!files.length) return;
    try {
      subirArchivosChat(chat.id, files);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar");
    }
  };

  // Fotos sacadas con la cámara: se achican (máx. 2560 px, JPEG) para que suban rápido.
  const mandarCaptura = async (files: File[]) => {
    if (!files.length) return;
    const listos = await Promise.all(files.map((f) => (f.type.startsWith("image/") ? comprimirFoto(f) : Promise.resolve(f))));
    mandarArchivos(listos);
  };

  const usarMencion = () => {
    if (!sugerir) return;
    const cursor = caja.current?.selectionStart ?? texto.length;
    const nuevo = `${texto.slice(0, sugerir.desde)}@prodi ${texto.slice(cursor)}`;
    setTexto(nuevo);
    setSugerir(null);
    requestAnimationFrame(() => {
      const pos = sugerir.desde + 7;
      caja.current?.focus();
      caja.current?.setSelectionRange(pos, pos);
    });
  };

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

  // Mientras se ve, sus avisos no muestran cartel ni suenan (ya estás leyendo).
  useEffect(() => {
    if (!activa) return;
    chatEnPantalla.entrar(chat.id);
    return () => chatEnPantalla.salir(chat.id);
  }, [activa, chat.id]);

  useEffect(() => {
    if (!activa) return;
    fin.current?.scrollIntoView({ block: "end" });
    void marcarLeido(chat, uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensajes.length, chat.id, subidas.length, pensando, activa]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t) return;
    setEnviando(true);
    setSugerir(null);
    try {
      const id = await enviarMensaje(chat, uid, t, { remitente: nombre });
      setTexto("");
      // @prodi: el servidor lo procesa y contesta en el chat.
      if (mencionaProdi(t)) {
        setPensando(true);
        pedirAProdi(chat.id, id)
          .catch((err) => toast.error(err instanceof Error ? err.message : "Prodi no pudo responder"))
          .finally(() => setTimeout(() => setPensando(false), 1500));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar");
    } finally {
      setEnviando(false);
    }
  };

  const voz = useGrabadorVoz();
  // La caja se vuelve a montar al terminar de grabar un audio: ahí se vuelve a medir.
  useEffect(() => {
    const el = caja.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAyudaCaja(ayudaQueEntra(el)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [voz.grabando]);
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
  const ultimoMio = [...mensajes].reverse().find((m) => m.by === uid && m.tipo !== "sistema")?.id;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setArrastrando(false);
        mandarArchivos(Array.from(e.dataTransfer.files));
      }}
    >
      {arrastrando && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background/90 text-primary">
          <Upload className="h-8 w-8" />
          <p className="text-sm font-semibold">Soltá para mandar al chat</p>
          <p className="text-xs text-muted-foreground">Fotos, videos, PDF o documentos · hasta {CHAT_MAX_MB} MB</p>
        </div>
      )}
      <header className={cn("flex items-center border-b", compacto ? "gap-2 px-2 py-2" : "gap-3 px-3 py-2.5 md:px-5")}>
        <button
          type="button"
          onClick={onBack}
          className={cn("-m-1 shrink-0 rounded-full p-2.5 hover:bg-muted md:m-0 md:p-1.5", !compacto && "md:hidden")}
          aria-label={compacto ? "Volver a la lista de chats" : "Volver"}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => chat.tipo !== "directo" && setInfo(true)}
          className={cn(
            "flex min-w-0 flex-1 items-center rounded-lg text-left",
            compacto ? "gap-2" : "gap-3",
            chat.tipo !== "directo" && "hover:bg-muted/50"
          )}
          title={chat.tipo !== "directo" ? "Ver miembros y datos del grupo" : undefined}
          disabled={chat.tipo === "directo"}
        >
          <ChatIcon chat={chat} profiles={profiles} uid={uid} color={color} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{tituloChat(chat, uid, profiles, role)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {chat.tipo === "directo"
                ? getRoleInfo(perfilDe(chat.miembros.find((m) => m !== uid) ?? "")?.role).label
                : miembros.map((m) => m.nombre?.split(" ")[0]).join(", ")}
            </span>
          </span>
        </button>
        {(role !== "cliente" || chat.proyecto_id) &&
          (compacto ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={videollamada}
              disabled={llamando}
              className="h-10 w-10 shrink-0 text-primary md:h-8 md:w-8"
              aria-label="Videollamada"
              title="Videollamada"
            >
              {llamando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            </Button>
          ) : (
            <Button size="sm" onClick={videollamada} disabled={llamando} className="shrink-0">
              {llamando ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1.5" /> : <Video className="h-4 w-4 sm:mr-1.5" />}
              <span className="hidden sm:inline">Videollamada</span>
            </Button>
          ))}
        {acciones}
      </header>

      <div className={cn("min-h-0 flex-1 overflow-y-auto px-3", compacto ? "py-3" : "py-4 md:px-6")}>
        {cargando ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mensajes.length === 0 && !subidas.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Escribí el primer mensaje.</p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {mensajes.map((m, i) => {
              const mio = m.by === uid;
              const bot = m.by === PRODI_ID;
              const dia = diaLabel(m.at);
              const mostrarDia = dia !== ultimoDia;
              ultimoDia = dia;
              const prev = mensajes[i - 1];
              const agrupado =
                prev && prev.tipo !== "sistema" && prev.by === m.by && !mostrarDia && new Date(m.at).getTime() - new Date(prev.at).getTime() < 5 * 60_000;
              // Avisos del grupo ("Lucas sumó a Ana"): al medio, sin burbuja.
              if (m.tipo === "sistema")
                return (
                  <div key={m.id}>
                    {mostrarDia && (
                      <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{dia}</p>
                    )}
                    <p className="mx-auto my-2 w-fit max-w-[90%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
                      {mio ? "Vos" : nombreDe(m.by, m.by_nombre).split(" ")[0]} {m.texto}
                    </p>
                  </div>
                );
              return (
                <div key={m.id}>
                  {mostrarDia && (
                    <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{dia}</p>
                  )}
                  <div className={cn("flex items-end gap-2", mio ? "justify-end" : "justify-start", !agrupado && "mt-2")}>
                    {!mio && (chat.tipo !== "directo" || bot) && (
                      <div className="w-7 shrink-0">
                        {!agrupado &&
                          (bot ? (
                            <AvatarProdi />
                          ) : (
                            (perfilDe(m.by) || m.by_nombre) && (
                              <UserAvatar profile={perfilDe(m.by) ?? ({ id: m.by, nombre: m.by_nombre, email: "" } as Profile)} size="sm" />
                            )
                          ))}
                      </div>
                    )}
                    <div
                      className={cn(
                        "min-w-0 rounded-2xl px-3.5 py-2 text-sm shadow-sm", compacto ? "max-w-[85%]" : "max-w-[82%] sm:max-w-[70%]",
                        mio
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : bot
                            ? "rounded-bl-md border border-[#6F40FC]/30 bg-gradient-to-br from-[#6F40FC]/[0.07] to-[#E040A0]/[0.07]"
                            : "rounded-bl-md bg-card border"
                      )}
                    >
                      {bot && !agrupado ? (
                        <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#6F40FC]">
                          Prodi <span className="rounded bg-[#6F40FC]/10 px-1 text-[9px] uppercase tracking-wider">asistente</span>
                        </p>
                      ) : (
                        !mio && !agrupado && chat.tipo !== "directo" && (
                          <p className="mb-0.5 text-[11px] font-semibold text-primary">{nombreDe(m.by, m.by_nombre)}</p>
                        )
                      )}
                      {m.tipo === "archivo" && m.archivo ? (
                        <div className="space-y-1">
                          <ArchivoMensaje archivo={m.archivo} mio={mio} />
                          {m.leyenda && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] pt-0.5">{m.leyenda}</p>}
                        </div>
                      ) : bot ? (
                        <div className="space-y-2">
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.texto}</p>
                          {m.link &&
                            (m.link.startsWith("/chat?tareas") ? (
                              <button
                                type="button"
                                onClick={onTareas}
                                className="inline-flex items-center gap-1.5 rounded-full bg-[#6F40FC] px-3 py-1 text-xs font-semibold text-white"
                              >
                                {m.link_texto || "Ver"}
                              </button>
                            ) : (
                              <Link
                                to={m.link}
                                className="inline-flex items-center gap-1.5 rounded-full bg-[#6F40FC] px-3 py-1 text-xs font-semibold text-white"
                              >
                                {m.link_texto || "Ver"}
                              </Link>
                            ))}
                        </div>
                      ) : m.tipo === "llamada" ? (
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
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.texto}</p>
                        </div>
                      ) : m.tipo === "audio" && m.audio ? (
                        <AudioMensaje chatId={chat.id} audio={m.audio} mio={mio} />
                      ) : (
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {mencionaProdi(m.texto)
                            ? m.texto.split(/(@prodi\b)/i).map((p, j) =>
                                /^@prodi$/i.test(p) ? (
                                  <span key={j} className={cn("rounded px-0.5 font-semibold", mio ? "bg-white/20" : "bg-[#6F40FC]/10 text-[#6F40FC]")}>
                                    {p}
                                  </span>
                                ) : (
                                  p
                                )
                              )
                            : m.texto}
                        </p>
                      )}
                      <p
                        className={cn(
                          "mt-0.5 flex items-center justify-end gap-1 text-[10px]",
                          mio ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}
                      >
                        {hora(m.at)}
                        {mio && <Visto chat={chat} m={m} uid={uid} nombreDe={(id) => nombreDe(id)} />}
                      </p>
                    </div>
                  </div>
                  {mio && m.id === ultimoMio && <VistoLinea chat={chat} m={m} uid={uid} />}
                </div>
              );
            })}
            {subidas.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {subidas.map((s) => (
                  <SubidaBurbuja key={s.id} s={s} />
                ))}
              </div>
            )}
            {pensando && (
              <div className="mt-2 flex items-end gap-2">
                <AvatarProdi />
                <div className="rounded-2xl rounded-bl-md border border-[#6F40FC]/30 bg-[#6F40FC]/[0.06] px-3.5 py-2 text-sm text-[#6F40FC]">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Prodi está pensando…
                  </span>
                </div>
              </div>
            )}
            <div ref={fin} />
          </div>
        )}
      </div>

      <footer
        // Abajo: aire + la barra del celular (o la barra de inicio del iPhone si la barra está escondida).
        className={cn(
          "border-t bg-background p-2 min-[380px]:p-3",
          !compacto && "pb-[calc(var(--alto-barra)+0.5rem)] min-[380px]:pb-[calc(var(--alto-barra)+0.75rem)] md:pb-3"
        )}
        style={compacto ? { paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" } : undefined}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-1 min-[380px]:gap-2">
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
          <input
            ref={elegirArchivo}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              mandarArchivos(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-11 w-11 shrink-0 rounded-full text-muted-foreground"
            onClick={() => elegirArchivo.current?.click()}
            aria-label="Adjuntar archivo"
            title={`Adjuntar foto, video o documento (hasta ${CHAT_MAX_MB} MB)`}
          >
            <Paperclip className="h-5 w-5" />
          </Button>
          {/* Cámara: en el celular, la del sistema (foto, selfie o video); en la compu, un diálogo con vista previa. */}
          <input
            ref={capturaFoto}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void mandarCaptura(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <input
            ref={capturaSelfie}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={(e) => {
              void mandarCaptura(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <input
            ref={capturaVideo}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              mandarArchivos(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          {enCelular ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="-ml-1 h-11 w-11 shrink-0 rounded-full text-muted-foreground min-[380px]:-ml-2"
                  aria-label="Cámara"
                  title="Sacar foto o grabar video"
                >
                  <Camera className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuItem onSelect={() => capturaFoto.current?.click()}>Sacar foto</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => capturaSelfie.current?.click()}>Selfie</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => capturaVideo.current?.click()}>Grabar video</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="-ml-1 h-11 w-11 shrink-0 rounded-full text-muted-foreground min-[380px]:-ml-2"
              onClick={() => setCamara(true)}
              aria-label="Sacar foto"
              title="Sacar foto con la cámara"
            >
              <Camera className="h-5 w-5" />
            </Button>
          )}
          <div className="relative min-w-0 flex-1">
            {sugerir && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  usarMencion();
                }}
                className="absolute bottom-full left-0 z-10 mb-2 flex w-full max-w-sm items-center gap-2.5 rounded-xl border bg-popover p-2 text-left shadow-lg"
              >
                <AvatarProdi />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">@prodi</span>
                  <span className="block truncate text-xs text-muted-foreground">Asistente: agenda reuniones, deja tareas, recuerda cosas del cliente</span>
                </span>
              </button>
            )}
            <Textarea
              ref={caja}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setSugerir(mencionEnCurso(e.target.value, e.target.selectionStart ?? e.target.value.length));
              }}
              onKeyDown={(e) => {
                if (sugerir && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
                  e.preventDefault();
                  usarMencion();
                  return;
                }
                if (sugerir && e.key === "Escape") {
                  e.preventDefault();
                  setSugerir(null);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              onBlur={() => setSugerir(null)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files ?? []);
                if (!files.length) return;
                e.preventDefault();
                mandarArchivos(files);
              }}
              rows={1}
              placeholder={ayudaCaja}
              className="max-h-36 min-h-[44px] resize-none rounded-2xl"
            />
          </div>
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
      {!enCelular && <CamaraDialog open={camara} onOpenChange={setCamara} onFoto={(f) => mandarArchivos([f])} />}
      {chat.tipo !== "directo" && <InfoChat chat={chat} open={info} onOpenChange={setInfo} onSalio={onBack} />}
    </div>
  );
}
