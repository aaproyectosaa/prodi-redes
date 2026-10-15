import { memo, useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Flag, LayoutGrid, Rocket, Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { useRedes } from "@/contexts/redes-data-context";
import { diaSemana, diasDelMes, formatearFecha, sumarDias } from "@/lib/fecha";
import { hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { especialesDe } from "@/lib/feriados";
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
    <div className="inline-flex h-11 items-center rounded-2xl bg-muted/60 p-1" role="tablist" aria-label="Vista">
      {ops.map((o) => (
        <button
          key={o.v}
          type="button"
          role="tab"
          aria-selected={vista === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition-all",
            vista === o.v ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
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
  /** Color del cliente (puntito en el chip). Opcional. */
  color?: string | null;
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
        color: mostrarCliente && cliente ? cliente.color || null : null,
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

// ---------------------------------------------------------------------------
// Piezas chicas del calendario
// ---------------------------------------------------------------------------

/** "Jueves 15 de octubre" */
function tituloDia(fecha: string): string {
  return formatearFecha(fecha, { weekday: "long", day: "numeric", month: "long" })
    .replace(",", "")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Chip sólido suave de un evento (en la grilla de la compu). */
const ChipEvento = memo(function ChipEvento({ e, T }: { e: EventoCal; T: TipoCal }) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        e.onClick();
      }}
      onKeyDown={(ev) => ev.stopPropagation()}
      title={`${T.label}: ${e.titulo}${e.detalle ? ` (${e.detalle})` : ""}`}
      className={cn(
        // T.chip trae el fondo suave y el color de texto; sin borde para que se vea "lleno".
        "relative flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-lg px-1.5 py-[3px] text-left text-[11px] font-medium leading-tight transition-shadow",
        "after:pointer-events-none after:absolute after:inset-0 after:bg-current after:opacity-0 after:transition-opacity hover:after:opacity-[0.08] hover:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        T.chip
      )}
    >
      <T.icon className="h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{e.titulo}</span>
      {e.color && <span className="h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-background" style={{ backgroundColor: e.color }} />}
    </button>
  );
});

type Especial = ReturnType<typeof especialesDe>[number];

/** Cartelito de feriado / fecha comercial dentro de la celda. */
function BannerEspecial({ x }: { x: Especial }) {
  const feriado = x.tipo === "feriado";
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium leading-[18px]",
        feriado ? "bg-red-500/[0.08] text-red-700 dark:text-red-300" : "bg-fuchsia-500/[0.08] text-fuchsia-700 dark:text-fuchsia-300"
      )}
    >
      {feriado ? <Flag className="h-2.5 w-2.5 shrink-0" /> : <Sparkles className="h-2.5 w-2.5 shrink-0" />}
      <span className="truncate">{x.nombre}</span>
    </span>
  );
}

/** Todo lo de un día, agrupado por tipo (lo usa el pop-up de la compu y el panel del celular). */
function DetalleDia({
  dia,
  eventos,
  tipos,
  vacioTexto,
  onElegir,
}: {
  dia: string;
  eventos: EventoCal[];
  tipos: Record<string, TipoCal>;
  vacioTexto: string;
  onElegir: (e: EventoCal) => void;
}) {
  const esp = especialesDe(dia);
  const grupos = useMemo(() => {
    const orden = Object.keys(tipos);
    const m = new Map<string, EventoCal[]>();
    for (const e of eventos) m.set(e.tipo, [...(m.get(e.tipo) ?? []), e]);
    return [...m.entries()].sort((a, b) => orden.indexOf(a[0]) - orden.indexOf(b[0]));
  }, [eventos, tipos]);

  let n = 0;
  return (
    <div className="space-y-3">
      {esp.map((x) => (
        <div
          key={x.nombre}
          className={cn(
            "flex items-start gap-2.5 rounded-2xl p-3 text-sm",
            x.tipo === "feriado" ? "bg-red-500/[0.07]" : "bg-fuchsia-500/[0.07]"
          )}
        >
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
              x.tipo === "feriado" ? "bg-red-500/15 text-red-600 dark:text-red-300" : "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300"
            )}
          >
            {x.tipo === "feriado" ? <Flag className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <b className="font-semibold">{x.tipo === "feriado" ? `Feriado: ${x.nombre}` : x.nombre}</b>
            <span className="block text-xs text-muted-foreground">
              {x.tipo === "feriado" ? "Pensá horarios del local y contenido de la fecha." : `Idea: ${x.idea}`}
            </span>
          </span>
        </div>
      ))}

      {grupos.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{vacioTexto}</p>
      ) : (
        grupos.map(([tipo, lista]) => {
          const T = tipos[tipo];
          if (!T) return null;
          return (
            <section key={tipo} className="space-y-1.5">
              <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-full", T.dot)} />
                {T.label}
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{lista.length}</span>
              </p>
              {lista.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => onElegir(e)}
                  style={{ animationDelay: `${n++ * 40}ms` }}
                  className="group flex w-full items-center gap-3 rounded-2xl border bg-card p-2.5 text-left transition-all animate-in fade-in slide-in-from-bottom-1 fill-mode-both hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:animate-none"
                >
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", T.chip)}>
                    <T.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.titulo}</span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {e.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />}
                      <span className="truncate">{e.detalle ?? T.label}</span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendario mensual genérico
// ---------------------------------------------------------------------------

const MAX_CHIPS = 3;

/** Calendario mensual genérico: grilla del mes (empieza el lunes) y el detalle del día elegido. */
export function CalendarioEventos({ eventos, tipos, vacio }: { eventos: EventoCal[]; tipos: Record<string, TipoCal>; vacio: string }) {
  const hoy = hoyISO();
  const [mes, setMes] = useState(mesActual());
  const [dia, setDia] = useState<string | null>(hoy);
  const [abierto, setAbierto] = useState(false);
  // Tipos ocultos con los chips de la leyenda (filtro local, no toca los datos).
  const [ocultos, setOcultos] = useState<Set<string>>(() => new Set());

  const alternar = useCallback((t: string) => {
    setOcultos((prev) => {
      const s = new Set(prev);
      if (s.has(t)) s.delete(t);
      else s.add(t);
      return s;
    });
  }, []);

  const visibles = useMemo(() => (ocultos.size ? eventos.filter((e) => !ocultos.has(e.tipo)) : eventos), [eventos, ocultos]);

  const porDia = useMemo(() => {
    const m = new Map<string, EventoCal[]>();
    for (const e of visibles) {
      const l = m.get(e.fecha);
      if (l) l.push(e);
      else m.set(e.fecha, [e]);
    }
    m.forEach((l) => l.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)));
    return m;
  }, [visibles]);

  // Cuántos de cada tipo hay en el mes que se ve (sin importar el filtro).
  const conteo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of eventos) if (e.fecha.startsWith(mes)) c[e.tipo] = (c[e.tipo] ?? 0) + 1;
    return c;
  }, [eventos, mes]);
  const totalMes = useMemo(() => Object.values(conteo).reduce((a, b) => a + b, 0), [conteo]);
  const visiblesMes = useMemo(() => visibles.filter((e) => e.fecha.startsWith(mes)).length, [visibles, mes]);

  // Grilla del mes empezando el lunes (con feriados y fechas comerciales ya calculados).
  const celdas = useMemo(() => {
    const primero = `${mes}-01`;
    const offset = (diaSemana(primero) + 6) % 7;
    const inicio = sumarDias(primero, -offset);
    const total = Math.ceil((offset + diasDelMes(mes)) / 7) * 7;
    return Array.from({ length: total }, (_, i) => {
      const fecha = sumarDias(inicio, i);
      const esp = especialesDe(fecha);
      return {
        fecha,
        num: Number(fecha.slice(8, 10)),
        delMes: fecha.startsWith(mes),
        finde: i % 7 >= 5,
        esp,
        feriado: esp.find((x) => x.tipo === "feriado"),
        efemeride: esp.find((x) => x.tipo === "efemeride"),
      };
    });
  }, [mes]);

  const irMes = (m: string) => {
    setMes(m);
    // Al cambiar de mes en el celular, elegir el 1 (u hoy si es el mes actual).
    setDia(m === mesActual() ? hoy : `${m}-01`);
  };

  const abrirDia = (fecha: string) => {
    setDia(fecha);
    setAbierto(true);
  };

  const elegirDesdePopup = (e: EventoCal) => {
    setAbierto(false);
    e.onClick();
  };

  const lista = dia ? (porDia.get(dia) ?? []) : [];
  const vacioDia = totalMes === 0 ? vacio : visiblesMes === 0 ? "Los filtros ocultan todo lo de este mes." : "Nada este día.";
  const claves = Object.keys(tipos);

  return (
    <div className="space-y-3 animate-in fade-in duration-300 motion-reduce:animate-none">
      {/* Encabezado: mes, flechas, Hoy y leyenda-filtro */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0 rounded-full"
            onClick={() => irMes(sumarMeses(mes, -1))}
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 text-center sm:min-w-[190px] sm:flex-none">
            <h3 className="truncate text-xl font-bold capitalize leading-tight tracking-tight sm:text-2xl">{mesLabel(mes)}</h3>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {totalMes === 0 ? "Sin eventos" : `${totalMes} evento${totalMes === 1 ? "" : "s"}`}
            </p>
          </div>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0 rounded-full"
            onClick={() => irMes(sumarMeses(mes, 1))}
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={() => irMes(mesActual())}
            disabled={mes === mesActual() && dia === hoy}
            className={cn(
              "ml-1 inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors",
              mes === mesActual()
                ? "bg-muted/60 text-muted-foreground disabled:opacity-70"
                : "bg-primary/10 text-primary hover:bg-primary/15"
            )}
          >
            Hoy
          </button>
        </div>

        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible lg:justify-end">
          {claves.map((t) => {
            const T = tipos[t];
            const activo = !ocultos.has(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={activo}
                onClick={() => alternar(t)}
                title={activo ? `Ocultar ${T.label.toLowerCase()}` : `Mostrar ${T.label.toLowerCase()}`}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all",
                  activo ? "border-border bg-card text-foreground shadow-sm hover:bg-muted/50" : "border-dashed bg-transparent text-muted-foreground opacity-60 hover:opacity-90"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full transition-opacity", T.dot, !activo && "opacity-40")} />
                <T.icon className="h-3.5 w-3.5" />
                <span className={cn(!activo && "line-through")}>{T.label}</span>
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{conteo[t] ?? 0}</span>
              </button>
            );
          })}
          <span className="ml-1 hidden shrink-0 items-center gap-3 text-[11px] text-muted-foreground sm:inline-flex">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Feriado
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-500" /> Fecha comercial
            </span>
          </span>
        </div>
      </div>

      {/* Grilla */}
      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="grid grid-cols-7 border-b bg-muted/20 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 sm:text-[11px]">
          {DIAS.map((d, i) => (
            <div key={d} className={cn("py-2.5", i >= 5 && "text-muted-foreground/60")}>
              {d}
            </div>
          ))}
        </div>

        {/* Celular: grilla compacta con puntitos; el día elegido se ve abajo. */}
        <div className="grid grid-cols-7 gap-0.5 p-1.5 sm:hidden">
          {celdas.map((c) => {
            const evs = porDia.get(c.fecha) ?? [];
            const sel = dia === c.fecha;
            const esHoy = c.fecha === hoy;
            const tiposDia = [...new Set(evs.map((e) => e.tipo))];
            return (
              <button
                key={c.fecha}
                type="button"
                onClick={() => setDia(c.fecha)}
                aria-pressed={sel}
                aria-label={`${c.num}${c.feriado ? ` (feriado: ${c.feriado.nombre})` : ""}${c.efemeride ? ` (${c.efemeride.nombre})` : ""}: ${evs.length} evento${evs.length === 1 ? "" : "s"}`}
                className={cn(
                  "flex h-12 flex-col items-center justify-center gap-1 rounded-xl transition-colors",
                  !c.delMes && "opacity-35",
                  c.finde && !sel && "bg-muted/30",
                  c.delMes && c.feriado && !sel && "bg-red-500/[0.07]",
                  sel ? "bg-primary/10 ring-1 ring-inset ring-primary/50" : "active:bg-muted/60"
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums",
                    esHoy && "bg-primary font-bold text-primary-foreground shadow-sm",
                    !esHoy && sel && "font-bold text-primary",
                    !esHoy && !sel && c.feriado && "font-bold text-red-600 dark:text-red-400",
                    !esHoy && !sel && !c.feriado && c.efemeride && "font-semibold text-fuchsia-600 dark:text-fuchsia-400"
                  )}
                >
                  {c.num}
                </span>
                <span className="flex h-1.5 items-center gap-0.5">
                  {c.delMes && c.feriado && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  {c.delMes && c.efemeride && <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-500" />}
                  {tiposDia.slice(0, 3).map((t) => (
                    <span key={t} className={cn("h-1.5 w-1.5 rounded-full", tipos[t]?.dot)} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        {/* Compu: celdas con chips; tocar el día abre todo lo de ese día. */}
        <div className="hidden grid-cols-7 sm:grid">
          {celdas.map((c, i) => {
            const evs = porDia.get(c.fecha) ?? [];
            const esHoy = c.fecha === hoy;
            const resto = evs.length - MAX_CHIPS;
            const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                abrirDia(c.fecha);
              }
            };
            return (
              <div
                key={c.fecha}
                role="button"
                tabIndex={0}
                onClick={() => abrirDia(c.fecha)}
                onKeyDown={onKey}
                aria-label={`${tituloDia(c.fecha)}${c.feriado ? ` (feriado: ${c.feriado.nombre})` : ""}${c.efemeride ? ` (${c.efemeride.nombre})` : ""}: ${evs.length} evento${evs.length === 1 ? "" : "s"}`}
                title={c.esp.map((x) => (x.tipo === "feriado" ? `Feriado: ${x.nombre}` : x.nombre)).join(" · ") || undefined}
                className={cn(
                  "group relative flex min-h-[124px] cursor-pointer flex-col gap-1 border-b border-r p-1.5 text-left transition-colors lg:min-h-[136px] lg:p-2",
                  "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  (i + 1) % 7 === 0 && "border-r-0",
                  i >= celdas.length - 7 && "border-b-0",
                  c.finde && "bg-muted/[0.18]",
                  c.delMes && c.feriado && "bg-red-500/[0.035]",
                  esHoy && "bg-primary/[0.05] ring-2 ring-inset ring-primary/60",
                  "hover:bg-muted/40"
                )}
              >
                <div className={cn("flex items-center justify-between", !c.delMes && "opacity-40")}>
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs tabular-nums transition-colors",
                      esHoy && "bg-primary font-bold text-primary-foreground shadow-sm",
                      !esHoy && c.feriado && "font-bold text-red-600 dark:text-red-400",
                      !esHoy && !c.feriado && c.efemeride && "font-semibold text-fuchsia-600 dark:text-fuchsia-400",
                      !esHoy && !c.feriado && !c.efemeride && "font-medium text-foreground/80 group-hover:bg-muted"
                    )}
                  >
                    {c.num}
                  </span>
                  {esHoy && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Hoy</span>}
                </div>

                {c.delMes && c.esp.map((x) => <BannerEspecial key={x.nombre} x={x} />)}

                <div className={cn("flex min-w-0 flex-col gap-1", !c.delMes && "opacity-50")}>
                  {evs.slice(0, MAX_CHIPS).map((e) => {
                    const T = tipos[e.tipo];
                    return T ? <ChipEvento key={e.key} e={e} T={T} /> : null;
                  })}
                  {resto > 0 && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        abrirDia(c.fecha);
                      }}
                      onKeyDown={(ev) => ev.stopPropagation()}
                      className="self-start rounded-full px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
                    >
                      +{resto} más
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Compu: aviso cuando el mes está vacío (el detalle va en el pop-up). */}
      {(totalMes === 0 || visiblesMes === 0) && (
        <p className="hidden px-1 text-center text-xs text-muted-foreground sm:block">{vacioDia}</p>
      )}

      {/* Celular: lo del día elegido, debajo de la grilla. */}
      <div className="rounded-3xl border bg-card p-3 sm:hidden">
        <p className="mb-2.5 px-1 text-sm font-semibold">{dia ? tituloDia(dia) : "Elegí un día"}</p>
        {dia && (
          <DetalleDia
            dia={dia}
            eventos={lista}
            tipos={tipos}
            vacioTexto={vacioDia === "Nada este día." ? "Nada este día. Tocá otro día del calendario." : vacioDia}
            onElegir={(e) => e.onClick()}
          />
        )}
      </div>

      {/* Compu: pop-up con todo lo del día. */}
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-md rounded-3xl sm:rounded-3xl">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg">{dia ? tituloDia(dia) : ""}</DialogTitle>
            <DialogDescription>
              {lista.length === 0 ? "Sin eventos" : `${lista.length} evento${lista.length === 1 ? "" : "s"}`}
              {ocultos.size > 0 && " · con filtros"}
            </DialogDescription>
          </DialogHeader>
          {dia && <DetalleDia dia={dia} eventos={lista} tipos={tipos} vacioTexto={vacioDia} onElegir={elegirDesdePopup} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
