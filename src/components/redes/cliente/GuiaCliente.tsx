import { useEffect, useState } from "react";
import { toast } from "sonner";
import { doc, updateDoc } from "@/lib/db";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  Lightbulb,
  Loader2,
  MessageCircle,
  Hand,
  Rocket,
  Sparkles,
  Store,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";
import { faltaMarca } from "@/lib/redes/proximoPaso";
import { db } from "@/integrations/firebase/client";
import type { Project } from "@/integrations/firebase/types";
import { assertEditable } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import { MarcaArchivos } from "../MarcaArchivos";

const CAMINO: { icon: LucideIcon; titulo: string; texto: string; vos?: boolean }[] = [
  { icon: Lightbulb, titulo: "Idea", texto: "Charlamos qué querés mostrar este mes y armamos las ideas.", vos: true },
  { icon: CalendarDays, titulo: "Filmación", texto: "Vamos a tu local un día y filmamos todos los videos juntos." },
  { icon: Clapperboard, titulo: "Edición", texto: "Los editamos y los revisa nuestro equipo." },
  { icon: CheckCircle2, titulo: "Tu OK", texto: "Te avisamos de cada video en la app y por mail: lo aprobás o pedís cambios.", vos: true },
  { icon: Rocket, titulo: "En redes", texto: "Lo publicamos con pauta y ves los resultados acá." },
];

const TAREAS: { icon: LucideIcon; titulo: string; texto: string }[] = [
  { icon: CheckCircle2, titulo: "Aprobar los videos", texto: "Te avisamos en la app y por mail. Un toque y listo." },
  { icon: MessageCircle, titulo: "Contarnos tus ideas", texto: "Promos, productos, novedades: escribinos por el chat." },
  { icon: TrendingUp, titulo: "Mirar los resultados", texto: "Cuánta gente vio tus videos y cuántos mensajes te llegaron." },
];

/**
 * Bienvenida para el cliente: aparece la primera vez. El logo y los datos de la marca son
 * obligatorios: mientras falten, no se puede cerrar. Después se vuelve a abrir con "¿Cómo funciona?".
 */
export function GuiaCliente({
  open,
  onOpenChange,
  cliente,
  nombre,
  uid,
  obligatorio = false,
  pasoInicial = 0,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cliente: Project;
  nombre: string;
  uid?: string;
  /** Falta la marca: no se puede cerrar hasta completarla. */
  obligatorio?: boolean;
  pasoInicial?: number;
}) {
  const [paso, setPaso] = useState(pasoInicial);
  const total = 4;
  const m = cliente.marca ?? {};
  const [rubro, setRubro] = useState(m.rubro ?? "");
  const [descripcion, setDescripcion] = useState(m.descripcion ?? m.notas ?? "");
  const [publico, setPublico] = useState(m.publico ?? "");
  const [colores, setColores] = useState(m.colores ?? "");
  const [instagram, setInstagram] = useState(cliente.redes?.instagram ?? "");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPaso(pasoInicial);
      setAviso(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const falta = faltaMarca(cliente);
  const infoOk = rubro.trim().length >= 3 && descripcion.trim().length >= 10;
  const infoCambio =
    rubro !== (m.rubro ?? "") ||
    descripcion !== (m.descripcion ?? m.notas ?? "") ||
    publico !== (m.publico ?? "") ||
    colores !== (m.colores ?? "") ||
    instagram !== (cliente.redes?.instagram ?? "");

  const terminar = async () => {
    // El logo se pide pero no frena: si no lo tiene a mano (o no se puede subir), lo sube después desde "Mi negocio".
    if (!infoOk) {
      setAviso("Completá a qué se dedica tu negocio y qué lo hace distinto.");
      return;
    }
    if (infoCambio || falta.info) {
      setGuardando(true);
      try {
        await callApi("/api/ia/marca-info", { proyecto_id: cliente.id, rubro, descripcion, publico, colores, instagram });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo guardar");
        setGuardando(false);
        return;
      }
      setGuardando(false);
    }
    cerrar(false, true);
  };

  const cerrar = (o: boolean, completo = false) => {
    if (o) return onOpenChange(true);
    // Sin marca no se puede cerrar: lo llevamos al paso de la marca.
    if (obligatorio && !completo) {
      setPaso(3);
      setAviso("Para empezar necesitamos unos datos de tu marca.");
      return;
    }
    onOpenChange(false);
    setPaso(0);
    if (!uid) return;
    try {
      assertEditable();
      void updateDoc(doc(db, "profiles", uid), { guia_cliente_at: new Date().toISOString() }).catch(() => undefined);
    } catch {
      /* en "ver como" no se guarda */
    }
  };

  const PASOS = [
    { icon: Sparkles, etiqueta: "Bienvenida" },
    { icon: Clapperboard, etiqueta: "Cómo funciona" },
    { icon: Hand, etiqueta: "Lo tuyo" },
    { icon: Store, etiqueta: "Tu marca" },
  ];
  const IconoPaso = PASOS[paso].icon;
  const titulo =
    paso === 0 ? `¡Hola${nombre ? `, ${nombre}` : ""}! 👋` : paso === 1 ? "Así nace cada video" : paso === 2 ? "Lo único que tenés que hacer" : "Tu marca";

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent
        className={cn(
          "flex max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-2xl sm:max-h-[94dvh]",
          // La cruz de cerrar, sobre la cabecera de color.
          "[&>button.absolute]:right-4 [&>button.absolute]:top-4 [&>button.absolute]:z-20 [&>button.absolute]:rounded-full [&>button.absolute]:bg-black/20 [&>button.absolute]:p-1.5 [&>button.absolute]:text-white [&>button.absolute]:opacity-100 [&>button.absolute]:backdrop-blur",
          obligatorio && "[&>button.absolute]:hidden"
        )}
        onPointerDownOutside={(e) => obligatorio && e.preventDefault()}
        onEscapeKeyDown={(e) => obligatorio && e.preventDefault()}
      >
        {/* Cabecera con degradé: en qué paso está y cuántos faltan. */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-primary via-violet-600 to-fuchsia-500 px-5 pb-5 pt-5 text-white sm:px-6">
          <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-16 left-6 h-32 w-32 rounded-full bg-fuchsia-300/25 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-1.5 pr-10">
            {PASOS.map((p, i) => (
              <span key={p.etiqueta} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                <span className={cn("block h-full rounded-full bg-white transition-all duration-500", i <= paso ? "w-full" : "w-0")} />
              </span>
            ))}
          </div>
          <div className="relative mt-4 flex items-center gap-3">
            <span
              key={paso}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/20 shadow-inner ring-1 ring-white/30 backdrop-blur animate-in zoom-in-50 duration-300"
            >
              <IconoPaso className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">
                Paso {paso + 1} de {total} · {PASOS[paso].etiqueta}
              </p>
              <DialogTitle className="text-xl font-bold leading-tight text-white sm:text-2xl">{titulo}</DialogTitle>
            </div>
          </div>
        </div>

        {/* Contenido con scroll propio: la cabecera y los botones quedan fijos. */}
        <div key={paso} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 animate-in fade-in slide-in-from-right-4 duration-300 sm:px-6">
          {paso === 0 && (
            <div className="space-y-5">
              <DialogDescription className="text-base leading-relaxed text-foreground/80">
                Este es tu espacio en Prodi. Desde acá seguís tus videos de principio a fin, sin perderte nada. Te mostramos cómo funciona en un
                minuto.
              </DialogDescription>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: Clapperboard, t: "Tus videos" },
                  { icon: CheckCircle2, t: "Los aprobás" },
                  { icon: TrendingUp, t: "Resultados" },
                ].map((x) => (
                  <div key={x.t} className="flex flex-col items-center gap-2 rounded-2xl border bg-muted/40 px-2 py-3.5 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25">
                      <x.icon className="h-5 w-5" />
                    </span>
                    <span className="text-xs font-semibold">{x.t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {paso === 1 && (
            <div className="space-y-4">
              <DialogDescription className="text-sm">
                Son 5 pasos. <b className="text-foreground">Vos solo participás en dos</b>: los que dicen “Te toca”.
              </DialogDescription>
              {/* Línea de tiempo: los pasos del cliente, resaltados. */}
              <ol className="relative">
                {CAMINO.map((c, i) => (
                  <li key={c.titulo} className="relative flex gap-3.5 pb-3 last:pb-0">
                    {i < CAMINO.length - 1 && (
                      <span className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-0.5 rounded-full bg-gradient-to-b from-primary/40 to-border" aria-hidden />
                    )}
                    <span
                      className={cn(
                        "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                        c.vos ? "bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/30" : "border-2 border-border bg-card text-muted-foreground"
                      )}
                    >
                      <c.icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className={cn("min-w-0 flex-1 rounded-2xl px-3.5 py-2.5", c.vos && "bg-primary/[0.08] ring-1 ring-primary/25")}>
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        <span className="text-muted-foreground">{i + 1}.</span> {c.titulo}
                        {c.vos && (
                          <span className="rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                            Te toca
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.texto}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {paso === 2 && (
            <div className="space-y-4">
              <DialogDescription className="text-sm">Del resto nos encargamos nosotros.</DialogDescription>
              <div className="space-y-2.5">
                {TAREAS.map((t, i) => (
                  <div key={t.titulo} className="flex items-center gap-3.5 rounded-2xl border bg-card p-3.5 transition-colors hover:border-primary/40">
                    <span
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-md",
                        [
                          "bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/25",
                          "bg-gradient-to-br from-sky-400 to-blue-600 shadow-sky-500/25",
                          "bg-gradient-to-br from-primary to-fuchsia-500 shadow-primary/25",
                        ][i % 3]
                      )}
                    >
                      <t.icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{t.titulo}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{t.texto}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="flex items-start gap-2.5 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.05] p-3.5 text-xs leading-relaxed text-muted-foreground">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                Arriba de todo vas a ver siempre un cartel con tu próximo paso. Si no dice nada para hacer, es que está todo en marcha.
              </p>
            </div>
          )}

          {paso === 3 && (
            <div className="space-y-4">
              <DialogDescription className="text-sm">
                Con esto armamos tus videos, los textos y las piezas gráficas con tu identidad. Con contarnos de tu negocio ya arrancamos.
              </DialogDescription>
              <div className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label>
                    ¿A qué se dedica tu negocio? <span className="text-destructive">*</span>
                  </Label>
                  <Input className="h-11 rounded-xl" value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Ej: pizzería y delivery" />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    ¿Qué lo hace distinto? <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    rows={2}
                    className="rounded-xl"
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    placeholder="Ej: masa madre de 48 horas, horno a leña, abrimos hasta las 2 AM"
                  />
                </div>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>¿A quién le vendés?</Label>
                    <Input className="h-11 rounded-xl" value={publico} onChange={(e) => setPublico(e.target.value)} placeholder="Ej: familias y jóvenes" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Instagram</Label>
                    <Input className="h-11 rounded-xl" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tumarca" />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 rounded-2xl border bg-muted/30 p-3.5">
                <Label>
                  Logo y colores de tu marca
                  <span className="ml-1 font-normal text-muted-foreground">(si no los tenés a mano, después)</span>
                </Label>
                <MarcaArchivos cliente={cliente} />
              </div>
            </div>
          )}

          {aviso && <p className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive animate-in fade-in">{aviso}</p>}
        </div>

        {/* Botones fijos abajo. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-background/80 px-5 py-3.5 backdrop-blur sm:px-6">
          {paso === 0 ? (
            obligatorio ? (
              <span />
            ) : (
              <Button variant="ghost" className="rounded-full" onClick={() => cerrar(false)}>
                Ahora no
              </Button>
            )
          ) : (
            <Button variant="ghost" className="rounded-full" onClick={() => setPaso((p) => p - 1)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
            </Button>
          )}
          {paso < total - 1 ? (
            <Button
              className="group h-11 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-6 font-semibold shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/35"
              onClick={() => setPaso((p) => p + 1)}
            >
              {paso === 0 ? "Empezar" : "Siguiente"} <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          ) : (
            <Button
              className="h-11 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-5 font-semibold shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/35"
              onClick={() => void terminar()}
              disabled={guardando}
            >
              {guardando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {falta.logo ? "Listo, el logo después" : "Listo, ir a mi panel"} {!guardando && <CheckCircle2 className="ml-1.5 h-4 w-4" />}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
