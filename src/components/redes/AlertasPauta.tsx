import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, BellRing, ChevronDown, Flame, Link2Off, PauseCircle, Repeat, TrendingUp, Wallet } from "lucide-react";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { useRedes } from "@/contexts/redes-data-context";
import { alertasPauta, estadoPresupuesto, type AlertaPauta, type TipoAlerta } from "@/lib/redes/alertasPauta";
import { sumarDiasF, usePautaMeta } from "@/lib/redes/metaPauta";
import { cn } from "@/lib/utils";

// Alertas de pauta en el tablero de quien la maneja (y del admin): lo que hay que tocar hoy en Meta.

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Las alertas de los clientes que ve esta persona (la pauta de los últimos 31 días, para comparar semanas y el mes). */
export function useAlertasPauta(activo = true) {
  const { clientes, videos } = useRedes();
  const hoy = hoyISO();
  const desde = [sumarDiasF(hoy, -15), `${hoy.slice(0, 7)}-01`].sort()[0];
  const filas = usePautaMeta(activo ? null : undefined, desde);
  const alertas = useMemo(() => (filas ? alertasPauta({ clientes, filas, videos, hoy }) : []), [filas, clientes, videos, hoy]);
  return { alertas, filas, cargando: activo && filas === null };
}

const ICONO: Record<TipoAlerta, React.ElementType> = {
  presupuesto_excedido: Wallet,
  presupuesto_cerca: Wallet,
  presupuesto_ritmo: TrendingUp,
  sin_gasto: PauseCircle,
  costo_sube: Flame,
  sin_resultados: AlertTriangle,
  frecuencia: Repeat,
  video_sin_anuncio: Link2Off,
};

const TONO = [
  "border-border bg-card",
  "border-amber-500/40 bg-amber-500/5",
  "border-red-500/50 bg-red-500/5",
];
const ICONO_TONO = ["bg-muted text-muted-foreground", "bg-amber-500/15 text-amber-600 dark:text-amber-300", "bg-red-500/15 text-red-600 dark:text-red-300"];

function Fila({ a }: { a: AlertaPauta }) {
  const navigate = useNavigate();
  const open = useOpenVideo();
  const { clienteById } = useRedes();
  const Icono = ICONO[a.tipo];
  const c = clienteById(a.proyectoId);
  return (
    <button
      type="button"
      onClick={() => (a.videoId ? open(a.videoId) : navigate(`/clientes/${a.proyectoId}?tab=resultados`))}
      className={cn("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/40", TONO[a.nivel])}
    >
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", ICONO_TONO[a.nivel])}>
        <Icono className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{a.titulo}</span>
          {c && <ClienteTag cliente={c} />}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{a.detalle}</span>
      </span>
    </button>
  );
}

/** Panel del tablero: las urgentes a la vista, el resto plegado. */
export function AlertasPauta() {
  const { alertas, cargando } = useAlertasPauta();
  const [verTodas, setVerTodas] = useState(false);
  if (cargando || !alertas.length) return null;
  const importantes = alertas.filter((a) => a.nivel >= 1);
  const visibles = verTodas ? alertas : importantes.slice(0, 5);
  const resto = alertas.length - visibles.length;
  const urgentes = alertas.filter((a) => a.nivel === 2).length;
  return (
    <section className="mb-4 space-y-2 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <BellRing className={cn("h-4 w-4", urgentes ? "text-red-500" : "text-amber-500")} />
        <h3 className="text-sm font-semibold">Alertas de pauta</h3>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", urgentes ? "bg-red-500/15 text-red-600 dark:text-red-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
          {urgentes ? `${urgentes} urgente${urgentes === 1 ? "" : "s"}` : `${alertas.length} para mirar`}
        </span>
      </div>
      <div className="space-y-2">
        {visibles.map((a) => (
          <Fila key={a.id} a={a} />
        ))}
      </div>
      {resto > 0 && (
        <button type="button" onClick={() => setVerTodas(true)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Ver {resto} más <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}
    </section>
  );
}

/** Barra de presupuesto del mes en la ficha del cliente. */
export function BarraPresupuesto({ cliente, filas }: { cliente: Parameters<typeof estadoPresupuesto>[0]; filas: Parameters<typeof estadoPresupuesto>[1] }) {
  const e = estadoPresupuesto(cliente, filas, hoyISO());
  if (!e.tope) return null;
  const uso = e.uso ?? 0;
  const color = uso >= 1 ? "bg-red-500" : uso >= 0.9 ? "bg-amber-500" : "bg-emerald-500";
  const ars = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Presupuesto de pauta del mes</p>
        <p className="text-sm font-semibold tabular-nums">
          {ars(e.gasto)} <span className="font-normal text-muted-foreground">de {ars(e.tope)}</span>
        </p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(uso * 100, 100)}%` }} />
      </div>
      <p className={cn("mt-1.5 text-[11px]", uso >= 1 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        {uso >= 1
          ? `Se pasó por ${ars(e.gasto - e.tope)}.`
          : `${Math.round(uso * 100)}% usado · día ${e.dia} de ${e.diasMes}${e.proyectado != null ? ` · al ritmo actual termina en ${ars(e.proyectado)}` : ""}`}
      </p>
    </div>
  );
}
