import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  BadgePercent,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Clapperboard,
  CreditCard,
  Film,
  Gift,
  Images,
  Lightbulb,
  Loader2,
  MessageSquareQuote,
  Package,
  PartyPopper,
  Play,
  Smartphone,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogOverlay } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import type { DriveAttachmentRef, Project } from "@/integrations/firebase/types";
import { useRedes } from "@/contexts/redes-data-context";
import { callApi } from "@/lib/redes/api";
import { asset } from "@/lib/asset";
import { formatearFecha } from "@/lib/fecha";
import { formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { extraPorPlataforma, planDe, PLATAFORMAS_EXTRA, textoDuracion, usoPlan, type PlataformaExtra } from "@/lib/redes/planes";
import { quienFilma, soloPauta } from "@/lib/redes/etapas";
import type { Video } from "@/lib/redes/types";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { SubirMaterial } from "@/components/redes/cliente/SubirMaterial";
import { cn } from "@/lib/utils";

const TIPOS: { label: string; titulo: string; icon: ElementType; placeholder: string }[] = [
  { label: "Promo", titulo: "Promo", icon: BadgePercent, placeholder: "Qué producto, qué precio o descuento, hasta cuándo…" },
  { label: "Producto nuevo", titulo: "Producto nuevo", icon: Package, placeholder: "Cuál es y qué lo hace especial…" },
  { label: "Detrás de escena", titulo: "Detrás de escena", icon: Camera, placeholder: "Qué parte de cómo trabajan querés mostrar…" },
  { label: "Testimonio", titulo: "Testimonio de clientes", icon: MessageSquareQuote, placeholder: "Quién cuenta su experiencia, qué querés que se escuche…" },
  { label: "Evento", titulo: "Evento", icon: PartyPopper, placeholder: "Qué evento, cuándo y dónde…" },
  { label: "Fecha especial", titulo: "Fecha especial", icon: Gift, placeholder: "Cuál (por ejemplo Día de la Madre) y qué querés decir…" },
  { label: "Otro", titulo: "", icon: Lightbulb, placeholder: "Qué querés que se vea, qué decir, alguna idea que te guste…" },
];

/** Frases que se suman a la idea con un toque. */
const EJEMPLOS = ["Que se vea el producto de cerca", "Que hable alguien del equipo", "Con el precio en pantalla", "Música alegre"];
const OBJETIVOS = ["Que me escriban", "Que vengan al local", "Que me conozcan más", "Vender algo puntual"];
/** Igual que api/_lib/pedidos.ts (preferenciaRodaje). */
const PREFERENCIAS = ["Mañanas", "Tardes", "Fines de semana"];
/** El editado se le muestra al cliente recién cuando le llega para aprobar (igual que en MaterialCliente). */
const EDITADO_VISIBLE: Video["etapa"][] = ["revision_cliente", "para_publicar", "publicado"];
/** Igual que MAX_ARCHIVOS_BASE en api/_lib/pedidos.ts. */
const MAX_ARCHIVOS = 30;

type Material = "existente" | "nueva" | "cliente";
type Cuando = "asap" | "semana" | "fecha";
type Paso = "que" | "idea" | "material" | "cuando";

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Date del calendario (medianoche local del día elegido) → "YYYY-MM-DD". */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const esMedia = (a: DriveAttachmentRef) => a.mime_type.startsWith("image/") || a.mime_type.startsWith("video/");
const miniatura = (id: string) => (id.startsWith("demo/") ? asset(id) : `https://drive.google.com/thumbnail?id=${id}&sz=w320`);

/** Lleva el campo a la vista cuando aparece el teclado (iPhone y Android). */
const alFoco = (e: React.FocusEvent<HTMLElement>) => {
  const el = e.currentTarget;
  setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
};

interface GrupoMaterial {
  id: string;
  titulo: string;
  mes: string;
  archivos: DriveAttachmentRef[];
}

/**
 * El cliente pide un video, en 3 o 4 pasos cortos (qué, la idea, con qué material, para cuándo). En el celular es a
 * pantalla completa con la barra de botones abajo (sigue arriba del teclado); en la compu, una ventana.
 * Si entra en su plan del mes se crea al toque; si se pasa, se le cotiza el video extra y lo paga con Mercado Pago.
 */
export function PedirVideoDialog({ open, onOpenChange, cliente }: { open: boolean; onOpenChange: (v: boolean) => void; cliente: Project }) {
  const { planes, videos } = useRedes();
  const [paso, setPaso] = useState<Paso>("que");
  const [atras, setAtras] = useState(false);
  const [tipo, setTipo] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [idea, setIdea] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [material, setMaterial] = useState<Material | null>(null);
  const [archivos, setArchivos] = useState<string[]>([]);
  const [eligiendo, setEligiendo] = useState(false);
  const [preferencia, setPreferencia] = useState<string | null>(null);
  const [cuando, setCuando] = useState<Cuando | null>(null);
  const [fecha, setFecha] = useState<string | null>(null);
  const [mesFinal, setMesFinal] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Si es extra: para dónde es (el precio cambia entre Instagram/Facebook, TikTok y YouTube).
  const [plataforma, setPlataforma] = useState<PlataformaExtra>("meta");
  const [listo, setListo] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const tituloRef = useRef<HTMLInputElement>(null);
  const cuerpoRef = useRef<HTMLDivElement>(null);
  const abrirVideo = useOpenVideo();
  const filma = quienFilma(cliente);

  // Material que ya tiene cargado: crudo de sus videos y lo editado que ya le llegó.
  const grupos = useMemo<GrupoMaterial[]>(() => {
    const vistos = new Set<string>();
    // Lo más nuevo primero (un archivo repetido queda en el video más reciente).
    return videos
      .filter((v) => v.proyecto_id === cliente.id)
      .sort((a, b) => b.mes.localeCompare(a.mes) || (b.created_at ?? "").localeCompare(a.created_at ?? ""))
      .map((v) => ({
        id: v.id,
        titulo: v.titulo,
        mes: v.mes,
        archivos: [...(v.attachments_crudo ?? []), ...(EDITADO_VISIBLE.includes(v.etapa) ? (v.attachments_finalizado ?? []) : [])].filter((a) => {
          if (!esMedia(a) || vistos.has(a.drive_file_id)) return false;
          vistos.add(a.drive_file_id);
          return true;
        }),
      }))
      .filter((g) => g.archivos.length > 0);
  }, [videos, cliente.id]);

  // Opciones de material: "lo mando yo" está siempre (a veces filman ellos aunque lo normal sea que filmemos
  // nosotros); si en la ficha filma siempre él, no hay "filmación nueva".
  const opciones = useMemo<Material[]>(
    () => [
      ...(grupos.length && !soloPauta(cliente) ? (["existente"] as const) : []),
      ...(filma !== "cliente" ? (["nueva"] as const) : []),
      "cliente" as const,
    ],
    [grupos.length, filma, cliente]
  );
  // Con una sola opción, el paso de material no se muestra.
  const pasos: Paso[] = opciones.length > 1 ? ["que", "idea", "material", "cuando"] : ["que", "idea", "cuando"];
  const i = pasos.indexOf(paso);
  const materialFinal: Material = opciones.length > 1 ? (material ?? opciones[0]) : opciones[0];
  const filmaCliente = materialFinal === "cliente";

  useEffect(() => {
    if (!open) return;
    setPaso("que");
    setAtras(false);
    setTipo(null);
    setTitulo("");
    setIdea("");
    setObjetivo("");
    setMaterial(null);
    setArchivos([]);
    setEligiendo(false);
    setPreferencia(null);
    setCuando(null);
    setFecha(null);
    setMesFinal(null);
    setAviso(null);
    setListo(false);
    setVideoId(null);
  }, [open]);

  // Cada paso arranca arriba.
  useEffect(() => {
    cuerpoRef.current?.scrollTo({ top: 0 });
  }, [paso, eligiendo, listo]);

  // iPhone: cuando aparece el teclado, el campo enfocado vuelve a la vista.
  useEffect(() => {
    if (!open) return;
    const f = () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && cuerpoRef.current?.contains(el)) setTimeout(() => el.scrollIntoView({ block: "center" }), 50);
    };
    window.addEventListener("teclado-ios", f);
    return () => window.removeEventListener("teclado-ios", f);
  }, [open]);

  const plan = planDe(cliente, planes);
  const precioExtra = plan.precioExtra[plataforma];
  const hoy = hoyISO();
  const limite = new Date(`${sumarMeses(hoy, 3)}T12:00:00`);
  // "Esta semana": hasta el domingo.
  const domingo = useMemo(() => {
    const d = new Date(`${hoy}T12:00:00`);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    return iso(d);
  }, [hoy]);
  const fechaElegida = cuando === "semana" ? domingo : cuando === "fecha" ? fecha : null;
  // El mes sale de la fecha elegida; "cuanto antes" va al mes actual.
  const mes = fechaElegida ? fechaElegida.slice(0, 7) : mesActual();
  const siguiente = sumarMeses(mes, 1);
  const uso = useMemo(() => usoPlan(cliente, planes, videos, mes), [cliente, planes, videos, mes]);
  const usoSiguiente = useMemo(() => usoPlan(cliente, planes, videos, siguiente), [cliente, planes, videos, siguiente]);
  const entra = uso.disponibles > 0;
  const nombreMes = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();
  const fechaTexto = (f: string) => formatearFecha(f, { weekday: "long", day: "numeric", month: "long" });
  const tipoInfo = TIPOS.find((t) => t.label === tipo);

  const ir = useCallback((p: Paso, haciaAtras = false) => {
    setAviso(null);
    setAtras(haciaAtras);
    setPaso(p);
  }, []);

  const validar = (): string | null => {
    if (paso === "que" && !tipo) return "Elegí una opción.";
    if (paso === "idea" && titulo.trim().length < 3) return tipo === "Otro" ? "Escribí en una frase qué querés mostrar." : "Ponele un nombre al video.";
    if (paso === "material" && !material) return "Elegí con qué material lo hacemos.";
    if (paso === "material" && material === "existente" && !archivos.length) return "Elegí al menos un archivo.";
    if (paso === "cuando" && (!cuando || (cuando === "fecha" && !fecha))) return cuando === "fecha" ? "Elegí un día en el calendario." : "Elegí para cuándo.";
    return null;
  };

  const siguientePaso = () => {
    const err = validar();
    if (err) {
      setAviso(err);
      if (paso === "idea") tituloRef.current?.focus();
      return;
    }
    ir(pasos[i + 1]);
  };

  const volver = () => {
    if (eligiendo) {
      setEligiendo(false);
      if (!archivos.length && material === "existente") setMaterial(null);
      return;
    }
    if (i === 0) onOpenChange(false);
    else ir(pasos[i - 1], true);
  };

  const elegirTipo = (t: (typeof TIPOS)[number]) => {
    // Si ya había escrito un nombre propio, no se lo pisamos.
    const propio = titulo.trim() && !TIPOS.some((x) => x.titulo === titulo);
    setTipo(t.label);
    if (!propio) setTitulo(t.titulo);
    setAviso(null);
    // Una decisión por pantalla: al elegir, pasa sola a la idea.
    setTimeout(() => {
      setAtras(false);
      setPaso("idea");
      if (t.label === "Otro" && !propio) setTimeout(() => tituloRef.current?.focus(), 350);
    }, 180);
  };

  const elegirMaterial = (m: Material) => {
    setMaterial(m);
    setAviso(null);
    if (m === "existente") setEligiendo(true);
    else if (m === "cliente") setTimeout(() => ir("cuando"), 180);
  };

  const sumarEjemplo = (e: string) => setIdea((x) => (x.trim() ? `${x.trim()}\n${e}` : e));

  const alternar = (id: string) => {
    setAviso(null);
    setArchivos((xs) => {
      if (xs.includes(id)) return xs.filter((x) => x !== id);
      if (xs.length >= MAX_ARCHIVOS) {
        setAviso(`Podés elegir hasta ${MAX_ARCHIVOS} archivos.`);
        return xs;
      }
      return [...xs, id];
    });
  };

  const pedir = async (m: string) => {
    setEnviando(true);
    try {
      const r = await callApi<{ estado: "creado" | "pago"; init_point?: string; video_id?: string }>("/api/pagos/pedir-video", {
        proyecto_id: cliente.id,
        mes: m,
        fecha_deseada: m === mes ? fechaElegida : null,
        titulo,
        idea,
        objetivo,
        plataforma,
        // El servidor lo decide con la ficha del cliente (y valida que los archivos sean suyos).
        filma_cliente: filmaCliente,
        material: {
          tipo: materialFinal,
          ...(materialFinal === "existente" ? { archivos } : {}),
          ...(materialFinal === "nueva" && preferencia ? { preferencia } : {}),
        },
      });
      setMesFinal(m);
      setVideoId(r.video_id ?? null);
      if (r.estado === "pago" && r.init_point) {
        onOpenChange(false);
        window.location.href = r.init_point;
        return;
      }
      setListo(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo enviar el pedido");
    } finally {
      setEnviando(false);
    }
  };

  const videoCreado = videoId ? videos.find((v) => v.id === videoId) : undefined;
  const nombresMaterial: Record<Material, string> = {
    existente: `Con material ya cargado (${archivos.length} archivo${archivos.length === 1 ? "" : "s"})`,
    nueva: `Lo filmamos nosotros${preferencia ? ` · ${preferencia.toLowerCase()}` : ""}`,
    cliente: "Lo filmás vos y nos mandás el material",
  };
  const titulos: Record<Paso, string> = {
    que: "¿Qué querés comunicar?",
    idea: "Contanos la idea",
    material: eligiendo ? "Elegí el material" : "¿Con qué material?",
    cuando: "¿Para cuándo?",
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
          className={cn(
            // Celular: pantalla completa (con el teclado del iPhone sigue a la parte visible, ver .pantalla-celular en index.css).
            "pantalla-celular fixed inset-0 z-50 flex flex-col overflow-hidden bg-background outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-8 duration-300",
            // Compu: ventana centrada.
            "sm:m-auto sm:h-[min(46rem,92dvh)] sm:w-full sm:max-w-lg sm:rounded-2xl sm:border sm:shadow-2xl sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:zoom-out-95"
          )}
        >
          {/* Encabezado fijo: cerrar, título y progreso. */}
          <div className="shrink-0 border-b px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-4">
            <div className="flex items-center gap-3">
              <DialogPrimitive.Title className="flex flex-1 items-center gap-2 text-base font-semibold">
                <Clapperboard className="h-5 w-5 text-primary" /> Pedir un video
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                className="-mr-1.5 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>
            {!listo && (
              <div className="mt-2.5 flex items-center gap-1.5" aria-label={`Paso ${i + 1} de ${pasos.length}`}>
                {pasos.map((p, n) => (
                  <span
                    key={p}
                    className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", n <= i ? "bg-primary" : "bg-muted")}
                  />
                ))}
                <span className="ml-1.5 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}/{pasos.length}
                </span>
              </div>
            )}
          </div>

          {/* Cuerpo: lo único que scrollea. */}
          <div ref={cuerpoRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
            {listo ? (
              <Listo
                titulo={titulo}
                mes={nombreMes(mesFinal ?? mes)}
                material={materialFinal}
                video={videoCreado}
                onAbrir={
                  videoId
                    ? () => {
                        onOpenChange(false);
                        abrirVideo(videoId);
                      }
                    : undefined
                }
              />
            ) : (
              <div
                key={`${paso}-${eligiendo}`}
                className={cn(
                  "space-y-5 animate-in fade-in duration-300 motion-reduce:animate-none",
                  atras ? "slide-in-from-left-6" : "slide-in-from-right-6"
                )}
              >
                <h2 className="text-2xl font-bold leading-tight tracking-tight">{titulos[paso]}</h2>

                {paso === "que" && (
                  <div className="grid grid-cols-2 gap-2.5">
                    {TIPOS.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => elegirTipo(t)}
                        className={cn(
                          "flex min-h-[5.5rem] flex-col items-start justify-between gap-2 rounded-2xl border-2 p-3.5 text-left transition-all active:scale-[0.97]",
                          tipo === t.label ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50",
                          t.label === "Otro" && "col-span-2 min-h-0 flex-row items-center justify-start"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-xl",
                            tipo === t.label ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                          )}
                        >
                          <t.icon className="h-5 w-5" />
                        </span>
                        <span className="text-[15px] font-semibold leading-tight">{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {paso === "idea" && (
                  <>
                    <div className="space-y-1.5">
                      <label htmlFor="pv-titulo" className="text-sm font-medium text-muted-foreground">
                        {tipo === "Otro" ? "¿Qué querés mostrar?" : "Nombre del video"}
                      </label>
                      <Input
                        id="pv-titulo"
                        ref={tituloRef}
                        value={titulo}
                        onFocus={alFoco}
                        onChange={(e) => {
                          setTitulo(e.target.value);
                          if (aviso) setAviso(null);
                        }}
                        maxLength={120}
                        enterKeyHint="next"
                        className="h-12 text-base"
                        placeholder={tipo === "Otro" ? "Ej: Inauguración del local nuevo" : "Ej: Promo del Día del Padre"}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="pv-idea" className="text-sm font-medium text-muted-foreground">
                        La idea <span className="font-normal">(opcional)</span>
                      </label>
                      <Textarea
                        id="pv-idea"
                        rows={4}
                        value={idea}
                        onFocus={alFoco}
                        onChange={(e) => setIdea(e.target.value)}
                        maxLength={2000}
                        className="text-base"
                        placeholder={tipoInfo?.placeholder ?? "Qué querés que se vea, qué decir…"}
                      />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {EJEMPLOS.filter((e) => !idea.includes(e)).map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => sumarEjemplo(e)}
                            className="rounded-full border border-dashed px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                          >
                            + {e}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium text-muted-foreground">
                        ¿Para qué? <span className="font-normal">(opcional)</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {OBJETIVOS.map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => setObjetivo(objetivo === o ? "" : o)}
                            className={cn(
                              "rounded-full border px-3 py-2 text-sm transition-colors",
                              objetivo === o ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50"
                            )}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {paso === "material" && !eligiendo && (
                  <div className="space-y-2.5">
                    {opciones.map((o) => {
                      const info = {
                        existente: { icon: Images, titulo: "Con material que ya está cargado", texto: archivos.length && material === "existente" ? `${archivos.length} archivo${archivos.length === 1 ? "" : "s"} elegido${archivos.length === 1 ? "" : "s"} · tocá para cambiar` : "Elegís fotos y videos que ya tenemos" },
                        nueva: { icon: Clapperboard, titulo: "Filmación nueva", texto: "Vamos y lo filmamos nosotros" },
                        cliente: soloPauta(cliente)
                          ? { icon: Smartphone, titulo: "Mando el video terminado", texto: "Lo subís acá y nosotros lo publicamos y pautamos" }
                          : { icon: Smartphone, titulo: "Yo mando el material", texto: "Lo filmaste vos (o lo vas a filmar) y lo subís acá" },
                      }[o];
                      const sel = material === o;
                      return (
                        <div key={o} className={cn("rounded-2xl border-2 transition-colors", sel ? "border-primary bg-primary/[0.07]" : "border-border bg-card")}>
                          <button
                            type="button"
                            onClick={() => elegirMaterial(o)}
                            className="flex w-full items-center gap-3.5 p-4 text-left active:scale-[0.99]"
                          >
                            <span
                              className={cn(
                                "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                                sel ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                              )}
                            >
                              <info.icon className="h-6 w-6" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-base font-semibold leading-tight">{info.titulo}</span>
                              <span className="mt-0.5 block text-sm text-muted-foreground">{info.texto}</span>
                            </span>
                            <span
                              className={cn(
                                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                                sel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                              )}
                            >
                              {sel && <Check className="h-3.5 w-3.5" />}
                            </span>
                          </button>
                          {o === "nueva" && sel && (
                            <div className="space-y-1.5 px-4 pb-4 animate-in fade-in">
                              <p className="text-xs font-medium text-muted-foreground">¿Cuándo te queda mejor? (opcional)</p>
                              <div className="flex flex-wrap gap-1.5">
                                {PREFERENCIAS.map((p) => (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPreferencia(preferencia === p ? null : p)}
                                    className={cn(
                                      "rounded-full border px-3 py-2 text-sm transition-colors",
                                      preferencia === p ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50"
                                    )}
                                  >
                                    {p}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {paso === "material" && eligiendo && (
                  <ElegirMaterial grupos={grupos} elegidos={archivos} onAlternar={alternar} />
                )}

                {paso === "cuando" && (
                  <>
                    <div className="grid gap-2.5">
                      {(
                        [
                          { v: "asap", icon: Zap, titulo: "Cuanto antes", texto: `Sin fecha fija, en ${nombreMes(mesActual())}` },
                          { v: "semana", icon: CalendarDays, titulo: "Esta semana", texto: `Hasta el ${fechaTexto(domingo)}` },
                          { v: "fecha", icon: CalendarDays, titulo: "Elegir fecha", texto: cuando === "fecha" && fecha ? cap(fechaTexto(fecha)) : "Para un día puntual" },
                        ] as { v: Cuando; icon: ElementType; titulo: string; texto: string }[]
                      ).map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => {
                            setCuando(o.v);
                            setAviso(null);
                          }}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors active:scale-[0.99]",
                            cuando === o.v ? "border-primary bg-primary/[0.07]" : "border-border bg-card hover:border-primary/50"
                          )}
                        >
                          <o.icon className={cn("h-5 w-5 shrink-0", cuando === o.v ? "text-primary" : "text-muted-foreground")} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold leading-tight">{o.titulo}</span>
                            <span className="block text-sm text-muted-foreground">{o.texto}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                    {cuando === "fecha" && (
                      <div className="flex justify-center rounded-2xl border animate-in fade-in">
                        <Calendar
                          mode="single"
                          locale={es}
                          weekStartsOn={1}
                          selected={fecha ? new Date(`${fecha}T12:00:00`) : undefined}
                          onSelect={(d) => {
                            if (!d) return;
                            setFecha(iso(d));
                            setAviso(null);
                          }}
                          fromDate={new Date(`${hoy}T12:00:00`)}
                          toDate={limite}
                          defaultMonth={fecha ? new Date(`${fecha}T12:00:00`) : undefined}
                        />
                      </div>
                    )}

                    {cuando && (cuando !== "fecha" || fecha) && (
                      <div className="space-y-3 animate-in fade-in">
                        <div className="space-y-2 rounded-2xl border bg-muted/30 p-4">
                          <p className="flex items-center gap-2 font-semibold">
                            {tipoInfo && <tipoInfo.icon className="h-4 w-4 shrink-0 text-primary" />}
                            <span className="min-w-0 break-words">{titulo}</span>
                          </p>
                          {idea && <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">{idea}</p>}
                          <ul className="space-y-1 text-sm">
                            <li className="flex items-center gap-2">
                              <Film className="h-4 w-4 shrink-0 text-muted-foreground" /> {nombresMaterial[materialFinal]}
                            </li>
                            <li className="flex items-center gap-2">
                              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {fechaElegida ? `Para el ${fechaTexto(fechaElegida)}` : `Cuanto antes (${nombreMes(mes)})`}
                              {objetivo ? ` · ${objetivo}` : ""}
                            </li>
                          </ul>
                        </div>
                        {entra ? (
                          <div className="flex items-start gap-3 rounded-2xl border border-success/40 bg-success/[0.08] p-4">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                            <div>
                              <p className="font-semibold">Entra en tu plan, sin costo</p>
                              <p className="text-sm text-muted-foreground">
                                Te quedan {uso.disponibles} de {uso.cupo} videos de {nombreMes(mes)}.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3 rounded-2xl border border-primary/40 bg-primary/[0.06] p-4">
                            <div className="flex items-start gap-3">
                              <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                              <div>
                                <p className="font-semibold">Este video es extra: {formatARS(precioExtra)}{plan.duracionExtra[plataforma] ? ` · ${textoDuracion(plan.duracionExtra[plataforma])}` : ""}</p>
                                <p className="text-sm text-muted-foreground">
                                  Ya usaste los {uso.cupo} videos de {nombreMes(mes)}. Lo pagás con Mercado Pago.
                                </p>
                              </div>
                            </div>
                            {extraPorPlataforma(plan) && (
                              <div className="space-y-1.5">
                                <p className="text-xs font-medium">¿Para dónde es?</p>
                                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                  {PLATAFORMAS_EXTRA.map((p) => (
                                    <button
                                      key={p.v}
                                      type="button"
                                      onClick={() => setPlataforma(p.v)}
                                      className={cn(
                                        "rounded-xl border px-2 py-2 text-center text-xs transition-colors",
                                        plataforma === p.v ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card hover:border-primary/50"
                                      )}
                                    >
                                      <span className="block">{p.label}</span>
                                      <span className="block tabular-nums text-muted-foreground">{formatARS(plan.precioExtra[p.v])}</span>
                                      {plan.duracionExtra[p.v] ? <span className="block text-[10px] text-muted-foreground">{textoDuracion(plan.duracionExtra[p.v])}</span> : null}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {cuando === "asap" && usoSiguiente.disponibles > 0 && (
                              <button
                                type="button"
                                onClick={() => pedir(siguiente)}
                                disabled={enviando}
                                className="w-full rounded-xl border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-primary"
                              >
                                ¿Puede esperar? <span className="font-semibold text-primary">Dejalo para {nombreMes(siguiente)}</span> y entra en
                                tu plan sin costo.
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Barra de botones fija abajo (arriba del teclado y de la barra de inicio del iPhone). */}
          <div className="shrink-0 border-t bg-background px-4 pt-3 pb-[max(0.75rem,var(--abajo-seguro))] sm:pb-4">
            {aviso && <p className="mb-2 text-sm font-medium text-destructive animate-in fade-in">{aviso}</p>}
            {listo ? (
              <Button className="h-12 w-full text-base" variant={filmaCliente ? "outline" : "default"} onClick={() => onOpenChange(false)}>
                {filmaCliente ? "Más tarde" : "Listo"}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {(i > 0 || eligiendo) && (
                  <Button variant="ghost" className="h-12 px-4 text-base" onClick={volver} disabled={enviando}>
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
                  </Button>
                )}
                {eligiendo ? (
                  <Button
                    className="h-12 flex-1 text-base"
                    onClick={() => {
                      if (!archivos.length) {
                        setAviso("Elegí al menos un archivo.");
                        return;
                      }
                      setEligiendo(false);
                      ir("cuando");
                    }}
                  >
                    {archivos.length ? `Usar ${archivos.length} archivo${archivos.length === 1 ? "" : "s"}` : "Elegí archivos"}
                  </Button>
                ) : paso !== "cuando" ? (
                  <Button className="h-12 flex-1 text-base" onClick={siguientePaso}>
                    Siguiente
                  </Button>
                ) : (
                  <Button
                    className="h-12 flex-1 text-base"
                    onClick={() => {
                      const err = validar();
                      if (err) setAviso(err);
                      else void pedir(mes);
                    }}
                    disabled={enviando || (!!cuando && !entra && !(precioExtra > 0))}
                  >
                    {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {!cuando || entra ? "Pedir video" : `Pagar ${formatARS(precioExtra)}`}
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Grilla de miniaturas del material cargado, agrupada por video, con selección múltiple. */
function ElegirMaterial({
  grupos,
  elegidos,
  onAlternar,
}: {
  grupos: GrupoMaterial[];
  elegidos: string[];
  onAlternar: (id: string) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="-mt-3 text-sm text-muted-foreground">Tocá las fotos y videos que querés usar.</p>
      {grupos.map((g) => (
        <section key={g.id} className="space-y-2">
          <p className="truncate text-sm font-semibold">
            {g.titulo} <span className="font-normal text-muted-foreground">· {mesLabel(g.mes)}</span>
          </p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {g.archivos.map((a) => {
              const n = elegidos.indexOf(a.drive_file_id);
              return (
                <button
                  key={a.drive_file_id}
                  type="button"
                  onClick={() => onAlternar(a.drive_file_id)}
                  aria-pressed={n >= 0}
                  aria-label={a.name}
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-xl bg-muted ring-offset-2 ring-offset-background transition-all active:scale-95",
                    n >= 0 && "ring-[3px] ring-primary"
                  )}
                >
                  <Miniatura archivo={a} />
                  {a.mime_type.startsWith("video/") && (
                    <span className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                      <Play className="h-3 w-3 fill-current" />
                    </span>
                  )}
                  <span
                    className={cn(
                      "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold",
                      n >= 0 ? "border-primary bg-primary text-primary-foreground" : "border-white/90 bg-black/25"
                    )}
                  >
                    {n >= 0 ? n + 1 : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Miniatura({ archivo }: { archivo: DriveAttachmentRef }) {
  const [error, setError] = useState(false);
  if (error) {
    const Icono = archivo.mime_type.startsWith("video/") ? Film : Images;
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1.5 text-muted-foreground">
        <Icono className="h-5 w-5" />
        <span className="line-clamp-2 break-all text-[10px] leading-tight">{archivo.name}</span>
      </span>
    );
  }
  return (
    <img
      src={miniatura(archivo.drive_file_id)}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setError(true)}
      className="h-full w-full object-cover"
    />
  );
}

/** Pedido enviado. Si lo filma el cliente, puede subir el material ahí mismo. */
function Listo({
  titulo,
  mes,
  material,
  video,
  onAbrir,
}: {
  titulo: string;
  mes: string;
  material: Material;
  video?: Video;
  onAbrir?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 pt-4 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success animate-in zoom-in-50 duration-500">
        <CheckCircle2 className="h-9 w-9" />
      </span>
      <p className="text-2xl font-bold">¡Pedido enviado!</p>
      <p className="max-w-xs text-muted-foreground">
        {material === "existente"
          ? `“${titulo}” ya está en tus videos de ${mes} y pasa directo a edición. Te avisamos cuando esté para ver.`
          : material === "cliente"
            ? `“${titulo}” ya está en tus videos de ${mes}. Subí lo que filmes y tocá “Listo, ya subí todo”.`
            : `“${titulo}” ya está en tus videos de ${mes}. El equipo te escribe para coordinar la filmación.`}
      </p>
      {material === "cliente" &&
        (video ? (
          <div className="mt-2 w-full text-left">
            <SubirMaterial video={video} />
          </div>
        ) : (
          onAbrir && (
            <Button className="mt-2 h-12 w-full text-base" onClick={onAbrir}>
              <Upload className="mr-2 h-4 w-4" /> Subir material ahora
            </Button>
          )
        ))}
    </div>
  );
}
