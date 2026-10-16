import { useMemo } from "react";
import { CalendarDays, CalendarPlus, Lightbulb, MapPin, PiggyBank, Video as VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { useRedes } from "@/contexts/redes-data-context";
import { formatearFecha, sumarDias } from "@/lib/fecha";
import { formatARS, hoyISO } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import type { Rodaje, Video } from "@/lib/redes/types";
import { LOCALIDAD_BASE, LOCALIDADES, buscarLocalidad, viaticoDe } from "../../../api/_lib/viaticos";

/** Días hacia adelante en los que un rodaje ya agendado sirve para sumar videos de la misma localidad. */
const VENTANA_DIAS = 14;

/** Lo que se le pide a la página para abrir el agendado (el mismo RodajeDialog). */
export type AgendarZona = { rodaje: Rodaje } | { clienteId: string; preseleccion: string[] };

interface Zona {
  localidad: string;
  km: number | null;
  /** Viático por viaje a esa localidad (0 sin cargo; null = se coordina aparte). */
  monto: number | null;
  pendientes: Video[];
  rodajes: Rodaje[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Localidades de la lista ordenadas de la más larga a la más corta (para encontrarlas dentro de un texto libre). */
const POR_LARGO = [...LOCALIDADES].sort((a, b) => b.n.length - a.n.length).map((l) => ({ n: l.n, q: norm(l.n) }));

/** Busca una localidad conocida dentro de un texto libre (ej. el lugar del rodaje: "Calle 12 nº 300, Avellaneda"). */
function localidadEnTexto(texto: string | null | undefined): string | null {
  const t = norm(String(texto ?? ""));
  if (!t) return null;
  const exacta = buscarLocalidad(t);
  if (exacta) return exacta.n;
  const hit = POR_LARGO.find(({ q }) => new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(t));
  return hit?.n ?? null;
}

/** Localidad del cliente, si el proyecto la tiene cargada (campo opcional). */
function localidadCliente(c: unknown): string | null {
  const x = c as { localidad?: unknown; ciudad?: unknown } | undefined;
  const v = typeof x?.localidad === "string" ? x.localidad : typeof x?.ciudad === "string" ? x.ciudad : "";
  return v.trim() || null;
}

/** Nombre canónico de la localidad (el de la lista si la conocemos). */
const canon = (s: string) => buscarLocalidad(s)?.n ?? s.trim();

function fechaLinda(fecha: string): string {
  const hoy = hoyISO();
  if (fecha === hoy) return "hoy";
  if (fecha === sumarDias(hoy, 1)) return "mañana";
  return `el ${formatearFecha(fecha, { weekday: "long", day: "numeric" })}`;
}

export function RodajesPorZona({ onAgendar, puede }: { onAgendar: (a: AgendarZona) => void; puede: boolean }) {
  const { videos, rodajes, clientes, clienteById, settings } = useRedes();
  const openVideo = useOpenVideo();
  const hoy = hoyISO();

  const zonas = useMemo(() => {
    const rodajeById = new Map(rodajes.map((r) => [r.id, r]));
    const videoById = new Map(videos.map((v) => [v.id, v]));
    const clientesOk = new Set(clientes.map((c) => c.id));

    const localidadVideo = (v: Video) =>
      canon(v.viatico?.localidad || localidadCliente(clienteById(v.proyecto_id)) || LOCALIDAD_BASE);

    // Videos que todavía hay que salir a filmar.
    const pendientes = videos.filter((v) => {
      if (!clientesOk.has(v.proyecto_id)) return false;
      if (v.filma_cliente) return false;
      if (v.material_base && v.material_base.tipo !== "nueva") return false;
      const r = v.rodaje_id ? rodajeById.get(v.rodaje_id) : undefined;
      const conRodaje = !!r && r.estado !== "cancelado";
      if (v.etapa === "planificado") return !conRodaje;
      if (v.etapa === "agendado") return !conRodaje;
      return false;
    });

    const proximos = rodajes
      .filter((r) => r.estado === "agendado" && r.fecha >= hoy && clientesOk.has(r.proyecto_id))
      .sort((a, b) => (a.fecha + (a.hora ?? "")).localeCompare(b.fecha + (b.hora ?? "")));

    const localidadRodaje = (r: Rodaje) => {
      const deVideo = r.video_ids.map((id) => videoById.get(id)?.viatico?.localidad).find(Boolean);
      return canon(
        deVideo || localidadEnTexto(r.lugar) || localidadCliente(clienteById(r.proyecto_id)) || LOCALIDAD_BASE
      );
    };

    const mapa = new Map<string, Zona>();
    const zona = (loc: string) => {
      const k = norm(loc);
      let z = mapa.get(k);
      if (!z) {
        const via = viaticoDe(settings.viaticos, loc);
        z = { localidad: via.localidad, km: via.km, monto: via.monto, pendientes: [], rodajes: [] };
        mapa.set(k, z);
      }
      return z;
    };
    for (const v of pendientes) zona(localidadVideo(v)).pendientes.push(v);
    for (const r of proximos) zona(localidadRodaje(r)).rodajes.push(r);

    // Más trabajo primero; Reconquista (sin viaje) al final si empata.
    return Array.from(mapa.values()).sort(
      (a, b) =>
        b.pendientes.length - a.pendientes.length ||
        (b.km ?? 999) - (a.km ?? 999) ||
        a.localidad.localeCompare(b.localidad)
    );
  }, [videos, rodajes, clientes, clienteById, settings.viaticos, hoy]);

  const limite = sumarDias(hoy, VENTANA_DIAS);

  const sugerencias = zonas
    .map((z) => {
      const rodaje = z.rodajes.find((r) => r.fecha <= limite) ?? null;
      if (!(z.pendientes.length >= 2 || (z.pendientes.length >= 1 && rodaje))) return null;
      // Un viaje por cliente si se filma cada uno por separado. Juntándolos queda uno solo
      // (o ninguno nuevo si ya hay un rodaje agendado ahí).
      const clientesIds = Array.from(new Set(z.pendientes.map((v) => v.proyecto_id)));
      const evitados = rodaje ? clientesIds.length : clientesIds.length - 1;
      const ahorro = z.monto && z.monto > 0 ? evitados * z.monto : 0;
      return { z, rodaje, clientesIds, evitados, ahorro };
    })
    .filter((s): s is NonNullable<typeof s> => !!s);

  const ahorroTotal = sugerencias.reduce((a, s) => a + s.ahorro, 0);
  const viajesTotal = sugerencias.reduce((a, s) => a + (s.z.monto ? s.evitados : 0), 0);

  if (zonas.length === 0) {
    return <EmptyState icon={MapPin} title="No hay videos para filmar ni rodajes agendados" />;
  }

  return (
    <div className="space-y-6">
      {sugerencias.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5 text-primary" /> Sugerencias para juntar viajes
            </h2>
            {ahorroTotal > 0 && (
              <p className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <PiggyBank className="h-3.5 w-3.5" />
                Ahorro estimado {formatARS(ahorroTotal)} · {viajesTotal} {viajesTotal === 1 ? "viaje menos" : "viajes menos"}
              </p>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {sugerencias.map(({ z, rodaje, clientesIds, evitados, ahorro }) => {
              const n = z.pendientes.length;
              const titulo = rodaje
                ? `Filmá ${n === 1 ? "el video" : `juntos los ${n} videos`} de ${z.localidad} ${fechaLinda(rodaje.fecha)} (ya hay rodaje ahí)`
                : `Filmá juntos los ${n} videos de ${z.localidad} el mismo día`;
              return (
                <div key={z.localidad} className="rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-sm">
                  <p className="text-sm font-semibold leading-snug">{titulo}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {z.km != null && z.km > 0 ? `${z.km} km de Reconquista · ` : ""}
                    {clientesIds.length} {clientesIds.length === 1 ? "cliente" : "clientes"}
                    {ahorro > 0
                      ? ` · ahorrás ${evitados} ${evitados === 1 ? "viaje" : "viajes"} ≈ ${formatARS(ahorro)}`
                      : z.monto === null
                        ? " · viático a coordinar"
                        : evitados > 0 && z.monto === 0
                          ? " · sin viático, pero ahorrás tiempo"
                          : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {z.pendientes.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => openVideo(v.id)}
                        className="flex max-w-full items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-xs hover:bg-background"
                      >
                        <VideoIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{v.titulo}</span>
                        <span className="shrink-0 text-muted-foreground">· {clienteById(v.proyecto_id)?.nombre ?? "—"}</span>
                      </button>
                    ))}
                  </div>
                  {puede && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {rodaje && (
                        <Button size="sm" onClick={() => onAgendar({ rodaje })}>
                          <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Ver rodaje de {clienteById(rodaje.proyecto_id)?.nombre ?? "—"}
                        </Button>
                      )}
                      {clientesIds.map((cid) => (
                        <Button
                          key={cid}
                          size="sm"
                          variant={rodaje ? "outline" : "default"}
                          onClick={() =>
                            onAgendar(
                              rodaje && rodaje.proyecto_id === cid
                                ? { rodaje }
                                : {
                                    clienteId: cid,
                                    preseleccion: z.pendientes.filter((v) => v.proyecto_id === cid).map((v) => v.id),
                                  }
                            )
                          }
                        >
                          <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
                          {rodaje && rodaje.proyecto_id === cid ? "Sumar al rodaje" : "Agendar"} {clienteById(cid)?.nombre ?? "—"}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> Por localidad
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {zonas.map((z) => {
            const clientesIds = Array.from(new Set(z.pendientes.map((v) => v.proyecto_id)));
            return (
              <div key={z.localidad} className="rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{z.localidad}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {z.km == null ? "Distancia a confirmar" : z.km === 0 ? "Base" : `${z.km} km`}
                      {" · "}
                      {z.monto === null ? "viático a coordinar" : z.monto === 0 ? "sin viático" : `viático ${formatARS(z.monto)}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                      z.pendientes.length ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground"
                    )}
                  >
                    {z.pendientes.length} por filmar
                  </span>
                </div>

                {clientesIds.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {clientesIds.map((cid) => (
                      <ClienteTag key={cid} cliente={clienteById(cid)} />
                    ))}
                  </div>
                )}

                {z.pendientes.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {z.pendientes.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => openVideo(v.id)}
                          className="w-full truncate rounded-lg bg-muted/60 px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                        >
                          {v.titulo}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 border-t pt-2">
                  {z.rodajes.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">Sin rodajes agendados ahí</p>
                  ) : (
                    <ul className="space-y-1">
                      {z.rodajes.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            disabled={!puede}
                            onClick={() => onAgendar({ rodaje: r })}
                            className="flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-xs hover:bg-muted/60 disabled:pointer-events-none"
                          >
                            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="font-medium">
                              {formatearFecha(r.fecha, { weekday: "short", day: "numeric", month: "short" })}
                              {r.hora ? ` ${r.hora}` : ""}
                            </span>
                            <span className="truncate text-muted-foreground">· {clienteById(r.proyecto_id)?.nombre ?? "—"}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
