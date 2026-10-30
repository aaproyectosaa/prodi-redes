import { useEffect, useMemo, useState } from "react";
import { ElegirCliente } from "@/components/redes/ElegirCliente";
import { useSearchParams } from "react-router-dom";
import { deleteDoc, doc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  AudioLines,
  FileText,
  Loader2,
  MapPin,
  Mic,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { Grabador } from "@/components/redes/Grabador";
import { grabarReunion } from "@/lib/redes/grabarReunion";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { avisar } from "@/lib/redes/avisos";
import { actualizarReunion, compartirMinuta, crearReunion, generarMinuta, minutaVacia } from "@/lib/redes/reuniones";
import { chatClienteId } from "@/lib/redes/chat";
import { aInputAR, desdeInputAR, formatearFecha } from "@/lib/fecha";
import { fechaHora } from "@/lib/redes/format";
import { cn, hrefSeguro } from "@/lib/utils";
import type { Minuta, Reunion } from "@/lib/redes/types";

/** Campos suaves (mismo estilo que Pedir un video). */
const SUAVE =
  "rounded-2xl border-transparent bg-muted/60 shadow-none transition-colors focus-visible:border-primary focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0 focus:ring-4 focus:ring-primary/15 focus:ring-offset-0";
const ETIQUETA = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export default function Reuniones() {
  const { reuniones } = useRedes();
  const { role } = useUserProfileContext();
  const [params, setParams] = useSearchParams();
  const abierta = reuniones.find((r) => r.id === params.get("r")) ?? null;
  const [tab, setTab] = useState<"proximas" | "pasadas">("proximas");
  const [nueva, setNueva] = useState(false);
  const [presencial, setPresencial] = useState(false);
  const esEquipo = role !== "cliente";
  const corte = Date.now() - 2 * 3600_000;

  const esPasada = (r: Reunion) => new Date(r.fecha).getTime() < corte || r.estado === "realizada";
  const proximas = reuniones.filter((r) => !esPasada(r)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const pasadas = reuniones.filter(esPasada).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const lista = tab === "proximas" ? proximas : pasadas;

  const abrir = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("r", id);
    else next.delete("r");
    setParams(next, { replace: true });
  };

  const [proxima, ...resto] = lista;

  return (
    <PageShell
      title={<span className="text-[26px] font-bold tracking-tight">Reuniones</span>}
      subtitle="Videollamadas y reuniones en persona, con la minuta armada por IA desde la grabación."
    >
      {esEquipo && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPresencial(true)}
            className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-violet-600 to-fuchsia-600 p-5 text-left text-white shadow-xl shadow-primary/25 transition-transform hover:-translate-y-0.5"
          >
            <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl transition-transform duration-500 group-hover:scale-125" />
            <span className="relative flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                <Mic className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-lg font-bold leading-tight">Grabar reunión presencial</span>
                <span className="block text-sm text-white/80">Dejá el celu sobre la mesa: sigue grabando con la pantalla bloqueada y la IA arma la minuta.</span>
              </span>
              <AudioLines className="h-6 w-6 shrink-0 text-white/60" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => setNueva(true)}
            className="group relative overflow-hidden rounded-3xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg"
          >
            <span className="relative flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Video className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-lg font-bold leading-tight">Videollamada</span>
                <span className="block text-sm text-muted-foreground">Empezala ahora o agendala. Gratis, sin instalar nada, y les avisamos a todos.</span>
              </span>
              <Plus className="h-6 w-6 shrink-0 text-muted-foreground" />
            </span>
          </button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-5">
        <TabsList className="h-11 rounded-2xl bg-muted/60 p-1">
          <TabsTrigger value="proximas" className="gap-2 rounded-xl px-4 font-semibold data-[state=active]:shadow-sm">
            Próximas
            {proximas.length > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-bold text-primary">{proximas.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="pasadas" className="gap-2 rounded-xl px-4 font-semibold data-[state=active]:shadow-sm">
            Realizadas
            {pasadas.length > 0 && <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] font-bold text-muted-foreground">{pasadas.length}</span>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {lista.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-14 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {tab === "proximas" ? <CalendarClock className="h-7 w-7" /> : <FileText className="h-7 w-7" />}
          </span>
          <p className="text-base font-semibold">{tab === "proximas" ? "No hay reuniones agendadas" : "Todavía no hay reuniones realizadas"}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {tab === "proximas"
              ? "Agendá una videollamada o grabá una reunión en persona. También podés arrancar una llamada desde cualquier chat."
              : "Acá quedan las reuniones que ya pasaron, con su minuta."}
          </p>
        </div>
      ) : tab === "proximas" ? (
        <div className="space-y-6">
          <ProximaHero reunion={proxima} onAbrir={() => abrir(proxima.id)} />
          {resto.length > 0 && (
            <section className="space-y-2.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Después</h2>
              <div className="grid gap-2.5 md:grid-cols-2">
                {resto.map((r) => (
                  <FilaReunion key={r.id} reunion={r} onAbrir={() => abrir(r.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {lista.map((r) => (
            <FilaReunion key={r.id} reunion={r} onAbrir={() => abrir(r.id)} conResumen />
          ))}
        </div>
      )}

      <NuevaReunionDialog open={nueva} onOpenChange={setNueva} onCreada={(id) => abrir(id)} />
      <PresencialDialog open={presencial} onOpenChange={setPresencial} onCreada={(id) => abrir(id)} />
      <ReunionSheet reunion={abierta} onClose={() => abrir(null)} />
    </PageShell>
  );
}

/** Reunión en persona: se crea y se empieza a grabar en un toque (sin videollamada ni invitaciones). */
function PresencialDialog({ open, onOpenChange, onCreada }: { open: boolean; onOpenChange: (v: boolean) => void; onCreada: (id: string) => void }) {
  const { clientes } = useRedes();
  const { user, profile } = useUserProfileContext();
  const [titulo, setTitulo] = useState("");
  const [clienteId, setClienteId] = useState("interna");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitulo("");
    setClienteId("interna");
  }, [open]);

  const cliente = clientes.find((c) => c.id === clienteId);

  const empezar = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const fecha = new Date().toISOString();
      const t = titulo.trim() || (cliente ? `Reunión con ${cliente.nombre}` : "Reunión de equipo");
      const { id } = await crearReunion({ titulo: t, proyecto: cliente ?? null, fecha, participantes: [], chat: null, presencial: true }, user.uid, profile?.nombre ?? "");
      onOpenChange(false);
      onCreada(id);
      await grabarReunion({ id, titulo: t, fecha }, cliente?.nombre ?? "Interno", "presencial");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo empezar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:rounded-3xl">
        <div className="relative overflow-hidden bg-gradient-to-br from-primary via-violet-600 to-fuchsia-600 px-6 pb-6 pt-7 text-white">
          <span className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
          <DialogHeader className="relative space-y-3 text-left">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <Mic className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <DialogTitle className="text-[22px] font-bold tracking-tight text-white">Grabar reunión presencial</DialogTitle>
              <DialogDescription className="text-white/80">Dejá el celu cerca de quienes hablan. Al terminar, la IA arma la minuta sola.</DialogDescription>
            </div>
          </DialogHeader>
        </div>
        <div className="space-y-4 px-6 pt-5">
          <div className="space-y-2">
            <Label className={ETIQUETA}>Tema</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Arranque con el cliente" className={cn(SUAVE, "h-12 text-[15px] font-medium")} />
          </div>
          <div className="space-y-2">
            <Label className={ETIQUETA}>Cliente</Label>
            <ElegirCliente value={clienteId} onChange={setClienteId} clientes={clientes} opciones={[{ value: "interna", label: "Reunión interna" }]} className={cn(SUAVE, "h-12")} />
          </div>
        </div>
        <DialogFooter className="px-6 pb-6 pt-5">
          <Button onClick={() => void empezar()} disabled={saving} className="h-12 w-full rounded-2xl bg-gradient-to-r from-primary to-fuchsia-600 text-base font-semibold shadow-lg shadow-primary/25">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <span className="mr-2 h-2.5 w-2.5 rounded-full bg-white" />}
            Empezar a grabar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bloque de fecha estilo calendario: mes arriba y el día grande. */
function BloqueFecha({ fecha, grande = false }: { fecha: string; grande?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-2xl text-center leading-none",
        grande ? "h-20 w-20 bg-primary text-primary-foreground shadow-lg shadow-primary/25" : "h-12 w-12 bg-primary/10 text-primary"
      )}
    >
      <span className={cn("font-semibold uppercase tracking-wider", grande ? "text-[11px] opacity-90" : "text-[9px]")}>
        {formatearFecha(fecha, { month: "short" }).replace(".", "")}
      </span>
      <span className={cn("font-bold tabular-nums tracking-tight", grande ? "mt-1 text-[32px]" : "mt-0.5 text-lg")}>{formatearFecha(fecha, { day: "numeric" })}</span>
    </span>
  );
}

function Avatares({ ids, max = 5 }: { ids: string[]; max?: number }) {
  const { profiles } = useAppData();
  const extra = ids.length - max;
  return (
    <div className="flex items-center -space-x-2">
      {ids.slice(0, max).map((id) => {
        const p = profiles.find((x) => x.id === id);
        return p ? <UserAvatar key={id} profile={p} size="sm" className="ring-2 ring-card" /> : null;
      })}
      {extra > 0 && (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-card">+{extra}</span>
      )}
    </div>
  );
}

/** La próxima reunión, bien a la vista. */
function ProximaHero({ reunion: r, onAbrir }: { reunion: Reunion; onAbrir: () => void }) {
  const { clienteById } = useRedes();
  const cliente = clienteById(r.proyecto_id);
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-primary/15 to-fuchsia-500/10 blur-2xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <button type="button" onClick={onAbrir} className="flex min-w-0 flex-1 items-center gap-4 text-left">
          <BloqueFecha fecha={r.fecha} grande />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <CalendarClock className="h-3 w-3" /> Próxima
            </span>
            <span className="block truncate text-lg font-bold leading-tight tracking-tight sm:text-xl">{r.titulo}</span>
            <span className="block text-sm capitalize text-muted-foreground">
              {formatearFecha(r.fecha, { weekday: "long", hour: "2-digit", minute: "2-digit" })}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end">
          <div className="flex items-center gap-3">
            {cliente ? <ClienteTag cliente={cliente} /> : <span className="text-xs text-muted-foreground">Interna</span>}
            <Avatares ids={r.participantes} max={4} />
          </div>
          {!r.presencial && (
            <Button asChild className="h-11 rounded-2xl px-5 font-semibold shadow-lg shadow-primary/25">
              <a href={hrefSeguro(r.link)} target="_blank" rel="noreferrer">
                <Video className="mr-2 h-4 w-4" /> Entrar
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FilaReunion({ reunion: r, onAbrir, conResumen = false }: { reunion: Reunion; onAbrir: () => void; conResumen?: boolean }) {
  const { clienteById } = useRedes();
  const cliente = clienteById(r.proyecto_id);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full items-start gap-3 rounded-2xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      <BloqueFecha fecha={r.fecha} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{r.titulo}</span>
          {r.minuta ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">
              <FileText className="h-3 w-3" /> Minuta
            </span>
          ) : r.estado === "realizada" ? (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Sin minuta</span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" /> {fechaHora(r.fecha)}
          </span>
          {cliente ? <ClienteTag cliente={cliente} /> : <span>Interna</span>}
          <span className="inline-flex items-center gap-1">
            {r.presencial ? <MapPin className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
            {r.presencial ? "En persona" : "Videollamada"}
          </span>
        </span>
        {conResumen && r.minuta?.resumen && <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{r.minuta.resumen}</span>}
      </span>
      <span className="hidden self-center sm:block">
        <Avatares ids={r.participantes} max={3} />
      </span>
    </button>
  );
}

function NuevaReunionDialog({
  open,
  onOpenChange,
  onCreada,
  editar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreada?: (id: string) => void;
  /** Con una reunión: se edita (tema, cliente, día y hora, participantes). */
  editar?: Reunion | null;
}) {
  const { clientes, chats, settings } = useRedes();
  const { profiles } = useAppData();
  const { user, profile } = useUserProfileContext();
  const [titulo, setTitulo] = useState("");
  const [clienteId, setClienteId] = useState("interna");
  const [fecha, setFecha] = useState(aInputAR(new Date()));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editar) {
      setTitulo(editar.titulo);
      setClienteId(editar.proyecto_id ?? "interna");
      setFecha(aInputAR(new Date(editar.fecha)));
      setSel(new Set(editar.participantes.filter((id) => id !== user?.uid)));
    } else {
      setTitulo("");
      setClienteId("interna");
      setFecha(aInputAR(new Date(Math.ceil(Date.now() / 1800_000) * 1800_000)));
      setSel(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editar?.id]);

  const cliente = clientes.find((c) => c.id === clienteId);
  // Al elegir un cliente se proponen su equipo y sus usuarios.
  const elegirCliente = (id: string) => {
    setClienteId(id);
    const c = clientes.find((x) => x.id === id);
    if (!c) return;
    const t = c.team_roles ?? {};
    setSel(new Set([...(t.productor ?? []), ...(t.cliente ?? [])]));
  };

  const guardarCambios = async () => {
    if (!user || !editar) return;
    setSaving(true);
    try {
      const nuevaFecha = desdeInputAR(fecha);
      const participantes = Array.from(new Set([...sel, editar.creada_por, user.uid]));
      const nuevoTitulo = titulo.trim() || editar.titulo;
      await actualizarReunion(editar.id, {
        titulo: nuevoTitulo,
        fecha: nuevaFecha,
        participantes,
        proyecto_id: cliente?.id ?? null,
        chat_id: cliente ? (chats.find((c) => c.id === chatClienteId(cliente.id))?.id ?? null) : null,
      });
      // Si cambió el día o la hora, les avisamos a todos; a los nuevos, que los invitaron.
      const cambioFecha = nuevaFecha !== editar.fecha;
      const nuevos = participantes.filter((id) => !editar.participantes.includes(id) && id !== user.uid);
      const resto = participantes.filter((id) => editar.participantes.includes(id) && id !== user.uid);
      if (cambioFecha && resto.length)
        void avisar({
          destinatarios: resto,
          titulo: "Cambió la reunión",
          cuerpo: `${nuevoTitulo} · ahora es el ${fechaHora(nuevaFecha)}`,
          link: `/reuniones?r=${editar.id}`,
          clave: `reunion_cambio:${editar.id}:${nuevaFecha}`,
          proyectoId: cliente?.id ?? null,
        });
      if (nuevos.length)
        void avisar({
          destinatarios: nuevos,
          titulo: "Reunión agendada",
          cuerpo: `${nuevoTitulo} · ${fechaHora(nuevaFecha)}`,
          link: `/reuniones?r=${editar.id}`,
          clave: `reunion:${editar.id}`,
          proyectoId: cliente?.id ?? null,
        });
      onOpenChange(false);
      toast.success(cambioFecha ? "Reunión cambiada. Les avisamos del nuevo horario." : "Reunión actualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const candidatos = profiles.filter((p) => {
    if (p.id === user?.uid || !p.role || p.role === "pending" || ["cm", "pm", "disenador"].includes(p.role)) return false;
    if (p.role !== "cliente") return true;
    return cliente ? (cliente.team_roles?.cliente ?? []).includes(p.id) : false;
  });

  const save = async (ahora: boolean) => {
    if (!user) return;
    setSaving(true);
    try {
      const chat = cliente ? chats.find((c) => c.id === chatClienteId(cliente.id)) ?? null : null;
      const { id, link } = await crearReunion(
        {
          titulo: titulo || (cliente ? `Reunión con ${cliente.nombre}` : "Reunión de equipo"),
          proyecto: cliente ?? null,
          fecha: ahora ? new Date().toISOString() : desdeInputAR(fecha),
          participantes: Array.from(sel),
          chat,
          jitsiBase: settings.jitsi_base,
        },
        user.uid,
        profile?.nombre ?? ""
      );
      onOpenChange(false);
      onCreada?.(id);
      if (ahora) window.open(link, "_blank", "noopener");
      toast.success(ahora ? "Videollamada iniciada. Les avisamos a los participantes." : "Reunión agendada. Les avisamos a los participantes.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-y-auto sm:max-h-[92dvh] sm:rounded-2xl">
        <DialogHeader className="space-y-3 text-left">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Video className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <DialogTitle className="text-[22px] font-bold tracking-tight">{editar ? "Editar reunión" : "Nueva reunión"}</DialogTitle>
            <DialogDescription>
              {editar
                ? "Cambiá el tema, el día y la hora o quiénes participan. El link de la videollamada sigue siendo el mismo."
                : "Se crea un link de videollamada gratis (Jitsi Meet). No hace falta instalar nada."}
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className={ETIQUETA}>Tema</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Planificación de noviembre" className={cn(SUAVE, "h-12 text-[15px] font-medium")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className={ETIQUETA}>Cliente</Label>
              <ElegirCliente
                value={clienteId}
                onChange={elegirCliente}
                clientes={clientes}
                opciones={[{ value: "interna", label: "Reunión interna" }]}
                className={cn(SUAVE, "h-12")}
              />
            </div>
            <div className="space-y-2">
              <Label className={ETIQUETA}>Día y hora</Label>
              <Input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} className={cn(SUAVE, "h-12")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label className={ETIQUETA}>
              Participantes {sel.size > 0 && <span className="font-normal normal-case tracking-normal">· {sel.size}</span>}
            </Label>
            <div className="space-y-0.5 rounded-2xl bg-muted/60 p-1.5 sm:max-h-56 sm:overflow-y-auto">
              {candidatos.map((p) => (
                <label
                  key={p.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
                    sel.has(p.id) ? "bg-background shadow-sm" : "hover:bg-background/60"
                  )}
                >
                  <Checkbox
                    checked={sel.has(p.id)}
                    onCheckedChange={() =>
                      setSel((prev) => {
                        const n = new Set(prev);
                        if (n.has(p.id)) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })
                    }
                  />
                  <UserAvatar profile={p} size="sm" />
                  <span className="flex-1 truncate text-sm font-medium">{p.nombre}</span>
                  {p.role === "cliente" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Cliente</span>}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {editar ? (
            <Button onClick={() => void guardarCambios()} disabled={saving} className="h-12 rounded-2xl px-6 font-semibold shadow-lg shadow-primary/25">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar cambios
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => save(true)} disabled={saving} className="h-12 rounded-2xl font-semibold">
                <Video className="mr-2 h-4 w-4" /> Empezar ahora
              </Button>
              <Button onClick={() => save(false)} disabled={saving} className="h-12 rounded-2xl px-6 font-semibold shadow-lg shadow-primary/25">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Agendar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListaEditable({
  label,
  items,
  onChange,
  editable,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  editable: boolean;
}) {
  if (!editable) {
    if (!items.length) return null;
    return (
      <div className="space-y-1.5">
        <p className={ETIQUETA}>{label}</p>
        <ul className="space-y-1 text-sm">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {t}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className={ETIQUETA}>{label}</p>
      <Textarea
        rows={Math.max(2, items.length + 1)}
        value={items.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
        placeholder="Uno por línea"
        className={SUAVE}
      />
    </div>
  );
}

function ReunionSheet({ reunion, onClose }: { reunion: Reunion | null; onClose: () => void }) {
  const { clienteById, chats } = useRedes();
  const { profiles } = useAppData();
  const { user, role, profile } = useUserProfileContext();
  const esEquipo = role !== "cliente";
  const [notas, setNotas] = useState("");
  const [minuta, setMinuta] = useState<Minuta | null>(null);
  const [editando, setEditando] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editarAbierto, setEditarAbierto] = useState(false);

  useEffect(() => {
    setNotas(reunion?.notas ?? "");
    setMinuta(reunion?.minuta ?? null);
    setEditando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reunion?.id, reunion?.minuta?.generado_at]);

  const grabaciones = reunion?.attachments_crudo ?? [];
  const cliente = clienteById(reunion?.proyecto_id);
  const chat = useMemo(
    () => (reunion?.chat_id ? chats.find((c) => c.id === reunion.chat_id) : cliente ? chats.find((c) => c.id === chatClienteId(cliente.id)) : undefined),
    [reunion?.chat_id, chats, cliente]
  );

  if (!reunion) return null;

  const run = async (k: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(k);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Algo salió mal");
    } finally {
      setBusy(null);
    }
  };

  const limpiar = (m: Minuta): Minuta => ({
    ...m,
    temas: m.temas.map((t) => t.trim()).filter(Boolean),
    acuerdos: m.acuerdos.map((t) => t.trim()).filter(Boolean),
    tareas: m.tareas.filter((t) => t.tarea.trim()),
  });

  return (
    <>
    <NuevaReunionDialog open={editarAbierto} onOpenChange={setEditarAbierto} editar={reunion} />
    <Sheet open={!!reunion} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1.5 border-b px-5 pb-4 pt-5 text-left">
          <div className="flex items-start gap-2 pr-8">
            <SheetTitle className="min-w-0 flex-1 text-[22px] font-bold tracking-tight">{reunion.titulo}</SheetTitle>
            {esEquipo && (
              <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-full" onClick={() => setEditarAbierto(true)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
              </Button>
            )}
          </div>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{fechaHora(reunion.fecha)}</span>
              {cliente && (
                <>
                  <span>·</span>
                  <ClienteTag cliente={cliente} size="md" />
                </>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {reunion.presencial ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <MapPin className="h-3.5 w-3.5" /> Reunión en persona
            </span>
          ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild className="h-11 rounded-2xl px-5 font-semibold shadow-lg shadow-primary/25">
              <a href={hrefSeguro(reunion.link)} target="_blank" rel="noreferrer">
                <Video className="mr-2 h-4 w-4" /> Entrar a la videollamada
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-11 rounded-2xl"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(reunion.link);
                  toast.success("Link copiado");
                } catch {
                  toast.message(reunion.link);
                }
              }}
            >
              Copiar link
            </Button>
          </div>
          )}

          <div className="flex flex-wrap gap-2">
            {reunion.participantes.map((id) => {
              const p = profiles.find((x) => x.id === id);
              return p ? (
                <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 py-0.5 pl-0.5 pr-3 text-xs font-medium">
                  <UserAvatar profile={p} size="sm" /> {p.nombre}
                </span>
              ) : null;
            })}
          </div>

          {esEquipo && (
            <section className="space-y-2.5">
              <h3 className={ETIQUETA}>Grabación</h3>
              <Grabador reunion={reunion} clienteNombre={cliente?.nombre ?? "Interno"} />
              {grabaciones.length > 0 && (
                <ul className="divide-y overflow-hidden rounded-2xl bg-muted/60 text-xs">
                  {grabaciones.map((g, i) => (
                    <li key={i} className="flex items-center gap-2.5 px-3 py-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/12 text-success">
                        <AudioLines className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                      <span className="shrink-0 text-muted-foreground">{(g.size / 1_048_576).toFixed(1)} MB</span>
                      {g.web_view_link && g.web_view_link !== "#" && (
                        <a href={g.web_view_link} target="_blank" rel="noreferrer" className="shrink-0 text-primary" aria-label="Abrir en Drive">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!reunion.presencial && (
                <p className="text-[11px] text-muted-foreground">
                  Videollamada: entrá a la llamada, volvé acá, tocá «Grabar videollamada» y elegí la pestaña de la llamada con «Compartir audio».
                </p>
              )}
            </section>
          )}

          {esEquipo && (
            <section className="space-y-2.5">
              <h3 className={ETIQUETA}>Notas</h3>
              <Textarea
                rows={4}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                onBlur={() => notas !== (reunion.notas ?? "") && void run("notas", () => actualizarReunion(reunion.id, { notas }))}
                placeholder="Anotá lo que se habló (si no hay grabación, la IA arma la minuta con esto)"
                className={SUAVE}
              />
            </section>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={cn(ETIQUETA, "flex items-center gap-1.5")}>
                <FileText className="h-3.5 w-3.5" /> Minuta
              </h3>
              {esEquipo && (
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="rounded-xl font-semibold"
                    disabled={!!busy || (!grabaciones.length && !notas.trim())}
                    title={!grabaciones.length && !notas.trim() ? "Grabá la reunión o escribí notas primero" : undefined}
                    onClick={() =>
                      run(
                        "ia",
                        async () => {
                          if (notas !== (reunion.notas ?? "")) await actualizarReunion(reunion.id, { notas });
                          await generarMinuta(reunion.id, grabaciones.length ? "audio" : "notas");
                        },
                        "Minuta lista"
                      )
                    }
                  >
                    {busy === "ia" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    {busy === "ia" ? "Escuchando la reunión…" : reunion.minuta ? "Regenerar con IA" : "Generar minuta con IA"}
                  </Button>
                  {!editando && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl"
                      onClick={() => {
                        setMinuta(reunion.minuta ?? minutaVacia());
                        setEditando(true);
                      }}
                    >
                      {reunion.minuta ? "Editar" : "Escribir a mano"}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {editando && minuta ? (
              <div className="space-y-3">
                <Textarea rows={3} value={minuta.resumen} onChange={(e) => setMinuta({ ...minuta, resumen: e.target.value })} placeholder="Resumen" className={SUAVE} />
                <ListaEditable label="Temas" items={minuta.temas} onChange={(temas) => setMinuta({ ...minuta, temas })} editable />
                <ListaEditable label="Acuerdos" items={minuta.acuerdos} onChange={(acuerdos) => setMinuta({ ...minuta, acuerdos })} editable />
                <ListaEditable
                  label="Tareas (tarea · responsable · fecha)"
                  items={minuta.tareas.map((t) => [t.tarea, t.responsable, t.fecha].filter(Boolean).join(" · "))}
                  onChange={(lines) =>
                    setMinuta({
                      ...minuta,
                      tareas: lines.map((l) => {
                        const [tarea, responsable, fecha] = l.split(" · ");
                        return { tarea: tarea ?? "", responsable: responsable || null, fecha: fecha || null };
                      }),
                    })
                  }
                  editable
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => setEditando(false)}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-xl font-semibold shadow-lg shadow-primary/25"
                    onClick={() =>
                      run(
                        "guardar",
                        async () => {
                          await actualizarReunion(reunion.id, {
                            minuta: { ...limpiar(minuta), fuente: reunion.minuta?.fuente ?? "manual", generado_at: new Date().toISOString() },
                            estado: "realizada",
                          });
                          setEditando(false);
                        },
                        "Minuta guardada"
                      )
                    }
                  >
                    Guardar minuta
                  </Button>
                </div>
              </div>
            ) : reunion.minuta ? (
              <div className="space-y-4 rounded-2xl border bg-card p-4">
                <p className="text-sm leading-relaxed">{reunion.minuta.resumen}</p>
                <ListaEditable label="Temas" items={reunion.minuta.temas} onChange={() => undefined} editable={false} />
                <ListaEditable label="Acuerdos" items={reunion.minuta.acuerdos} onChange={() => undefined} editable={false} />
                {reunion.minuta.tareas.length > 0 && (
                  <div className="space-y-1.5">
                    <p className={ETIQUETA}>Tareas</p>
                    <div className="divide-y overflow-hidden rounded-xl bg-muted/60">
                      {reunion.minuta.tareas.map((t, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                          <span className="flex-1">{t.tarea}</span>
                          {t.responsable && <span className="text-xs font-medium text-primary">{t.responsable}</span>}
                          {t.fecha && <span className="text-xs text-muted-foreground">{t.fecha}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {reunion.minuta.fuente === "audio" ? "Armada por IA a partir de la grabación" : reunion.minuta.fuente === "notas" ? "Armada por IA a partir de las notas" : "Escrita a mano"} ·{" "}
                  {fechaHora(reunion.minuta.generado_at)}
                </p>
                {esEquipo && chat && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={busy === "share"}
                    onClick={() => run("share", () => compartirMinuta(reunion, chat, user?.uid ?? "", profile?.nombre ?? ""), "Minuta enviada al chat")}
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" /> Mandar al chat {cliente ? `de ${cliente.nombre}` : ""}
                  </Button>
                )}
              </div>
            ) : (
              <p className={cn("rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground")}>
                {esEquipo ? "Grabá la reunión o escribí notas y tocá «Generar minuta con IA»." : "Cuando el equipo cargue la minuta, la vas a ver acá."}
              </p>
            )}
          </section>

          {esEquipo && reunion.estado !== "realizada" && (
            <Button variant="ghost" size="sm" onClick={() => run("hecha", () => actualizarReunion(reunion.id, { estado: "realizada" }), "Marcada como realizada")}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Marcar como realizada
            </Button>
          )}
          {role === "admin" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                run("del", async () => {
                  assertEditable();
                  await deleteDoc(doc(db, "reuniones", reunion.id));
                  onClose();
                }, "Reunión eliminada")
              }
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Eliminar
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}
