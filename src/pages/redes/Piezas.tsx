import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Check,
  Download,
  Flag,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Undo2,
  Upload,
  Maximize2,
  MessageCircle,
  Plus,
  Trash2,
  History,
  Megaphone,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell, EmptyState } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { EnfoqueBadge, EstadoPiezaBadge, VerVersion, VersionImg, driveThumb } from "@/components/redes/PiezaDialogs";
import { NotaDialog } from "@/components/redes/PautaDialogs";
import { DelSistemaAnterior } from "@/components/redes/DelSistemaAnterior";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useDriveConnection } from "@/hooks/use-drive-connection";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import { useMemoriaIA } from "@/lib/redes/planMes";
import { assertEditable, enModoVista } from "@/lib/redes/vistaComo";
import { callApi } from "@/lib/redes/api";
import {
  empezarPieza,
  formatoInfo,
  generarVersion,
  estaPublicada,
  marcarPublicada,
  borrarVersiones,
  mandarAlCliente,
  moverPieza,
  rechazarPieza,
  versionesDe,
} from "@/lib/redes/piezas";
import { fechaHora, formatARS, hace, hoyISO } from "@/lib/redes/format";
import { CalendarioEventos, SelectorVista, useVista, type EventoCal, type TipoCal } from "@/components/redes/VistaCalendario";
import { sinDisenadora } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { PiezaIA } from "@/lib/redes/types";
import { HablarConCliente } from "@/components/redes/HablarConCliente";
import { EditorPieza } from "@/components/redes/EditorPieza";
import { CompositorFoto } from "@/components/redes/CompositorFoto";
import { NuevaPiezaEquipo } from "@/components/redes/NuevaPiezaEquipo";
import { CompartirPorChat } from "@/components/redes/CompartirChat";

const TIPOS_CAL: Record<string, TipoCal> = {
  entregar: { label: "Para entregar", icon: Flag, chip: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30", dot: "bg-amber-500" },
  entregada: { label: "Entregada", icon: Check, chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", dot: "bg-emerald-500" },
};

interface Columna {
  id: string;
  titulo: string;
  ayuda: string;
  tuya: boolean;
  dot: string;
  filtro: (p: PiezaIA) => boolean;
}

const COLUMNAS: Columna[] = [
  { id: "hacer", titulo: "Para hacer", ayuda: "Pedidos nuevos: armalos.", tuya: true, dot: "bg-sky-500", filtro: (p) => p.estado === "pagada" },
  { id: "disenando", titulo: "Diseñando", ayuda: "En proceso o con cambios del cliente.", tuya: true, dot: "bg-primary", filtro: (p) => p.estado === "en_proceso" },
  { id: "cliente", titulo: "Esperando al cliente", ayuda: "Se las mandaste para aprobar.", tuya: false, dot: "bg-orange-500", filtro: (p) => p.estado === "para_aprobar" },
  {
    id: "listas",
    titulo: "Entregadas",
    ayuda: "Aprobadas, falta publicarlas. Las publicadas pasan al historial.",
    tuya: false,
    dot: "bg-emerald-500",
    filtro: (p) => p.estado === "entregada" && !estaPublicada(p) && p.updated_at >= new Date(Date.now() - 30 * 86_400_000).toISOString(),
  },
];

/** Kanban de diseño (Karen): qué hacer, qué está esperando al cliente y qué se entregó. */
export default function Piezas() {
  const { piezas, clienteById } = useRedes();
  const { role } = useUserProfileContext();
  const [params, setParams] = useSearchParams();
  const [abierta, setAbierta] = useState<string | null>(null);
  // "Nueva pieza" la cargan vos y la productora (con las fotos para usar).
  const [nueva, setNueva] = useState(false);
  const [historial, setHistorial] = useState(false);
  const cargaPiezas = role === "admin" || role === "productor";
  const pieza = piezas.find((p) => p.id === abierta) ?? null;

  // Link de un aviso: /piezas?pieza=abc
  const deLink = params.get("pieza");
  useEffect(() => {
    if (!deLink) return;
    setAbierta(deLink);
    const next = new URLSearchParams(params);
    next.delete("pieza");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deLink]);

  const [vista, setVista] = useVista("piezas");
  // Arrastrar tarjetas entre columnas (admin, diseño y productora). "Entregadas" solo el admin.
  const { user } = useUserProfileContext();
  const arrastra = !!user && ["admin", "diseno", "productor"].includes(role ?? "");
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const soltar = async (destino: Columna["id"], id: string) => {
    setArrastrando(null);
    setSobre(null);
    const p = piezas.find((x) => x.id === id);
    if (!p || !user) return;
    // Soltada en la misma columna: no pasa nada.
    if (COLUMNAS.find((c) => c.id === destino)?.filtro(p)) return;
    if (destino === "listas" && role !== "admin") {
      toast.error("Las da por entregadas el cliente al aprobarlas (o el admin).");
      return;
    }
    try {
      await moverPieza(p, destino as "hacer" | "disenando" | "cliente" | "listas", clienteById(p.proyecto_id), user.uid);
      toast.success(destino === "cliente" ? "Le llegó al cliente para aprobar" : "Movida");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mover");
    }
  };

  // En el celular el arrastre del navegador no anda con el dedo: se mantiene apretada la tarjeta y se mueve.
  const tablero = useRef<HTMLDivElement>(null);
  const tactil = useRef<{ id: string; x0: number; y0: number; timer: number } | null>(null);
  const recienSoltada = useRef(0);
  const [fantasma, setFantasma] = useState<{ id: string; x: number; y: number } | null>(null);
  const tocarTarjeta = (ev: React.TouchEvent, id: string) => {
    if (!arrastra || ev.touches.length !== 1) return;
    const t = ev.touches[0];
    const timer = window.setTimeout(() => {
      navigator.vibrate?.(25);
      setArrastrando(id);
      setFantasma({ id, x: t.clientX, y: t.clientY });
    }, 350);
    tactil.current = { id, x0: t.clientX, y0: t.clientY, timer };
  };
  // Si se mueve antes de tiempo es que quiere scrollear: no arrastra.
  const moverAntes = (ev: React.TouchEvent) => {
    const a = tactil.current;
    if (!a || fantasma) return;
    const t = ev.touches[0];
    if (Math.hypot(t.clientX - a.x0, t.clientY - a.y0) > 10) {
      clearTimeout(a.timer);
      tactil.current = null;
    }
  };
  const soltarAntes = () => {
    if (tactil.current && !fantasma) clearTimeout(tactil.current.timer);
    if (!fantasma) tactil.current = null;
  };
  useEffect(() => {
    if (!fantasma) return;
    const id = fantasma.id;
    let destino: string | null = null;
    let auto = 0;
    const mover = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      setFantasma({ id, x: t.clientX, y: t.clientY });
      const col = (document.elementFromPoint(t.clientX, t.clientY)?.closest("[data-col]") as HTMLElement | null)?.dataset.col ?? null;
      destino = col;
      setSobre(col);
      // Cerca del borde, el tablero se corre solo para llegar a las otras columnas.
      auto = t.clientX < 40 ? -14 : t.clientX > window.innerWidth - 40 ? 14 : 0;
    };
    const intervalo = window.setInterval(() => auto && tablero.current?.scrollBy({ left: auto }), 16);
    const fin = () => {
      recienSoltada.current = Date.now();
      tactil.current = null;
      setFantasma(null);
      setArrastrando(null);
      setSobre(null);
      if (destino) void soltar(destino, id);
    };
    document.addEventListener("touchmove", mover, { passive: false });
    document.addEventListener("touchend", fin);
    document.addEventListener("touchcancel", fin);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("touchmove", mover);
      document.removeEventListener("touchend", fin);
      document.removeEventListener("touchcancel", fin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fantasma?.id]);
  const piezaFantasma = fantasma ? piezas.find((p) => p.id === fantasma.id) : null;
  // Calendario: lo pendiente en la fecha que lo necesita el cliente (o 5 días después del pedido
  // si no puso fecha) y lo entregado el día que se aprobó.
  const eventosCal = useMemo<EventoCal[]>(
    () =>
      piezas.flatMap((p): EventoCal[] => {
        const titulo = `${formatoInfo(p.formato).label}: ${p.producto || p.pedido}`;
        const cliente = clienteById(p.proyecto_id)?.nombre ?? "";
        if (["pagada", "en_proceso", "para_aprobar"].includes(p.estado)) {
          const fecha = p.fecha_deseada ?? hoyISO(new Date(new Date(p.created_at).getTime() + 5 * 86_400_000));
          const estado = p.estado === "para_aprobar" ? "esperando al cliente" : p.estado === "en_proceso" ? "diseñando" : "para hacer";
          return [{ key: `${p.id}-e`, fecha, tipo: "entregar", orden: 0, titulo, detalle: `${cliente} · ${estado}${p.fecha_deseada ? "" : " · sin fecha, estimada"}`, onClick: () => setAbierta(p.id) }];
        }
        if (p.estado === "entregada") {
          const ap = [...(p.historial ?? [])].reverse().find((h) => h.accion === "Aprobada por el cliente");
          return [{ key: `${p.id}-ok`, fecha: hoyISO(new Date(ap?.at ?? p.updated_at)), tipo: "entregada", orden: 1, titulo, detalle: `${cliente} · entregada`, onClick: () => setAbierta(p.id) }];
        }
        return [];
      }),
    [piezas, clienteById]
  );

  const sinPagar = piezas.filter((p) => p.estado === "pendiente_pago");
  const activas = piezas.filter((p) => ["pagada", "en_proceso", "para_aprobar"].includes(p.estado)).length;
  // Historial: publicadas o entregadas hace más de 30 días.
  const enHistorial = useMemo(() => {
    const corte = new Date(Date.now() - 30 * 86_400_000).toISOString();
    return piezas.filter((p) => p.estado === "entregada" && (estaPublicada(p) || p.updated_at < corte)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [piezas]);

  return (
    <PageShell
      title="Piezas gráficas"
      subtitle="Posteos, historias, afiches, carteles y banners que piden los clientes. La IA te ayuda; vos decidís qué sale."
      className="max-w-none"
      actions={
        <>
          {piezas.length > 0 && <SelectorVista vista={vista} onChange={setVista} />}
          {enHistorial.length > 0 && (
            <Button variant="outline" onClick={() => setHistorial(true)}>
              <History className="mr-2 h-4 w-4" /> Historial ({enHistorial.length})
            </Button>
          )}
          {cargaPiezas && (
            <Button onClick={() => setNueva(true)} className="bg-gradient-to-r from-[#6F40FC] to-[#E040A0] text-white shadow-md transition-transform hover:-translate-y-0.5 hover:opacity-95">
              <Plus className="mr-2 h-4 w-4" /> Nueva pieza
            </Button>
          )}
        </>
      }
    >
      {piezas.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Todavía no hay pedidos"
          description={cargaPiezas ? "Los clientes las piden desde su panel, o cargala vos con «Nueva pieza»." : "Los clientes piden piezas desde su panel y te llegan acá."}
        />
      ) : vista === "calendario" ? (
        <CalendarioEventos eventos={eventosCal} tipos={TIPOS_CAL} vacio="No hay piezas para entregar ni entregadas este mes." />
      ) : (
        <>
          <div ref={tablero} className={cn("-mx-4 scroll-px-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:snap-none md:px-8", !fantasma && "snap-x snap-mandatory")}>
            <div className="flex min-w-max gap-3">
              {COLUMNAS.map((col) => {
                const items = piezas.filter(col.filtro).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
                const activa = col.tuya && items.length > 0;
                return (
                  <div
                    key={col.id}
                    data-col={col.id}
                    className={cn(
                      "flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border transition-colors sm:w-72",
                      activa ? "border-primary/40 bg-primary/[0.05]" : "bg-muted/30",
                      arrastrando && sobre === col.id && "border-primary bg-primary/10 ring-2 ring-primary/30"
                    )}
                    onDragOver={
                      arrastra
                        ? (ev) => {
                            if (!arrastrando) return;
                            ev.preventDefault();
                            ev.dataTransfer.dropEffect = "move";
                            if (sobre !== col.id) setSobre(col.id);
                          }
                        : undefined
                    }
                    onDragLeave={arrastra ? (ev) => !ev.currentTarget.contains(ev.relatedTarget as Node) && setSobre(null) : undefined}
                    onDrop={
                      arrastra
                        ? (ev) => {
                            ev.preventDefault();
                            const id = ev.dataTransfer.getData("text/pieza-id") || arrastrando;
                            if (id) void soltar(col.id, id);
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-center justify-between gap-2 px-3 pt-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                        <p className="text-sm font-semibold">{col.titulo}</p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                          activa ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                        )}
                      >
                        {items.length}
                      </span>
                    </div>
                    <p className="px-3 pb-2 pt-1 text-[11px] leading-snug text-muted-foreground">
                      {col.tuya && <span className="font-semibold text-primary">Te toca · </span>}
                      {col.ayuda}
                    </p>
                    <div className="flex min-h-[120px] flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-230px)] md:overflow-y-auto">
                      {items.map((p, i) => (
                        <div
                          key={p.id}
                          draggable={arrastra}
                          onDragStart={(ev) => {
                            ev.dataTransfer.setData("text/pieza-id", p.id);
                            ev.dataTransfer.effectAllowed = "move";
                            setArrastrando(p.id);
                          }}
                          onDragEnd={() => {
                            setArrastrando(null);
                            setSobre(null);
                          }}
                          onTouchStart={(ev) => tocarTarjeta(ev, p.id)}
                          onTouchMove={moverAntes}
                          onTouchEnd={soltarAntes}
                          onContextMenu={arrastra ? (ev) => ev.preventDefault() : undefined}
                          className={cn("min-w-0", arrastra && "cursor-grab select-none active:cursor-grabbing [-webkit-touch-callout:none]", arrastrando === p.id && "opacity-40")}
                        >
                          <PiezaCard pieza={p} i={i} cliente={clienteById(p.proyecto_id)?.nombre} onClick={() => Date.now() - recienSoltada.current > 500 && setAbierta(p.id)} />
                          {col.id === "listas" && user && (
                            <button
                              type="button"
                              onClick={() =>
                                void marcarPublicada(p, user.uid)
                                  .then(() => toast.success("Pasó al historial"))
                                  .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo"))
                              }
                              className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded-lg py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300"
                            >
                              <Megaphone className="h-3 w-3" /> Ya se publicó
                            </button>
                          )}
                        </div>
                      ))}
                      {items.length === 0 && (
                        <p className="py-6 text-center text-xs text-muted-foreground/70">{arrastrando ? "Soltala acá" : col.tuya ? "Nada pendiente 👌" : "Vacío"}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {role === "admin" && sinPagar.length > 0 && (
            <details className="mt-2 rounded-xl border px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">
                Pedidas sin pagar ({sinPagar.length}) · {formatARS(sinPagar.reduce((a, p) => a + p.precio, 0))}
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {sinPagar.map((p, i) => (
                  <PiezaCard key={p.id} pieza={p} i={i} cliente={clienteById(p.proyecto_id)?.nombre} onClick={() => setAbierta(p.id)} />
                ))}
              </div>
            </details>
          )}
          {activas === 0 && <p className="mt-2 text-sm text-muted-foreground">No hay piezas en curso.</p>}
        </>
      )}

      {fantasma && piezaFantasma && (
        <div
          className="pointer-events-none fixed z-[100] w-56 -translate-x-1/2 -translate-y-1/2 rotate-2 rounded-xl border border-primary bg-card p-2.5 text-sm shadow-2xl"
          style={{ left: fantasma.x, top: fantasma.y }}
        >
          <p className="truncate text-[11px] text-muted-foreground">{clienteById(piezaFantasma.proyecto_id)?.nombre}</p>
          <p className="truncate font-medium">{piezaFantasma.producto || piezaFantasma.pedido}</p>
          <p className="mt-1 text-[11px] font-semibold text-primary">{sobre ? `Soltar en «${COLUMNAS.find((c) => c.id === sobre)?.titulo}»` : "Llevala a otra columna"}</p>
        </div>
      )}
      <PiezaTrabajo pieza={pieza} onClose={() => setAbierta(null)} />
      <HistorialPiezas open={historial} onOpenChange={setHistorial} piezas={enHistorial} onAbrir={(id) => setAbierta(id)} />
      <NuevaPiezaEquipo open={nueva} onOpenChange={setNueva} onCreada={(id) => setAbierta(id)} />
    </PageShell>
  );
}

/** Lo ya publicado (o entregado hace más de un mes), por mes y con buscador. */
function HistorialPiezas({ open, onOpenChange, piezas, onAbrir }: { open: boolean; onOpenChange: (o: boolean) => void; piezas: PiezaIA[]; onAbrir: (id: string) => void }) {
  const { clienteById } = useRedes();
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  const lista = t
    ? piezas.filter((p) => [clienteById(p.proyecto_id)?.nombre, p.producto, p.pedido].some((x) => (x ?? "").toLowerCase().includes(t)))
    : piezas;
  const meses = new Map<string, PiezaIA[]>();
  for (const p of lista) {
    const m = (p.publicada_at ?? p.updated_at).slice(0, 7);
    meses.set(m, [...(meses.get(m) ?? []), p]);
  }
  const nombreMes = (m: string) => new Date(`${m}-15`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-3 rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Historial de piezas
          </DialogTitle>
          <DialogDescription>Las publicadas y las entregadas hace más de un mes.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente o pieza" className="pl-9" />
        </div>
        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          {lista.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No hay nada con esa búsqueda.</p>}
          {[...meses.entries()].map(([m, ps]) => (
            <div key={m}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground first-letter:uppercase">
                {nombreMes(m)} · {ps.length}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {ps.map((p, i) => (
                  <PiezaCard
                    key={p.id}
                    pieza={p}
                    i={i}
                    cliente={clienteById(p.proyecto_id)?.nombre}
                    onClick={() => {
                      onOpenChange(false);
                      onAbrir(p.id);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PiezaCard({ pieza: p, cliente, onClick, i }: { pieza: PiezaIA; cliente?: string; onClick: () => void; i: number }) {
  const { clienteById } = useRedes();
  const vs = versionesDe(p);
  const portada = vs[vs.length - 1];
  const info = formatoInfo(p.formato);
  const conCambios = p.estado === "en_proceso" && (p.rondas ?? 0) > 0;
  // Cliente sin diseñadora en su ficha: lo ven todas las de diseño hasta que el admin asigne una.
  const sinAsignar = !!clienteById(p.proyecto_id) && sinDisenadora(clienteById(p.proyecto_id)) && p.estado !== "entregada";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${i * 40}ms` }}
      className={cn(
        "flex w-full min-w-0 gap-3 rounded-xl border bg-card p-2.5 text-left transition-all animate-in fade-in slide-in-from-bottom-1 fill-mode-both hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm motion-reduce:animate-none",
        conCambios && "border-orange-500/50"
      )}
      title={cliente}
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {portada ? <VersionImg v={portada} className="object-cover" /> : <ImageIcon className="h-6 w-6 text-muted-foreground/40" />}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <ClienteTag cliente={clienteById(p.proyecto_id)} />
        <span className="block truncate text-sm font-medium">{p.producto || p.pedido}</span>
        <span className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted-foreground">{info.label}</span>
          <EnfoqueBadge enfoque={p.enfoque} />
        </span>
        <span className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>{p.incluida ? "Del plan" : p.precio ? `Pagada ${formatARS(p.precio)}` : ""}</span>
          <span>{hace(p.updated_at)}</span>
        </span>
        {conCambios && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-orange-600 dark:text-orange-300">
            <MessageSquareWarning className="h-3 w-3" /> El cliente pidió cambios
          </span>
        )}
        {sinAsignar && <span className="block text-[10px] text-amber-600 dark:text-amber-400">Sin diseñadora asignada</span>}
      </span>
    </button>
  );
}

function PiezaTrabajo({ pieza, onClose }: { pieza: PiezaIA | null; onClose: () => void }) {
  const { clienteById } = useRedes();
  const { user } = useUserProfileContext();
  const { connection } = useDriveConnection();
  const [ajustes, setAjustes] = useState("");
  const [generando, setGenerando] = useState(false);
  // Con una versión elegida, la IA puede mejorar esa (la usa de base) o hacer una nueva desde cero.
  const [modoIA, setModoIA] = useState<"mejorar" | "nueva">("mejorar");
  const [sel, setSel] = useState<string | null>(null);
  // "No tocar la foto": la IA deja un hueco y se pega la foto original (las caras quedan exactas).
  const [fotoIntacta, setFotoIntacta] = useState(true);
  const [componerId, setComponerId] = useState<string | null>(null);
  // Modo borrar: versiones marcadas para sacar.
  const [aBorrar, setABorrar] = useState<Set<string> | null>(null);
  const [borrando, setBorrando] = useState(false);
  // "Mandar por chat": a una persona, un grupo o el chat del cliente.
  const [compartir, setCompartir] = useState(false);
  // Versión abierta en grande (para verla bien y descargarla).
  const [ver, setVer] = useState<ReturnType<typeof versionesDe>[number] | null>(null);
  // Foto para usar abierta en grande.
  const [verFoto, setVerFoto] = useState<{ id: string; drive_file_id: string; name: string; mime_type?: string | null } | null>(null);
  const [mandando, setMandando] = useState(false);
  const [rechazo, setRechazo] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cliente = clienteById(pieza?.proyecto_id);
  const memoria = useMemoriaIA(pieza?.proyecto_id);
  const { upload, isUploading } = useDriveUpload({
    taskId: pieza?.id ?? "x",
    collectionName: "piezas_ia",
    slot: "finalizado",
    connection,
    projectName: cliente?.nombre ?? "Cliente",
    taskTipo: "Piezas",
    taskFecha: (pieza?.created_at ?? "").slice(0, 10),
    uploaderUid: user?.uid ?? null,
    taskLabel: pieza?.producto || pieza?.pedido || "Pieza",
  });

  // Material para la IA (fotos, fondos, ejemplos): va a "Material para usar" de la pieza.
  const inputMaterial = useRef<HTMLInputElement>(null);
  const { upload: uploadMaterial, isUploading: subiendoMaterial } = useDriveUpload({
    taskId: pieza?.id ?? "x",
    collectionName: "piezas_ia",
    slot: "crudo",
    connection,
    projectName: cliente?.nombre ?? "Cliente",
    taskTipo: "Piezas",
    taskFecha: (pieza?.created_at ?? "").slice(0, 10),
    uploaderUid: user?.uid ?? null,
    taskLabel: `Material · ${pieza?.producto || "pieza"}`,
  });
  const subirMaterial = async (files: File[]) => {
    if (!files.length) return;
    if (enModoVista()) {
      toast.error("Estás en modo 'ver como': es solo lectura.");
      return;
    }
    try {
      await uploadMaterial(files);
      toast.success("Material sumado: la IA lo va a usar");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir");
    }
  };
  const versiones = useMemo(() => (pieza ? versionesDe(pieza) : []), [pieza]);
  useEffect(() => {
    setSel(null);
    setAjustes("");
    setABorrar(null);
    setComponerId(null);
  }, [pieza?.id]);
  // Al aparecer una versión nueva, queda elegida.
  const ultima = versiones[versiones.length - 1]?.id;
  useEffect(() => {
    if (ultima) setSel(ultima);
  }, [ultima]);

  if (!pieza) return null;
  const info = formatoInfo(pieza.formato);
  const puedeTrabajar = pieza.estado === "pagada" || pieza.estado === "en_proceso";
  const fotosMaterial = (pieza.attachments_crudo ?? []).filter((f) => !f.mime_type || f.mime_type.startsWith("image/"));
  const hayFotos = fotosMaterial.length > 0;
  const productos = (memoria?.comercial?.productos ?? []).filter((p) => p.destacado).slice(0, 5);

  const generar = async () => {
    setGenerando(true);
    try {
      const r = await generarVersion(pieza.id, ajustes || undefined, hayFotos && fotoIntacta);
      setAjustes("");
      if (r.hueco_foto) {
        setComponerId(r.version_id);
        toast.success("Diseño listo: ahora acomodá la foto original");
      } else toast.success("Nueva versión generada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar");
    } finally {
      setGenerando(false);
    }
  };
  const crearConIA = async () => {
    const base = versiones.find((v) => v.id === sel);
    if (!base || modoIA === "nueva") return generar();
    setGenerando(true);
    try {
      assertEditable();
      await callApi("/api/ia/pieza-editar", { pieza_id: pieza.id, version_id: base.id, instruccion: ajustes });
      setAjustes("");
      toast.success("Listo: quedó como versión nueva");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear");
    } finally {
      setGenerando(false);
    }
  };
  const subir = async (files: File[]) => {
    if (!files.length) return;
    if (enModoVista()) {
      toast.error("Estás en modo 'ver como': es solo lectura.");
      return;
    }
    try {
      await empezarPieza(pieza);
      await upload(files);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo subir");
    }
  };
  const mandar = async () => {
    if (!sel) return;
    setMandando(true);
    try {
      await mandarAlCliente(pieza, sel, cliente, user?.uid ?? "");
      toast.success("Le llegó al cliente para aprobar");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar");
    } finally {
      setMandando(false);
    }
  };

  const borrarMarcadas = async () => {
    if (!aBorrar?.size) return;
    if (!window.confirm(aBorrar.size === 1 ? "¿Borrar la versión marcada?" : `¿Borrar las ${aBorrar.size} versiones marcadas?`)) return;
    setBorrando(true);
    try {
      await borrarVersiones(pieza, [...aBorrar]);
      if (sel && aBorrar.has(sel)) setSel(null);
      setABorrar(null);
      toast.success("Listo, borradas");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo borrar");
    } finally {
      setBorrando(false);
    }
  };
  const componer = versiones.find((v) => v.id === componerId) ?? null;

  const elegida = versiones.find((v) => v.id === sel) ?? null;
  const nElegida = elegida ? versiones.indexOf(elegida) + 1 : 0;
  const enviadaN = versiones.findIndex((v) => v.id === pieza.version_enviada_id) + 1;
  const aprobadaV = versiones.find((v) => v.id === pieza.version_aprobada_id) ?? null;
  const pasos = [
    { n: 1, t: "Leé el pedido", listo: true },
    { n: 2, t: "Creá la pieza", listo: versiones.length > 0 },
    { n: 3, t: "Elegí una versión", listo: !!elegida || pieza.estado === "para_aprobar" || pieza.estado === "entregada" },
    { n: 4, t: "Entregá al cliente", listo: pieza.estado === "para_aprobar" || pieza.estado === "entregada" },
  ];

  return (
    <Dialog open={!!pieza} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-5xl gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[94dvh]">
        {/* Encabezado: qué pieza es y en qué paso va */}
        <div className="border-b bg-gradient-to-r from-primary/[0.07] via-background to-fuchsia-500/[0.06] px-5 pb-3 pt-4">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-lg">
              {cliente?.nombre} · {info.label}
              <EnfoqueBadge enfoque={pieza.enfoque} />
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
              <EstadoPiezaBadge estado={pieza.estado} vista="equipo" />
              <span>
                {info.medida} · {pieza._origen ? "del sistema anterior" : pieza.incluida ? "incluida en el plan" : pieza.precio ? `pagada ${formatARS(pieza.precio)}` : "sin cargo"} · pedida {fechaHora(pieza.created_at)}
              </span>
            </DialogDescription>
          </DialogHeader>
          <ol className="mt-3 grid grid-cols-4 gap-1.5">
            {pasos.map((p, i) => {
              const actual = !p.listo && pasos.slice(0, i).every((x) => x.listo);
              return (
                <li
                  key={p.n}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors sm:text-xs",
                    p.listo ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : actual ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/60 text-muted-foreground"
                  )}
                >
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", p.listo ? "bg-emerald-500 text-white" : actual ? "bg-white/25" : "bg-background")}>
                    {p.listo ? <Check className="h-3 w-3" /> : p.n}
                  </span>
                  <span className="truncate">{p.t}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="grid max-h-[calc(94dvh-150px)] gap-0 overflow-y-auto md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] md:overflow-hidden">
          {/* 1. Lo que pidió el cliente */}
          <div className="space-y-3 border-b p-4 text-sm md:max-h-[calc(94dvh-150px)] md:overflow-y-auto md:border-b-0 md:border-r">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">1 · Lo que pidió</p>
            {(pieza.rondas ?? 0) > 0 && pieza.feedback_cliente && pieza.estado !== "entregada" && (
              <div className="rounded-xl border border-orange-500/40 bg-orange-500/[0.08] p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-orange-700 dark:text-orange-300">
                  <MessageSquareWarning className="h-3.5 w-3.5" /> El cliente pidió cambios
                </p>
                <p className="mt-1 whitespace-pre-wrap">{pieza.feedback_cliente}</p>
                <HablarConCliente
                  proyectoId={pieza.proyecto_id}
                  referencia={{ tipo: "pieza", id: pieza.id, titulo: [info.label, pieza.producto].filter(Boolean).join(" · "), detalle: info.medida, correccion: pieza.feedback_cliente }}
                  onAbrir={onClose}
                  className="mt-2 h-8 bg-background/60 text-xs"
                />
              </div>
            )}
            <div className="space-y-2 rounded-xl border bg-card p-3">
              {pieza.producto && (
                <p>
                  <span className="text-muted-foreground">Vender:</span> <b>{pieza.producto}</b>
                </p>
              )}
              {pieza.oferta && (
                <p>
                  <span className="text-muted-foreground">Precio / promo:</span> {pieza.oferta}
                </p>
              )}
              {pieza.cta && (
                <p>
                  <span className="text-muted-foreground">Llamado:</span> {pieza.cta}
                </p>
              )}
              {pieza.pedido && <p className="whitespace-pre-wrap leading-relaxed">{pieza.pedido}</p>}
              {pieza.texto_en_pieza && (
                <div className="rounded-lg bg-muted/60 p-2 text-xs">
                  <p className="mb-0.5 font-semibold text-muted-foreground">Texto que va en la pieza, tal cual:</p>
                  <p className="font-medium">“{pieza.texto_en_pieza}”</p>
                </div>
              )}
              {(pieza.attachments_crudo?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-primary">Material para usar ({pieza.attachments_crudo!.length}) · fotos, fondos, ejemplos · tocá para verlos</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {pieza.attachments_crudo!.map((f) => (
                      <button
                        key={f.drive_file_id}
                        type="button"
                        onClick={() => setVerFoto({ id: f.drive_file_id, drive_file_id: f.drive_file_id, name: f.name, mime_type: f.mime_type })}
                        className="aspect-square overflow-hidden rounded-lg border bg-muted transition-transform hover:scale-[1.04]"
                      >
                        <VersionImg v={{ drive_file_id: f.drive_file_id, name: f.name }} className="object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DelSistemaAnterior origen={pieza._origen} viejo={pieza._viejo} nota={pieza.nota_equipo} />
            <div className="space-y-2 rounded-xl border p-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                {cliente?.marca_archivos?.logo ? (
                  <img src={driveThumb(cliente.marca_archivos.logo.drive_file_id, 200)} alt="Logo" className="h-11 w-11 rounded-lg border bg-white object-contain p-1" referrerPolicy="no-referrer" />
                ) : (
                  <span className="text-[11px]">Sin logo cargado</span>
                )}
                <div className="space-y-0.5">
                  <p className="font-semibold text-foreground">Marca</p>
                  {cliente?.marca?.paleta?.length ? (
                    <p className="flex items-center gap-1">
                      {cliente.marca.paleta.map((c) => (
                        <span key={c} title={c} className="inline-block h-4 w-4 rounded-full border" style={{ background: c }} />
                      ))}
                    </p>
                  ) : (
                    cliente?.marca?.colores && <p>Colores: {cliente.marca.colores}</p>
                  )}
                  {cliente?.marca?.tono && <p>Tono: {cliente.marca.tono}</p>}
                </div>
              </div>
              {productos.length > 0 && (
                <div>
                  <p className="mb-1 font-medium text-foreground">Lo que más le conviene vender</p>
                  {productos.map((p) => (
                    <p key={p.id} className="flex items-center gap-1">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> {p.nombre}
                      {p.precio ? ` · ${p.precio}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
            {(pieza.historial?.length ?? 0) > 0 && (
              <details className="rounded-xl border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">Historial</summary>
                <ol className="mt-2 space-y-1.5">
                  {[...(pieza.historial ?? [])].reverse().map((h, i) => (
                    <li key={i}>
                      <span className="font-medium">{h.accion}</span> · <span className="text-muted-foreground">{fechaHora(h.at)}</span>
                      {h.nota && <p className="text-muted-foreground">“{h.nota}”</p>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>

          {/* 2 a 4. Tu trabajo */}
          <div className="space-y-5 p-4 md:max-h-[calc(94dvh-150px)] md:overflow-y-auto">
            {puedeTrabajar && (
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">2 · Creá la pieza</p>
                <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr]">
                  <div className="space-y-2 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.07] to-fuchsia-500/[0.04] p-3">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-primary" /> Con IA
                    </p>
                    {elegida && (
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-background/70 p-0.5 text-xs">
                        {(
                          [
                            { v: "mejorar", t: `Mejorar la v${nElegida}` },
                            { v: "nueva", t: "Nueva desde cero" },
                          ] as const
                        ).map((o) => (
                          <button
                            key={o.v}
                            type="button"
                            onClick={() => setModoIA(o.v)}
                            className={cn("rounded-md py-1.5 font-medium transition-all", modoIA === o.v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                          >
                            {o.t}
                          </button>
                        ))}
                      </div>
                    )}
                    <Textarea
                      rows={2}
                      value={ajustes}
                      onChange={(e) => setAjustes(e.target.value)}
                      placeholder={
                        elegida && modoIA === "mejorar"
                          ? `¿Qué le cambio a la v${nElegida}? Ej: sacá la botella verde, no toques las caras`
                          : "Indicaciones (opcional): fondo oscuro, más minimalista, foto grande…"
                      }
                      className="resize-none bg-background"
                    />
                    {hayFotos && !(elegida && modoIA === "mejorar") && (
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-background/70 p-2 text-xs">
                        <input type="checkbox" className="mt-0.5 accent-primary" checked={fotoIntacta} onChange={(e) => setFotoIntacta(e.target.checked)} />
                        <span>
                          <b>No tocar la foto</b> (recomendado con personas): la IA diseña alrededor y se pega la foto original, con las caras exactas.
                        </span>
                      </label>
                    )}
                    <Button className="w-full bg-gradient-to-r from-[#6F40FC] to-[#E040A0] text-white hover:opacity-90" onClick={() => void crearConIA()} disabled={generando || (!!elegida && modoIA === "mejorar" && ajustes.trim().length < 3)}>
                      {generando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      {generando ? "Creando (≈30 s)…" : elegida && modoIA === "mejorar" ? `Mejorar la v${nElegida}` : versiones.length ? "Otra versión nueva" : "Crear con IA"}
                    </Button>
                    {elegida && modoIA === "mejorar" && (
                      <p className="text-[11px] text-muted-foreground">La IA trabaja sobre la v{nElegida} y queda como versión nueva. La v{nElegida} no se toca.</p>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => inputMaterial.current?.click()}
                      disabled={subiendoMaterial || connection?.status !== "connected"}
                      className="flex items-center gap-2.5 rounded-2xl border-2 border-dashed p-3 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/[0.03] disabled:opacity-50"
                    >
                      {subiendoMaterial ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" /> : <ImagePlus className="h-5 w-5 shrink-0 text-primary" />}
                      <span>
                        <span className="block font-semibold">Sumar foto, fondo o ejemplo</span>
                        <span className="block text-[11px] text-muted-foreground">Para que la IA lo use. Contale en el pedido cómo.</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => input.current?.click()}
                      disabled={isUploading || connection?.status !== "connected"}
                      className="flex items-center gap-2.5 rounded-2xl border-2 border-dashed p-3 text-left text-sm transition-colors hover:border-primary/60 hover:bg-primary/[0.03] disabled:opacity-50"
                    >
                      {isUploading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" /> : <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />}
                      <span>
                        <span className="block font-semibold">Subir mi diseño terminado</span>
                        <span className="block text-[11px] text-muted-foreground">Lo hiciste en otro programa: queda como versión para mandar.</span>
                      </span>
                    </button>
                  </div>
                  <input
                    ref={inputMaterial}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void subirMaterial(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                  <input
                    ref={input}
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void subir(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                </div>
              </section>
            )}

            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">3 · Elegí la versión</p>
                {aBorrar ? (
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={!aBorrar.size || borrando} onClick={() => void borrarMarcadas()}>
                      {borrando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
                      Borrar {aBorrar.size || ""}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setABorrar(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  versiones.length > 0 && (
                    <div className="flex items-center gap-2">
                      <p className="hidden text-[11px] text-muted-foreground sm:block">Tocá para elegir · «Ver» para abrirla grande</p>
                      {puedeTrabajar && (
                        <button type="button" onClick={() => setABorrar(new Set(sel ? [sel] : []))} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" /> Borrar
                        </button>
                      )}
                    </div>
                  )
                )}
              </div>
              {versiones.length === 0 && !generando ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
                  <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium">Todavía no hay versiones</p>
                  <p className="text-xs text-muted-foreground">Creala con IA o subí tu diseño (paso 2).</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                  {versiones.map((v, i) => {
                    const marcada = sel === v.id;
                    const aprobada = v.id === pieza.version_aprobada_id;
                    const enviada = v.id === pieza.version_enviada_id;
                    const esPdf = v.mime_type === "application/pdf";
                    const tocar = () => {
                      if (aBorrar) {
                        const n = new Set(aBorrar);
                        if (n.has(v.id)) n.delete(v.id);
                        else n.add(v.id);
                        return setABorrar(n);
                      }
                      if (puedeTrabajar) setSel((s) => (s === v.id ? null : v.id));
                      else setVer(v);
                    };
                    const paraBorrar = !!aBorrar?.has(v.id);
                    return (
                      <div
                        key={v.id}
                        role="button"
                        tabIndex={0}
                        onClick={tocar}
                        onDoubleClick={() => !aBorrar && setVer(v)}
                        onKeyDown={(e) => e.key === "Enter" && tocar()}
                        className={cn(
                          "group relative cursor-pointer overflow-hidden rounded-xl border-2 transition-all animate-in fade-in zoom-in-95",
                          paraBorrar
                            ? "border-destructive opacity-80 shadow-lg shadow-destructive/20"
                            : marcada && !aBorrar
                              ? "border-primary shadow-lg shadow-primary/20"
                              : "border-transparent hover:-translate-y-0.5 hover:border-primary/40"
                        )}
                      >
                        <div className="flex aspect-[4/5] items-center justify-center bg-muted">
                          {esPdf ? <span className="text-sm font-semibold text-muted-foreground">PDF</span> : <VersionImg v={v} />}
                        </div>
                        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          v{i + 1} · {v.origen === "ia" ? (v.modelo ? (v.modelo.includes("pro") ? "IA Pro" : v.modelo.includes("2.5") ? "IA básica" : "IA") : "IA") : "subida"}
                        </span>
                        {(aprobada || enviada) && (
                          <span className={cn("absolute left-1.5 top-7 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white", aprobada ? "bg-emerald-600" : "bg-orange-500")}>
                            {aprobada ? "Aprobada" : "Enviada"}
                          </span>
                        )}
                        {aBorrar && (
                          <span className={cn("absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow", paraBorrar ? "bg-destructive text-white" : "bg-black/40")}>
                            {paraBorrar && <Trash2 className="h-3.5 w-3.5" />}
                          </span>
                        )}
                        {v.hueco_foto && !aBorrar && puedeTrabajar && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setComponerId(v.id);
                            }}
                            className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-transform hover:scale-105"
                          >
                            <ImagePlus className="h-3 w-3" /> Pegar foto
                          </button>
                        )}
                        {marcada && !aBorrar && (
                          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-primary py-0.5 pl-1 pr-2 text-[10px] font-semibold text-primary-foreground">
                            <Check className="h-3.5 w-3.5" /> Elegida
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVer(v);
                          }}
                          className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white transition-transform hover:scale-105"
                        >
                          <Maximize2 className="h-3 w-3" /> Ver
                        </button>
                      </div>
                    );
                  })}
                  {generando && (
                    <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed border-primary/40 bg-gradient-to-br from-primary/10 to-fuchsia-500/10">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <span className="text-xs font-medium text-primary">Creando…</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">4 · Entregá</p>
              {pieza.estado === "entregada" ? (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3 text-sm">
                  <Check className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span className="flex-1">
                    <b>El cliente la aprobó.</b> {aprobadaV ? "Abrila con «Ver» para descargarla." : ""}
                  </span>
                  {aprobadaV && (
                    <Button size="sm" variant="outline" onClick={() => setVer(aprobadaV)}>
                      <Download className="mr-1.5 h-4 w-4" /> Abrir
                    </Button>
                  )}
                </div>
              ) : null}
              {pieza.estado === "entregada" && user && (
                <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs">
                  {pieza.publicada_at ? (
                    <>
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Megaphone className="h-3.5 w-3.5 text-emerald-600" /> Publicada {hace(pieza.publicada_at)} · está en el historial
                      </span>
                      <button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => void marcarPublicada(pieza, user.uid, false)}>
                        No, todavía no
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground">{estaPublicada(pieza) ? "Ya pasó la fecha de publicación: está en el historial." : "¿Ya se subió a las redes?"}</span>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void marcarPublicada(pieza, user.uid).then(() => toast.success("Pasó al historial"))}>
                        <Megaphone className="mr-1 h-3.5 w-3.5" /> Ya se publicó
                      </Button>
                    </>
                  )}
                </div>
              )}
              {pieza.estado === "entregada" ? null : pieza.estado === "para_aprobar" ? (
                <div className="rounded-2xl border border-orange-500/30 bg-orange-500/[0.06] p-3 text-sm">
                  <b>Esperando al cliente.</b> Le mandaste la v{enviadaN || "?"} {hace(pieza.updated_at)}. Cuando la apruebe o pida cambios te llega el aviso.
                </div>
              ) : (
                puedeTrabajar && (
                  <Button className="h-12 w-full text-base" onClick={() => void mandar()} disabled={!sel || mandando}>
                    {mandando ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
                    {sel ? `Mandar la v${nElegida} al cliente para aprobar` : versiones.length ? "Elegí una versión para mandarla" : "Primero creá una versión"}
                  </Button>
                )
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {versiones.length > 0 ? (
                  <Button variant="outline" size="sm" onClick={() => setCompartir(true)}>
                    <MessageCircle className="mr-1.5 h-4 w-4" /> Mandar {sel ? `la v${nElegida}` : "la última"} por chat
                  </Button>
                ) : (
                  <span />
                )}
                {puedeTrabajar && (
                  <button type="button" onClick={() => setRechazo(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
                    <Undo2 className="h-3.5 w-3.5" /> No se puede hacer
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>

        <NotaDialog
          open={rechazo}
          onOpenChange={setRechazo}
          title={pieza.incluida || pieza._origen ? "No se puede hacer" : "No se puede hacer: devolver el pago"}
          description={
            pieza.incluida || pieza._origen
              ? "No se descuenta del plan del cliente y le avisamos con tu nota."
              : "Se devuelve el pago por Mercado Pago y le avisamos al cliente con tu nota."
          }
          placeholder="Ej.: para esto necesitamos fotos reales del producto, mejor lo filmamos."
          confirmLabel={pieza.incluida || pieza._origen ? "Avisar al cliente" : "Devolver el pago"}
          onConfirm={async (nota) => {
            await rechazarPieza(pieza, nota);
            toast.success("Listo, le avisamos al cliente");
            onClose();
          }}
        />
        <VerVersion v={verFoto} titulo="Foto para usar" onClose={() => setVerFoto(null)} />
        <CompositorFoto
          diseno={componer}
          fotos={fotosMaterial}
          onGuardar={async (f) => {
            await empezarPieza(pieza);
            await upload([f]);
          }}
          onClose={() => setComponerId(null)}
        />
        <CompartirPorChat open={compartir} onOpenChange={setCompartir} piezaId={pieza.id} versionId={sel ?? versiones.at(-1)?.id ?? null} proyectoId={pieza.proyecto_id} />
        {ver && ver.mime_type !== "application/pdf" && !["cancelada", "rechazada", "pendiente_pago"].includes(pieza.estado) ? (
          <EditorPieza v={ver} titulo={`${pieza.producto || "Pieza"} · Versión ${versiones.findIndex((x) => x.id === ver.id) + 1}`} piezaId={pieza.id} onClose={() => setVer(null)} />
        ) : (
          <VerVersion v={ver} titulo={`Versión ${ver ? versiones.findIndex((x) => x.id === ver.id) + 1 : ""}`} onClose={() => setVer(null)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
