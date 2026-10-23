import { useEffect, useMemo, useRef, useState } from "react";
import { BotonAplicar, ChatIA } from "@/components/redes/ChatIA";
import { CampaniaIA } from "@/components/redes/CampaniaIA";
import {
  Brain,
  Check,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Clapperboard,
  Lightbulb,
  Loader2,
  FileText,
  Megaphone,
  MessageCircle,
  Paperclip,
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
import { callApi } from "@/lib/redes/api";
import { hace, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { usoPlan } from "@/lib/redes/planes";
import {
  aBase64,
  ajustarIdea,
  armarPlan,
  type ArchivoContexto,
  cambiosPendientes,
  enviarPlan,
  ESTADO_PLAN,
  guardarBorrador,
  guardarNotasIA,
  mesParaPlanificar,
  quitarNotaChat,
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
  const meses = [0, 1, 2, 3, 4, 5].map((d) => sumarMeses(mesActual(), d));
  // "mes": las ideas de un mes (lo de siempre). "campania": charlar una campaña con la IA (un día de rodaje, varios meses).
  const [modo, setModo] = useState<"mes" | "campania">("mes");
  useEffect(() => {
    if (open) setModo("mes");
  }, [open]);
  // Al bajar, el encabezado se achica (queda el título, el cliente y el mes) para dejar lugar a las ideas.
  const [compacto, setCompacto] = useState(false);
  useEffect(() => {
    setCompacto(false);
  }, [open, modo]);
  const alScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    if (y > 48 && !compacto) setCompacto(true);
    else if (y < 8 && compacto) setCompacto(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-2xl [&>button.absolute]:right-4 [&>button.absolute]:top-4 [&>button.absolute]:rounded-full [&>button.absolute]:bg-white/15 [&>button.absolute]:p-1.5 [&>button.absolute]:text-white [&>button.absolute]:opacity-100 [&>button.absolute]:backdrop-blur">
        <DialogHeader
          className={cn(
            "relative shrink-0 space-y-1 overflow-clip bg-gradient-to-br from-primary via-violet-600 to-fuchsia-500 px-5 text-left text-white transition-[padding] duration-200",
            compacto ? "pb-3 pt-3" : "pb-4 pt-5"
          )}
        >
          <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/15 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-20 left-10 h-40 w-40 rounded-full bg-fuchsia-300/25 blur-3xl" aria-hidden />
          <DialogTitle className={cn("relative flex items-center gap-2.5 pr-10 text-white transition-all duration-200", compacto ? "text-base" : "text-xl")}>
            <span
              className={cn(
                "flex items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30 backdrop-blur transition-all duration-200",
                compacto ? "h-7 w-7" : "h-9 w-9"
              )}
            >
              <Sparkles className={compacto ? "h-4 w-4" : "h-5 w-5"} />
            </span>
            {modo === "mes" ? "Armar el mes con IA" : "Campaña con IA"}
          </DialogTitle>
          {/* Lo que se esconde al bajar: la explicación y el cambio de modo. */}
          <div className={cn("relative grid transition-[grid-template-rows,opacity] duration-200", compacto ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100")} aria-hidden={compacto}>
          <div className="min-h-0 space-y-1 overflow-clip">
          <DialogDescription className="relative text-white/80">
            {modo === "mes"
              ? "La IA propone las ideas con lo que sabe del cliente. Vos las revisás y recién ahí le llegan. Lo que cambies, lo aprende para la próxima."
              : "Charlá la campaña con la IA: pregunta lo que le falta y reparte los videos del día de rodaje en los meses, según el plan del cliente."}
          </DialogDescription>
          {/* Modo: un mes o una campaña. */}
          <div className="relative mt-2 inline-flex w-full rounded-full bg-black/20 p-1 backdrop-blur sm:w-auto sm:self-start">
            {(
              [
                ["mes", "Armar el mes", Sparkles],
                ["campania", "Campaña con rodaje", Clapperboard],
              ] as const
            ).map(([k, label, Icono]) => (
              <button
                key={k}
                type="button"
                onClick={() => setModo(k)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-all sm:flex-none",
                  modo === k ? "bg-white text-primary shadow-md" : "text-white/85 hover:text-white"
                )}
              >
                <Icono className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          </div>
          </div>
          <div className={cn("relative flex flex-wrap items-center gap-2", compacto ? "pt-1" : "pt-2")}>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger
                className={cn(
                  "h-9 rounded-full border-white/25 bg-white/15 text-white backdrop-blur sm:w-64 sm:flex-none [&>svg]:text-white",
                  compacto ? "w-auto min-w-0 flex-1" : "w-full"
                )}
              >
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
            <div className="flex items-center gap-1 rounded-full border border-white/25 bg-white/15 p-0.5 backdrop-blur">
              {modo === "campania" && <span className="pl-2.5 text-xs text-white/75">Desde</span>}
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full text-white hover:bg-white/20 hover:text-white"
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
                className="h-8 w-8 rounded-full text-white hover:bg-white/20 hover:text-white"
                disabled={mes >= meses[meses.length - 1]}
                onClick={() => setMes(sumarMeses(mes, 1))}
                aria-label="Mes siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {cliente && !loading && modo === "mes" && !compacto && (
              <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-primary shadow-sm">{ESTADO_PLAN[plan?.estado ?? "nada"].label}</span>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-5" onScroll={alScroll}>
          {!cliente ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Elegí un cliente.</p>
          ) : modo === "campania" ? (
            <CampaniaIA
              key={cliente.id}
              proyectoId={cliente.id}
              nombre={cliente.nombre}
              mesDesde={mes}
              onCargado={(m) => {
                setMes(m);
                setModo("mes");
              }}
            />
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !plan ? (
            <SinPlan proyectoId={cliente.id} nombre={cliente.nombre} mes={mes} libres={libres} onCampania={() => setModo("campania")} />
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

function SinPlan({ proyectoId, nombre, mes, libres, onCampania }: { proyectoId: string; nombre: string; mes: string; libres: number; onCampania: () => void }) {
  const [busy, setBusy] = useState(false);
  const [pista, setPista] = useState("");
  // Cuántos videos armar ahora (por defecto, todos los libres).
  const [cantidad, setCantidad] = useState(libres);
  useEffect(() => setCantidad(libres), [libres, proyectoId, mes]);
  const [archivos, setArchivos] = useState<File[]>([]);
  const inputArchivos = useRef<HTMLInputElement>(null);
  const sumarArchivos = (lista: FileList | null) => {
    const nuevos = Array.from(lista ?? []).filter((f) => /^image\/(jpeg|png|gif|webp)$|^application\/pdf$/.test(f.type));
    if ((lista?.length ?? 0) > nuevos.length) toast.error("Solo imágenes (JPG, PNG, WEBP) o PDF");
    const todos = [...archivos, ...nuevos].slice(0, 5);
    if (todos.reduce((n, f) => n + f.size, 0) > 3_000_000) return toast.error("Los archivos pesan mucho: hasta 3 MB en total");
    setArchivos(todos);
  };
  const armar = async () => {
    setBusy(true);
    try {
      const adjuntos: ArchivoContexto[] = await Promise.all(archivos.map(async (f) => ({ nombre: f.name, mime: f.type, data: await aBase64(f) })));
      const r = await armarPlan(proyectoId, mes, pista.trim() || null, {
        ...(cantidad < libres ? { cantidad } : {}),
        ...(adjuntos.length ? { archivos: adjuntos } : {}),
      });
      setArchivos([]);
      toast.success(
        `La IA armó ${r.ideas.length} idea${r.ideas.length === 1 ? "" : "s"}. Revisalas antes de mandarlas.${pista.trim() || adjuntos.length ? " El contexto quedó en su memoria." : ""}`
      );
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
    <div className="space-y-3">
    <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.1] via-card to-card p-5 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
      <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-fuchsia-500/10 blur-2xl" aria-hidden />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-lg shadow-primary/30">
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
      {/* Cuántos videos armar ahora */}
      {libres > 1 && (
        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">¿Cuántos videos?</span>
          <div className="flex flex-wrap gap-1 rounded-2xl bg-muted/50 p-1">
            {Array.from({ length: libres }, (_, n) => n + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCantidad(n)}
                className={cn(
                  "min-w-9 rounded-xl px-3 py-1.5 text-xs font-bold tabular-nums transition-all",
                  cantidad === n ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {n === libres ? `Los ${n}` : n}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative mt-3 space-y-2">
        <Textarea
          value={pista}
          onChange={(e) => setPista(e.target.value)}
          placeholder={cantidad === 1 ? "Contale de qué tiene que ser el video: el contexto, qué quieren lograr, qué no puede faltar…" : "¿Algo para tener en cuenta este mes? (opcional) Ej.: lanzan menú nuevo"}
          className="min-h-[88px] rounded-2xl bg-background/60 px-4 py-3 text-sm"
          maxLength={3000}
        />
        {archivos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {archivos.map((f, n) => (
              <span key={`${f.name}-${n}`} className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs">
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setArchivos(archivos.filter((_, i) => i !== n))} className="text-muted-foreground hover:text-foreground" aria-label="Quitar">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="relative mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={inputArchivos}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            sumarArchivos(e.target.files);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" onClick={() => inputArchivos.current?.click()} disabled={busy || archivos.length >= 5} className="h-11 rounded-full px-4">
          <Paperclip className="mr-2 h-4 w-4" /> Adjuntar archivos
        </Button>
        <p className="flex-1 text-[11px] leading-snug text-muted-foreground">Imágenes o PDF. Lo que le pases queda guardado en lo que aprendió de {nombre}.</p>
        <Button
          onClick={() => void armar()}
          disabled={busy}
          className="h-11 shrink-0 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-5 font-semibold shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {busy ? "Pensando ideas…" : cantidad === 1 ? "Armar 1 video" : cantidad < libres ? `Armar ${cantidad} videos` : "Armar con IA"}
        </Button>
      </div>
    </div>
    <button
      type="button"
      onClick={onCampania}
      className="group flex w-full items-center gap-3 rounded-2xl border border-dashed border-primary/30 px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/[0.04]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Megaphone className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">¿Es una campaña con un día de rodaje?</span>
        <span className="block text-xs text-muted-foreground">Charlala con la IA y que reparta los videos en varios meses.</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
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

  // Campaña: los otros meses del cliente que todavía están en borrador con ideas de la misma campaña. Se pueden
  // mandar todos juntos: al cliente le llega un solo link para aprobar la campaña entera.
  const campania = ideas.find((i) => i.campania)?.campania ?? null;
  const proximos = useMemo(() => [0, 1, 2, 3, 4, 5, 6, 7].map((d) => sumarMeses(mesActual(), d)), []);
  const planesCliente = usePlanesDelMes(campania ? proximos : [], !!campania);
  const deCampania = campania
    ? planesCliente
        .filter((p) => p.proyecto_id === plan.proyecto_id && p.estado === "borrador" && (p.id === plan.id || (p.ideas ?? []).some((i) => i.campania === campania)))
        .sort((a, b) => a.mes.localeCompare(b.mes))
    : [];
  const ideasCampania = deCampania.reduce((n, p) => n + (p.id === plan.id ? ideas.length : (p.ideas ?? []).length), 0);
  const rangoCampania =
    deCampania.length > 1
      ? `${mesLabel(deCampania[0].mes).split(" ")[0].toLowerCase()} a ${mesLabel(deCampania[deCampania.length - 1].mes).split(" ")[0].toLowerCase()}`
      : "";

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

  const enviarCampania = async () => {
    const malas = new Set(ideas.filter((i) => i.titulo.trim().length < 3 || i.idea.trim().length < 10).map((i) => i.id));
    setErrores(malas);
    if (malas.size) {
      toast.error("Completá el título y la descripción de las ideas marcadas");
      return;
    }
    if (
      !window.confirm(
        `¿Mandar a ${nombre} toda la campaña “${campania}”? Son ${ideasCampania} ideas de ${rangoCampania} (${deCampania.length} meses). Le llega un solo aviso con un link para aprobarlas todas.`
      )
    )
      return;
    setBusy("campania");
    try {
      await guardarBorrador(plan, ideas, nota.trim() || null);
      setDirty(false);
      await callApi("/api/ia/plan-enviar-campania", { proyecto_id: plan.proyecto_id, meses: deCampania.map((p) => p.mes), nota_equipo: nota.trim() || null });
      toast.success(`Le llegó a ${nombre} la campaña entera: ${ideasCampania} ideas de ${rangoCampania}.`);
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };

  // El cliente lo aprobó por WhatsApp, en persona o en una llamada (o todavía no usa el sistema):
  // se guarda como está y se crean los videos, sin mandárselo.
  const aprobadoPorFuera = async () => {
    const malas = new Set(ideas.filter((i) => i.titulo.trim().length < 3 || i.idea.trim().length < 10).map((i) => i.id));
    setErrores(malas);
    if (!ideas.length || malas.size) {
      toast.error(ideas.length ? "Completá el título y la descripción de las ideas marcadas" : "Dejá al menos una idea");
      return;
    }
    if (!window.confirm(`¿${nombre} aprobó las ${ideas.length} ideas por otro medio? Se crean los videos sin mandárselo.`)) return;
    setBusy("enviar");
    try {
      await guardarBorrador(plan, ideas, nota.trim() || null);
      await callApi("/api/ia/plan-responder", {
        proyecto_id: plan.proyecto_id,
        mes: plan.mes,
        respuestas: ideas.map((i) => ({ id: i.id, ok: true })),
        nota: null,
        por_fuera: true,
      });
      toast.success("Listo: quedó aprobado y se crearon los videos");
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
              {i.origen !== "equipo" && i.campania && (
                <span className="mr-auto inline-flex items-center gap-1 self-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <Clapperboard className="h-3 w-3" /> {i.campania}
                </span>
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

      <ChatIA
        tipo="plan"
        titulo="Charlá el plan con la IA"
        proyectoId={plan.proyecto_id}
        mes={plan.mes}
        actual={() => ideasRef.current}
        renderPropuesta={(p, listo) => {
          const nuevas = (Array.isArray(p.ideas) ? (p.ideas as IdeaPlan[]) : []).filter((x) => x?.titulo);
          return (
            <div className="space-y-2">
              <ol className="list-decimal space-y-1 pl-5 text-xs">
                {nuevas.map((x) => (
                  <li key={x.id}>
                    <b>{x.titulo}</b>
                    <span className="text-muted-foreground"> · {x.idea}</span>
                  </li>
                ))}
              </ol>
              <BotonAplicar
                onClick={() => {
                  // Las ideas propias del equipo que la IA dejó igual siguen siendo "tuyas".
                  const propias = new Map(ideasRef.current.filter((x) => x.origen === "equipo").map((x) => [x.titulo.trim().toLowerCase(), x]));
                  const final = nuevas.map((x) => propias.get(x.titulo.trim().toLowerCase()) ?? x);
                  setIdeas(final);
                  setDirty(true);
                  listo();
                  toast.success("Plan actualizado");
                }}
              >
                Usar estas ideas
              </BotonAplicar>
            </div>
          );
        }}
      />

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
          {deCampania.length > 1 && (
            <Button
              onClick={() => void enviarCampania()}
              disabled={!!busy}
              className="h-auto flex-col items-stretch gap-0 bg-gradient-to-r from-primary to-fuchsia-500 py-2 text-left font-semibold shadow-md shadow-primary/25 sm:items-end sm:text-right"
            >
              <span className="flex items-center gap-2 sm:justify-end">
                {busy === "campania" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
                Mandar toda la campaña a {nombre.split(" ")[0]}
              </span>
              <span className="text-[11px] font-normal text-white/85">
                {ideasCampania} ideas de {rangoCampania}, en un solo link
              </span>
            </Button>
          )}
          <Button onClick={() => void enviar()} disabled={!!busy} variant={deCampania.length > 1 ? "outline" : "default"}>
            {busy === "enviar" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {deCampania.length > 1 ? `Mandar solo ${mesLabel(plan.mes).split(" ")[0].toLowerCase()}` : `Aprobar y mandar a ${nombre.split(" ")[0]}`}
          </Button>
          <Button variant="outline" onClick={() => void aprobadoPorFuera()} disabled={!!busy} title="Lo aprobó por WhatsApp, en persona o todavía no usa el sistema">
            <Check className="mr-2 h-4 w-4 text-emerald-600" />
            Ya lo aprobó por otro medio
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
  const [busy, setBusy] = useState<null | "fuera" | "volver">(null);
  // El cliente lo aprobó por WhatsApp, en persona o en una llamada: se cargan todas como aprobadas y se crean los videos.
  const aprobadoPorFuera = async () => {
    if (!window.confirm(`¿El cliente aprobó las ${plan.ideas.length} ideas por otro medio? Se crean los videos como si las hubiera aprobado desde su panel.`)) return;
    setBusy("fuera");
    try {
      await callApi("/api/ia/plan-responder", {
        proyecto_id: plan.proyecto_id,
        mes: plan.mes,
        respuestas: plan.ideas.map((i) => ({ id: i.id, ok: true })),
        nota: null,
        por_fuera: true,
      });
      toast.success("Listo: quedó aprobado y se crearon los videos");
    } catch (er) {
      err(er);
    } finally {
      setBusy(null);
    }
  };
  // Volver a editar: pasa a borrador (el cliente deja de verlo para responder hasta que se lo mandes de nuevo).
  const volverAEditar = async () => {
    if (!window.confirm("¿Volver a editar el plan? El cliente deja de verlo para responder hasta que se lo mandes de nuevo.")) return;
    setBusy("volver");
    try {
      await callApi("/api/ia/plan-volver", { proyecto_id: plan.proyecto_id, mes: plan.mes });
      toast.success("Volvió a borrador: editalo y mandalo de nuevo");
    } catch (er) {
      err(er);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4">
      {plan.estado === "enviado" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void aprobadoPorFuera()} disabled={!!busy} className="bg-emerald-600 hover:bg-emerald-600/90">
            {busy === "fuera" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
            El cliente lo aprobó por otro medio
          </Button>
          <Button size="sm" variant="outline" onClick={() => void volverAEditar()} disabled={!!busy}>
            {busy === "volver" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pencil className="mr-1.5 h-3.5 w-3.5" />}
            Volver a editar
          </Button>
        </div>
      )}
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
  const [busy, setBusy] = useState<null | "crear" | "descartar" | "ia">(null);
  const [aplicada, setAplicada] = useState(false);
  // La IA reescribe la idea con lo que pidió el cliente (queda en los campos para revisarla antes de crear el video).
  const aplicarConIA = async () => {
    setBusy("ia");
    try {
      const r = await callApi<{ titulo: string; idea: string }>("/api/ia/plan-reescribir", { proyecto_id: plan.proyecto_id, mes: plan.mes, idea_id: idea.id });
      setTitulo(r.titulo);
      setTexto(r.idea);
      setAplicada(true);
      toast.success("Listo: revisala y creá el video");
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };
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
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="h-8 rounded-full border-primary/40 bg-background text-xs" onClick={() => void aplicarConIA()} disabled={!!busy}>
          {busy === "ia" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />}
          {aplicada ? "Rehacer con IA" : "Aplicar con IA"}
        </Button>
        <span className="text-[11px] text-muted-foreground">{aplicada ? "Ya tiene el cambio: revisala y creá el video." : "Reescribe la idea con lo que pidió el cliente."}</span>
      </div>
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
        {!!m?.contexto_equipo?.length && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Paperclip className="h-3.5 w-3.5 text-primary" /> Lo que le pasó el equipo
            </p>
            <ul className="space-y-1">
              {[...m.contexto_equipo].reverse().map((n) => (
                <li key={`${n.at}_${n.texto}`} className="flex items-start gap-2 text-sm">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40" />
                  <span className="flex-1">
                    {n.texto}{" "}
                    <span className="text-[11px] text-muted-foreground">
                      · {n.at.split("-").reverse().slice(0, 2).join("/")}
                      {n.archivos?.length ? ` · ${n.archivos.join(", ")}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void quitarNotaChat(proyectoId, n.texto).catch(err)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                    aria-label="Quitar este dato"
                    title="Quitar (si quedó mal o ya no vale)"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!m?.chat_notas?.length && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <MessageCircle className="h-3.5 w-3.5 text-primary" /> Del chat con el cliente
            </p>
            <ul className="space-y-1">
              {[...m.chat_notas].reverse().map((n) => (
                <li key={`${n.at}_${n.texto}`} className="flex items-start gap-2 text-sm">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40" />
                  <span className="flex-1">
                    {n.texto} <span className="text-[11px] text-muted-foreground">· {n.at.split("-").reverse().slice(0, 2).join("/")}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void quitarNotaChat(proyectoId, n.texto).catch(err)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                    aria-label="Quitar este dato"
                    title="Quitar (si quedó mal o ya no vale)"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
