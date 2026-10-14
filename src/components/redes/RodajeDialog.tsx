import { useEffect, useMemo, useState } from "react";
import { es } from "date-fns/locale";
import { CalendarDays, Check, Clapperboard, Clock, Loader2, MapPin, Plus, Sparkles } from "lucide-react";
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
import { EtapaBadge } from "./EtapaBadge";

const HORAS = ["09:00", "10:00", "11:00", "14:00", "16:00", "18:00"];

/** "jueves 15 de octubre" */
const fechaLarga = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        activo ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-muted/40 text-foreground hover:border-primary/50 hover:bg-primary/10"
      )}
    >
      {children}
    </button>
  );
}

/** Agenda (o edita) una jornada de filmación con varios videos. */
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
  const { clientes, videos } = useRedes();
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
      setFecha(sumarDias(hoyISO(), 1));
      setHora("10:00");
      setLugar("");
      setNotas("");
      setPreparar("");
      setSel(new Set(preseleccion ?? []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rodaje?.id, clienteInicial]);

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
    if (!cliente || !user) return;
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
  const rapidas = [
    { label: "Hoy", f: hoy },
    { label: "Mañana", f: sumarDias(hoy, 1) },
    { label: "Pasado", f: sumarDias(hoy, 2) },
  ];
  const otraHora = !!hora && !HORAS.includes(hora);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[92dvh]">
        <div className="border-b bg-gradient-to-r from-primary/[0.08] via-background to-fuchsia-500/[0.06] px-5 pb-4 pt-5">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Clapperboard className="h-4 w-4" />
              </span>
              {rodaje ? "Editar rodaje" : "Agendar rodaje"}
            </DialogTitle>
            <DialogDescription>Elegí cliente, día y hora. Todos los videos marcados se filman en la misma jornada.</DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[calc(92dvh-170px)] space-y-5 overflow-y-auto px-5 py-4">
          {/* Cliente */}
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Select
              value={clienteId}
              onValueChange={(v) => {
                setClienteId(v);
                setSel(new Set());
                setPendientes({});
              }}
              disabled={!!rodaje}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Elegí un cliente" />
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
          </div>

          {/* Día */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> Día
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {rapidas.map((r) => (
                <Chip key={r.label} activo={fecha === r.f} onClick={() => setFecha(r.f)}>
                  {r.label}
                </Chip>
              ))}
            </div>
            <Popover open={calAbierto} onOpenChange={setCalAbierto}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-11 w-full items-center gap-2 rounded-xl border bg-background px-3 text-left text-sm transition-colors hover:border-primary/50"
                >
                  <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                  <span className={cn("flex-1 first-letter:uppercase", !fecha && "text-muted-foreground")}>{fecha ? fechaLarga(fecha) : "Elegí el día"}</span>
                  <span className="text-xs text-muted-foreground">Cambiar</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
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

          {/* Hora */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Hora
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {HORAS.map((h) => (
                <Chip
                  key={h}
                  activo={hora === h && !verOtra}
                  onClick={() => {
                    setHora(h);
                    setVerOtra(false);
                  }}
                >
                  {h}
                </Chip>
              ))}
              {verOtra || otraHora ? (
                <Input
                  type="time"
                  autoFocus={verOtra && !otraHora}
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  aria-label="Otra hora"
                  className="h-8 w-[7.5rem] rounded-full border-primary text-xs ring-1 ring-primary"
                />
              ) : (
                <Chip activo={false} onClick={() => setVerOtra(true)}>
                  Otra…
                </Chip>
              )}
            </div>
          </div>

          {/* Lugar */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> Lugar
            </Label>
            <Input className="h-11" value={lugar} onChange={(e) => setLugar(e.target.value)} placeholder="Dirección o lugar de filmación" />
          </div>

          {/* Videos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Videos a filmar</Label>
              {sel.size > 0 && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">{sel.size} elegidos</span>}
            </div>
            {!clienteId ? (
              <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Elegí un cliente primero.</p>
            ) : (
              <div className="space-y-1.5">
                {candidatos.map((v) => {
                  const marcado = sel.has(v.id);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => toggle(v.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                        marcado ? "border-primary/60 bg-primary/[0.07]" : "hover:bg-muted/50"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                          marcado ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                        )}
                      >
                        {marcado && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{v.titulo}</span>
                        <span className="text-[11px] text-muted-foreground">{mesLabel(v.mes)}</span>
                      </span>
                      <EtapaBadge etapa={v.etapa} />
                    </button>
                  );
                })}
                {sinLlegar.map(([id, titulo]) => (
                  <div key={id} className="flex items-center gap-3 rounded-xl border border-primary/60 bg-primary/[0.07] px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="truncate text-sm font-medium">{titulo}</span>
                  </div>
                ))}
                {candidatos.length === 0 && sinLlegar.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {puedeCrear ? "No tiene videos planificados sin rodaje. Cargá acá lo que van a filmar:" : "Este cliente filma él mismo: sus videos no llevan rodaje."}
                  </p>
                )}
                {puedeCrear && (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void crear();
                    }}
                  >
                    <Input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nuevo video: ej. Reel del producto estrella" className="h-10" />
                    <Button type="submit" variant="outline" className="h-10 shrink-0" disabled={creando || nuevo.trim().length < 3}>
                      {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      <span className="ml-1.5 hidden sm:inline">Agregar</span>
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>

          {/* Para el cliente */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Qué tiene que tener listo el cliente</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
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
            <Textarea value={preparar} onChange={(e) => setPreparar(e.target.value)} rows={2} placeholder="Productos, personas, vestuario, local ordenado…" />
            <p className="text-[11px] text-muted-foreground">Se lo mandamos al cliente el día anterior junto con la hora y el lugar.</p>
          </div>

          {/* Para el equipo */}
          <div className="space-y-1.5">
            <Label>Notas para el equipo</Label>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Equipo a llevar, luces, quién va…" />
          </div>
        </div>

        {/* Resumen + guardar */}
        <div className="flex flex-col gap-2 border-t bg-muted/20 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground first-letter:uppercase">
            {fecha ? `${fechaLarga(fecha)}${hora ? ` · ${hora} h` : ""}` : "Sin fecha"}
            {cliente ? ` · ${cliente.nombre}` : ""}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving || !cliente || (sel.size === 0 && !(puedeCrear && nuevo.trim().length >= 3))}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {rodaje ? "Guardar cambios" : "Agendar rodaje"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
