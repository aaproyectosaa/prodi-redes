import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Check,
  Download,
  Flag,
  Image as ImageIcon,
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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { enModoVista } from "@/lib/redes/vistaComo";
import {
  empezarPieza,
  formatoInfo,
  generarVersion,
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
    ayuda: "Aprobadas por el cliente (últimos 30 días).",
    tuya: false,
    dot: "bg-emerald-500",
    filtro: (p) => p.estado === "entregada" && p.updated_at >= new Date(Date.now() - 30 * 86_400_000).toISOString(),
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

  return (
    <PageShell
      title="Piezas gráficas"
      subtitle="Posteos, historias, afiches, carteles y banners que piden los clientes. La IA te ayuda; vos decidís qué sale."
      className="max-w-none"
      actions={
        <>
          {piezas.length > 0 && <SelectorVista vista={vista} onChange={setVista} />}
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
          <div className="-mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:snap-none md:px-8">
            <div className="flex min-w-max gap-3">
              {COLUMNAS.map((col) => {
                const items = piezas.filter(col.filtro).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
                const activa = col.tuya && items.length > 0;
                return (
                  <div
                    key={col.id}
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
                          className={cn("min-w-0", arrastra && "cursor-grab active:cursor-grabbing", arrastrando === p.id && "opacity-40")}
                        >
                          <PiezaCard pieza={p} i={i} cliente={clienteById(p.proyecto_id)?.nombre} onClick={() => setAbierta(p.id)} />
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

      <PiezaTrabajo pieza={pieza} onClose={() => setAbierta(null)} />
      <NuevaPiezaEquipo open={nueva} onOpenChange={setNueva} onCreada={(id) => setAbierta(id)} />
    </PageShell>
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
  const [sel, setSel] = useState<string | null>(null);
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

  const versiones = useMemo(() => (pieza ? versionesDe(pieza) : []), [pieza]);
  useEffect(() => {
    setSel(null);
    setAjustes("");
  }, [pieza?.id]);
  // Al aparecer una versión nueva, queda elegida.
  const ultima = versiones[versiones.length - 1]?.id;
  useEffect(() => {
    if (ultima) setSel(ultima);
  }, [ultima]);

  if (!pieza) return null;
  const info = formatoInfo(pieza.formato);
  const puedeTrabajar = pieza.estado === "pagada" || pieza.estado === "en_proceso";
  const productos = (memoria?.comercial?.productos ?? []).filter((p) => p.destacado).slice(0, 5);

  const generar = async () => {
    setGenerando(true);
    try {
      await generarVersion(pieza.id, ajustes || undefined);
      setAjustes("");
      toast.success("Nueva versión generada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar");
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

  return (
    <Dialog open={!!pieza} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-4xl overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {cliente?.nombre} · {info.label}
            <EnfoqueBadge enfoque={pieza.enfoque} />
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <EstadoPiezaBadge estado={pieza.estado} vista="equipo" />
            <span>
              {info.medida} ·{" "}
              {pieza._origen ? "del sistema anterior" : pieza.incluida ? "incluida en el plan" : pieza.precio ? `pagada ${formatARS(pieza.precio)}` : "sin cargo"} · pedida{" "}
              {fechaHora(pieza.created_at)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1fr_1.35fr]">
          <div className="space-y-3 text-sm">
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
            {(pieza.attachments_crudo?.length ?? 0) > 0 && (
              <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/[0.04] p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                  <ImageIcon className="h-3.5 w-3.5" /> Fotos para usar ({pieza.attachments_crudo!.length})
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {pieza.attachments_crudo!.map((f) => (
                    <button
                      key={f.drive_file_id}
                      type="button"
                      onClick={() => setVerFoto({ id: f.drive_file_id, drive_file_id: f.drive_file_id, name: f.name, mime_type: f.mime_type })}
                      className="aspect-square overflow-hidden rounded-lg border bg-muted transition-transform hover:scale-[1.03]"
                    >
                      <VersionImg v={{ drive_file_id: f.drive_file_id, name: f.name }} className="object-cover" />
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">La IA las usa al generar. Tocá una para verla grande o descargarla.</p>
              </div>
            )}
            <div className="space-y-1.5 rounded-xl border p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pedido</p>
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
              {pieza.pedido && <p className="whitespace-pre-wrap">{pieza.pedido}</p>}
              {pieza.texto_en_pieza && (
                <p className="text-xs">
                  Texto tal cual: <span className="font-semibold">“{pieza.texto_en_pieza}”</span>
                </p>
              )}
            </div>
            <DelSistemaAnterior origen={pieza._origen} viejo={pieza._viejo} nota={pieza.nota_equipo} />
            <div className="space-y-2 rounded-xl border p-3 text-xs text-muted-foreground">
              <p className="font-semibold uppercase tracking-wider">Marca</p>
              <div className="flex items-center gap-3">
                {cliente?.marca_archivos?.logo ? (
                  <img src={driveThumb(cliente.marca_archivos.logo.drive_file_id, 200)} alt="Logo" className="h-12 w-12 rounded-lg border bg-white object-contain p-1" referrerPolicy="no-referrer" />
                ) : (
                  <span className="text-[11px]">Sin logo cargado</span>
                )}
                <div className="space-y-0.5">
                  {cliente?.marca?.rubro && <p>{cliente.marca.rubro}</p>}
                  {cliente?.marca?.paleta?.length ? (
                    <p className="flex items-center gap-1">
                      Colores:
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
            {puedeTrabajar && (
              <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/[0.04] p-3">
                <p className="text-xs font-semibold">Hacela con IA</p>
                <Textarea
                  rows={2}
                  value={ajustes}
                  onChange={(e) => setAjustes(e.target.value)}
                  placeholder="Indicaciones para la IA (opcional): fondo oscuro, más minimalista, foto de producto grande…"
                />
                <Button className="w-full" onClick={() => void generar()} disabled={generando}>
                  {generando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : versiones.length ? <RefreshCw className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {generando ? "Generando (≈20 s)…" : versiones.length ? "Otra versión con IA" : "Generar con IA"}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">o</p>
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
                <Button variant="outline" className="w-full" onClick={() => input.current?.click()} disabled={isUploading || connection?.status !== "connected"}>
                  {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Subir mi diseño (imagen o PDF)
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {versiones.length === 0 ? (
              <EmptyState icon={ImageIcon} title="Sin versiones" description="Generala con IA o subí tu diseño." />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {versiones.map((v, i) => {
                  const marcada = sel === v.id;
                  const aprobada = v.id === pieza.version_aprobada_id;
                  const enviada = v.id === pieza.version_enviada_id;
                  const esPdf = v.mime_type === "application/pdf";
                  return (
                    <div
                      key={v.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => (puedeTrabajar ? setSel((s) => (s === v.id ? null : v.id)) : setVer(v))}
                      onDoubleClick={() => setVer(v)}
                      onKeyDown={(e) => e.key === "Enter" && (puedeTrabajar ? setSel((s) => (s === v.id ? null : v.id)) : setVer(v))}
                      className={cn(
                        "group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all animate-in fade-in zoom-in-95",
                        marcada ? "border-primary" : "border-transparent hover:border-primary/40"
                      )}
                    >
                      <div className="flex aspect-square items-center justify-center bg-muted">
                        {esPdf ? <span className="text-sm font-semibold text-muted-foreground">PDF</span> : <VersionImg v={v} />}
                      </div>
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        v{i + 1} · {v.origen === "ia" ? "IA" : "subida"}
                        {aprobada ? " · aprobada" : enviada ? " · enviada" : ""}
                      </span>
                      {marcada && (
                        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-4 w-4" />
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
              </div>
            )}
            {versiones.length > 0 && (
              <Button variant="outline" className="w-full" onClick={() => setCompartir(true)}>
                <MessageCircle className="mr-2 h-4 w-4" /> Mandar {sel ? "la elegida" : "la última"} por chat
              </Button>
            )}
            {puedeTrabajar && (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRechazo(true)}>
                  <Undo2 className="mr-2 h-4 w-4" /> No se puede hacer
                </Button>
                <Button onClick={() => void mandar()} disabled={!sel || mandando}>
                  {mandando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Mandar al cliente para aprobar
                </Button>
              </div>
            )}
            {pieza.estado === "para_aprobar" && (
              <p className="rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
                Se la mandaste {hace(pieza.updated_at)}. Cuando la apruebe o pida cambios te llega el aviso.
              </p>
            )}
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
        {pieza && (
          <CompartirPorChat open={compartir} onOpenChange={setCompartir} piezaId={pieza.id} versionId={sel ?? versiones.at(-1)?.id ?? null} proyectoId={pieza.proyecto_id} />
        )}
        {pieza && ver && ver.mime_type !== "application/pdf" && !["cancelada", "rechazada", "pendiente_pago"].includes(pieza.estado) ? (
          <EditorPieza v={ver} titulo={`${pieza.producto || "Pieza"} · Versión ${versiones.findIndex((x) => x.id === ver.id) + 1}`} piezaId={pieza.id} onClose={() => setVer(null)} />
        ) : (
          <VerVersion v={ver} titulo={`Versión ${ver ? versiones.findIndex((x) => x.id === ver.id) + 1 : ""}`} onClose={() => setVer(null)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
