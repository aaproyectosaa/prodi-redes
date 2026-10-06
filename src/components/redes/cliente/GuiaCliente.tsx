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
  Rocket,
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
  { icon: CheckCircle2, titulo: "Tu OK", texto: "Te llega cada video por WhatsApp: lo aprobás o pedís cambios.", vos: true },
  { icon: Rocket, titulo: "En redes", texto: "Lo publicamos con pauta y ves los resultados acá." },
];

const TAREAS: { icon: LucideIcon; titulo: string; texto: string }[] = [
  { icon: CheckCircle2, titulo: "Aprobar los videos", texto: "Te avisamos por WhatsApp. Un toque y listo." },
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
    if (!infoOk || falta.logo) {
      setAviso(
        falta.logo && !infoOk
          ? "Falta tu logo y contarnos de tu negocio."
          : falta.logo
            ? "Falta subir tu logo."
            : "Completá a qué se dedica tu negocio y qué lo hace distinto."
      );
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
      setAviso("Para empezar necesitamos tu logo y unos datos de tu marca.");
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

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent
        className={cn(
          "max-h-[94vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-2xl p-0",
          obligatorio && "[&>button.absolute]:hidden"
        )}
        onPointerDownOutside={(e) => obligatorio && e.preventDefault()}
        onEscapeKeyDown={(e) => obligatorio && e.preventDefault()}
      >
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex gap-1.5 pr-8">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={cn("h-1 flex-1 rounded-full", i <= paso ? "bg-primary" : "bg-muted")} />
            ))}
          </div>

          {paso === 0 && (
            <div className="space-y-3 py-2 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Rocket className="h-7 w-7" />
              </span>
              <DialogTitle className="text-2xl">¡Hola{nombre ? `, ${nombre}` : ""}!</DialogTitle>
              <DialogDescription className="text-base">
                Este es tu espacio en Prodi. Desde acá seguís tus videos de principio a fin, sin perderte nada. Te
                mostramos cómo funciona en un minuto.
              </DialogDescription>
            </div>
          )}

          {paso === 1 && (
            <div className="space-y-4">
              <div>
                <DialogTitle className="text-xl">Así nace cada video</DialogTitle>
                <DialogDescription>Son 5 pasos. Vos solo participás en dos.</DialogDescription>
              </div>
              <ol className="space-y-2.5">
                {CAMINO.map((c, i) => (
                  <li
                    key={c.titulo}
                    className={cn("flex items-start gap-3 rounded-xl border p-3", c.vos && "border-primary/40 bg-primary/[0.06]")}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                        c.vos ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <c.icon className="h-4 w-4" /> {c.titulo}
                        {c.vos && <span className="rounded-full bg-primary/15 px-2 text-[10px] text-primary">VOS</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{c.texto}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {paso === 2 && (
            <div className="space-y-4">
              <div>
                <DialogTitle className="text-xl">Lo único que tenés que hacer</DialogTitle>
                <DialogDescription>Del resto nos encargamos nosotros.</DialogDescription>
              </div>
              <div className="space-y-2.5">
                {TAREAS.map((t) => (
                  <div key={t.titulo} className="flex items-start gap-3 rounded-xl border bg-card p-3">
                    <t.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">{t.titulo}</p>
                      <p className="text-xs text-muted-foreground">{t.texto}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                <Bell className="mt-0.5 h-4 w-4 shrink-0" />
                Arriba de todo vas a ver siempre un cartel con tu próximo paso. Si no dice nada para hacer, es que está todo
                en marcha.
              </p>
            </div>
          )}

          {paso === 3 && (
            <div className="space-y-4">
              <div>
                <DialogTitle className="text-xl">Tu marca</DialogTitle>
                <DialogDescription>
                  Con esto armamos tus videos, los textos y las piezas gráficas con tu identidad. Es lo único obligatorio.
                </DialogDescription>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>
                    ¿A qué se dedica tu negocio? <span className="text-destructive">*</span>
                  </Label>
                  <Input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Ej: pizzería y delivery" />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    ¿Qué lo hace distinto? <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    rows={2}
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    placeholder="Ej: masa madre de 48 horas, horno a leña, abrimos hasta las 2 AM"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>¿A quién le vendés?</Label>
                  <Input value={publico} onChange={(e) => setPublico(e.target.value)} placeholder="Ej: familias y jóvenes" />
                </div>
                <div className="space-y-1.5">
                  <Label>Instagram</Label>
                  <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@tumarca" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Logo <span className="text-destructive">*</span>
                  <span className="ml-1 font-normal text-muted-foreground">y los colores de tu marca</span>
                </Label>
                <MarcaArchivos cliente={cliente} />
              </div>
            </div>
          )}

          {aviso && <p className="text-sm font-medium text-destructive animate-in fade-in">{aviso}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            {paso === 0 ? (
              obligatorio ? (
                <span />
              ) : (
                <Button variant="ghost" onClick={() => cerrar(false)}>
                  Ahora no
                </Button>
              )
            ) : (
              <Button variant="ghost" onClick={() => setPaso((p) => p - 1)}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Atrás
              </Button>
            )}
            {paso < total - 1 ? (
              <Button onClick={() => setPaso((p) => p + 1)}>
                {paso === 0 ? "Empezar" : "Siguiente"} <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => void terminar()} disabled={guardando}>
                {guardando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Listo, ir a mi panel {!guardando && <CheckCircle2 className="ml-1.5 h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
