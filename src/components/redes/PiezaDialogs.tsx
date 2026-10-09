import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CreditCard,
  Download,
  FolderOpen,
  ImageOff,
  Loader2,
  Megaphone,
  Monitor,
  Pencil,
  Printer,
  ShoppingBag,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import { callApi } from "@/lib/redes/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useRedes } from "@/contexts/redes-data-context";
import {
  ENFOQUES,
  ESTADO_PIEZA_CLIENTE,
  ESTADO_PIEZA_LABEL,
  FORMATOS,
  aprobarPieza,
  cupoPiezas,
  formatoInfo,
  iconoFormato,
  iniciarPago,
  pedirCambiosPieza,
  pedirPieza,
  precioDe,
  versionEnviada,
  versionFinal,
  type FormatoInfo,
} from "@/lib/redes/piezas";
import { formatARS, fechaCorta, hoyISO, mesActual } from "@/lib/redes/format";
import type { EnfoquePieza, FormatoPieza, PiezaIA, VersionPieza } from "@/lib/redes/types";
import type { Project } from "@/integrations/firebase/types";
import { asset } from "@/lib/asset";

// Los ids "demo/…" son imágenes locales de la demo navegable.
export function driveThumb(fileId: string, size = 800) {
  if (fileId.startsWith("demo/")) return asset(fileId);
  if (fileId.startsWith("data:")) return fileId;
  if (fileId.startsWith("blob:")) return fileId.slice(5);
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${size}`;
}
export function driveDownload(fileId: string) {
  if (fileId.startsWith("demo/")) return asset(fileId);
  if (fileId.startsWith("blob:")) return fileId.slice(5);
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export function VersionImg({ v, className }: { v: Pick<VersionPieza, "drive_file_id" | "name"> & { thumbnail_link?: string }; className?: string }) {
  const src = v.drive_file_id.startsWith("blob:") && v.thumbnail_link ? v.thumbnail_link : driveThumb(v.drive_file_id);
  return <img src={src} alt={v.name} referrerPolicy="no-referrer" loading="lazy" className={cn("h-full w-full bg-muted object-contain", className)} />;
}

const ESTADO_TONE: Record<PiezaIA["estado"], string> = {
  pendiente_pago: "bg-warning/15 text-warning border-warning/30",
  pagada: "bg-sky-500/12 text-sky-600 dark:text-sky-300 border-sky-500/25",
  en_proceso: "bg-primary/12 text-primary border-primary/30",
  para_aprobar: "bg-orange-500/12 text-orange-600 dark:text-orange-300 border-orange-500/30",
  entregada: "bg-success/12 text-success border-success/30",
  rechazada: "bg-destructive/10 text-destructive border-destructive/30",
  cancelada: "bg-muted text-muted-foreground border-border",
};

export function EstadoPiezaBadge({ estado, vista = "cliente" }: { estado: PiezaIA["estado"]; vista?: "cliente" | "equipo" }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", ESTADO_TONE[estado])}>
      {vista === "cliente" ? ESTADO_PIEZA_CLIENTE[estado] : ESTADO_PIEZA_LABEL[estado]}
    </span>
  );
}

export function EnfoqueBadge({ enfoque }: { enfoque?: EnfoquePieza }) {
  if (!enfoque) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        enfoque === "comercial" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
      )}
    >
      {enfoque === "comercial" ? <ShoppingBag className="h-3 w-3" /> : <Megaphone className="h-3 w-3" />}
      {ENFOQUES[enfoque].label}
    </span>
  );
}

/** Dibujito del formato con un ejemplo adentro (título, foto y botón). */
function MiniFormato({ f, activo }: { f: FormatoInfo; activo: boolean }) {
  const { width, height } = iconoFormato(f.ratio, 56);
  const apaisado = width > height;
  return (
    <span
      className={cn(
        "relative flex shrink-0 overflow-hidden rounded-md border-2 bg-background p-1 transition-colors",
        apaisado ? "flex-row gap-1" : "flex-col gap-0.5",
        activo ? "border-primary" : "border-muted-foreground/40"
      )}
      style={{ width, height }}
      aria-hidden
    >
      <span className={cn("rounded-sm", activo ? "bg-primary/30" : "bg-muted-foreground/20", apaisado ? "h-full w-2/5" : "h-1/2 w-full")} />
      <span className={cn("flex flex-1 flex-col justify-center gap-0.5", apaisado && "py-0.5")}>
        <span className={cn("h-1 w-4/5 rounded-full", activo ? "bg-primary" : "bg-muted-foreground/50")} />
        <span className="h-0.5 w-3/5 rounded-full bg-muted-foreground/30" />
        <span className={cn("mt-0.5 h-1 w-2/5 rounded-full", activo ? "bg-emerald-500" : "bg-muted-foreground/40")} />
      </span>
    </span>
  );
}

/** Tarjeta de pieza para el cliente. */
export function PiezaClienteCard({ pieza, onAbrir }: { pieza: PiezaIA; onAbrir?: () => void }) {
  const [paying, setPaying] = useState(false);
  const final = versionFinal(pieza);
  const enviada = versionEnviada(pieza);
  const imagen = pieza.estado === "entregada" ? final : pieza.estado === "para_aprobar" ? enviada : null;
  const sinImagen = pieza.estado === "entregada" && !imagen;
  // Del sistema anterior: muchas tienen el link a la carpeta de Drive con el diseño en vez del archivo.
  const carpetaDrive = sinImagen ? (pieza._viejo?.material_finalizado ?? "").match(/https?:\/\/drive\.google\.com\/\S+/)?.[0] ?? null : null;
  const pagar = async () => {
    setPaying(true);
    try {
      const { init_point } = await iniciarPago({ tipo: "pieza_ia", pieza_id: pieza.id });
      window.location.href = init_point;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar el pago");
      setPaying(false);
    }
  };
  const teToca = pieza.estado === "para_aprobar";
  const info = formatoInfo(pieza.formato);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card transition-all",
        teToca && "border-orange-500/60 shadow-md shadow-orange-500/10 ring-1 ring-orange-500/40"
      )}
    >
      <button type="button" onClick={onAbrir} disabled={!onAbrir || !imagen} className="relative block aspect-square w-full bg-muted">
        {imagen ? (
          <VersionImg v={imagen} />
        ) : sinImagen ? (
          // Lista pero sin archivo: casi siempre del sistema anterior (no se subió la imagen al sistema).
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
            <ImageOff className="h-8 w-8 opacity-50" />
            <p className="text-xs">{carpetaDrive ? "La imagen está en Drive" : "Sin imagen en el sistema"}</p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 text-primary/60" />
            <p className="text-xs">
              {pieza.estado === "pendiente_pago"
                ? "Falta el pago para empezar"
                : pieza.estado === "rechazada"
                  ? pieza.incluida
                    ? "No la pudimos hacer (no se descuenta de tu plan)"
                    : "No la pudimos hacer: te devolvimos el pago"
                  : (pieza.rondas ?? 0) > 0
                    ? "Estamos haciendo los cambios que pediste"
                    : "La estamos diseñando"}
            </p>
          </div>
        )}
        {teToca && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Te toca
          </span>
        )}
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <EstadoPiezaBadge estado={pieza.estado} />
          <span className="text-[11px] text-muted-foreground">{fechaCorta(pieza.created_at)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {info.label}
          {pieza.incluida ? " · del plan" : ""}
        </p>
        <p className="line-clamp-2 text-sm">{pieza.producto || pieza.pedido}</p>
        {pieza.estado === "pendiente_pago" && (
          <Button className="w-full" size="sm" onClick={pagar} disabled={paying}>
            {paying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Pagar {formatARS(pieza.precio)}
          </Button>
        )}
        {teToca && onAbrir && (
          <Button className="w-full bg-orange-600 hover:bg-orange-600/90" size="sm" onClick={onAbrir}>
            Ver y aprobar <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        )}
        {pieza.estado === "entregada" && final && (
          <Button asChild className="w-full" size="sm" variant="secondary">
            <a href={driveDownload(final.drive_file_id)} target="_blank" rel="noreferrer" download>
              <Download className="mr-2 h-4 w-4" /> Descargar
            </a>
          </Button>
        )}
        {carpetaDrive && (
          <Button asChild className="w-full" size="sm" variant="secondary">
            <a href={carpetaDrive} target="_blank" rel="noreferrer">
              <FolderOpen className="mr-2 h-4 w-4" /> Abrir en Drive
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

/** El cliente mira la versión que le mandó diseño y la aprueba o pide cambios. */
export function PiezaAprobarDialog({ pieza, onClose }: { pieza: PiezaIA | null; onClose: () => void }) {
  const { user } = useUserProfileContext();
  const { clienteById } = useRedes();
  const [cambios, setCambios] = useState(false);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState<null | "ok" | "cambios">(null);
  useEffect(() => {
    setCambios(false);
    setNota("");
  }, [pieza?.id]);
  if (!pieza) return null;
  const v = pieza.estado === "entregada" ? versionFinal(pieza) : versionEnviada(pieza);
  const cliente = clienteById(pieza.proyecto_id);
  const puede = pieza.estado === "para_aprobar";

  const aprobar = async () => {
    setBusy("ok");
    try {
      await aprobarPieza(pieza, cliente, user?.uid ?? "");
      toast.success("¡Lista! Ya la podés descargar.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo aprobar");
    } finally {
      setBusy(null);
    }
  };
  const mandarCambios = async () => {
    if (nota.trim().length < 5) {
      toast.error("Contanos qué cambiarías");
      return;
    }
    setBusy("cambios");
    try {
      await pedirCambiosPieza(pieza, cliente, user?.uid ?? "", nota.trim());
      toast.success("Recibimos tus cambios. Te avisamos cuando esté.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!pieza} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>{puede ? "¿Va así?" : "Tu pieza"}</DialogTitle>
          <DialogDescription>
            {formatoInfo(pieza.formato).label} · {pieza.producto || pieza.pedido.slice(0, 80)}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-xl border bg-muted">
          {v ? <VersionImg v={v} className="max-h-[55dvh]" /> : <p className="p-8 text-center text-sm text-muted-foreground">Sin imagen</p>}
        </div>
        {puede ? (
          cambios ? (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <Label>¿Qué cambiarías?</Label>
              <Textarea autoFocus rows={3} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: el precio más grande, otro color de fondo, sacar la foto de la izquierda" />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCambios(false)}>
                  Volver
                </Button>
                <Button onClick={() => void mandarCambios()} disabled={busy === "cambios"}>
                  {busy === "cambios" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Mandar cambios
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setCambios(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Pedir cambios
              </Button>
              <Button onClick={() => void aprobar()} disabled={busy === "ok"} className="bg-emerald-600 hover:bg-emerald-600/90">
                {busy === "ok" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ThumbsUp className="mr-2 h-4 w-4" />}
                Aprobar
              </Button>
            </div>
          )
        ) : (
          v && (
            <Button asChild variant="secondary">
              <a href={driveDownload(v.drive_file_id)} target="_blank" rel="noreferrer" download>
                <Download className="mr-2 h-4 w-4" /> Descargar
              </a>
            </Button>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pedir una pieza: qué necesitás → para qué → qué dice → confirmar
// ---------------------------------------------------------------------------

const CTAS = ["Escribinos por WhatsApp", "Vení al local", "Reservá tu lugar", "Comprá online"];
const MOTIVOS: { label: string; texto: string }[] = [
  { label: "Saludo por una fecha", texto: "Saludo por (qué fecha): " },
  { label: "Horario especial", texto: "Avisar que (qué día) abrimos en el horario: " },
  { label: "Novedad del local", texto: "Contar que: " },
  { label: "Aviso importante", texto: "Avisar que: " },
];
const PASOS = ["Qué necesitás", "Para qué", "Qué dice", "Confirmar"];

const GUIA = [
  "Elegí dónde la vas a usar. Si dudás, el posteo cuadrado sirve para casi todo.",
  "¿Querés vender algo (un producto, una promo) o contar algo (un horario, un saludo, una novedad)?",
  "Contalo con tus palabras: no hace falta que esté perfecto, nuestra diseñadora lo pule.",
  "Revisá y confirmá. Te avisamos cuando esté lista para que la apruebes o pidas cambios.",
];

export function PedirPiezaDialog({
  open,
  onOpenChange,
  cliente,
  guiado = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cliente: Project | undefined;
  /** Primera vez: muestra una ayuda en cada paso. */
  guiado?: boolean;
}) {
  const { settings, planes, piezas } = useRedes();
  const [paso, setPaso] = useState(0);
  const [formato, setFormato] = useState<FormatoPieza>("cuadrado");
  const [enfoque, setEnfoque] = useState<EnfoquePieza>("comercial");
  const [producto, setProducto] = useState("");
  const [oferta, setOferta] = useState("");
  const [cta, setCta] = useState(CTAS[0]);
  const [pedido, setPedido] = useState("");
  const [texto, setTexto] = useState("");
  const [fecha, setFecha] = useState("");
  const [intentado, setIntentado] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPaso(0);
    setFormato("cuadrado");
    setEnfoque("comercial");
    setProducto("");
    setOferta("");
    setCta(CTAS[0]);
    setPedido("");
    setTexto("");
    setFecha("");
    setIntentado(false);
  }, [open]);

  const info = formatoInfo(formato);
  const cupo = cupoPiezas(cliente, planes, piezas, mesActual());
  const entra = cupo.quedan > 0;
  const precio = precioDe(settings, formato);
  const tieneLogo = !!cliente?.marca_archivos?.logo;

  const errorPaso2 =
    enfoque === "comercial"
      ? producto.trim().length < 3 && pedido.trim().length < 10
        ? "Contanos qué producto o servicio querés vender"
        : null
      : pedido.trim().length < 10
        ? "Contanos qué querés comunicar"
        : null;

  const siguiente = () => {
    if (paso === 2) {
      setIntentado(true);
      if (errorPaso2) return;
    }
    setPaso((p) => p + 1);
  };

  const go = async () => {
    if (!cliente) return;
    setSaving(true);
    try {
      const r = await pedirPieza(cliente.id, {
        formato,
        enfoque,
        pedido: pedido.trim(),
        texto_en_pieza: texto.trim() || null,
        producto: enfoque === "comercial" ? producto.trim() || null : null,
        oferta: enfoque === "comercial" ? oferta.trim() || null : null,
        cta: enfoque === "comercial" ? cta : null,
        fecha_deseada: fecha || null,
      });
      if (r.estado === "pago") {
        window.location.href = r.init_point;
        return;
      }
      toast.success("¡Listo! Ya le llegó a nuestra diseñadora. Te avisamos cuando esté para aprobar.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo pedir");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Pedir una pieza gráfica
          </DialogTitle>
          <DialogDescription>
            La diseña nuestra diseñadora y te llega para aprobar.{" "}
            {cupo.incluidas > 0
              ? entra
                ? `Te ${cupo.quedan === 1 ? "queda 1 pieza" : `quedan ${cupo.quedan} piezas`} del plan este mes.`
                : "Ya usaste las piezas del plan de este mes: esta se paga aparte."
              : "Se paga aparte con Mercado Pago."}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-1.5 text-[11px]">
          {PASOS.map((p, i) => (
            <li key={p} className="flex flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold transition-colors",
                  i < paso ? "bg-primary/60 text-primary-foreground" : i === paso ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {i < paso ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={cn("hidden truncate sm:inline", i === paso ? "font-semibold" : "text-muted-foreground")}>{p}</span>
            </li>
          ))}
        </ol>

        {guiado && (
          <div key={`g${paso}`} className="flex gap-2.5 rounded-xl border border-primary/30 bg-primary/[0.07] p-3 text-sm animate-in fade-in duration-300 motion-reduce:animate-none">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{paso + 1}</span>
            <p>{GUIA[paso]}</p>
          </div>
        )}
        <div key={paso} className="animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
          {paso === 0 && (
            <div className="space-y-4">
              {(
                [
                  { g: "redes", t: "Para redes y pantallas", icon: Monitor },
                  { g: "impresion", t: "Para imprimir", icon: Printer },
                ] as const
              ).map(({ g, t, icon: Icono }) => (
                <div key={g} className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Icono className="h-3.5 w-3.5" /> {t}
                    {g === "impresion" && settings.precio_pieza_impresion && !entra ? (
                      <span className="font-normal normal-case tracking-normal">· {formatARS(settings.precio_pieza_impresion)}</span>
                    ) : null}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {FORMATOS.filter((f) => f.grupo === g).map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setFormato(f.value)}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border p-2.5 text-left transition-all",
                          formato === f.value ? "border-primary bg-primary/[0.07] shadow-sm" : "hover:border-primary/40"
                        )}
                      >
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center">
                          <MiniFormato f={f} activo={formato === f.value} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold leading-tight">{f.label}</span>
                          <span className="block text-[11px] leading-snug text-muted-foreground">{f.ejemplo}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {paso === 1 && (
            <div className="grid gap-3">
              {(Object.keys(ENFOQUES) as EnfoquePieza[]).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEnfoque(e)}
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border p-4 text-left transition-all",
                    enfoque === e ? "border-primary bg-primary/[0.07] shadow-sm" : "hover:border-primary/40"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      e === "comercial" ? "bg-emerald-500/15 text-emerald-600" : "bg-sky-500/15 text-sky-600"
                    )}
                  >
                    {e === "comercial" ? <ShoppingBag className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}
                  </span>
                  <span>
                    <span className="block font-semibold">{ENFOQUES[e].label}</span>
                    <span className="block text-sm text-muted-foreground">{ENFOQUES[e].desc}</span>
                  </span>
                  {enfoque === e && <Check className="ml-auto h-5 w-5 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          )}

          {paso === 2 && (
            <div className="space-y-3">
              {enfoque === "comercial" ? (
                <>
                  <div className="space-y-1.5">
                    <Label>¿Qué querés vender?</Label>
                    <Input value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Ej.: combo familiar de 2 pizzas + gaseosa" maxLength={160} autoFocus />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Precio o promo (opcional)</Label>
                    <Input value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Ej.: $18.900 · 2x1 los jueves · 20% off hasta el domingo" maxLength={160} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>¿Qué querés que haga la gente?</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {CTAS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCta(c)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs transition-colors",
                            cta === c ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary hover:text-primary"
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Algo más que tengamos que saber (opcional)</Label>
                    <Textarea rows={2} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ej.: que se vea la pizza bien de cerca, es para el fin de semana largo" maxLength={2000} />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>¿Qué querés comunicar?</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {MOTIVOS.map((m) => (
                        <button
                          key={m.label}
                          type="button"
                          onClick={() => setPedido(m.texto)}
                          className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <Textarea rows={3} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Contanos con tus palabras qué tiene que decir" maxLength={2000} autoFocus />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label>Texto que tiene que aparecer, tal cual (opcional)</Label>
                <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: SÁBADO ABIERTO HASTA LAS 2 AM" maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pieza-fecha">¿Para cuándo la necesitás? (opcional)</Label>
                <Input id="pieza-fecha" type="date" min={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full sm:w-48" />
              </div>
              {intentado && errorPaso2 && <p className="text-xs text-destructive">{errorPaso2}</p>}
            </div>
          )}

          {paso === 3 && (
            <div className="space-y-3">
              <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{info.label}</span>
                  <span className="text-xs text-muted-foreground">{info.medida}</span>
                  <EnfoqueBadge enfoque={enfoque} />
                </div>
                {enfoque === "comercial" && producto && <p>{producto}{oferta ? ` · ${oferta}` : ""}</p>}
                {enfoque === "comercial" && <p className="text-xs text-muted-foreground">Llamado: {cta}</p>}
                {pedido && <p className="whitespace-pre-wrap text-muted-foreground">{pedido}</p>}
                {texto && <p className="text-xs">Texto: “{texto}”</p>}
                {fecha && <p className="text-xs">Para el {fecha.split("-").reverse().slice(0, 2).join("/")}</p>}
                <p className={cn("text-xs", tieneLogo ? "text-success" : "text-muted-foreground")}>
                  {tieneLogo ? "✓ Va con tu logo" : "Sin logo cargado: subilo en “Mi negocio”"}
                </p>
              </div>
              <div
                className={cn(
                  "rounded-xl border p-3 text-sm",
                  entra ? "border-emerald-500/40 bg-emerald-500/[0.07]" : "border-primary/30 bg-primary/[0.05]"
                )}
              >
                {entra ? (
                  <p>
                    <b>Entra en tu plan.</b> Después de esta te {cupo.quedan - 1 === 1 ? "queda 1" : `quedan ${cupo.quedan - 1}`} este mes.
                  </p>
                ) : (
                  <p>
                    <b>{formatARS(precio)}</b> con Mercado Pago. Arrancamos cuando se acredita.
                  </p>
                )}
              </div>
              <ol className="space-y-1 text-xs text-muted-foreground">
                <li>1. Nuestra diseñadora la arma con tu marca.</li>
                <li>2. Te llega para aprobar: si algo no va, pedís cambios.</li>
                <li>3. Cuando la aprobás, la descargás desde acá.</li>
              </ol>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          {paso === 0 ? (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setPaso((p) => p - 1)}>
              Atrás
            </Button>
          )}
          {paso < 3 ? (
            <Button onClick={siguiente}>Siguiente</Button>
          ) : (
            <Button onClick={() => void go()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : entra ? <Check className="mr-2 h-4 w-4" /> : <CreditCard className="mr-2 h-4 w-4" />}
              {entra ? "Pedir" : "Pagar y pedir"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * La versión en grande: se abre tocando la miniatura. La imagen se baja por el sistema (con permiso solo para
 * ese archivo), así se ve y se descarga aunque el archivo de Drive no sea público.
 */
/** Retoques rápidos con IA (Opus arma la instrucción y Gemini edita la imagen). */
const RETOQUES: { label: string; pedido: string; formato?: string }[] = [
  { label: "✨ Más luz y contraste", pedido: "Más luminosa y con más contraste, colores más vivos sin cambiar la paleta de la marca" },
  { label: "🎨 Otro fondo", pedido: "Cambiá el fondo por otro más limpio y atractivo, acorde a la marca" },
  { label: "🔠 Texto más grande", pedido: "Hacé el texto principal más grande y legible en el celular" },
  { label: "🧹 Más simple", pedido: "Simplificá la composición: menos elementos, más aire, un solo mensaje claro" },
  { label: "📱 Pasar a historia", pedido: "Adaptala a formato historia vertical", formato: "vertical" },
  { label: "⬛ Pasar a cuadrado", pedido: "Adaptala a formato posteo cuadrado", formato: "cuadrado" },
];

export function VerVersion({
  v,
  titulo,
  onClose,
  edicion,
}: {
  v: (Pick<VersionPieza, "drive_file_id" | "name"> & { mime_type?: string | null; id?: string }) | null;
  titulo?: string;
  onClose: () => void;
  /** Si viene: herramientas de IA para editar esta versión (queda como versión nueva). */
  edicion?: { piezaId: string };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pedido, setPedido] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const editar = async (instruccion: string, formato?: string, etiqueta = "Editando") => {
    if (!edicion || !v?.id || instruccion.trim().length < 3) return;
    setEditando(etiqueta);
    try {
      await callApi("/api/ia/pieza-editar", { pieza_id: edicion.piezaId, version_id: v.id, instruccion, formato: formato ?? null });
      toast.success("Listo: quedó como versión nueva");
      setPedido("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo editar");
    } finally {
      setEditando(null);
    }
  };
  useEffect(() => {
    setUrl(null);
    setError(false);
    if (!v) return;
    if (v.drive_file_id.startsWith("demo/") || v.drive_file_id.startsWith("data:") || v.drive_file_id.startsWith("blob:")) {
      setUrl(driveThumb(v.drive_file_id, 2000));
      return;
    }
    let vivo = true;
    getDriveMediaPlayUrl(v.drive_file_id)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [v]);
  const esPdf = v?.mime_type === "application/pdf";
  return (
    <Dialog open={!!v} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-4xl gap-3 overflow-y-auto p-3 sm:p-4">
        <DialogHeader className="px-1">
          <DialogTitle className="truncate text-base">{titulo ?? v?.name ?? "Pieza"}</DialogTitle>
        </DialogHeader>
        <div className={cn("fondo-transparencia flex items-center justify-center overflow-hidden rounded-xl bg-muted", edicion ? "max-h-[52vh] min-h-[30vh]" : "max-h-[75vh] min-h-[40vh]")}>
          {error ? (
            <p className="p-6 text-sm text-muted-foreground">No se pudo abrir la imagen. Probá de nuevo en un rato.</p>
          ) : !url ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : esPdf ? (
            <iframe src={url} title={v?.name} className="h-[75vh] w-full" />
          ) : (
            <img src={url} alt={v?.name} className={cn("w-auto max-w-full animate-in fade-in zoom-in-95 object-contain", edicion ? "max-h-[52vh]" : "max-h-[75vh]")} />
          )}
        </div>
        {edicion && v?.id && !esPdf && (
          <div className="space-y-2.5 rounded-xl border bg-gradient-to-br from-primary/[0.07] to-transparent p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Editar con IA
              <span className="text-xs font-normal text-muted-foreground">· queda como versión nueva, esta no se toca</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RETOQUES.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  disabled={!!editando}
                  onClick={() => void editar(r.pedido, r.formato, r.label)}
                  className="rounded-full border bg-background px-3 py-1 text-xs font-medium transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-sm disabled:opacity-50"
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Textarea
                value={pedido}
                onChange={(e) => setPedido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void editar(pedido);
                  }
                }}
                rows={1}
                placeholder="O pedí lo que quieras: «poné el logo más chico», «sacá a la chica de la izquierda», «fondo verde»…"
                className="min-h-10 resize-none bg-background text-sm"
                disabled={!!editando}
              />
              <Button onClick={() => void editar(pedido)} disabled={!!editando || pedido.trim().length < 3} className="shrink-0">
                <Sparkles className="mr-1.5 h-4 w-4" /> Aplicar
              </Button>
            </div>
            {editando && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {editando}… (≈30 s)
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <p className="self-center truncate px-1 text-xs text-muted-foreground">{v?.name}</p>
          <Button asChild disabled={!url}>
            <a href={url ?? "#"} download={v?.name ?? "pieza"} target="_blank" rel="noreferrer">
              <Download className="mr-2 h-4 w-4" /> Descargar
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
