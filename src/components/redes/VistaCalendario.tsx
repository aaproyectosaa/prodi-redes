import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Flag, LayoutGrid, Rocket, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { useRedes } from "@/contexts/redes-data-context";
import { diaSemana, diasDelMes, formatearFecha, sumarDias } from "@/lib/fecha";
import { hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/redes/types";

// ---------------------------------------------------------------------------
// Selector Kanban / Calendario (se recuerda por pantalla en este navegador)
// ---------------------------------------------------------------------------

export type Vista = "kanban" | "calendario";

export function useVista(clave: string): [Vista, (v: Vista) => void] {
  const key = `prodi-vista-${clave}`;
  const [vista, setVista] = useState<Vista>(() => {
    try {
      return localStorage.getItem(key) === "calendario" ? "calendario" : "kanban";
    } catch {
      return "kanban";
    }
  });
  const cambiar = (v: Vista) => {
    setVista(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* sin almacenamiento: queda solo en esta sesión */
    }
  };
  return [vista, cambiar];
}

export function SelectorVista({ vista, onChange }: { vista: Vista; onChange: (v: Vista) => void }) {
  const ops: { v: Vista; label: string; icon: LucideIcon }[] = [
    { v: "kanban", label: "Kanban", icon: LayoutGrid },
    { v: "calendario", label: "Calendario", icon: CalendarDays },
  ];
  return (
    <div className="inline-flex rounded-xl border bg-muted/40 p-1" role="tablist" aria-label="Vista">
      {ops.map((o) => (
        <button
          key={o.v}
          type="button"
          role="tab"
          aria-selected={vista === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
            vista === o.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <o.icon className="h-4 w-4" /> {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendario: cada video aparece el día que se filma, el día que lo pidió el
// cliente y el día que se publicó.
// ---------------------------------------------------------------------------

type TipoEvento = "rodaje" | "pedido" | "publicado";

/** Cómo se ve cada tipo de evento en el calendario. */
export interface TipoCal {
  label: string;
  icon: LucideIcon;
  chip: string;
  dot: string;
}

const TIPOS: Record<TipoEvento, TipoCal> = {
  rodaje: {
    label: "Filmación",
    icon: CalendarDays,
    chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/30",
    dot: "bg-sky-500",
  },
  pedido: {
    label: "Pedido para",
    icon: Flag,
    chip: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30",
    dot: "bg-amber-500",
  },
  publicado: {
    label: "Publicado",
    icon: Rocket,
    chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-500",
  },
};

/** Un evento cualquiera del calendario (video, pieza…). */
export interface EventoCal {
  key: string;
  fecha: string; // YYYY-MM-DD
  tipo: string;
  orden?: number;
  titulo: string;
  detalle?: string;
  onClick: () => void;
}

const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export function VistaCalendario({ videos, mostrarCliente = true }: { videos: Video[]; mostrarCliente?: boolean }) {
  const { rodajes, clienteById } = useRedes();
  const open = useOpenVideo();
  const eventos = useMemo(() => {
    const out: EventoCal[] = [];
    const orden: Record<TipoEvento, number> = { rodaje: 0, pedido: 1, publicado: 2 };
    const ev = (key: string, fecha: string, tipo: TipoEvento, v: Video, hora?: string | null) => {
      const cliente = clienteById(v.proyecto_id);
      out.push({
        key,
        fecha,
        tipo,
        orden: orden[tipo] * 10000 + Number((hora ?? "").replace(":", "") || 0),
        titulo: v.titulo,
        detalle: `${TIPOS[tipo].label}${hora ? ` · ${hora}` : ""}${mostrarCliente && cliente ? ` · ${cliente.nombre}` : ""}`,
        onClick: () => open(v.id),
      });
    };
    for (const v of videos) {
      const r = v.rodaje_id ? rodajes.find((x) => x.id === v.rodaje_id) : undefined;
      if (r && r.estado !== "cancelado") ev(`${v.id}-r`, r.fecha, "rodaje", v, r.hora);
      if (v.fecha_deseada) ev(`${v.id}-p`, v.fecha_deseada, "pedido", v);
      if (v.publicacion?.publicado_at) ev(`${v.id}-pub`, hoyISO(new Date(v.publicacion.publicado_at)), "publicado", v);
    }
    return out;
  }, [videos, rodajes, clienteById, mostrarCliente, open]);
  return <CalendarioEventos eventos={eventos} tipos={TIPOS} vacio="No hay filmaciones, pedidos ni publicaciones este mes." />;
}

/** Calendario mensual genérico: grilla del mes (empieza el lunes) y el detalle del día elegido. */
export function CalendarioEventos({ eventos, tipos, vacio }: { eventos: EventoCal[]; tipos: Record<string, TipoCal>; vacio: string }) {
  const hoy = hoyISO();
  const [mes, setMes] = useState(mesActual());
  const [dia, setDia] = useState<string | null>(hoy);

  const porDia = useMemo(() => {
    const m = new Map<string, EventoCal[]>();
    for (const e of eventos) m.set(e.fecha, [...(m.get(e.fecha) ?? []), e]);
    m.forEach((l) => l.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)));
    return m;
  }, [eventos]);

  // Grilla del mes empezando el lunes.
  const celdas = useMemo(() => {
    const primero = `${mes}-01`;
    const offset = (diaSemana(primero) + 6) % 7;
    const inicio = sumarDias(primero, -offset);
    const total = Math.ceil((offset + diasDelMes(mes)) / 7) * 7;
    return Array.from({ length: total }, (_, i) => {
      const fecha = sumarDias(inicio, i);
      return { fecha, num: Number(fecha.slice(8, 10)), delMes: fecha.startsWith(mes) };
    });
  }, [mes]);

  const delMes = eventos.filter((e) => e.fecha.startsWith(mes)).length;
  const lista = dia ? (porDia.get(dia) ?? []) : [];

  return (
    <div className="space-y-3 animate-in fade-in duration-300 motion-reduce:animate-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setMes(sumarMeses(mes, -1))} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-[150px] text-center text-base font-semibold capitalize">{mesLabel(mes)}</p>
          <Button size="icon" variant="ghost" onClick={() => setMes(sumarMeses(mes, 1))} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {mes !== mesActual() && (
            <Button
              size="sm"
              variant="outline"
              className="ml-1 h-8"
              onClick={() => {
                setMes(mesActual());
                setDia(hoy);
              }}
            >
              Hoy
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {Object.keys(tipos).map((t) => {
            const T = tipos[t];
            return (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", T.dot)} />
                <T.icon className="h-3.5 w-3.5" /> {T.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {DIAS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {celdas.map((c, i) => {
            const evs = porDia.get(c.fecha) ?? [];
            const sel = dia === c.fecha;
            const esHoy = c.fecha === hoy;
            return (
              <button
                key={c.fecha}
                type="button"
                onClick={() => setDia(c.fecha)}
                className={cn(
                  "flex min-h-[56px] flex-col items-stretch gap-1 border-b border-r p-1 text-left transition-colors md:min-h-[112px] md:p-1.5",
                  (i + 1) % 7 === 0 && "border-r-0",
                  !c.delMes && "bg-muted/20 text-muted-foreground/60",
                  sel ? "bg-primary/[0.08] ring-1 ring-inset ring-primary/50" : "hover:bg-muted/40"
                )}
                aria-label={`${c.num}: ${evs.length} evento${evs.length === 1 ? "" : "s"}`}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center self-start rounded-full text-xs tabular-nums",
                    esHoy && "bg-primary font-bold text-primary-foreground"
                  )}
                >
                  {c.num}
                </span>
                {/* Celular: puntitos. Compu: chips con el nombre del video. */}
                <span className="flex flex-wrap gap-0.5 md:hidden">
                  {evs.slice(0, 4).map((e) => (
                    <span key={e.key} className={cn("h-1.5 w-1.5 rounded-full", tipos[e.tipo].dot)} />
                  ))}
                </span>
                <span className="hidden space-y-0.5 md:block">
                  {evs.slice(0, 3).map((e) => {
                    const T = tipos[e.tipo];
                    return (
                      <span
                        key={e.key}
                        className={cn("flex items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[11px] leading-tight", T.chip)}
                        title={`${T.label}: ${e.titulo}`}
                      >
                        <T.icon className="h-3 w-3 shrink-0" />
                        <span className="truncate">{e.titulo}</span>
                      </span>
                    );
                  })}
                  {evs.length > 3 && <span className="block px-1 text-[11px] text-muted-foreground">+{evs.length - 3} más</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detalle del día elegido */}
      <div className="rounded-2xl border bg-card p-3">
        <p className="mb-2 px-1 text-sm font-semibold">
          {dia
            ? formatearFecha(dia, { weekday: "long", day: "numeric", month: "long" })
                .replace(/^./, (c) => c.toUpperCase())
            : "Elegí un día"}
        </p>
        {lista.length === 0 ? (
          <p className="px-1 pb-1 text-xs text-muted-foreground">
            {delMes === 0 ? vacio : "Nada este día. Tocá otro día del calendario."}
          </p>
        ) : (
          <div className="space-y-1.5">
            {lista.map((e, i) => {
              const T = tipos[e.tipo];
              return (
                <button
                  key={e.key}
                  type="button"
                  onClick={e.onClick}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className="flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all animate-in fade-in slide-in-from-bottom-1 fill-mode-both hover:-translate-y-0.5 hover:border-primary/50 motion-reduce:animate-none"
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", T.chip)}>
                    <T.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.titulo}</span>
                    <span className="block truncate text-xs text-muted-foreground">{e.detalle ?? T.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
