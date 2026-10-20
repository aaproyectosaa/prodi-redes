import { useMemo } from "react";
import { CheckCircle2, Clock, CreditCard, Loader2, Wallet, XCircle } from "lucide-react";
import { useRedes } from "@/contexts/redes-data-context";
import { useDetalleMp } from "@/components/redes/admin/RepartoCobros";
import { FilaKpis, Kpi, Vacio } from "@/components/redes/admin/AdminUI";
import { formatARS } from "@/lib/redes/format";
import type { CobroConMp } from "@/lib/redes/reparto";
import type { Cobro } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

// Cobros → Extras: lo que los clientes pagan solos por Mercado Pago (videos extra, piezas aparte, viáticos, jornadas
// de filmación), con lo que se quedó Mercado Pago y cuándo se libera la plata (Mercado Pago la retiene unos días).

const EXTRAS: Cobro["tipo"][] = ["video_extra", "pieza_ia", "viatico", "jornada"];
const TIPO: Record<string, string> = { video_extra: "Video extra", pieza_ia: "Pieza gráfica", viatico: "Viáticos", jornada: "Jornada de filmación" };
const zona = "America/Argentina/Buenos_Aires";
const mesAR = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: zona }).slice(0, 7);
const dia = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: zona });

/** Los extras del mes (los pagados ese mes y los que esperan pago creados ese mes). */
export function useExtrasDelMes(mes: string): CobroConMp[] {
  const { cobros } = useRedes();
  return useMemo(
    () =>
      (cobros as CobroConMp[])
        .filter((c) => EXTRAS.includes(c.tipo))
        .filter((c) => (c.estado === "aprobado" ? !!c.pagado_at && mesAR(c.pagado_at) === mes : mesAR(c.created_at) === mes))
        .sort((a, b) => (b.pagado_at ?? b.created_at).localeCompare(a.pagado_at ?? a.created_at)),
    [cobros, mes]
  );
}

const liberado = (c: CobroConMp) => !!c.mp_liberado || (!!c.mp_libera_at && new Date(c.mp_libera_at).getTime() <= Date.now());

function Estado({ c }: { c: CobroConMp }) {
  if (c.estado === "aprobado") {
    if (liberado(c))
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" /> Liberada{c.mp_libera_at ? ` el ${dia(c.mp_libera_at)}` : ""}
        </span>
      );
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
        <Clock className="h-3 w-3" /> {c.mp_libera_at ? `Se libera el ${dia(c.mp_libera_at)}` : c.mp_payment_id ? "Pagado · consultando liberación" : "Pagado"}
      </span>
    );
  }
  if (c.estado === "pendiente")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
        <CreditCard className="h-3 w-3" /> Esperando que pague
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      <XCircle className="h-3 w-3" /> {c.estado === "rechazado" ? "Rechazado" : "Cancelado"}
    </span>
  );
}

export function CobrosExtras({ mes, filtro }: { mes: string; filtro: (nombre: string) => boolean }) {
  const { clienteById } = useRedes();
  const todos = useExtrasDelMes(mes);
  const lista = todos.filter((c) => filtro(clienteById(c.proyecto_id)?.nombre ?? ""));
  const pagados = lista.filter((c) => c.estado === "aprobado");
  const consultando = useDetalleMp(pagados);

  const cobrado = pagados.reduce((a, c) => a + c.monto, 0);
  const comision = pagados.reduce((a, c) => a + (c.mp_comision ?? 0), 0);
  const neto = (c: CobroConMp) => c.mp_neto ?? c.monto - (c.mp_comision ?? 0);
  const yaLiberadoMp = pagados.filter(liberado).reduce((a, c) => a + neto(c), 0);
  const porLiberar = pagados.filter((c) => !liberado(c) && !!c.mp_payment_id);
  // Sin pago de Mercado Pago (cargado a mano): se toma como disponible.
  const sinMp = pagados.filter((c) => !c.mp_payment_id && !liberado(c)).reduce((a, c) => a + neto(c), 0);
  const proxima = porLiberar
    .map((c) => c.mp_libera_at)
    .filter((x): x is string => !!x)
    .sort()[0];

  if (!lista.length) {
    return <Vacio icono={Wallet} titulo="Sin extras este mes" texto="Cuando un cliente pague un video extra, una pieza aparte o viáticos por Mercado Pago, aparece acá solo." />;
  }

  return (
    <div className="space-y-4">
      <FilaKpis>
        <Kpi icono={Wallet} label="Cobrado por extras" valor={formatARS(cobrado)} sub={`${pagados.length} ${pagados.length === 1 ? "pago" : "pagos"}${comision ? ` · Mercado Pago se quedó ${formatARS(comision)}` : ""}`} />
        <Kpi icono={CheckCircle2} tono="verde" label="Ya liberado" valor={formatARS(yaLiberadoMp + sinMp)} sub="disponible en Mercado Pago" />
        <Kpi
          icono={Clock}
          tono="ambar"
          label="Por liberar"
          valor={formatARS(porLiberar.reduce((a, c) => a + neto(c), 0))}
          sub={proxima ? `el próximo se libera el ${dia(proxima)}` : porLiberar.length ? "consultando a Mercado Pago…" : "nada pendiente"}
        />
      </FilaKpis>

      <div className="overflow-hidden rounded-2xl border bg-card">
        {lista.map((c) => {
          const cliente = clienteById(c.proyecto_id);
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {cliente?.nombre ?? "Cliente"}
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{TIPO[c.tipo] ?? c.tipo}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.concepto}
                  {c.estado === "aprobado" && c.pagado_at ? ` · pagó el ${dia(c.pagado_at)}` : ` · pedido el ${dia(c.created_at)}`}
                </p>
              </div>
              <div className="text-right">
                <p className={cn("text-sm font-bold tabular-nums", c.estado !== "aprobado" && "text-muted-foreground")}>{formatARS(c.monto)}</p>
                {c.estado === "aprobado" && c.mp_comision ? <p className="text-[11px] tabular-nums text-muted-foreground">te quedan {formatARS(neto(c))}</p> : null}
              </div>
              <div className="w-full sm:w-auto">
                <Estado c={c} />
              </div>
            </div>
          );
        })}
      </div>
      {consultando && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando a Mercado Pago la comisión y la fecha de liberación…
        </p>
      )}
    </div>
  );
}
