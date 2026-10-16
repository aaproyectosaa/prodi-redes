import { useEffect, useMemo, useRef, useState } from "react";
import { es } from "date-fns/locale";
import { Building2, CalendarDays, Check, ChevronDown, Clapperboard, Film, History, Loader2, MapPin, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { agendarRodaje, actualizarRodaje, crearVideos } from "@/lib/redes/videos";
import { quienFilma } from "@/lib/redes/etapas";
import { hoyISO, mesActual, mesLabel } from "@/lib/redes/format";
import { sumarDias } from "@/lib/fecha";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";
import type { Rodaje, Video } from "@/lib/redes/types";

const HORAS = ["08:00", "09:00", "10:00", "11:00", "14:00", "16:00", "18:00"];

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const iniciales = (n: string) =>
  n
    .split(/s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

/** Agenda (o edita) una jornada de filmación con varios videos. */
/**
 * Lo que se puede sacar del pedido del cliente para el rodaje: el lugar (localidad del viático), el día (unos días
 * antes de cuando lo quiere publicado, respetando si prefiere fines de semana), la hora (mañana o tarde) y una nota.
 */
function desdePedido(v: Video): { fecha: string; hora: string; lugar: string | null; notas: string } {
  const manana = sumarDias(hoyISO(), 1);
  const pref = v.material_base?.preferencia ?? null;
  // 3 días antes de publicar (para editar), nunca antes de mañana.
  let fecha = v.fecha_deseada ? sumarDias(v.fecha_deseada, -3) : manana;
  if (fecha < manana) fecha = manana;
  const dia = (f: string) => new Date(`${f}T12:00:00`).getDay();
  if (pref === "Fines de semana") {
    // El sábado más cercano (antes de la fecha si se puede).
    let s = fecha;
    while (dia(s) !== 6 && s > manana) s = sumarDias(s, -1);
    if (dia(s) !== 6) {
      s = fecha;
      while (dia(s) !== 6) s = sumarDias(s, 1);
    }
    fecha = s;
  } else if (dia(fecha) === 0) {
    // Domingo no: el viernes antes (o el lunes si ya no da).
    fecha = sumarDias(fecha, -2) >= manana ? sumarDias(fecha, -2) : sumarDias(fecha, 1);
  }
  const hora = pref === "Tardes" ? "16:00" : "10:00";
  const lugar = v.viatico?.localidad ?? null;
  const fechaPub = v.fecha_deseada
    ? new Date(`${v.fecha_deseada}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).replace(/[.,]/g, "")
    : null;
  const notas = [
    "Pedido del cliente",
    pref ? `prefiere ${pref.toLowerCase()}` : null,
    fechaPub ? `lo quiere publicado el ${fechaPub}` : null,
    v.viatico?.km != null ? `${v.viatico.localidad} (${v.viatico.km} km)` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { fecha, hora, lugar, notas };
}

export function RodajeDialog({
  open,
  onOpenChange,
  clienteId: clienteInicial,
  rodaje,
  preseleccion,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clienteId?: string;
  rodaje?: Rodaje | null;
  preseleccion?: string[];
}) {
  const { clientes, videos, rodajes } = useRedes();
  const { user } = useUserProfileContext();
  const [clienteId, setClienteId] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [hora, setHora] = useState("10:00");
  const [lugar, setLugar] = useState("");
  const [notas, setNotas] = useState("");
  const [preparar, setPreparar] = useState("");
  const [sugiriendo, setSugiriendo] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [calAbierto, setCalAbierto] = useState(false);
  const [verOtra, setVerOtra] = useState(false);
  const [detalles, setDetalles] = useState(false);
  // Si viene de un pedido del cliente: con qué se completó (para avisarlo arriba).
  const [autoDe, setAutoDe] = useState<string | null>(null);
  const tira = useRef<HTMLDivElement>(null);
  // Video nuevo cargado desde acá (si el cliente no tiene nada planificado).
  const [nuevo, setNuevo] = useState("");
  const [creando, setCreando] = useState(false);
  // Recién creados que todavía no llegaron de la base: se muestran igual.
  const [pendientes, setPendientes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setNuevo("");
    setPendientes({});
    setVerOtra(!!rodaje?.hora && !HORAS.includes(rodaje.hora));
    setDetalles(!!(rodaje?.preparar || rodaje?.notas));
    if (rodaje) {
      setClienteId(rodaje.proyecto_id);
      setFecha(rodaje.fecha);
      setHora(rodaje.hora ?? "");
      setLugar(rodaje.lugar ?? "");
      setNotas(rodaje.notas ?? "");
      setPreparar(rodaje.preparar ?? "");
      setSel(new Set(rodaje.video_ids));
    } else {
      setClienteId(clienteInicial ?? "");
      setPreparar("");
      setSel(new Set(preseleccion ?? []));
      // Pedido del cliente: se completa con lo que pidió (lugar, día, hora y notas). Todo se puede cambiar.
      const pedido = videos.find((v) => preseleccion?.includes(v.id) && v.pedido_cliente);
      const auto = pedido ? desdePedido(pedido) : null;
      const ultimo = rodajes.filter((r) => r.proyecto_id === clienteInicial && r.lugar).sort((a, b) => b.fecha.localeCompare(a.fecha))[0]?.lugar ?? "";
      setFecha(auto?.fecha ?? sumarDias(hoyISO(), 1));
      setHora(auto?.hora ?? "10:00");
      setLugar(auto?.lugar ?? ultimo);
      setNotas(auto?.notas ?? "");
      setAutoDe(auto ? pedido!.titulo : null);
      if (auto?.notas) setDetalles(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rodaje?.id, clienteInicial, (preseleccion ?? []).join(",")]);

  const cliente = clientes.find((c) => c.id === clienteId);
  const candidatos = useMemo(
    () =>
      videos
        .filter(
          (v) =>
            v.proyecto_id === clienteId &&
            (v.etapa === "planificado" || (rodaje && v.rodaje_id === rodaje.id && v.etapa === "agendado") || (v.etapa === "agendado" && !v.rodaje_id))
        )
        .sort((a, b) => a.mes.localeCompare(b.mes) || a.created_at.localeCompare(b.created_at)),
    [videos, clienteId, rodaje]
  );
  const sinLlegar = Object.entries(pendientes).filter(([id]) => !candidatos.some((v) => v.id === id));
  // Si el cliente filma siempre él, sus videos no llevan rodaje: no se cargan desde acá.
  const puedeCrear = !!cliente && quienFilma(cliente) !== "cliente";

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const crear = async () => {
    if (!cliente || !user || nuevo.trim().length < 3) return;
    setCreando(true);
    try {
      const [id] = await crearVideos(cliente, [{ titulo: nuevo.trim() }], mesActual(), user.uid);
      setPendientes((p) => ({ ...p, [id]: nuevo.trim() }));
      setSel((s) => new Set([...s, id]));
      setNuevo("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear el video");
    } finally {
      setCreando(false);
    }
  };

  const save = async () => {
    if (!user) return;
    if (!cliente) {
      toast.error("Elegí el cliente");
      return;
    }
    if (!fecha) {
      toast.error("Poné la fecha del rodaje");
      return;
    }
    setSaving(true);
    // Lo que quedó escrito en "Nuevo video" sin tocar Agregar, también va.
    const ids = new Set(sel);
    const recien: Record<string, string> = { ...pendientes };
    if (puedeCrear && nuevo.trim().length >= 3) {
      try {
        const [id] = await crearVideos(cliente, [{ titulo: nuevo.trim() }], mesActual(), user.uid);
        ids.add(id);
        recien[id] = nuevo.trim();
        setPendientes(recien);
        setSel(new Set(ids));
        setNuevo("");
      } catch (err) {
        setSaving(false);
        toast.error(err instanceof Error ? err.message : "No se pudo crear el video");
        return;
      }
    }
    const elegidos = videos.filter((v) => ids.has(v.id));
    // Recién creados que todavía no llegaron de la base: alcanza con el id (están planificados).
    const ts = new Date().toISOString();
    for (const id of Object.keys(recien)) {
      if (ids.has(id) && !elegidos.some((v) => v.id === id)) elegidos.push({ id, etapa: "planificado", etapa_desde: ts } as Video);
    }
    // Los videos del rodaje que ya avanzaron (se filmaron) se mantienen.
    if (rodaje) {
      for (const v of videos) {
        if (v.rodaje_id === rodaje.id && v.etapa !== "agendado" && !sel.has(v.id)) elegidos.push(v);
      }
    }
    if (elegidos.length === 0) {
      setSaving(false);
      toast.error("Elegí o cargá al menos un video para filmar");
      return;
    }
    try {
      const datos = { fecha, hora: hora || null, lugar: lugar || null, notas: notas || null, preparar: preparar.trim() || null };
      if (rodaje) {
        await actualizarRodaje(rodaje, { ...datos, video_ids: elegidos.map((v) => v.id) }, elegidos, user.uid, videos);
        toast.success("Rodaje actualizado");
      } else {
        await agendarRodaje(cliente, datos, elegidos, user.uid);
        toast.success("Rodaje agendado. Le avisamos al cliente.");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const hoy = hoyISO();
  // Tira de días (como las apps de turnos): los próximos 21; si se eligió otro del calendario, va primero.
  const dias = Array.from({ length: 21 }, (_, i) => sumarDias(hoy, i));
  if (fecha && !dias.includes(fecha)) dias.unshift(fecha);
  const otraHora = !!hora && !HORAS.includes(hora);
  // Para no escribir de nuevo la dirección: el lugar del último rodaje de este cliente.
  const ultimoLugar = useMemo(
    () =>
      rodajes
        .filter((r) => r.proyecto_id === clienteId && r.lugar && r.id !== rodaje?.id)
        .sort((a, b) => b.fecha.localeCompare(a.fecha))[0]?.lugar ?? null,
    [rodajes, clienteId, rodaje?.id]
  );
  // El día elegido queda a la vista en la tira (al abrir o al elegirlo en el calendario).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const el = tira.current?.querySelector<HTMLElement>(`[data-dia="${fecha}"]`);
      const cont = tira.current;
      if (el && cont) cont.scrollTo({ left: el.offsetLeft - cont.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
    }, 50);
    return () => clearTimeout(id);
  }, [fecha, open]);
  const cantidad = sel.size + (puedeCrear && nuevo.trim().length >= 3 ? 1 : 0);
  const listo = !!cliente && !!fecha && cantidad > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] max-w-xl flex-col gap-0 overflow-hidden rounded-3xl border-white/10 p-0 sm:max-h-[94dvh]">
        {/* Encabezado */}
        <div className="relative shrink-0 overflow-hidden px-6 pb-5 pt-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-primary/25 blur-3xl" />
          <div className="pointer-events-none absolute -left-10 top-6 h-32 w-32 rounded-full bg-fuchsia-500/15 blur-3xl" />
          <DialogHeader className="relative space-y-1 text-left">
            <DialogTitle className="flex items-center gap-3 text-xl font-bold tracking-tight">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white shadow-lg shadow-primary/30">
                <Clapperboard className="h-5 w-5" />
              </span>
              {rodaje ? "Editar rodaje" : "Nuevo rodaje"}
            </DialogTitle>
            <DialogDescription>Elegí el cliente, el día y la hora. Le avisamos solo.</DialogDescription>
          </DialogHeader>
        </div>

        {/* Lo único que scrollea: así el botón de abajo siempre se ve (también en el celular). */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-6 pb-6">
          {!rodaje && autoDe && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-primary/30 bg-primary/[0.08] px-3.5 py-2.5 text-sm">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                <b>Ya lo completamos con el pedido</b> «{autoDe}»: lugar, día y hora. Revisalo y cambiá lo que haga falta.
              </p>
            </div>
          )}
          {/* Cliente */}
          <Select
            value={clienteId}
            onValueChange={(v) => {
              setClienteId(v);
              setSel(new Set());
              setPendientes({});
            }}
            disabled={!!rodaje}
          >
            <SelectTrigger className="h-14 rounded-2xl border-white/10 bg-muted/40 px-4 text-base font-medium">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-xs font-bold text-primary">
                  {cliente ? iniciales(cliente.nombre ?? "") : <Building2 className="h-4 w-4" />}
                </div>
                <div className="min-w-0 truncate">
                  <SelectValue placeholder="¿Para qué cliente?" />
                </div>
              </div>
            </SelectTrigger>
            <SelectContent>
              {[...clientes]
                .sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""))
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          {/* Día */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">¿Qué día?</p>
              <Popover open={calAbierto} onOpenChange={setCalAbierto}>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
                    <CalendarDays className="h-3.5 w-3.5" /> Ver calendario
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto rounded-2xl p-0" align="end">
                  <Calendar
                    mode="single"
                    locale={es}
                    weekStartsOn={1}
                    selected={fecha ? new Date(`${fecha}T12:00:00`) : undefined}
                    defaultMonth={fecha ? new Date(`${fecha}T12:00:00`) : undefined}
                    onSelect={(d) => {
                      if (!d) return;
                      setFecha(isoLocal(d));
                      setCalAbierto(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div ref={tira} className="relative -mx-6 flex snap-x scroll-px-6 gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {dias.map((d) => {
                const activo = d === fecha;
                const dt = new Date(`${d}T12:00:00`);
                const arriba = d === hoy ? "Hoy" : d === sumarDias(hoy, 1) ? "Mañana" : dt.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
                const finde = dt.getDay() === 0 || dt.getDay() === 6;
                return (
                  <button
                    key={d}
                    type="button"
                    data-dia={d}
                    onClick={() => setFecha(d)}
                    className={cn(
                      "flex w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-2xl border py-2.5 transition-all",
                      activo
                        ? "border-transparent bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white shadow-lg shadow-primary/30"
                        : "border-white/10 bg-muted/30 hover:border-primary/40 hover:bg-primary/10",
                      !activo && finde && "opacity-60"
                    )}
                  >
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wide", activo ? "text-white/85" : "text-muted-foreground")}>{arriba}</span>
                    <span className="text-xl font-bold leading-tight tabular-nums">{dt.getDate()}</span>
                    <span className={cn("text-[10px] capitalize", activo ? "text-white/85" : "text-muted-foreground")}>
                      {dt.toLocaleDateString("es-AR", { month: "short" }).replace(".", "")}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Hora */}
          <section className="space-y-2.5">
            <p className="text-sm font-semibold">¿A qué hora?</p>
            <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-muted/30 p-1.5 sm:grid-cols-8">
              {HORAS.map((h) => {
                const activo = hora === h && !verOtra;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      setHora(h);
                      setVerOtra(false);
                    }}
                    className={cn(
                      "h-10 rounded-xl text-sm font-semibold tabular-nums transition-all",
                      activo ? "bg-background text-primary shadow-md ring-1 ring-primary/40" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    )}
                  >
                    {h}
                  </button>
                );
              })}
              {verOtra || otraHora ? (
                <input
                  type="time"
                  autoFocus={verOtra && !otraHora}
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  aria-label="Otra hora"
                  className="h-10 rounded-xl bg-background px-2 text-center text-sm font-semibold text-primary shadow-md outline-none ring-1 ring-primary/40"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setVerOtra(true)}
                  className="h-10 rounded-xl text-sm font-medium text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
                >
                  Otra
                </button>
              )}
            </div>
          </section>

          {/* Lugar */}
          <section className="space-y-2.5">
            <p className="text-sm font-semibold">¿Dónde?</p>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <Input
                value={lugar}
                onChange={(e) => setLugar(e.target.value)}
                placeholder="Dirección o lugar de filmación"
                className="h-12 rounded-2xl border-white/10 bg-muted/30 pl-11 text-[15px]"
              />
            </div>
            {ultimoLugar && !lugar && (
              <button
                type="button"
                onClick={() => setLugar(ultimoLugar)}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-muted/30 px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                <History className="h-3 w-3 shrink-0" /> <span className="truncate">Como la última vez: {ultimoLugar}</span>
              </button>
            )}
          </section>

          {/* Videos */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">¿Qué se filma?</p>
              {cantidad > 0 && (
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                  {cantidad} video{cantidad === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {!clienteId ? (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-muted-foreground">
                <Film className="h-5 w-5 shrink-0" /> Elegí el cliente y te mostramos sus videos planificados.
              </div>
            ) : (
              <div className="space-y-2">
                {candidatos.map((v) => {
                  const marcado = sel.has(v.id);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => toggle(v.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all",
                        marcado ? "border-primary/50 bg-primary/[0.08] shadow-sm" : "border-white/10 bg-muted/20 hover:bg-muted/40"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          marcado ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                        )}
                      >
                        {marcado && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{v.titulo}</span>
                        <span className="text-xs capitalize text-muted-foreground">{mesLabel(v.mes)}</span>
                      </span>
                    </button>
                  );
                })}
                {sinLlegar.map(([id, titulo]) => (
                  <div key={id} className="flex items-center gap-3 rounded-2xl border border-primary/50 bg-primary/[0.08] px-4 py-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span className="truncate text-sm font-semibold">{titulo}</span>
                  </div>
                ))}
                {puedeCrear ? (
                  <form
                    className="relative"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void crear();
                    }}
                  >
                    <Plus className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={nuevo}
                      onChange={(e) => setNuevo(e.target.value)}
                      placeholder={candidatos.length || sinLlegar.length ? "Sumar otro video…" : "¿Qué van a filmar? Ej: Reel con drone"}
                      className="h-12 rounded-2xl border-dashed border-white/15 bg-transparent pl-11 pr-24 text-[15px]"
                    />
                    {nuevo.trim().length >= 3 && (
                      <Button type="submit" size="sm" disabled={creando} className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-xl">
                        {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sumar"}
                      </Button>
                    )}
                  </form>
                ) : (
                  candidatos.length === 0 && <p className="text-xs text-muted-foreground">Este cliente filma él mismo: sus videos no llevan rodaje.</p>
                )}
              </div>
            )}
          </section>

          {/* Más detalles (opcional) */}
          <section className="rounded-2xl border border-white/10 bg-muted/20">
            <button type="button" onClick={() => setDetalles((d) => !d)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span>
                <span className="block text-sm font-semibold">Más detalles</span>
                <span className="text-xs text-muted-foreground">Qué tiene que tener listo el cliente y notas para el equipo</span>
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", detalles && "rotate-180")} />
            </button>
            {detalles && (
              <div className="space-y-4 border-t border-white/10 px-4 pb-4 pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Para el cliente</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-full text-xs text-primary"
                      disabled={!clienteId || sel.size === 0 || sugiriendo}
                      onClick={async () => {
                        setSugiriendo(true);
                        try {
                          const r = await callApi<{ texto: string }>("/api/ia/preparar", { proyecto_id: clienteId, video_ids: Array.from(sel) });
                          setPreparar(r.texto);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "No se pudo sugerir");
                        } finally {
                          setSugiriendo(false);
                        }
                      }}
                    >
                      {sugiriendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                      Sugerir con IA
                    </Button>
                  </div>
                  <Textarea
                    value={preparar}
                    onChange={(e) => setPreparar(e.target.value)}
                    rows={2}
                    className="rounded-xl border-white/10 bg-background/50"
                    placeholder="Productos, personas, vestuario, local ordenado…"
                  />
                  <p className="text-[11px] text-muted-foreground">Se lo mandamos el día anterior junto con la hora y el lugar.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Para el equipo</Label>
                  <Textarea
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                    rows={2}
                    className="rounded-xl border-white/10 bg-background/50"
                    placeholder="Equipo a llevar, luces, quién va…"
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Resumen + guardar */}
        <div className="flex shrink-0 items-center gap-3 border-t border-white/10 bg-muted/20 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {fecha && (
              <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-background shadow-sm ring-1 ring-white/10">
                <span className="text-[9px] font-semibold uppercase leading-none text-primary">
                  {new Date(`${fecha}T12:00:00`).toLocaleDateString("es-AR", { month: "short" }).replace(".", "")}
                </span>
                <span className="text-base font-bold leading-tight">{Number(fecha.slice(8))}</span>
              </span>
            )}
            <div className="min-w-0 text-xs leading-snug">
              <p className="truncate font-semibold first-letter:uppercase">
                {fecha ? new Date(`${fecha}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long" }) : "Sin día"}
                {hora ? ` · ${hora} h` : ""}
              </p>
              <p className="truncate text-muted-foreground">{!cliente ? "Elegí un cliente" : !fecha ? "Falta elegir el día" : cantidad === 0 ? "Falta elegir los videos" : cliente.nombre}</p>
            </div>
          </div>
          <Button
            onClick={save}
            // Se puede tocar aunque falte algo: así dice qué falta (día, cliente o videos) en vez de quedar gris sin explicar.
            disabled={saving}
            className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-[#6F40FC] to-[#E040A0] px-5 font-semibold text-white shadow-lg shadow-primary/30 transition-transform hover:-translate-y-0.5 hover:opacity-95 disabled:shadow-none"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {rodaje ? "Guardar cambios" : "Agendar rodaje"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
