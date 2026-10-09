import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { collection, limit, onSnapshot, orderBy, query } from "@/lib/db";
import { ArrowLeft, Camera, Check, CheckCheck, FileText, Image as ImageIcon, Info, Loader2, Paperclip, Reply, Send, Sparkles, Upload, Video, X } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import {
  contactosDe,
  enviarAudio,
  enviarMensaje,
  lecturasDe,
  marcarLeido,
  mencionaProdi,
  noLeido,
  pedirAProdi,
  guardarLinks,
  tieneLink,
  reaccionar,
  puedeEditarMensaje,
  PRODI_ID,
  tituloChat,
} from "@/lib/redes/chat";
import { limpiarSubidasListas, subirArchivosChat, useSubidasChat, CHAT_MAX_MB } from "@/lib/redes/chatArchivos";
import { TextoIA } from "@/components/redes/TextoIA";
import { TarjetaReferencia } from "./TarjetaReferencia";
import { AudioMensaje, BarraGrabando, BotonMic, useGrabadorVoz } from "@/components/redes/chat/Voz";
import { ArchivoMensaje, SubidaBurbuja } from "@/components/redes/chat/Archivo";
import { ChatIcon } from "@/components/redes/chat/ChatIcon";
import { EtiquetaContacto, InfoChat } from "@/components/redes/chat/Grupos";
import { Cabecitas, EditarMensajeDialog, InfoMensaje, vistosHasta } from "@/components/redes/chat/InfoMensaje";
import { TareaMensajeDialog } from "@/components/redes/chat/TareaMensaje";
import { CamaraDialog, camaraDelSistema } from "@/components/redes/chat/Camara";
import { comprimirFoto } from "@/lib/imagen";
import { crearReunion } from "@/lib/redes/reuniones";
import { getRoleInfo } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { chatEnPantalla, EVENTO_BORRADOR, tomarBorrador } from "@/lib/redes/chatDock";
import { fechaAR, formatearFecha, hoyAR, sumarDias } from "@/lib/fecha";
import type { Chat as ChatT, Mensaje, ReferenciaChat } from "@/lib/redes/types";
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

/** Lo que se está escribiendo justo antes del cursor termina en "@algo": se sugieren @prodi y la gente del chat. */
function mencionEnCurso(texto: string, cursor: number): { desde: number; q: string } | null {
  const m = /(^|\s)@([\p{L}]*)$/u.exec(texto.slice(0, cursor));
  if (!m) return null;
  return { desde: cursor - m[2].length - 1, q: m[2] };
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "@Nati" y "@prodi" resaltados dentro del texto de un mensaje. */
function conMenciones(texto: string, mio: boolean) {
  const partes = texto.split(/(@[\p{L}]+)/u);
  if (partes.length === 1) return texto;
  return partes.map((p, j) =>
    p.startsWith("@") ? (
      <span
        key={j}
        className={cn(
          "rounded px-0.5 font-semibold",
          /^@prodi$/i.test(p) ? (mio ? "bg-white/20" : "bg-[#6F40FC]/10 text-[#6F40FC]") : mio ? "bg-white/20" : "bg-primary/10 text-primary"
        )}
      >
        {p}
      </span>
    ) : (
      p
    )
  );
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
 * Tocando la hora se abre "Info del mensaje" (quién lo vio y cuándo).
 */
function Visto({ chat, m, uid }: { chat: ChatT; m: Mensaje; uid: string }) {
  const { lecturas, vieron, todos, resumen } = estadoVisto(chat, m, uid);
  if (!lecturas.length) return null;
  const Icono = vieron.length ? CheckCheck : Check;
  return (
    <span className={cn("inline-flex items-center", todos ? "text-primary-foreground" : "text-primary-foreground/60")} title={resumen}>
      <Icono className="h-3.5 w-3.5" strokeWidth={todos ? 3 : 2} aria-label={resumen} />
    </span>
  );
}

/** Mantener apretado (celular) abre la info del mensaje. Moverse (scroll) lo cancela. */
function alMantenerApretado(t: MutableRefObject<ReturnType<typeof setTimeout> | undefined>, alMantener: () => void) {
  const cancelar = () => clearTimeout(t.current);
  return {
    onTouchStart: () => {
      cancelar();
      t.current = setTimeout(() => {
        navigator.vibrate?.(10);
        alMantener();
      }, 500);
    },
    onTouchMove: cancelar,
    onTouchEnd: cancelar,
    onTouchCancel: cancelar,
  };
}

/**
 * Deslizar un mensaje hacia la derecha para responderlo (como en WhatsApp): la burbuja acompaña el dedo,
 * aparece la flechita y, si se pasa de la marca, vibra y queda respondiendo. Movimiento vertical: es scroll.
 */
function DeslizarParaResponder({ children, onResponder }: { children: ReactNode; onResponder: () => void }) {
  const [dx, setDx] = useState(0);
  const inicio = useRef<{ x: number; y: number; eje: "x" | "y" | null } | null>(null);
  const MARCA = 60;
  return (
    <div
      // pan-y: el scroll vertical lo hace el navegador; lo horizontal queda para "responder" (no corre la lista).
      className="relative touch-pan-y"
      onTouchStart={(e) => {
        const t = e.touches[0];
        inicio.current = { x: t.clientX, y: t.clientY, eje: null };
      }}
      onTouchMove={(e) => {
        const s = inicio.current;
        if (!s) return;
        const t = e.touches[0];
        const mx = t.clientX - s.x;
        const my = t.clientY - s.y;
        if (!s.eje && (Math.abs(mx) > 8 || Math.abs(my) > 8)) s.eje = Math.abs(mx) > Math.abs(my) ? "x" : "y";
        if (s.eje !== "x") return;
        const nuevo = Math.max(0, Math.min(90, mx));
        if (nuevo >= MARCA && dx < MARCA) navigator.vibrate?.(10);
        setDx(nuevo);
      }}
      onTouchEnd={() => {
        if (dx >= MARCA) onResponder();
        inicio.current = null;
        setDx(0);
      }}
      onTouchCancel={() => {
        inicio.current = null;
        setDx(0);
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-primary/15 text-primary transition-opacity"
        style={{ opacity: Math.min(1, dx / MARCA), transform: `translateY(-50%) scale(${0.6 + Math.min(1, dx / MARCA) * 0.4})` }}
      >
        <Reply className="h-4 w-4" />
      </span>
      <div style={{ transform: `translateX(${dx}px)`, transition: dx ? "none" : "transform 200ms ease-out" }}>{children}</div>
    </div>
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
  onSinLeer,
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
  /** Cuántos mensajes sin leer tiene (el chat flotante lo muestra en la burbuja minimizada). */
  onSinLeer?: (n: number) => void;
}) {
  const { clienteById, chats } = useRedes();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [llamando, setLlamando] = useState(false);
  const [pensando, setPensando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [sugerir, setSugerir] = useState<{ desde: number; q: string } | null>(null);
  const [mencionados, setMencionados] = useState<Record<string, string>>({});
  const [respondiendo, setRespondiendo] = useState<Mensaje | null>(null);
  const [referencia, setReferencia] = useState<ReferenciaChat | null>(null);
  const [tareaMsg, setTareaMsg] = useState<Mensaje | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  // Abierto desde otra pantalla con un mensaje empezado (ej. "Hablarlo con el cliente" en una corrección).
  useEffect(() => {
    const tomar = () => {
      const b = tomarBorrador(chat.id);
      if (!b) return;
      setTexto(b.texto);
      setReferencia(b.referencia ?? null);
      requestAnimationFrame(() => {
        caja.current?.focus();
        caja.current?.setSelectionRange(b.texto.length, b.texto.length);
      });
    };
    tomar();
    const alLlegar = (e: Event) => (e as CustomEvent<string>).detail === chat.id && tomar();
    window.addEventListener(EVENTO_BORRADOR, alLlegar);
    return () => window.removeEventListener(EVENTO_BORRADOR, alLlegar);
  }, [chat.id]);
  const elegirArchivo = useRef<HTMLInputElement>(null);
  const elegirDocumento = useRef<HTMLInputElement>(null);
  const capturaFoto = useRef<HTMLInputElement>(null);
  const capturaSelfie = useRef<HTMLInputElement>(null);
  const capturaVideo = useRef<HTMLInputElement>(null);
  const [camara, setCamara] = useState(false);
  const [info, setInfo] = useState(false);
  // Privado (con una persona o con Prodi): sin info de grupo.
  const privado = chat.tipo === "directo" || chat.tipo === "prodi";
  const [infoMsg, setInfoMsg] = useState<Mensaje | null>(null);
  const [editMsg, setEditMsg] = useState<Mensaje | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pegadoAbajo = useRef(true);
  const tMantener = useRef<ReturnType<typeof setTimeout>>();
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

  /** Elige una sugerencia de "@": inserta "@Nombre " y la anota para avisarle (si sigue en el texto al mandar). */
  const usarMencion = (c: { id: string; etiqueta: string }) => {
    if (!sugerir) return;
    const cursor = caja.current?.selectionStart ?? texto.length;
    const ins = `@${c.etiqueta} `;
    const nuevo = `${texto.slice(0, sugerir.desde)}${ins}${texto.slice(cursor)}`;
    setTexto(nuevo);
    setSugerir(null);
    if (c.id !== PRODI_ID) setMencionados((prev) => ({ ...prev, [c.id]: c.etiqueta }));
    requestAnimationFrame(() => {
      const pos = sugerir.desde + ins.length;
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

  // Al volver a desplegarla sin nada nuevo, queda donde estaba.
  const visto = useRef("");
  useEffect(() => {
    if (!activa) return;
    const ahora = `${chat.id}|${mensajes.length}|${subidas.length}|${pensando}`;
    if (ahora !== visto.current) fin.current?.scrollIntoView({ block: "end" });
    visto.current = ahora;
    void marcarLeido(chat, uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensajes.length, chat.id, subidas.length, pensando, activa]);

  // Si se achica la lista (se abre el teclado) estando abajo de todo, se sigue viendo lo último.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const alScroll = () => {
      pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    const abajo = () => {
      if (pegadoAbajo.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("scroll", alScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(abajo) : null;
    ro?.observe(el);
    window.addEventListener("teclado-ios", abajo);
    return () => {
      el.removeEventListener("scroll", alScroll);
      ro?.disconnect();
      window.removeEventListener("teclado-ios", abajo);
    };
  }, []);

  const leidoHasta = chat.leido?.[uid] ?? "";
  const sinLeer = noLeido(chat, uid)
    ? mensajes.filter((m) => m.by !== uid && m.tipo !== "sistema" && m.at > leidoHasta).length || 1
    : 0;
  useEffect(() => {
    if (!cargando) onSinLeer?.(sinLeer);
  }, [sinLeer, cargando, onSinLeer]);

  /** "Responder": el mensaje queda citado arriba de la caja y se escribe la respuesta. */
  const responder = (m: Mensaje) => {
    setRespondiendo(m);
    requestAnimationFrame(() => caja.current?.focus());
  };

  /** Toca una cita: lleva al mensaje original y lo resalta un momento. */
  const irAMensaje = (id: string) => {
    const el = document.getElementById(`msj-${id}`);
    if (!el) {
      toast.info("Ese mensaje es más viejo: no está cargado en pantalla.");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("bg-primary/15");
    setTimeout(() => el.classList.remove("bg-primary/15"), 1400);
  };

  const enviar = async () => {
    const t = texto.trim() || (referencia ? `Sobre ${referencia.titulo}` : "");
    if (!t) return;
    setEnviando(true);
    setSugerir(null);
    try {
      // Mencionados: los elegidos de la lista cuyo "@Nombre" sigue en el texto.
      const menciones = Object.entries(mencionados)
        .filter(([, etiqueta]) => new RegExp(`@${etiqueta}(?![\\p{L}])`, "u").test(t))
        .map(([id]) => id);
      const id = await enviarMensaje(chat, uid, t, { remitente: nombre, respondeA: respondiendo, menciones, referencia });
      setTexto("");
      setMencionados({});
      setRespondiendo(null);
      setReferencia(null);
      if (tieneLink(t) && chat.tipo !== "prodi") guardarLinks(chat.id, id);
      // @prodi: el servidor lo procesa y contesta en el chat.
      if (mencionaProdi(t) || chat.tipo === "prodi") {
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
      const id = await enviarAudio(chat, uid, r.blob, r.duracion, nombre);
      // En su chat con Prodi, el audio es un pedido: lo pasa a texto y contesta.
      if (chat.tipo === "prodi") {
        setPensando(true);
        pedirAProdi(chat.id, id)
          .catch((err) => toast.error(err instanceof Error ? err.message : "Prodi no pudo responder"))
          .finally(() => setTimeout(() => setPensando(false), 1500));
      }
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
  // Para "@": @prodi y la gente del chat (sin mí). Se escribe el nombre de pila; si se repite, nombre y apellido.
  const genteDelChat = chat.miembros.filter((u) => u !== uid && u !== PRODI_ID).map((u) => ({ id: u, nombre: nombreDe(u, chat.nombres?.[u]) }));
  const pilas = genteDelChat.map((g) => g.nombre.split(" ")[0]);
  const candidatos = [
    { id: PRODI_ID, etiqueta: "prodi", nombre: "prodi", detalle: "Asistente: agenda reuniones, deja tareas, recuerda cosas del cliente" },
    ...genteDelChat.map((g) => {
      const pila = g.nombre.split(" ")[0];
      const repetido = pilas.filter((p) => p === pila).length > 1;
      return { id: g.id, etiqueta: (repetido ? g.nombre : pila).replace(/\s+/g, ""), nombre: g.nombre, detalle: "Le llega un aviso" };
    }),
  ];
  const sugerencias = sugerir
    ? candidatos.filter((c) => !sugerir.q || sinTildes(c.nombre).split(" ").some((w) => w.startsWith(sinTildes(sugerir.q))) || sinTildes(c.etiqueta).startsWith(sinTildes(sugerir.q))).slice(0, 6)
    : [];
  const contactos = contactosDe(chats);
  /** "Contacto" (solo chat) o el rol; los clientes no leen perfiles ajenos: ahí solo se sabe si es contacto. */
  const etiquetaPersona = (id: string) => {
    const r = perfilDe(id)?.role;
    return r === "contacto" || contactos.has(id) ? "Contacto" : r ? getRoleInfo(r).label : "";
  };
  const miembros = chat.miembros.map(perfilDe).filter(Boolean) as Profile[];

  let ultimoDia = "";
  const ultimoMio = [...mensajes].reverse().find((m) => m.by === uid && m.tipo !== "sistema")?.id;
  // Grupos: caritas de quién leyó hasta dónde (como Messenger), debajo del último mensaje que vio cada uno.
  const vistos = useMemo(
    () => (chat.tipo === "directo" ? new Map<string, string[]>() : vistosHasta(chat, mensajes, uid)),
    [chat, mensajes, uid]
  );

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
      <header className={cn("flex shrink-0 items-center border-b", compacto ? "gap-2 px-2 py-2" : "gap-3 px-3 py-2.5 md:px-5")}>
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
          onClick={() => !privado && setInfo(true)}
          className={cn(
            "flex min-w-0 flex-1 items-center rounded-lg text-left",
            compacto ? "gap-2" : "gap-3",
            !privado && "hover:bg-muted/50"
          )}
          title={!privado ? "Ver miembros y datos del grupo" : undefined}
          disabled={privado}
        >
          <ChatIcon chat={chat} profiles={profiles} uid={uid} color={color} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{tituloChat(chat, uid, profiles, role)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {chat.tipo === "prodi"
                ? "Tu asistente: agenda, tareas, clientes y logos"
                : chat.tipo === "directo"
                ? etiquetaPersona(chat.miembros.find((m) => m !== uid) ?? "")
                : miembros.map((m) => m.nombre?.split(" ")[0]).join(", ")}
            </span>
          </span>
        </button>
        {/* Los contactos (solo chat) no arman reuniones: las crea el equipo o el cliente. */}
        {role !== "contacto" && chat.tipo !== "prodi" && (role !== "cliente" || chat.proyecto_id) &&
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

      <div ref={scroller} className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3", compacto ? "py-3" : "py-4 md:px-6")}>
        {cargando ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mensajes.length === 0 && !subidas.length ? (
          chat.tipo === "prodi" ? (
            <div className="mx-auto max-w-sm space-y-2 py-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Tu chat con Prodi</p>
              <p>Acá no hace falta escribir @prodi. Probá:</p>
              <p>“Agendame una reunión con Ariel mañana a las 10”</p>
              <p>“¿Qué videos tiene Natalia en edición?”</p>
              <p>“Pasame el logo de Sample”</p>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Escribí el primer mensaje.</p>
          )
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
                      {/* Las propias, sin "Vos" adelante (quedaba "Vos sumó…"): con mayúscula. */}
                      {mio ? m.texto.charAt(0).toUpperCase() + m.texto.slice(1) : `${nombreDe(m.by, m.by_nombre).split(" ")[0]} ${m.texto}`}
                    </p>
                  </div>
                );
              const reacciones = Object.entries(m.reacciones ?? {}).filter(([, l]) => l.length > 0);
              return (
                <div key={m.id} id={`msj-${m.id}`} className="scroll-mt-24 rounded-xl transition-colors duration-700">
                  {mostrarDia && (
                    <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{dia}</p>
                  )}
                  <DeslizarParaResponder onResponder={() => responder(m)}>
                  <div className={cn("group/msj flex items-end gap-2", mio ? "justify-end" : "justify-start", !agrupado && "mt-2")}>
                    {mio && (
                      <button
                        type="button"
                        onClick={() => responder(m)}
                        className="mb-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover/msj:opacity-100 md:flex"
                        aria-label="Responder"
                        title="Responder"
                      >
                        <Reply className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {mio && (
                      <button
                        type="button"
                        onClick={() => setInfoMsg(m)}
                        className="mb-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover/msj:opacity-100 md:flex"
                        aria-label="Info del mensaje"
                        title="Info del mensaje"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    )}
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
                      {...alMantenerApretado(tMantener, () => setInfoMsg(m))}
                      className={cn(
                        "min-w-0 rounded-2xl px-3.5 py-2 text-sm shadow-sm [-webkit-touch-callout:none]", compacto ? "max-w-[85%]" : "max-w-[82%] sm:max-w-[70%]",
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
                          <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                            {nombreDe(m.by, m.by_nombre)}
                            {etiquetaPersona(m.by) === "Contacto" && <EtiquetaContacto />}
                          </p>
                        )
                      )}
                      {m.responde_a && (
                        <button
                          type="button"
                          onClick={() => irAMensaje(m.responde_a!.id)}
                          className={cn(
                            "mb-1.5 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-xs",
                            mio ? "border-white/70 bg-white/15" : "border-primary bg-muted/70"
                          )}
                        >
                          <span className={cn("block font-semibold", mio ? "text-primary-foreground" : "text-primary")}>
                            {m.responde_a.by === uid ? "Vos" : nombreDe(m.responde_a.by, m.responde_a.by_nombre)}
                          </span>
                          <span className={cn("line-clamp-2", mio ? "text-primary-foreground/80" : "text-muted-foreground")}>{m.responde_a.texto}</span>
                        </button>
                      )}
                      {m.referencia && <TarjetaReferencia r={m.referencia} mio={mio} />}
                      {m.tipo === "archivo" && m.archivo ? (
                        <div className="space-y-1">
                          <ArchivoMensaje archivo={m.archivo} mio={mio} />
                          {m.leyenda && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] pt-0.5">{m.leyenda}</p>}
                        </div>
                      ) : bot ? (
                        <div className="space-y-2">
                          <TextoIA texto={m.texto} />
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
                          {conMenciones(m.texto, mio)}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => setInfoMsg(m)}
                        className={cn(
                          "ml-auto mt-0.5 flex items-center justify-end gap-1 rounded-sm text-[10px]",
                          mio ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}
                        aria-label="Info del mensaje"
                      >
                        {m.editado_at && <span className="italic">editado ·</span>}
                        {hora(m.at)}
                        {mio && <Visto chat={chat} m={m} uid={uid} />}
                      </button>
                    </div>
                    {!mio && (
                      <button
                        type="button"
                        onClick={() => setInfoMsg(m)}
                        className="mb-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover/msj:opacity-100 md:flex"
                        aria-label="Info del mensaje"
                        title="Info del mensaje"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!mio && (
                      <button
                        type="button"
                        onClick={() => responder(m)}
                        className="mb-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover/msj:opacity-100 md:flex"
                        aria-label="Responder"
                        title="Responder"
                      >
                        <Reply className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  </DeslizarParaResponder>
                  {reacciones.length > 0 && (
                    <div className={cn("-mt-1 flex flex-wrap gap-1", mio ? "justify-end pr-1" : chat.tipo !== "directo" || bot ? "pl-9" : "pl-1")}>
                      {reacciones.map(([emoji, quienes]) => {
                        const mia = quienes.includes(uid);
                        return (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => void reaccionar(chat, m, uid, emoji).catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo"))}
                            title={quienes.map((q) => (q === uid ? "Vos" : nombreDe(q).split(" ")[0])).join(", ")}
                            className={cn(
                              "relative z-[1] inline-flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-xs shadow-sm transition-transform active:scale-95",
                              mia && "border-primary/50 bg-primary/10"
                            )}
                          >
                            <span>{emoji}</span>
                            {quienes.length > 1 && <span className="tabular-nums text-muted-foreground">{quienes.length}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {mio && m.id === ultimoMio && <VistoLinea chat={chat} m={m} uid={uid} />}
                  {vistos.has(m.id) && (
                    <Cabecitas ids={vistos.get(m.id)!} perfilDe={perfilDe} mio={mio} onClick={() => setInfoMsg(m)} />
                  )}
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
          "shrink-0 border-t bg-background p-2 min-[380px]:p-3",
          !compacto && "pb-[calc(var(--alto-barra)+0.5rem)] min-[380px]:pb-[calc(var(--alto-barra)+0.75rem)] md:pb-3"
        )}
        style={compacto ? { paddingBottom: "calc(0.75rem + var(--abajo-seguro))" } : undefined}
      >
        {referencia && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2">
            <div className="min-w-0 flex-1">
              <TarjetaReferencia r={referencia} compacta />
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setReferencia(null)} aria-label="Sacar la tarjeta">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {respondiendo && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 rounded-xl border-l-4 border-primary bg-muted/60 py-1.5 pl-3 pr-1 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
            <Reply className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-primary">Respondiendo a {respondiendo.by === uid ? "vos" : nombreDe(respondiendo.by, respondiendo.by_nombre)}</p>
              <p className="truncate text-xs text-muted-foreground">{respondiendo.texto || respondiendo.leyenda || (respondiendo.audio ? "🎤 Audio" : "📎 Archivo")}</p>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setRespondiendo(null)} aria-label="No responder">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
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
          {/* Como documento: llega el archivo original para bajar (sin vista previa), también si es una foto. */}
          <input
            ref={elegirDocumento}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!files.length) return;
              try {
                subirArchivosChat(chat.id, files, undefined, true);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "No se pudo mandar");
              }
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-11 w-11 shrink-0 rounded-full text-muted-foreground"
                aria-label="Adjuntar archivo"
                title={`Adjuntar foto, video o documento (hasta ${CHAT_MAX_MB} MB)`}
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-60">
              <DropdownMenuItem onSelect={() => elegirArchivo.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" /> Fotos y videos
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => elegirDocumento.current?.click()}>
                <FileText className="mr-2 h-4 w-4" />
                <span>
                  Documento
                  <span className="block text-xs text-muted-foreground">Archivo original, sin comprimir</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
            {sugerencias.length > 0 && (
              <div className="absolute bottom-full left-0 z-10 mb-2 w-full max-w-sm overflow-hidden rounded-xl border bg-popover shadow-lg">
                {sugerencias.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      usarMencion(c);
                    }}
                    className={cn("flex w-full items-center gap-2.5 p-2 text-left transition-colors hover:bg-muted", i === 0 && "bg-muted/60")}
                  >
                    {c.id === PRODI_ID ? <AvatarProdi /> : <UserAvatar profile={perfilDe(c.id) ?? ({ id: c.id, nombre: c.nombre, email: "" } as Profile)} size="sm" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{c.id === PRODI_ID ? "@prodi" : c.nombre}</span>
                      <span className="block truncate text-xs text-muted-foreground">{c.detalle}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <Textarea
              ref={caja}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setSugerir(mencionEnCurso(e.target.value, e.target.selectionStart ?? e.target.value.length));
              }}
              onKeyDown={(e) => {
                if (sugerencias.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
                  e.preventDefault();
                  usarMencion(sugerencias[0]);
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
              placeholder={chat.tipo === "prodi" ? "Pedile algo a Prodi…" : ayudaCaja}
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
      {!privado && <InfoChat chat={chat} open={info} onOpenChange={setInfo} onSalio={onBack} />}
      <InfoMensaje
        chat={chat}
        m={infoMsg}
        uid={uid}
        perfilDe={perfilDe}
        onOpenChange={(v) => !v && setInfoMsg(null)}
        onEditar={
          infoMsg && puedeEditarMensaje(infoMsg, uid)
            ? () => {
                setEditMsg(infoMsg);
                setInfoMsg(null);
              }
            : undefined
        }
        onResponder={
          infoMsg
            ? () => {
                responder(infoMsg);
                setInfoMsg(null);
              }
            : undefined
        }
        onTarea={
          infoMsg && (infoMsg.texto || infoMsg.leyenda)
            ? () => {
                setTareaMsg(infoMsg);
                setInfoMsg(null);
              }
            : undefined
        }
        onReaccionar={(emoji) => {
          if (!infoMsg) return;
          void reaccionar(chat, infoMsg, uid, emoji).catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo"));
          setInfoMsg(null);
        }}
      />
      <EditarMensajeDialog chat={chat} m={editMsg} onOpenChange={(v) => !v && setEditMsg(null)} />
      <TareaMensajeDialog chat={chat} m={tareaMsg} uid={uid} perfilDe={perfilDe} onOpenChange={(v) => !v && setTareaMsg(null)} />
    </div>
  );
}
