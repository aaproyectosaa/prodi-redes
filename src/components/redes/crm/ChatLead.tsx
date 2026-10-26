import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Check, Clock, Instagram, Loader2, MessageCircle, Paperclip, Pencil, Phone, Plus, RefreshCw, Send, Smile, Sparkles, Trash2, X, Zap, AtSign, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { db, doc, onSnapshot, suscribirEscribiendo } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";
import { ConfigCatalogo, SelectorProductos, type Producto } from "./CatalogoProductos";

// Chat de un lead que llegó por Instagram o Messenger: se lee y se contesta desde el CRM (api/_lib/meta-leads.ts).
// Herramientas del vendedor: respuestas rápidas del equipo (con {nombre}), tres respuestas sugeridas por la IA según
// la charla, emojis, la cuenta regresiva de las 24 h que da Meta para responder y guardar el WhatsApp o el mail que
// el lead escribió en el chat. Se actualiza solo cada 15 segundos.

/** Lo adjunto que vino de Meta (las URLs de Meta vencen: se renuevan cada vez que se actualiza el chat). */
interface AdjuntoChat {
  tipo: "imagen" | "video" | "audio" | "archivo" | "tarjeta";
  url?: string | null;
  preview?: string | null;
  titulo?: string | null;
  subtitulo?: string | null;
  link?: string | null;
}

interface Mensaje {
  id: string;
  texto: string;
  adjunto: boolean;
  adjuntos?: AdjuntoChat[];
  tipo?: "texto" | "historia" | "publicacion" | "sticker" | "archivo" | "otro";
  at: string;
  mio: boolean;
  /** Solo los que mandé recién: se ven al instante mientras viajan a Meta. */
  estado?: "enviando" | "error";
}
interface Conversacion {
  plataforma: string;
  mensajes: Mensaje[];
  puede_responder: boolean;
  /** "agente": pasaron las 24 h pero se puede hasta 7 días con Human Agent. */
  ventana?: "normal" | "agente" | "cerrada";
  vence: string | null;
}
interface Respuesta {
  titulo: string;
  texto: string;
}
export interface LeadChat {
  id: string;
  nombre?: string;
  negocio?: string;
  instagram?: string;
  telefono?: string;
  email?: string;
  /** Copia de los últimos mensajes guardada en el lead (abre al instante y llega en tiempo real). */
  meta?: { plataforma?: string; chat?: { mensajes?: unknown[]; at?: string } | null } | null;
}

const VENTANA_MS = 24 * 3600_000;
const VENTANA_AGENTE_MS = 7 * VENTANA_MS;
/** La conversación armada con la copia guardada (el plazo para responder se calcula acá). */
function desdeCopia(lead: LeadChat): Conversacion | null {
  const lista = lead.meta?.chat?.mensajes as Mensaje[] | undefined;
  if (!Array.isArray(lista) || !lista.length) return null;
  const ultimoSuyo = [...lista].reverse().find((m) => !m.mio);
  const desde = ultimoSuyo ? Date.parse(ultimoSuyo.at) : 0;
  const ahora = Date.now();
  const ventana = desde + VENTANA_MS > ahora ? "normal" : desde + VENTANA_AGENTE_MS > ahora ? "agente" : "cerrada";
  return {
    plataforma: lead.meta?.plataforma ?? "instagram",
    mensajes: lista,
    puede_responder: ventana !== "cerrada",
    ventana,
    vence: desde ? new Date(desde + (ventana === "agente" ? VENTANA_AGENTE_MS : VENTANA_MS)).toISOString() : null,
  };
}

const RESPUESTAS_BASE: Respuesta[] = [
  { titulo: "Saludo", texto: "¡Hola {nombre}! Gracias por escribirnos 🙌 Somos Prodi: hacemos los videos de tu negocio, los publicamos y los pautamos en Meta. ¿Qué negocio tenés?" },
  { titulo: "Pedir WhatsApp", texto: "¿Me pasás tu WhatsApp así te cuento mejor y te mando ejemplos de lo que hacemos?" },
  { titulo: "Agendar llamada", texto: "¿Te queda bien una videollamada de 15 minutos esta semana? Decime qué día y horario te sirve y la agendamos." },
  { titulo: "Precios", texto: "Los planes dependen de cuántos videos por mes necesites. Contame un poco de tu negocio y te armo una propuesta a medida." },
  { titulo: "Ejemplos", texto: "Te dejo algunos de nuestros trabajos: https://somosprodi.com" },
  { titulo: "Seguimiento", texto: "¡Hola {nombre}! ¿Pudiste ver lo que te pasé? Cualquier duda te ayudo." },
];

const EMOJIS = ["🙌", "😊", "👌", "🔥", "🚀", "💪", "👏", "🙏", "✨", "📹", "📈", "✅", "👉", "😉", "🤝", "❤️"];

const TIPO_SIN_TEXTO: Record<string, string> = {
  historia: "Respondió a una historia",
  publicacion: "Compartió una publicación",
  sticker: "Mandó un sticker",
  archivo: "Foto, audio o archivo",
  otro: "Reacción o mensaje sin texto",
};

const hora = (at: string) => new Date(at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
function dia(at: string) {
  const d = new Date(at);
  const hoy = new Date();
  const ayer = new Date(Date.now() - 86400_000);
  if (d.toDateString() === hoy.toDateString()) return "Hoy";
  if (d.toDateString() === ayer.toDateString()) return "Ayer";
  const t = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== hoy.getFullYear() ? { year: "numeric" } : {}) });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const conNombre = (t: string, lead: LeadChat) => t.replace(/\{nombre\}/g, (lead.nombre || lead.negocio || "").replace(/^@/, "").split(/[\s.]/)[0] || "").replace(/¡Hola !/, "¡Hola!");

/** WhatsApp o mail que el lead escribió en el chat y todavía no está en su ficha. */
function datosEnChat(mensajes: Mensaje[], lead: LeadChat) {
  const suyos = mensajes.filter((m) => !m.mio && m.texto).map((m) => m.texto).join(" \n ");
  const tel = suyos.match(/(?:\+?54\s?9?\s?)?\(?\d{2,4}\)?[\s-]?\d{2,4}[\s-]?\d{3,4}/)?.[0]?.trim();
  const mail = suyos.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)?.[0];
  const soloDig = (v?: string) => (v ?? "").replace(/\D/g, "");
  return {
    telefono: tel && soloDig(tel).length >= 8 && !soloDig(lead.telefono).endsWith(soloDig(tel).slice(-8)) ? tel : null,
    email: mail && mail.toLowerCase() !== (lead.email ?? "").toLowerCase() ? mail : null,
  };
}

function useRespuestas() {
  const [lista, setLista] = useState<Respuesta[] | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, "web_config", "respuestas"),
        (s) => {
          const l = s.exists() ? (s.data()?.lista as Respuesta[] | undefined) : undefined;
          setLista(Array.isArray(l) && l.length ? l : RESPUESTAS_BASE);
        },
        () => setLista(RESPUESTAS_BASE)
      ),
    []
  );
  return lista ?? RESPUESTAS_BASE;
}

/** Botón de la barra de herramientas. */
function Herramienta({ activo, onClick, children, titulo }: { activo?: boolean; onClick?: () => void; children: React.ReactNode; titulo: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        activo ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** Editor de las respuestas rápidas del equipo. */
function EditarRespuestas({ lista, onClose }: { lista: Respuesta[]; onClose: () => void }) {
  const [items, setItems] = useState<Respuesta[]>(lista);
  const [guardando, setGuardando] = useState(false);
  const guardar = async () => {
    setGuardando(true);
    try {
      await callApi("/api/web/respuestas", { lista: items });
      toast.success("Respuestas rápidas guardadas");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron guardar");
    } finally {
      setGuardando(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Escribí <b>{"{nombre}"}</b> y se reemplaza por el nombre del lead.
      </p>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {items.map((r, i) => (
          <div key={i} className="space-y-1 rounded-xl border p-2">
            <div className="flex gap-1">
              <Input value={r.titulo} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))} placeholder="Título" className="h-8 text-xs" maxLength={40} />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Borrar">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea value={r.texto} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} rows={2} className="text-xs" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={() => setItems([...items, { titulo: "", texto: "" }])}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Agregar
        </Button>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" className="h-8 rounded-full text-xs" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ChatLead({ lead }: { lead: LeadChat }) {
  const [conv, setConv] = useState<Conversacion | null>(() => desdeCopia(lead));
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [panel, setPanel] = useState<null | "rapidas" | "ia" | "editar" | "productos" | "catalogo">(null);
  const [sugerencias, setSugerencias] = useState<string[] | null>(null);
  const [pensando, setPensando] = useState(false);
  const [pedido, setPedido] = useState("");
  const [abajo, setAbajo] = useState(true);
  const [nuevos, setNuevos] = useState(0);
  const [ahora, setAhora] = useState(Date.now());
  const respuestas = useRespuestas();
  const caja = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const cantidad = useRef(0);

  // Con el chat abierto el sistema pregunta más seguido si cambió algo (cada 4 s, como los chats del equipo).
  useEffect(() => suscribirEscribiendo(() => undefined), []);
  const copia = lead.meta?.chat;
  useEffect(() => {
    const nueva = desdeCopia(lead);
    if (!nueva) return;
    setConv((c) => {
      if (!c) return nueva;
      const ids = new Set(c.mensajes.map((m) => m.id));
      const faltan = nueva.mensajes.filter((m) => !ids.has(m.id));
      if (!faltan.length) return c;
      const mensajes = [...c.mensajes, ...faltan].sort((a, b) => a.at.localeCompare(b.at));
      return { ...nueva, mensajes };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copia]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await callApi<Conversacion>("/api/web/meta-conversacion", { id: lead.id });
      setConv(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo traer la conversación");
    } finally {
      setCargando(false);
    }
  }, [lead.id]);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => document.visibilityState === "visible" && void cargar(), 30_000);
    const reloj = setInterval(() => setAhora(Date.now()), 60_000);
    return () => {
      clearInterval(t);
      clearInterval(reloj);
    };
  }, [cargar]);

  const bajar = (suave = true) => caja.current?.scrollTo({ top: caja.current.scrollHeight, behavior: suave ? "smooth" : "auto" });

  // Mensaje nuevo: si estaba abajo, baja; si estaba leyendo arriba, avisa con un botón.
  useEffect(() => {
    const n = conv?.mensajes.length ?? 0;
    if (n > cantidad.current) {
      if (abajo || cantidad.current === 0) requestAnimationFrame(() => bajar(cantidad.current !== 0));
      else setNuevos((x) => x + (n - cantidad.current));
    }
    cantidad.current = n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv]);

  const alScroll = () => {
    const c = caja.current;
    if (!c) return;
    const enFondo = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
    setAbajo(enFondo);
    if (enFondo) setNuevos(0);
  };

  // Auto-altura del cuadro de texto.
  useEffect(() => {
    const t = entrada.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
  }, [texto]);

  const usar = (t: string) => {
    setTexto(conNombre(t, lead));
    setPanel(null);
    requestAnimationFrame(() => entrada.current?.focus());
  };

  const sugerir = async () => {
    setPanel("ia");
    setPensando(true);
    try {
      const r = await callApi<{ opciones: string[] }>("/api/web/meta-sugerir", { id: lead.id, pedido: pedido.trim() || undefined });
      setSugerencias(r.opciones);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no pudo sugerir");
    } finally {
      setPensando(false);
    }
  };

  // Lo que mandé y todavía no volvió de Meta: se muestra al instante (sin esperar).
  const [pendientes, setPendientes] = useState<Mensaje[]>([]);
  const mandar = (t: string, id = `local-${Date.now()}`) => {
    const at = new Date().toISOString();
    setPendientes((l) => [...l.filter((x) => x.id !== id), { id, texto: t, adjunto: false, tipo: "texto", at, mio: true, estado: "enviando" }]);
    requestAnimationFrame(() => bajar());
    callApi("/api/web/meta-responder", { id: lead.id, texto: t })
      .then(() => {
        // Ya salió: queda como enviado hasta que Meta lo devuelva en la conversación.
        setPendientes((l) => l.map((x) => (x.id === id ? { ...x, estado: undefined } : x)));
        setTimeout(() => void cargar(), 1200);
      })
      .catch((e) => {
        setPendientes((l) => l.map((x) => (x.id === id ? { ...x, estado: "error" } : x)));
        toast.error(e instanceof Error ? e.message : "No se pudo enviar");
      });
  };
  const mandarProductos = (lista: Producto[]) => {
    const id = `local-p-${Date.now()}`;
    const texto = `🛍️ ${lista.map((p) => p.nombre).join(" · ")}`;
    setPanel(null);
    setPendientes((l) => [...l, { id, texto, adjunto: false, tipo: "texto", at: new Date().toISOString(), mio: true, estado: "enviando" }]);
    requestAnimationFrame(() => bajar());
    callApi<{ como: string }>("/api/web/meta-productos", { id: lead.id, ids: lista.map((p) => p.id) })
      .then(() => {
        setPendientes((l) => l.filter((x) => x.id !== id));
        toast.success(lista.length === 1 ? "Producto enviado" : `${lista.length} productos enviados`);
        setTimeout(() => void cargar(), 1200);
      })
      .catch((e) => {
        setPendientes((l) => l.filter((x) => x.id !== id));
        toast.error(e instanceof Error ? e.message : "No se pudieron mandar");
      });
  };
  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    setTexto("");
    setSugerencias(null);
    mandar(t);
    requestAnimationFrame(() => entrada.current?.focus());
  };

  const guardarDato = async (campo: "telefono" | "email", valor: string) => {
    try {
      await callApi("/api/web/datos", { id: lead.id, [campo]: valor });
      toast.success(campo === "telefono" ? "WhatsApp guardado en la ficha" : "Email guardado en la ficha");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  const red = conv?.plataforma === "messenger" ? "Messenger" : "Instagram";
  const IconoRed = conv?.plataforma === "messenger" ? MessageCircle : Instagram;
  const usuario = (lead.instagram ?? "").replace(/^@/, "");
  const appLink = conv?.plataforma === "messenger" ? "https://business.facebook.com/latest/inbox" : usuario ? `https://ig.me/m/${usuario}` : "https://www.instagram.com/direct/inbox/";
  const quedan = conv?.vence ? Date.parse(conv.vence) - ahora : 0;
  const horas = Math.max(0, Math.floor(quedan / 3600_000));
  const extendida = conv?.ventana === "agente";
  const detectados = useMemo(() => (conv ? datosEnChat(conv.mensajes, lead) : { telefono: null, email: null }), [conv, lead]);
  const ultimoSuyo = conv ? [...conv.mensajes].reverse().find((m) => !m.mio) : undefined;
  const esperandoRespuesta = !!conv && conv.mensajes.length > 0 && !conv.mensajes[conv.mensajes.length - 1].mio;

  // Mensajes agrupados por día y seguidos del mismo lado.
  const mensajesVer = useMemo(() => {
    const base = conv?.mensajes ?? [];
    const faltan = pendientes.filter(
      (p) => !base.some((m) => m.mio && m.texto.trim() === p.texto.trim() && Date.parse(m.at) >= Date.parse(p.at) - 120_000)
    );
    return [...base, ...faltan];
  }, [conv, pendientes]);

  const filas = useMemo(() => {
    const lista = mensajesVer;
    const res: ({ tipo: "dia"; label: string; key: string } | { tipo: "msj"; m: Mensaje; primero: boolean; ultimo: boolean; key: string })[] = [];
    lista.forEach((m, i) => {
      const ant = lista[i - 1];
      const sig = lista[i + 1];
      if (!ant || dia(ant.at) !== dia(m.at)) res.push({ tipo: "dia", label: dia(m.at), key: `d-${m.id}` });
      const mismoAnt = ant && ant.mio === m.mio && dia(ant.at) === dia(m.at) && Date.parse(m.at) - Date.parse(ant.at) < 5 * 60_000;
      const mismoSig = sig && sig.mio === m.mio && dia(sig.at) === dia(m.at) && Date.parse(sig.at) - Date.parse(m.at) < 5 * 60_000;
      res.push({ tipo: "msj", m, primero: !mismoAnt, ultimo: !mismoSig, key: m.id });
    });
    return res;
  }, [mensajesVer]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* Barra fina: red, último mensaje y cuánto queda para responder (el nombre ya está arriba de la ficha). */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <IconoRed className="h-4 w-4 shrink-0 text-pink-500" />
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{red}</span>
          {ultimoSuyo ? ` · último mensaje ${dia(ultimoSuyo.at).toLowerCase()}, ${hora(ultimoSuyo.at)}` : ""}
        </p>
        {conv &&
          (conv.puede_responder ? (
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                extendida
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : horas < 3
                    ? "bg-red-500/15 text-red-600 dark:text-red-400"
                    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              )}
              title={
                extendida
                  ? "Pasaron más de 24 h: se responde como persona (Human Agent), hasta 7 días después de su último mensaje"
                  : "Meta deja responder hasta 24 h después del último mensaje del lead"
              }
            >
              <Clock className="h-3 w-3" />{" "}
              {extendida
                ? `Plazo extendido · ${horas >= 24 ? `${Math.floor(horas / 24)} d` : `${horas} h`}`
                : horas < 1
                  ? "Menos de 1 h para responder"
                  : `${horas} h para responder`}
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              <Clock className="h-3 w-3" /> Ventana cerrada
            </span>
          ))}
        <button type="button" onClick={() => void cargar()} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Actualizar" aria-label="Actualizar">
          <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} />
        </button>
      </div>

      {/* Mensajes */}
      <div className="relative min-h-0 flex-1">
        <div ref={caja} onScroll={alScroll} className="absolute inset-0 overflow-y-auto bg-background bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[length:20px_20px] px-4 py-4 sm:px-6">
          {!conv && !error && (
            <p className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Trayendo la conversación…
            </p>
          )}
          {error && <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>}
          {filas.map((f) =>
            f.tipo === "dia" ? (
              <div key={f.key} className="my-4 flex items-center gap-3 first:mt-0">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{f.label}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : (
              <div key={f.key} className={cn("flex", f.m.mio ? "justify-end" : "justify-start", f.primero ? "mt-2" : "mt-0.5")}>
                <div
                  className={cn(
                    "group max-w-[75%] px-3.5 py-2 text-[13.5px] leading-snug",
                    f.m.mio ? "bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/20" : "border bg-card shadow-sm",
                    f.m.mio
                      ? cn("rounded-2xl", !f.ultimo && "rounded-br-md", !f.primero && "rounded-tr-md")
                      : cn("rounded-2xl", !f.ultimo && "rounded-bl-md", !f.primero && "rounded-tl-md"),
                    f.ultimo && (f.m.mio ? "rounded-br-sm" : "rounded-bl-sm")
                  )}
                >
                  {!!f.m.adjuntos?.length && (
                    <span className={cn("block space-y-1.5", f.m.texto && "mb-1.5")}>
                      {f.m.adjuntos.map((a, i) => (
                        <AdjuntoVista key={i} a={a} mio={f.m.mio} />
                      ))}
                    </span>
                  )}
                  {f.m.texto && <span className="whitespace-pre-wrap break-words">{f.m.texto}</span>}
                  {((f.m.adjunto && !f.m.adjuntos?.length) || (!f.m.texto && !f.m.adjuntos?.length)) && (
                    <span className={cn("flex items-center gap-1 text-xs italic", f.m.texto ? "mt-1 opacity-80" : "opacity-80")}>
                      <Paperclip className="h-3 w-3" /> {TIPO_SIN_TEXTO[f.m.tipo ?? "otro"] ?? TIPO_SIN_TEXTO.otro}
                    </span>
                  )}
                  <span className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", f.m.mio ? "text-white/75" : "text-muted-foreground")}>
                    {f.m.estado === "error" ? (
                      <button
                        type="button"
                        onClick={() => mandar(f.m.texto, f.m.id)}
                        className="rounded-full bg-white/20 px-2 py-0.5 font-semibold text-white hover:bg-white/30"
                      >
                        No se envió · Reintentar
                      </button>
                    ) : (
                      <>
                        {hora(f.m.at)}
                        {f.m.mio && (f.m.estado === "enviando" ? <Clock className="h-3 w-3 animate-pulse" /> : <Check className="h-3 w-3" />)}
                      </>
                    )}
                  </span>
                </div>
              </div>
            )
          )}
          {conv && conv.mensajes.length === 0 && <p className="py-16 text-center text-xs text-muted-foreground">Todavía no hay mensajes.</p>}
        </div>
        {!abajo && (
          <button
            type="button"
            onClick={() => bajar()}
            className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-lg hover:bg-muted"
          >
            <ArrowDown className="h-3.5 w-3.5" /> {nuevos ? `${nuevos} nuevo${nuevos === 1 ? "" : "s"}` : "Abajo"}
          </button>
        )}
      </div>

      {/* Datos que escribió en el chat */}
      {(detectados.telefono || detectados.email) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t bg-emerald-500/5 px-3 py-2 text-xs">
          <span className="text-muted-foreground">En el chat pasó:</span>
          {detectados.telefono && (
            <button
              type="button"
              onClick={() => void guardarDato("telefono", detectados.telefono!)}
              className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
            >
              <Phone className="h-3 w-3" /> Guardar {detectados.telefono} como WhatsApp
            </button>
          )}
          {detectados.email && (
            <button
              type="button"
              onClick={() => void guardarDato("email", detectados.email!)}
              className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
            >
              <AtSign className="h-3 w-3" /> Guardar {detectados.email}
            </button>
          )}
        </div>
      )}

      {/* Paneles: respuestas rápidas y sugerencias de la IA */}
      {panel === "rapidas" && (
        <div className="border-t bg-muted/40 p-2">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Respuestas rápidas</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPanel("editar")} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10">
                <Pencil className="h-3 w-3" /> Editar
              </button>
              <button type="button" onClick={() => setPanel(null)} className="rounded-md p-0.5 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid max-h-44 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {respuestas.map((r, i) => (
              <button key={i} type="button" onClick={() => usar(r.texto)} className="rounded-xl border bg-card p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
                <span className="block text-xs font-semibold">{r.titulo}</span>
                <span className="line-clamp-2 block text-[11px] text-muted-foreground">{conNombre(r.texto, lead)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {panel === "editar" && (
        <div className="border-t bg-muted/40 p-2">
          <EditarRespuestas lista={respuestas} onClose={() => setPanel("rapidas")} />
        </div>
      )}
      {panel === "productos" && (
        <div className="border-t bg-muted/40 p-2">
          <SelectorProductos negocio="prodi" onElegir={(l) => mandarProductos(l)} onCerrar={() => setPanel(null)} onConfigurar={() => setPanel("catalogo")} />
        </div>
      )}
      {panel === "catalogo" && (
        <div className="max-h-[50vh] overflow-y-auto border-t bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Catálogo de Prodi</p>
            <button type="button" onClick={() => setPanel("productos")} className="text-[11px] font-semibold text-primary hover:underline">
              Volver a elegir
            </button>
          </div>
          <ConfigCatalogo negocio="prodi" />
        </div>
      )}
      {panel === "ia" && (
        <div className="border-t bg-gradient-to-br from-primary/[0.06] to-fuchsia-500/[0.06] p-2">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> Respuestas sugeridas
            </p>
            <button type="button" onClick={() => setPanel(null)} className="rounded-md p-0.5 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {pensando ? (
            <p className="flex items-center gap-2 px-1 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Leyendo la charla y armando respuestas…
            </p>
          ) : (
            <div className="space-y-1.5">
              {(sugerencias ?? []).map((t, i) => (
                <button key={i} type="button" onClick={() => usar(t)} className="block w-full rounded-xl border bg-card p-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/5">
                  {t}
                </button>
              ))}
              <div className="flex gap-1.5 pt-0.5">
                <Input
                  value={pedido}
                  onChange={(e) => setPedido(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void sugerir()}
                  placeholder="Pedile algo: ej. invitalo a una llamada el jueves"
                  className="h-8 rounded-full text-xs"
                />
                <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-full text-xs" onClick={() => void sugerir()}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Otras
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Responder */}
      <div className="border-t bg-background px-3 pb-3 pt-2">
        {conv && !conv.puede_responder ? (
          <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="flex-1">Pasaron más de 7 días desde su último mensaje: Meta no deja responder desde acá.</span>
            <a href={appLink} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground hover:bg-primary/90">
              Abrir {red}
            </a>
          </div>
        ) : (
          <>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Herramienta activo={panel === "rapidas" || panel === "editar"} onClick={() => setPanel(panel === "rapidas" ? null : "rapidas")} titulo="Respuestas guardadas del equipo">
                <Zap className="h-3.5 w-3.5" /> Rápidas
              </Herramienta>
              <Herramienta activo={panel === "productos" || panel === "catalogo"} onClick={() => setPanel(panel === "productos" ? null : "productos")} titulo="Mandar productos del catálogo (tarjeta con foto, precio y link)">
                <ShoppingBag className="h-3.5 w-3.5" /> Productos
              </Herramienta>
              <Herramienta activo={panel === "ia"} onClick={() => void sugerir()} titulo="La IA lee la charla y te propone 3 respuestas">
                <Sparkles className="h-3.5 w-3.5" /> Sugerir con IA
              </Herramienta>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground" title="Emojis" aria-label="Emojis">
                    <Smile className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start">
                  <div className="grid grid-cols-8 gap-0.5">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setTexto((t) => `${t}${e}`);
                          entrada.current?.focus();
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-muted"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {esperandoRespuesta && <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">Espera tu respuesta</span>}
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                ref={entrada}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enviar();
                  }
                }}
                rows={1}
                placeholder={`Responder por ${red}…`}
                className="max-h-[140px] min-h-[42px] resize-none rounded-2xl bg-muted/50 text-sm"
                disabled={!conv}
                maxLength={1000}
              />
              <Button
                size="icon"
                className="h-[42px] w-[42px] shrink-0 rounded-full bg-gradient-to-br from-primary to-fuchsia-500 shadow-md shadow-primary/25"
                onClick={enviar}
                disabled={!texto.trim() || !conv}
                aria-label="Enviar"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {texto.length > 700 && <p className="mt-1 px-1 text-right text-[10px] text-muted-foreground">{texto.length}/1000</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** Foto, video, audio, archivo o tarjeta de producto de un mensaje de Instagram / Facebook. */
function AdjuntoVista({ a, mio }: { a: AdjuntoChat; mio: boolean }) {
  const [roto, setRoto] = useState(false);
  const caja = cn("block overflow-hidden rounded-xl", mio ? "bg-white/10" : "bg-muted");
  if (a.tipo === "imagen" && a.url && !roto)
    return (
      <a href={a.url} target="_blank" rel="noopener noreferrer" className={caja}>
        <img src={a.preview || a.url} alt="Foto" loading="lazy" onError={() => setRoto(true)} className="max-h-64 w-full object-cover" />
      </a>
    );
  if (a.tipo === "video" && a.url && !roto)
    return <video src={a.url} poster={a.preview ?? undefined} controls playsInline preload="metadata" onError={() => setRoto(true)} className="max-h-72 w-full rounded-xl bg-black" />;
  if (a.tipo === "audio" && a.url && !roto) return <audio src={a.url} controls preload="metadata" onError={() => setRoto(true)} className="w-60 max-w-full" />;
  if (a.tipo === "tarjeta")
    return (
      <a href={a.link ?? undefined} target="_blank" rel="noopener noreferrer" className={cn(caja, "w-56 max-w-full")}>
        {a.url && !roto && <img src={a.url} alt="" loading="lazy" onError={() => setRoto(true)} className="h-32 w-full object-cover" />}
        <span className="block px-2.5 py-2">
          {a.titulo && <span className="block truncate text-xs font-semibold">{a.titulo}</span>}
          {a.subtitulo && <span className={cn("block truncate text-[11px]", mio ? "text-white/75" : "text-muted-foreground")}>{a.subtitulo}</span>}
          {a.link && <span className={cn("mt-0.5 block truncate text-[10px] underline", mio ? "text-white/80" : "text-primary")}>Ver</span>}
        </span>
      </a>
    );
  // Vencido o sin vista previa: el aviso de siempre, con link si hay.
  const etiqueta = a.tipo === "imagen" ? "Foto" : a.tipo === "video" ? "Video" : a.tipo === "audio" ? "Audio" : a.titulo || "Archivo";
  return a.url ? (
    <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs italic underline opacity-90">
      <Paperclip className="h-3 w-3" /> {etiqueta}
    </a>
  ) : (
    <span className="flex items-center gap-1 text-xs italic opacity-80">
      <Paperclip className="h-3 w-3" /> {etiqueta}
    </span>
  );
}
