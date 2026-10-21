import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Eye, Moon, Sun, FileText, Image as ImageIcon, Loader2, MessageCircle, Mic, MicOff, Paperclip, Phone, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";
import { leer, type Archivo } from "@/lib/redes/adjuntosIA";
import { crearPresupuesto, guardarPresupuesto, linkPresupuesto, usePresupuestos, type Presupuesto } from "@/lib/redes/presupuestos";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { cn } from "@/lib/utils";
import { preciosFaltantes, type Propuesta } from "../../../api/_lib/propuesta";
import { PropuestaVista } from "./PropuestaVista";
import { destrabarAudio, LlamadaIA } from "./LlamadaIA";

// Presupuesto en formato propuesta comercial (como los PDF de Prodi), en pantalla completa: a la izquierda la charla
// con la IA (escribiendo, dictando, en llamada o pasándole capturas, PDF y el chat de WhatsApp) y a la derecha la
// vista previa, que se edita tocando cualquier texto. Los precios los pone Lucas (api/_lib/presupuesto-ia.ts).

export interface DatosPropuesta {
  empresa: string;
  contacto: { nombre?: string | null; telefono?: string | null; email?: string | null };
  validez: string;
  propuesta: Propuesta;
}

interface Mensaje {
  rol: "yo" | "ia";
  texto: string;
  adjuntos?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Reconocimiento = (): any => (typeof window === "undefined" ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

const SALUDO: Mensaje = {
  rol: "ia",
  texto:
    "Contame qué te pidió el cliente y qué le querés ofrecer (si son varias opciones, las armo por separado). Podés escribirme, dictarme, llamarme o pasarme capturas, un PDF o el chat de WhatsApp. Los precios los ponés vos.",
};

export function PropuestaEditor({ id: idInicial, inicial, onClose }: { id: string | null; inicial: DatosPropuesta; onClose: () => void }) {
  const { user } = useUserProfileContext();
  const lista = usePresupuestos(true);
  const [id, setId] = useState(idInicial);
  const [d, setD] = useState<DatosPropuesta>(inicial);
  const [cambios, setCambios] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([SALUDO]);
  const mensajesRef = useRef(mensajes);
  mensajesRef.current = mensajes;
  const dRef = useRef(d);
  dRef.current = d;
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  // El chat de WhatsApp queda para toda la charla (las capturas y PDF van solo con el mensaje que las lleva).
  const [chats, setChats] = useState<string[]>([]);
  const [leyendo, setLeyendo] = useState<string | null>(null);
  const [llamada, setLlamada] = useState(false);
  const [dictando, setDictando] = useState(false);
  const rec = useRef<{ stop: () => void } | null>(null);
  const [vista, setVista] = useState<"charla" | "vista">("charla");
  const fin = useRef<HTMLDivElement>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const actual = id ? lista?.find((x) => x.id === id) : undefined;

  const cambiar = (c: Partial<DatosPropuesta>) => {
    setD((x) => ({ ...x, ...c }));
    setCambios(true);
  };

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [mensajes.length, pensando]);

  // No perder lo armado al cerrar la pestaña.
  useEffect(() => {
    if (!cambios) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [cambios]);

  const sumarArchivos = async (files: File[]) => {
    if (!files.length) return;
    setLeyendo("Leyendo…");
    try {
      const listos = (
        await Promise.all(files.map((f) => leer(f, (n, total) => setLeyendo(`Escuchando los audios (${n} de ${total})…`)).catch((e) => (toast.error(e instanceof Error ? e.message : "No se pudo leer"), []))))
      ).flat();
      setArchivos((prev) => [...prev, ...listos].slice(0, 10));
    } finally {
      setLeyendo(null);
    }
  };

  /** Manda un mensaje a la IA; devuelve su respuesta (null si falló). `voz`: viene de la llamada. */
  const enviar = async (pedido?: string, voz = false): Promise<string | null> => {
    const t = (pedido ?? texto).trim();
    const adj = voz ? [] : archivos;
    if ((!t && !adj.length) || (pensando && !voz)) return null;
    const nuevosChats = [...chats, ...adj.filter((a) => a.tipo === "chat").map((a) => `--- ${a.nombre} ---\n${a.texto ?? ""}`)];
    const mio: Mensaje = { rol: "yo", texto: t || "Te paso esto.", adjuntos: adj.map((a) => a.nombre) };
    const nuevos = [...mensajesRef.current, mio];
    mensajesRef.current = nuevos;
    setMensajes(nuevos);
    if (!voz) {
      setTexto("");
      setArchivos([]);
    }
    setChats(nuevosChats);
    setPensando(true);
    try {
      const actualD = dRef.current;
      const r = await callApi<{ respuesta: string; propuesta: Propuesta; empresa: string; contacto: { nombre: string; telefono: string } }>("/api/ia/presupuesto-ia", {
        mensajes: nuevos.filter((m) => m !== SALUDO).map((m) => ({ rol: m.rol, texto: m.adjuntos?.length ? `${m.texto} [adjuntó: ${m.adjuntos.join(", ")}]` : m.texto })),
        propuesta: actualD.propuesta,
        empresa: actualD.empresa,
        contacto: actualD.contacto,
        chat: nuevosChats.join("\n\n").slice(-40000),
        adjuntos: adj.filter((a) => a.data).map((a) => ({ data: a.data, mime: a.mime })),
        ...(voz ? { voz: true } : {}),
      });
      setD((x) => ({
        ...x,
        propuesta: r.propuesta,
        empresa: x.empresa || r.empresa || r.propuesta.titulo,
        contacto: { ...x.contacto, nombre: x.contacto.nombre || r.contacto.nombre || null, telefono: x.contacto.telefono || r.contacto.telefono || null },
      }));
      setCambios(true);
      setMensajes((prev) => [...prev, { rol: "ia", texto: r.respuesta }]);
      return r.respuesta;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no respondió");
      setMensajes((prev) => prev.filter((m) => m !== mio));
      if (!voz) {
        setTexto(t);
        setArchivos(adj);
      }
      return null;
    } finally {
      setPensando(false);
    }
  };

  const dictar = () => {
    if (dictando) return rec.current?.stop();
    const R = Reconocimiento();
    if (!R) return toast.error("Este navegador no deja dictar. Probá con Chrome o usá la llamada.");
    const r = new R();
    r.lang = "es-AR";
    r.continuous = true;
    r.interimResults = false;
    const base = texto ? `${texto.trim()} ` : "";
    let dicho = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) dicho += `${e.results[i][0].transcript} `;
      setTexto(base + dicho.trim());
    };
    r.onend = () => setDictando(false);
    r.onerror = () => setDictando(false);
    rec.current = r;
    r.start();
    setDictando(true);
  };

  const guardar = async (): Promise<string | null> => {
    const empresa = (d.empresa || d.propuesta.titulo).trim();
    if (!empresa) {
      toast.error("Poné el nombre del cliente arriba");
      return null;
    }
    setGuardando(true);
    try {
      const datos = { empresa, contacto: d.contacto, validez: d.validez, propuesta: d.propuesta, plan_id: null, items: [], moneda: "ARS" as const, tipo: "factura" as const, nota: "" };
      let nuevoId = id;
      if (id) await guardarPresupuesto(id, datos);
      else {
        const numero = Math.max(0, ...(lista ?? []).map((x) => x.numero ?? 0)) + 1;
        nuevoId = await crearPresupuesto({ ...datos, created_by: user?.uid ?? "" }, numero);
        setId(nuevoId);
      }
      setCambios(false);
      toast.success("Presupuesto guardado");
      return nuevoId;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
      return null;
    } finally {
      setGuardando(false);
    }
  };

  const cerrar = () => {
    if (cambios && !window.confirm("Tenés cambios sin guardar. ¿Salir igual?")) return;
    rec.current?.stop();
    onClose();
  };

  const verComoCliente = async () => {
    if (cambios && !(await guardar())) return;
    const p = id ? lista?.find((x) => x.id === id) : undefined;
    if (p) window.open(linkPresupuesto(p as Presupuesto), "_blank");
    else toast.message("Guardalo primero y después lo ves como el cliente");
  };

  const faltan = preciosFaltantes(d.propuesta);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Barra de arriba: cliente y guardar */}
      <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2 sm:px-4">
        <Button size="icon" variant="ghost" className="shrink-0 rounded-full" onClick={cerrar} aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25 sm:flex">
          <FileText className="h-4 w-4" />
        </span>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:grid-cols-4">
          <Input value={d.empresa} onChange={(e) => cambiar({ empresa: e.target.value })} placeholder="Cliente (empresa)" className="h-9" aria-label="Cliente" />
          <Input value={d.contacto.nombre ?? ""} onChange={(e) => cambiar({ contacto: { ...d.contacto, nombre: e.target.value } })} placeholder="Contacto" className="h-9" aria-label="Contacto" />
          <Input value={d.contacto.telefono ?? ""} onChange={(e) => cambiar({ contacto: { ...d.contacto, telefono: e.target.value } })} placeholder="WhatsApp" className="h-9" aria-label="WhatsApp" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">Vale hasta</span>
            <Input type="date" value={d.validez} onChange={(e) => cambiar({ validez: e.target.value })} className="h-9" />
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {faltan > 0 && (
            <span className="hidden items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 lg:flex">
              <AlertTriangle className="h-3.5 w-3.5" /> Faltan {faltan} precio{faltan === 1 ? "" : "s"}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => cambiar({ propuesta: { ...d.propuesta, tema: d.propuesta.tema === "claro" ? "oscuro" : "claro" } })}
            title="Cambiar el fondo del presupuesto"
          >
            {d.propuesta.tema === "claro" ? <Sun className="mr-1.5 h-3.5 w-3.5" /> : <Moon className="mr-1.5 h-3.5 w-3.5" />}
            Fondo {d.propuesta.tema === "claro" ? "blanco" : "oscuro"}
          </Button>
          {actual && (
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => void verComoCliente()}>
              <Eye className="mr-1.5 h-3.5 w-3.5" /> Como el cliente
            </Button>
          )}
          <Button size="sm" onClick={() => void guardar()} disabled={guardando || (!cambios && !!id)} className="rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-5 font-semibold shadow-md shadow-primary/25">
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {cambios || !id ? "Guardar" : "Guardado"}
          </Button>
        </div>
      </header>

      {/* En el celu: pestañas */}
      <div className="flex border-b lg:hidden">
        {(["charla", "vista"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVista(v)}
            className={cn("flex-1 py-2 text-sm font-semibold transition-colors", vista === v ? "border-b-2 border-primary text-primary" : "text-muted-foreground")}
          >
            {v === "charla" ? "Charla con la IA" : `Vista previa${faltan ? ` · ${faltan} sin precio` : ""}`}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Charla */}
        <aside className={cn("min-h-0 w-full flex-col border-r bg-card lg:flex lg:w-[400px] lg:shrink-0", vista === "charla" ? "flex" : "hidden")}>
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="flex-1 text-sm font-semibold">Armalo charlando</p>
            {!llamada && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-full"
                onClick={() => {
                  destrabarAudio();
                  setLlamada(true);
                }}
              >
                <Phone className="mr-1.5 h-3.5 w-3.5" /> Llamar
              </Button>
            )}
          </div>

          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void sumarArchivos(Array.from(e.dataTransfer.files));
            }}
          >
            {mensajes.map((m, i) => (
              <div key={i} className={cn("flex", m.rol === "yo" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                    m.rol === "yo" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted"
                  )}
                >
                  {m.texto}
                  {!!m.adjuntos?.length && <p className="mt-1 text-[11px] opacity-80">📎 {m.adjuntos.join(" · ")}</p>}
                </div>
              </div>
            ))}
            {pensando && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Armando la propuesta…
              </div>
            )}
            <div ref={fin} />
          </div>

          {llamada ? (
            <div className="border-t p-2">
              <LlamadaIA titulo="Presupuesto" onDecir={(t) => enviar(t, true)} onCortar={() => setLlamada(false)} />
            </div>
          ) : (
            <div className="border-t p-2">
              {(archivos.length > 0 || leyendo) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {archivos.map((a) => (
                    <span key={a.id} className="flex max-w-full items-center gap-1.5 rounded-full border bg-muted/60 py-0.5 pl-1 pr-2 text-[11px]">
                      {a.vista ? (
                        <img src={a.vista} alt="" className="h-5 w-5 rounded-full object-cover" />
                      ) : a.tipo === "chat" ? (
                        <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
                      ) : a.tipo === "imagen" ? (
                        <ImageIcon className="h-3.5 w-3.5" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-red-500" />
                      )}
                      <span className="truncate">{a.nombre}</span>
                      <button type="button" onClick={() => setArchivos((l) => l.filter((x) => x.id !== a.id))} aria-label="Quitar" className="text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {leyendo && (
                    <span className="flex items-center gap-1 text-[11px] text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" /> {leyendo}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-end gap-1.5">
                <input
                  ref={inputArchivo}
                  type="file"
                  multiple
                  hidden
                  accept="image/*,application/pdf,.txt,.zip,audio/*,.opus"
                  onChange={(e) => {
                    void sumarArchivos(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => inputArchivo.current?.click()} aria-label="Adjuntar" title="Capturas, PDF o el chat de WhatsApp (.zip con archivos)">
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length) {
                      e.preventDefault();
                      void sumarArchivos(files);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void enviar();
                    }
                  }}
                  rows={1}
                  placeholder={dictando ? "Te escucho…" : "Ej.: le ofrezco una campaña de 6 videos y aparte la administración de redes"}
                  className="max-h-40 min-h-[2.5rem] resize-none text-sm"
                />
                <Button
                  size="icon"
                  variant={dictando ? "destructive" : "ghost"}
                  className={cn("h-9 w-9 shrink-0", dictando && "animate-pulse")}
                  onClick={dictar}
                  aria-label={dictando ? "Terminar de dictar" : "Dictar"}
                >
                  {dictando ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
                <Button size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={() => void enviar()} disabled={pensando || !!leyendo || (!texto.trim() && !archivos.length)} aria-label="Enviar">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </aside>

        {/* Vista previa editable */}
        <main className={cn("min-h-0 flex-1 overflow-y-auto bg-muted/40 p-3 sm:p-6 lg:block", vista === "vista" ? "block" : "hidden")}>
          <p className="mx-auto mb-2 max-w-[820px] text-center text-xs text-muted-foreground">Así lo ve el cliente. Tocá cualquier texto para cambiarlo; los precios los ponés vos.</p>
          <PropuestaVista p={d.propuesta} validez={d.validez} onCambiar={(propuesta) => cambiar({ propuesta })} className="mx-auto max-w-[820px] rounded-2xl shadow-2xl" />
        </main>
      </div>
    </div>
  );
}
