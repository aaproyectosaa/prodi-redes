import { useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell } from "@/components/redes/PageShell";
import { VideoCard } from "@/components/redes/VideoCard";
import { PlanificarDialog } from "@/components/redes/PlanificarDialog";
import { RodajeDialog } from "@/components/redes/RodajeDialog";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { ETAPAS, estaTrabado, etapaInfo } from "@/lib/redes/etapas";
import { mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { canManageProduction } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { forzarEtapa } from "@/lib/redes/videos";
import type { EtapaVideo } from "@/lib/redes/types";
import { tableroDe, type TableroRol } from "@/lib/redes/tableros";
import { SelectorVista, VistaCalendario, useVista } from "@/components/redes/VistaCalendario";
import { BotonArmarMes, PlanesAviso } from "@/components/redes/PlanesAviso";

/** Kanban: el equipo ve su tablero; el admin, todo el recorrido. */
export default function Circuito() {
  const { role } = useUserProfileContext();
  const tablero = tableroDe(role);
  return tablero ? <TableroEquipo tablero={tablero} /> : <CircuitoCompleto />;
}

function TableroEquipo({ tablero }: { tablero: TableroRol }) {
  const { videos, clientes } = useRedes();
  const { role, user } = useUserProfileContext();
  const uid = user?.uid ?? "";
  const [cliente, setCliente] = useState("todos");
  const [planificar, setPlanificar] = useState(false);
  const [rodaje, setRodaje] = useState(false);
  const esProd = role === "productor";
  const [vista, setVista] = useVista(`equipo-${role}`);

  const mios = useMemo(
    () => videos.filter((v) => tablero.esMio(v, uid) && (cliente === "todos" || v.proyecto_id === cliente)),
    [videos, tablero, uid, cliente]
  );

  return (
    <PageShell
      title={tablero.titulo}
      subtitle={tablero.ayuda}
      className="max-w-none"
      actions={
        <>
          {clientes.length > 1 && (
            <Select value={cliente} onValueChange={setCliente}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos mis clientes</SelectItem>
                {clientes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {esProd && (
            <>
              <BotonArmarMes clienteId={cliente === "todos" ? null : cliente} />
              <Button variant="outline" onClick={() => setRodaje(true)}>
                <CalendarPlus className="mr-2 h-4 w-4" /> Agendar rodaje
              </Button>
              <Button onClick={() => setPlanificar(true)}>
                <Plus className="mr-2 h-4 w-4" /> Planificar
              </Button>
            </>
          )}
        </>
      }
    >
      {esProd && <PlanesAviso />}
      <div className="mb-4">
        <SelectorVista vista={vista} onChange={setVista} />
      </div>
      {vista === "calendario" ? (
        <VistaCalendario videos={mios} />
      ) : (
      <div className="-mx-4 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:snap-none md:px-8">
        <div className="flex min-w-max gap-3">
          {tablero.columnas.map((col) => {
            const items = mios
              .filter((v) => tablero.columnaDe(v) === col.id)
              .sort((a, b) => a.etapa_desde.localeCompare(b.etapa_desde));
            const activa = col.tuya && items.length > 0;
            return (
              <div
                key={col.id}
                className={cn(
                  "flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border sm:w-72",
                  activa ? "border-primary/40 bg-primary/[0.05]" : "bg-muted/30"
                )}
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
                  {items.map((v) => (
                    <VideoCard key={v.id} video={v} showEtapa={false} accion={col.tuya ? col.accion : undefined} />
                  ))}
                  {items.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground/70">
                      {col.tuya ? "Nada pendiente 👌" : "Vacío"}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
      {esProd && (
        <>
          <PlanificarDialog open={planificar} onOpenChange={setPlanificar} />
          <RodajeDialog open={rodaje} onOpenChange={setRodaje} />
        </>
      )}
    </PageShell>
  );
}

/** Vista del super admin: todas las etapas, con filtros. */
function CircuitoCompleto() {
  const { videos, clientes, settings } = useRedes();
  const { role, user } = useUserProfileContext();
  // Super admin: arrastra una tarjeta a otra columna para cambiar el video de etapa (como "Mover a…" en el video).
  const arrastra = role === "admin" && !!user;
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<EtapaVideo | null>(null);
  const soltar = async (etapa: EtapaVideo, id: string) => {
    setArrastrando(null);
    setSobre(null);
    const v = videos.find((x) => x.id === id);
    if (!v || !user || v.etapa === etapa) return;
    try {
      await forzarEtapa(v, etapa, user.uid);
      toast.success(`«${v.titulo}» pasó a ${etapaInfo(etapa).label}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mover");
    }
  };
  const [cliente, setCliente] = useState("todos");
  const [mes, setMes] = useState<string>("activos");
  const [q, setQ] = useState("");
  const [soloTrabados, setSoloTrabados] = useState(false);
  const [planificar, setPlanificar] = useState(false);
  const [vista, setVista] = useVista("circuito");

  const meses = [0, -1, -2, -3, 1].map((d) => sumarMeses(mesActual(), d));

  const filtrados = useMemo(() => {
    const text = q.trim().toLowerCase();
    return videos.filter((v) => {
      if (cliente !== "todos" && v.proyecto_id !== cliente) return false;
      if (mes === "activos") {
        // Todo lo que no está publicado + lo publicado este mes.
        if (v.etapa === "publicado" && v.mes !== mesActual()) return false;
      } else if (v.mes !== mes) return false;
      if (soloTrabados && !estaTrabado(v, settings.dias_alerta)) return false;
      if (text && !v.titulo.toLowerCase().includes(text)) return false;
      return true;
    });
  }, [videos, cliente, mes, q, soloTrabados, settings.dias_alerta]);

  // El calendario muestra todo (sin el filtro de mes): se navega mes a mes.
  const paraCalendario = videos.filter(
    (v) => (cliente === "todos" || v.proyecto_id === cliente) && (!q.trim() || v.titulo.toLowerCase().includes(q.trim().toLowerCase()))
  );
  const trabados = filtrados.filter((v) => estaTrabado(v, settings.dias_alerta)).length;

  return (
    <PageShell
      title="Videos"
      subtitle="Dónde está cada video, de la idea a la pauta."
      className="max-w-none"
      actions={
        canManageProduction(role) && (
          <>
            <BotonArmarMes clienteId={cliente === "todos" ? null : cliente} />
            <Button onClick={() => setPlanificar(true)}>
              <Plus className="mr-2 h-4 w-4" /> Planificar
            </Button>
          </>
        )
      }
    >
      {canManageProduction(role) && <PlanesAviso />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SelectorVista vista={vista} onChange={setVista} />
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar video" className="pl-9" />
        </div>
        <Select value={cliente} onValueChange={setCliente}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los clientes</SelectItem>
            {clientes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {vista === "kanban" && (
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="activos">En curso</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m}>
                {mesLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        )}
        {vista === "kanban" && (
        <Button
          variant={soloTrabados ? "default" : "outline"}
          size="sm"
          className="h-10"
          onClick={() => setSoloTrabados((v) => !v)}
        >
          <AlertTriangle className="mr-1.5 h-4 w-4" />
          Trabados {trabados > 0 && `(${trabados})`}
        </Button>
        )}
      </div>

      {vista === "calendario" ? (
        <VistaCalendario videos={paraCalendario} />
      ) : (
      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        <div className="flex min-w-max gap-3">
          {ETAPAS.map((e) => {
            const items = filtrados
              .filter((v) => v.etapa === e.value)
              .sort((a, b) => a.etapa_desde.localeCompare(b.etapa_desde));
            return (
              <div
                key={e.value}
                className={cn(
                  "flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/30 transition-colors",
                  arrastrando && sobre === e.value && "border-primary bg-primary/10"
                )}
                onDragOver={
                  arrastra
                    ? (ev) => {
                        if (!arrastrando) return;
                        ev.preventDefault();
                        ev.dataTransfer.dropEffect = "move";
                        if (sobre !== e.value) setSobre(e.value);
                      }
                    : undefined
                }
                onDragLeave={arrastra ? (ev) => !ev.currentTarget.contains(ev.relatedTarget as Node) && setSobre(null) : undefined}
                onDrop={
                  arrastra
                    ? (ev) => {
                        ev.preventDefault();
                        const id = ev.dataTransfer.getData("text/video-id") || arrastrando;
                        if (id) void soltar(e.value, id);
                      }
                    : undefined
                }
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", e.dot)} />
                    <p className="text-sm font-semibold">{e.label}</p>
                  </div>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                <p className="px-3 pb-2 text-[11px] leading-snug text-muted-foreground">{e.descripcion}</p>
                <div className="flex min-h-[120px] flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-300px)] md:overflow-y-auto">
                  {items.map((v) => (
                    <div
                      key={v.id}
                      draggable={arrastra}
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData("text/video-id", v.id);
                        ev.dataTransfer.effectAllowed = "move";
                        setArrastrando(v.id);
                      }}
                      onDragEnd={() => {
                        setArrastrando(null);
                        setSobre(null);
                      }}
                      className={cn(arrastra && "cursor-grab active:cursor-grabbing", arrastrando === v.id && "opacity-40")}
                    >
                      <VideoCard video={v} showEtapa={false} />
                    </div>
                  ))}
                  {items.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground/70">{arrastrando ? "Soltalo acá" : "Vacío"}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      )}

      <PlanificarDialog open={planificar} onOpenChange={setPlanificar} />
    </PageShell>
  );
}
