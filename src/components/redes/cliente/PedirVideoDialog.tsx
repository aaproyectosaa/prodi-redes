import { useEffect, useMemo, useRef, useState } from "react";
import { es } from "date-fns/locale";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clapperboard, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import type { Project } from "@/integrations/firebase/types";
import { useRedes } from "@/contexts/redes-data-context";
import { callApi } from "@/lib/redes/api";
import { formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { planDe, usoPlan } from "@/lib/redes/planes";
import { cn } from "@/lib/utils";

const IDEAS = [
  { label: "Promo", titulo: "Promo", idea: "Queremos mostrar una promo: (qué producto, qué precio o descuento, hasta cuándo)" },
  { label: "Producto nuevo", titulo: "Producto nuevo", idea: "Presentar un producto nuevo: (cuál es y qué lo hace especial)" },
  { label: "Detrás de escena", titulo: "Detrás de escena", idea: "Mostrar cómo trabajamos: (qué parte del proceso)" },
  { label: "Testimonios", titulo: "Testimonios de clientes", idea: "Clientes contando su experiencia" },
  { label: "Evento", titulo: "Evento", idea: "Anunciar un evento: (qué, cuándo y dónde)" },
  { label: "Fecha especial", titulo: "Fecha especial", idea: "Saludo o promo por una fecha especial: (cuál, por ejemplo Día de la Madre)" },
  { label: "Otros", titulo: "", idea: "" },
];

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Date → "YYYY-MM-DD" en hora local. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const OBJETIVOS = ["Que me escriban", "Que vengan al local", "Que me conozcan más", "Vender un producto puntual"];

/**
 * El cliente pide un video. Si entra en su plan del mes se crea al toque;
 * si se pasa, se le cotiza el video extra y lo paga con Mercado Pago.
 */
export function PedirVideoDialog({ open, onOpenChange, cliente }: { open: boolean; onOpenChange: (v: boolean) => void; cliente: Project }) {
  const { planes, videos } = useRedes();
  const [paso, setPaso] = useState(0);
  const [tipo, setTipo] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [idea, setIdea] = useState("");
  const [objetivo, setObjetivo] = useState("");
  /** Fecha elegida en el calendario, o "sin_fecha" (cuando puedan), o null (todavía no eligió). */
  const [fecha, setFecha] = useState<string | null>(null);
  const [mesFinal, setMesFinal] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const tituloRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPaso(0);
    setTipo(null);
    setTitulo("");
    setIdea("");
    setObjetivo("");
    setFecha(null);
    setMesFinal(null);
    setAviso(null);
    setListo(false);
  }, [open]);

  const plan = planDe(cliente, planes);
  const hoy = hoyISO();
  const limite = new Date();
  limite.setMonth(limite.getMonth() + 3);
  // El mes sale de la fecha elegida; "cuando puedan" va al mes actual.
  const mes = fecha && fecha !== "sin_fecha" ? fecha.slice(0, 7) : mesActual();
  const siguiente = sumarMeses(mes, 1);
  const uso = useMemo(() => usoPlan(cliente, planes, videos, mes), [cliente, planes, videos, mes]);
  const usoSiguiente = useMemo(() => usoPlan(cliente, planes, videos, siguiente), [cliente, planes, videos, siguiente]);
  const entra = uso.disponibles > 0;
  const nombreMes = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();
  const fechaTexto = (f: string) =>
    new Date(`${f}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

  const siguientePaso = () => {
    if (paso === 0 && titulo.trim().length < 3) {
      setAviso(tipo === "Otros" ? "Escribí en una frase qué querés mostrar." : "Elegí una opción o escribí de qué se trata el video.");
      tituloRef.current?.focus();
      return;
    }
    if (paso === 1 && !fecha) {
      setAviso("Elegí un día en el calendario, o tocá “Cuando puedan”.");
      return;
    }
    setAviso(null);
    setPaso((p) => p + 1);
  };

  const pedir = async (m: string) => {
    setEnviando(true);
    try {
      const r = await callApi<{ estado: "creado" | "pago"; init_point?: string }>("/api/pagos/pedir-video", {
        proyecto_id: cliente.id,
        mes: m,
        fecha_deseada: fecha && fecha !== "sin_fecha" ? fecha : null,
        titulo,
        idea,
        objetivo,
      });
      setMesFinal(m);
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

  const pasos = ["Qué", "Para cuándo", "Confirmar"];
  const elegirIdea = (i: (typeof IDEAS)[number]) => {
    setTipo(i.label);
    setTitulo(i.titulo);
    setIdea(i.idea);
    setAviso(null);
    // "Otros": el cursor va directo al nombre para que lo escriba.
    if (i.label === "Otros") setTimeout(() => tituloRef.current?.focus(), 50);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-2xl">
        {listo ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success animate-in zoom-in-50 duration-500">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <DialogTitle className="text-xl">¡Pedido enviado!</DialogTitle>
            <DialogDescription className="max-w-xs">
              “{titulo}” ya está en tus videos de {nombreMes(mesFinal ?? mes)}. El equipo te escribe para coordinar la filmación.
            </DialogDescription>
            <Button className="mt-2" onClick={() => onOpenChange(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Clapperboard className="h-5 w-5 text-primary" /> Pedir un video
              </DialogTitle>
              <DialogDescription>Contanos qué querés mostrar y lo sumamos a tus videos.</DialogDescription>
            </div>

            <ol className="flex items-center gap-2 text-[11px]">
              {pasos.map((p, i) => (
                <li key={p} className="flex flex-1 items-center gap-1.5">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold transition-colors duration-300",
                      i <= paso ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className={cn("truncate", i === paso ? "font-semibold" : "text-muted-foreground")}>{p}</span>
                </li>
              ))}
            </ol>

            <div key={paso} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300 motion-reduce:animate-none">
              {paso === 0 && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {IDEAS.map((i) => (
                      <button
                        key={i.label}
                        type="button"
                        onClick={() => elegirIdea(i)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary",
                          tipo === i.label && "border-primary bg-primary text-primary-foreground hover:text-primary-foreground"
                        )}
                      >
                        {i.label}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <Label>{tipo === "Otros" ? "¿Qué querés mostrar?" : "Ponele un nombre"}</Label>
                    <Input
                      ref={tituloRef}
                      value={titulo}
                      onChange={(e) => {
                        setTitulo(e.target.value);
                        if (aviso) setAviso(null);
                      }}
                      placeholder={tipo === "Otros" ? "Ej: Inauguración del local nuevo" : "Ej: Promo del Día del Padre"}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contanos más (opcional)</Label>
                    <Textarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Qué querés que se vea, qué decir, alguna idea que te guste…" />
                  </div>
                </>
              )}

              {paso === 1 && (
                <>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4 text-primary" /> ¿Para cuándo lo necesitás publicado?
                    </Label>
                    <div className="flex justify-center rounded-xl border">
                      <Calendar
                        mode="single"
                        locale={es}
                        weekStartsOn={1}
                        selected={fecha && fecha !== "sin_fecha" ? new Date(`${fecha}T12:00:00`) : undefined}
                        onSelect={(d) => {
                          if (!d) return;
                          setFecha(iso(d));
                          setAviso(null);
                        }}
                        fromDate={new Date(`${hoy}T12:00:00`)}
                        toDate={limite}
                        defaultMonth={fecha && fecha !== "sin_fecha" ? new Date(`${fecha}T12:00:00`) : undefined}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFecha("sin_fecha");
                        setAviso(null);
                      }}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2.5 text-sm transition-colors",
                        fecha === "sin_fecha" ? "border-primary bg-primary/10 font-medium text-primary" : "hover:border-primary/50"
                      )}
                    >
                      No tengo fecha: cuando puedan
                    </button>
                    {fecha && (
                      <p className={cn("text-xs animate-in fade-in", entra ? "text-success" : "text-muted-foreground")}>
                        {fecha !== "sin_fecha" && `${cap(fechaTexto(fecha))}. `}
                        {entra
                          ? `En ${nombreMes(mes)} te quedan ${uso.disponibles} video${uso.disponibles === 1 ? "" : "s"} en tu plan.`
                          : `En ${nombreMes(mes)} tu plan ya está completo: va como video extra (${formatARS(plan.precioVideoExtra)}).`}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>¿Qué querés lograr? (opcional)</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {OBJETIVOS.map((o) => (
                        <button
                          key={o}
                          type="button"
                          onClick={() => setObjetivo(objetivo === o ? "" : o)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs transition-all",
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

              {paso === 2 && (
                <>
                  <div className="space-y-1 rounded-xl border bg-muted/30 p-3 text-sm">
                    <p className="font-semibold">{titulo}</p>
                    {idea && <p className="text-xs text-muted-foreground">{idea}</p>}
                    <p className="text-xs text-muted-foreground">
                      {fecha && fecha !== "sin_fecha" ? `Para el ${fechaTexto(fecha)}` : `Sin fecha fija (${nombreMes(mes)})`}
                      {objetivo ? ` · ${objetivo}` : ""}
                    </p>
                  </div>
                  {entra ? (
                    <div className="flex items-start gap-3 rounded-xl border border-success/40 bg-success/[0.08] p-4">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                      <div>
                        <p className="font-semibold">Entra en tu plan, sin costo</p>
                        <p className="text-xs text-muted-foreground">
                          Te quedan {uso.disponibles} de {uso.cupo} videos en {nombreMes(mes)}.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/[0.06] p-4">
                      <div className="flex items-start gap-3">
                        <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                        <div>
                          <p className="font-semibold">Video extra: {formatARS(plan.precioVideoExtra)}</p>
                          <p className="text-xs text-muted-foreground">
                            Ya usaste los {uso.cupo} videos de tu plan en {nombreMes(mes)}. Lo pagás con Mercado Pago y lo
                            sumamos a {nombreMes(mes)}.
                          </p>
                        </div>
                      </div>
                      {fecha === "sin_fecha" && usoSiguiente.disponibles > 0 && (
                        <button
                          type="button"
                          onClick={() => pedir(siguiente)}
                          disabled={enviando}
                          className="w-full rounded-lg border bg-card px-3 py-2 text-left text-xs transition-colors hover:border-primary"
                        >
                          ¿No es urgente? <span className="font-semibold text-primary">Dejalo para {nombreMes(siguiente)}</span> y entra
                          en tu plan sin costo.
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {aviso && <p className="text-sm font-medium text-destructive animate-in fade-in">{aviso}</p>}

            <div className="flex items-center justify-between gap-2">
              {paso === 0 ? (
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAviso(null);
                    setPaso((p) => p - 1);
                  }}
                  disabled={enviando}
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
                </Button>
              )}
              {paso < 2 ? (
                <Button onClick={siguientePaso}>
                  Siguiente <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => pedir(mes)} disabled={enviando || (!entra && !(plan.precioVideoExtra > 0))}>
                  {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {entra ? "Pedir video" : `Pagar ${formatARS(plan.precioVideoExtra)}`}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
