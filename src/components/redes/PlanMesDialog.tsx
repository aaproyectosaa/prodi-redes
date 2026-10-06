import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Lightbulb,
  Loader2,
  MessageSquareWarning,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { ResumenComercial } from "@/components/redes/ContextoComercial";
import { useRedes } from "@/contexts/redes-data-context";
import { hace, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { usoPlan } from "@/lib/redes/planes";
import {
  ajustarIdea,
  armarPlan,
  cambiosPendientes,
  enviarPlan,
  ESTADO_PLAN,
  guardarBorrador,
  guardarNotasIA,
  mesParaPlanificar,
  rehacerIdea,
  useMemoriaIA,
  usePlanesDelMes,
  usePlanMes,
} from "@/lib/redes/planMes";
import type { IdeaPlan, PlanMes } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Algo salió mal");

/**
 * "Armar el mes con IA": la IA propone las ideas, producción las revisa y edita,
 * y recién ahí le llegan al cliente. Todo lo que se cambia queda para que la IA aprenda.
 */
export function PlanMesDialog({
  open,
  onOpenChange,
  clienteId: clienteInicial,
  mes: mesInicial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clienteId?: string | null;
  mes?: string | null;
}) {
  const { clientes, planes, videos } = useRedes();
  const [clienteId, setClienteId] = useState<string>("");
  const [mes, setMes] = useState(mesParaPlanificar());

  useEffect(() => {
    if (!open) return;
    setClienteId(clienteInicial ?? clientes[0]?.id ?? "");
    setMes(mesInicial ?? mesParaPlanificar());
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clienteInicial, mesInicial]);

  const cliente = clientes.find((c) => c.id === clienteId);
  const { plan, loading } = usePlanMes(open ? clienteId : null, mes);
  const delMes = usePlanesDelMes(open ? [mes] : [], open);
  const libres = usoPlan(cliente, planes, videos, mes).disponibles;
  const meses = [0, 1, 2].map((d) => sumarMeses(mesActual(), d));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-3xl overflow-y-auto rounded-2xl p-0">
        <DialogHeader className="space-y-1 border-b px-5 pb-4 pt-5 text-left">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" /> Armar el mes con IA
          </DialogTitle>
          <DialogDescription>
            La IA propone las ideas con lo que sabe del cliente. Vos las revisás y recién ahí le llegan. Lo que cambies, la IA lo
            aprende para la próxima.
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger className="h-9 w-full sm:w-64">
                <SelectValue placeholder="Elegí el cliente">{cliente?.nombre}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clientes.map((c) => {
                  const p = delMes.find((x) => x.proyecto_id === c.id);
                  const e = ESTADO_PLAN[p?.estado ?? "nada"];
                  return (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        {c.nombre}
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", e.clase)}>{e.label}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 rounded-lg border p-0.5">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={mes <= meses[0]}
                onClick={() => setMes(sumarMeses(mes, -1))}
                aria-label="Mes anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[120px] text-center text-sm font-medium">{mesLabel(mes)}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={mes >= meses[meses.length - 1]}
                onClick={() => setMes(sumarMeses(mes, 1))}
                aria-label="Mes siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {cliente && !loading && (
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", ESTADO_PLAN[plan?.estado ?? "nada"].clase)}>
                {ESTADO_PLAN[plan?.estado ?? "nada"].label}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-5 px-5 pb-5 pt-4">
          {!cliente ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Elegí un cliente.</p>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !plan ? (
            <SinPlan proyectoId={cliente.id} nombre={cliente.nombre} mes={mes} libres={libres} />
          ) : plan.estado === "borrador" ? (
            <Borrador key={plan.id} plan={plan} nombre={cliente.nombre} />
          ) : (
            <Enviado plan={plan} onCerrar={() => onOpenChange(false)} />
          )}
          {cliente && <ResumenComercial proyectoId={cliente.id} nombre={cliente.nombre} />}
          {cliente && <PanelMemoria proyectoId={cliente.id} nombre={cliente.nombre} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function SinPlan({ proyectoId, nombre, mes, libres }: { proyectoId: string; nombre: string; mes: string; libres: number }) {
  const [busy, setBusy] = useState(false);
  const [pista, setPista] = useState("");
  const armar = async () => {
    setBusy(true);
    try {
      const r = await armarPlan(proyectoId, mes, pista.trim() || null);
      toast.success(`La IA armó ${r.ideas.length} idea${r.ideas.length === 1 ? "" : "s"}. Revisalas antes de mandarlas.`);
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  if (libres <= 0) {
    return (
      <div className="rounded-2xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">{nombre} ya tiene todos los videos de {mesLabel(mes).toLowerCase()} cargados.</p>
        <p className="mt-1 text-xs text-muted-foreground">Si necesitan más, se suman como video extra desde “Planificar”.</p>
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.08] via-card to-card p-5 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Sparkles className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {libres} video{libres === 1 ? "" : "s"} libre{libres === 1 ? "" : "s"} en {mesLabel(mes).toLowerCase()}
          </p>
          <p className="text-sm text-muted-foreground">
            La IA usa la marca, los videos que más mensajes trajeron, las fechas del mes y todo lo que aprendió de {nombre}.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={pista}
          onChange={(e) => setPista(e.target.value)}
          placeholder="¿Algo para tener en cuenta este mes? (opcional) Ej.: lanzan menú nuevo"
          className="flex-1"
          maxLength={300}
        />
        <Button onClick={() => void armar()} disabled={busy} className="shrink-0">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {busy ? "Pensando ideas…" : "Armar con IA"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Borrador({ plan, nombre }: { plan: PlanMes; nombre: string }) {
  const [ideas, setIdeas] = useState<IdeaPlan[]>(plan.ideas ?? []);
  const [nota, setNota] = useState(plan.nota_equipo ?? "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errores, setErrores] = useState<Set<string>>(new Set());
  const ideasRef = useRef(ideas);
  ideasRef.current = ideas;

  // Si cambian las ideas en el servidor (rehacer con IA), se toma la versión nueva.
  const firma = `${plan.generado_at ?? ""}|${plan.ideas_ia?.length ?? 0}`;
  useEffect(() => {
    setIdeas(plan.ideas ?? []);
    setNota(plan.nota_equipo ?? "");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  // Guardado automático mientras edita.
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      guardarBorrador(plan, ideas, nota.trim() || null)
        .then(() => setDirty(false))
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(t);
  }, [dirty, ideas, nota, plan]);

  const guardarYa = async () => {
    if (dirty) {
      await guardarBorrador(plan, ideasRef.current, nota.trim() || null);
      setDirty(false);
    }
  };

  const cambiar = (id: string, campo: "titulo" | "idea" | "objetivo", v: string) => {
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, [campo]: v } : i)));
    setErrores((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    setDirty(true);
  };
  const quitar = (id: string) => {
    setIdeas((prev) => prev.filter((i) => i.id !== id));
    setDirty(true);
  };
  const agregar = () => {
    setIdeas((prev) => [...prev, { id: `e${Date.now().toString(36)}`, titulo: "", idea: "", objetivo: null, origen: "equipo" }]);
    setDirty(true);
  };

  const rehacer = async (id: string, pista: string) => {
    setBusy(`idea:${id}`);
    try {
      await guardarYa();
      await rehacerIdea(plan.proyecto_id, plan.mes, id, pista || null);
      toast.success("Idea nueva lista");
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };
  const rehacerTodo = async (pista: string) => {
    setBusy("todo");
    try {
      await armarPlan(plan.proyecto_id, plan.mes, pista || null);
      toast.success("La IA armó ideas nuevas");
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };

  const enviar = async () => {
    const malas = new Set(ideas.filter((i) => i.titulo.trim().length < 3 || i.idea.trim().length < 10).map((i) => i.id));
    setErrores(malas);
    if (ideas.length === 0) {
      toast.error("Dejá al menos una idea");
      return;
    }
    if (malas.size) {
      toast.error("Completá el título y la descripción de las ideas marcadas");
      return;
    }
    setBusy("enviar");
    try {
      await enviarPlan(plan.proyecto_id, plan.mes, ideas, nota.trim() || null);
      toast.success(`Le llegó a ${nombre}. La IA guardó tus cambios para aprender.`);
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };

  const editadas = ideas.filter((i) => {
    const o = (plan.ideas_ia ?? []).find((x) => x.id === i.id);
    return !o || o.titulo !== i.titulo || o.idea !== i.idea;
  }).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2.5 text-sm">
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-600" />
          <span>
            <b>Borrador:</b> el cliente todavía no lo ve. Editá lo que quieras.
          </span>
        </span>
        <span className="text-xs text-muted-foreground">{dirty ? "Guardando…" : "Guardado"}</span>
      </div>

      <div className="space-y-3">
        {ideas.map((i, n) => (
          <div
            key={i.id}
            style={{ animationDelay: `${n * 60}ms` }}
            className={cn(
              "rounded-2xl border bg-card p-3.5 transition-colors animate-in fade-in slide-in-from-bottom-1 fill-mode-both motion-reduce:animate-none",
              errores.has(i.id) && "border-destructive/60",
              busy === `idea:${i.id}` && "opacity-60"
            )}
          >
            <div className="flex items-start gap-2">
              <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {n + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  value={i.titulo}
                  onChange={(e) => cambiar(i.id, "titulo", e.target.value)}
                  placeholder="Título del video"
                  className="h-9 font-semibold"
                  maxLength={120}
                />
                <Textarea
                  value={i.idea}
                  onChange={(e) => cambiar(i.id, "idea", e.target.value)}
                  placeholder="Qué se ve y qué se dice"
                  rows={3}
                  className="text-sm"
                  maxLength={1200}
                />
                <Input
                  value={i.objetivo ?? ""}
                  onChange={(e) => cambiar(i.id, "objetivo", e.target.value)}
                  placeholder="Para qué sirve (ej. conseguir pedidos por WhatsApp)"
                  className="h-8 text-xs"
                  maxLength={200}
                />
                {i.porque && (
                  <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                    <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" /> {i.porque}
                  </p>
                )}
                {errores.has(i.id) && <p className="text-xs text-destructive">Falta el título o la descripción.</p>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-1">
              {i.origen === "equipo" && (
                <span className="mr-auto self-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Idea tuya</span>
              )}
              <PistaPopover
                titulo="Otra idea en lugar de esta"
                placeholder="¿Algo en particular? Ej.: más divertida, sobre delivery"
                boton="Pedir otra"
                disabled={!!busy}
                onConfirm={(p) => void rehacer(i.id, p)}
              >
                <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={!!busy}>
                  {busy === `idea:${i.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Otra idea
                </Button>
              </PistaPopover>
              <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-destructive" onClick={() => quitar(i.id)} disabled={!!busy}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Quitar
              </Button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={agregar}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed py-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" /> Agregar una idea propia
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Mensaje para el cliente (opcional)</p>
        <Textarea
          value={nota}
          onChange={(e) => {
            setNota(e.target.value);
            setDirty(true);
          }}
          rows={2}
          placeholder="Ej.: ¡Hola Martín! Este mes pensamos en el Día de la Madre y en la pizza nueva."
          maxLength={600}
        />
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <PistaPopover
          titulo="Rehacer todas las ideas"
          placeholder="¿Qué cambiarías? Ej.: menos promos, más detrás de escena"
          boton="Rehacer todo"
          disabled={!!busy}
          onConfirm={(p) => void rehacerTodo(p)}
          aviso="Se reemplazan todas las ideas de este borrador."
        >
          <Button variant="ghost" size="sm" disabled={!!busy} className="text-muted-foreground">
            {busy === "todo" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            Rehacer todo
          </Button>
        </PistaPopover>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button onClick={() => void enviar()} disabled={!!busy}>
            {busy === "enviar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Aprobar y mandar a {nombre.split(" ")[0]}
          </Button>
          <span className="text-center text-[11px] text-muted-foreground sm:text-right">
            {ideas.length} idea{ideas.length === 1 ? "" : "s"}
            {editadas ? ` · ${editadas} cambiada${editadas === 1 ? "" : "s"} por vos (la IA lo aprende)` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function PistaPopover({
  children,
  titulo,
  placeholder,
  boton,
  aviso,
  disabled,
  onConfirm,
}: {
  children: React.ReactNode;
  titulo: string;
  placeholder: string;
  boton: string;
  aviso?: string;
  disabled?: boolean;
  onConfirm: (pista: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pista, setPista] = useState("");
  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" align="end">
        <p className="text-sm font-semibold">{titulo}</p>
        {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}
        <Input value={pista} onChange={(e) => setPista(e.target.value)} placeholder={placeholder} maxLength={300} autoFocus />
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            setOpen(false);
            onConfirm(pista.trim());
            setPista("");
          }}
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {boton}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------

function Enviado({ plan, onCerrar }: { plan: PlanMes; onCerrar: () => void }) {
  const openVideo = useOpenVideo();
  const pendientes = cambiosPendientes(plan);
  const verVideo = (id: string) => {
    onCerrar();
    window.setTimeout(() => openVideo(id), 150);
  };
  const e = ESTADO_PLAN[plan.estado];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", e.clase)}>{e.label}</span>
        {plan.estado === "enviado" && (
          <span className="text-xs text-muted-foreground">
            Se lo mandaste {hace(plan.enviado_at)}
            {(plan.recordatorios ?? 0) > 0 && ` · le recordamos ${plan.recordatorios === 1 ? "1 vez" : `${plan.recordatorios} veces`}`}
          </span>
        )}
        {plan.respondido_at && <span className="text-xs text-muted-foreground">Respondió {hace(plan.respondido_at)}</span>}
      </div>
      {plan.nota_cliente && (
        <p className="rounded-xl border bg-muted/40 p-3 text-sm">
          <span className="font-medium">El cliente dice:</span> “{plan.nota_cliente}”
        </p>
      )}
      {pendientes.length > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-orange-500/40 bg-orange-500/[0.08] px-3 py-2.5 text-sm">
          <MessageSquareWarning className="h-4 w-4 shrink-0 text-orange-600" />
          Ajustá {pendientes.length === 1 ? "la idea que pidió cambiar" : `las ${pendientes.length} ideas que pidió cambiar`} y creá el video.
        </p>
      )}
      <div className="space-y-2.5">
        {plan.ideas.map((i) =>
          i.respuesta?.ok === false && !i.video_id && !i.descartada ? (
            <AjusteIdea key={i.id} plan={plan} idea={i} />
          ) : (
            <div key={i.id} className={cn("rounded-2xl border bg-card p-3.5", i.descartada && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{i.titulo}</p>
                <EstadoIdea idea={i} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{i.idea}</p>
              {i.respuesta?.ok === false && i.respuesta.comentario && (
                <p className="mt-2 text-xs text-orange-700 dark:text-orange-300">Pidió: “{i.respuesta.comentario}”</p>
              )}
              {i.video_id && (
                <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => verVideo(i.video_id!)}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Ver video
                </Button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function EstadoIdea({ idea }: { idea: IdeaPlan }) {
  if (idea.descartada) return <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Descartada</span>;
  if (idea.video_id)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        <Check className="h-3 w-3" /> {idea.respuesta?.ok ? "Aprobada · video creado" : "Ajustada · video creado"}
      </span>
    );
  return <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">Esperando</span>;
}

function AjusteIdea({ plan, idea }: { plan: PlanMes; idea: IdeaPlan }) {
  const [titulo, setTitulo] = useState(idea.titulo);
  const [texto, setTexto] = useState(idea.idea);
  const [busy, setBusy] = useState<null | "crear" | "descartar">(null);
  const run = async (accion: "crear" | "descartar") => {
    if (accion === "crear" && titulo.trim().length < 3) {
      toast.error("Poné un título");
      return;
    }
    setBusy(accion);
    try {
      await ajustarIdea(plan.proyecto_id, plan.mes, idea.id, accion, { titulo: titulo.trim(), idea: texto.trim(), objetivo: idea.objetivo });
      toast.success(accion === "crear" ? "Video creado con el ajuste" : "Idea descartada");
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2 rounded-2xl border-2 border-orange-500/40 bg-orange-500/[0.04] p-3.5 animate-in fade-in duration-300">
      <p className="flex items-start gap-1.5 text-sm">
        <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
        <span>
          <b>Pidió cambios:</b> “{idea.respuesta?.comentario}”
        </span>
      </p>
      <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="h-9 font-semibold" maxLength={120} />
      <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} className="text-sm" maxLength={1200} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => void run("descartar")} disabled={!!busy} className="text-muted-foreground">
          {busy === "descartar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1.5 h-3.5 w-3.5" />}
          Descartar
        </Button>
        <Button size="sm" onClick={() => void run("crear")} disabled={!!busy}>
          {busy === "crear" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Crear video con el ajuste
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PanelMemoria({ proyectoId, nombre }: { proyectoId: string; nombre: string }) {
  const m = useMemoriaIA(proyectoId);
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setNotas(m?.notas_equipo ?? ""), [m?.notas_equipo, proyectoId]);
  const revisiones = m?.ejemplos?.length ?? 0;
  const cambio = notas.trim() !== (m?.notas_equipo ?? "").trim();
  const guardar = async () => {
    setBusy(true);
    try {
      await guardarNotasIA(proyectoId, notas.trim());
      toast.success("La IA lo va a tener en cuenta siempre");
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  const lineas = useMemo(() => (m?.resumen ?? "").split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean), [m?.resumen]);
  return (
    <details className="group rounded-2xl border bg-muted/20 px-4 py-3">
      <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold">
        <Brain className="h-4 w-4 text-primary" />
        Lo que la IA aprendió de {nombre}
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {revisiones ? `${revisiones} revisi${revisiones === 1 ? "ón" : "ones"}` : "todavía nada"}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        {lineas.length ? (
          <ul className="space-y-1.5">
            {lineas.map((l, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                {l}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Aprende cada vez que revisás un plan (qué dejás, qué cambiás, qué sacás) y cada vez que el cliente responde.
          </p>
        )}
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Indicaciones fijas para la IA</p>
          <Textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            maxLength={1500}
            placeholder="Ej.: no mostrar precios; siempre cerrar con “pedí por WhatsApp”; el dueño no quiere salir en cámara."
          />
          {cambio && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void guardar()} disabled={busy}>
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Guardar
              </Button>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
