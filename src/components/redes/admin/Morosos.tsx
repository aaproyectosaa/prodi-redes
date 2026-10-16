import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, BellRing, CheckCircle2, Clock, Loader2, MessageCircle, PauseCircle, ShieldOff, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useRedes } from "@/contexts/redes-data-context";
import { doc, updateDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { callApi } from "@/lib/redes/api";
import { abrirEnDock } from "@/lib/redes/chatDock";
import { recalcularMora, type FacturaDoc } from "@/lib/redes/facturacion";
import { formatARS, hoyISO } from "@/lib/redes/format";
import { sumarDias } from "@/lib/fecha";
import { assertEditable } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";
import { estadoMora, leerConfigMora, type NivelMora } from "../../../../api/_lib/mora-calc";

/** Cómo se ve cada escalón. */
export const NIVEL_MORA: Record<NivelMora, { label: string; clase: string; icono: React.ElementType }> = {
  al_dia: { label: "Al día", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icono: CheckCircle2 },
  vencido: { label: "Vencido", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icono: Clock },
  mora: { label: "En mora", clase: "bg-orange-500/15 text-orange-700 dark:text-orange-300", icono: AlertTriangle },
  sin_extras: { label: "Sin extras", clase: "bg-red-500/15 text-red-700 dark:text-red-300", icono: ShieldOff },
  pausa: { label: "Producción pausada", clase: "bg-red-600 text-white", icono: PauseCircle },
};

const fechaCorta = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;

/**
 * Panel de morosos (Cobros): los clientes con boletas vencidas, del más atrasado al menos, con lo que deben y el
 * interés a hoy, en qué escalón están y qué se puede hacer: recordarle, escribirle o darle unos días de tregua.
 */
/** Los clientes con boletas vencidas (del más atrasado al menos), con su estado de mora a hoy. */
export function useMorosos(facturas: FacturaDoc[]) {
  const { clientes, settings } = useRedes();
  const cfg = leerConfigMora(settings as unknown as Record<string, unknown>);
  const hoy = hoyISO();
  const filas = useMemo(
    () =>
      clientes
        .map((c) => {
          const tregua = !!c.mora_tregua_hasta && c.mora_tregua_hasta >= hoy;
          const e = estadoMora(
            facturas.filter((f) => f.proyecto_id === c.id),
            hoy,
            cfg,
            tregua
          );
          return { c, e, tregua };
        })
        .filter((x) => x.e.dias > 0)
        .sort((a, b) => b.e.dias - a.e.dias || b.e.deuda - a.e.deuda),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientes, facturas, hoy, cfg.activo, cfg.aviso, cfg.extras, cfg.pausa]
  );
  const total = filas.reduce((a, x) => a + x.e.deuda + x.e.interes, 0);
  return { filas, total, cfg };
}

export function Morosos({ facturas, embebido }: { facturas: FacturaDoc[]; embebido?: boolean }) {
  const { chats } = useRedes();
  const { filas, total, cfg } = useMorosos(facturas);
  if (!filas.length) return null;

  return (
    <section id="morosos" className={cn("space-y-3", !embebido && "rounded-3xl border border-red-500/30 bg-gradient-to-br from-red-500/[0.07] via-card to-card p-4")}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle className="h-5 w-5 text-red-500" /> Morosos
          </h2>
          <p className="text-xs text-muted-foreground">
            {filas.length} cliente{filas.length === 1 ? "" : "s"} con pagos vencidos · deben {formatARS(total)} con interés (0,5% por día).
            {cfg.activo ? ` En mora a los ${cfg.aviso} días, sin extras a los ${cfg.extras} y producción pausada a los ${cfg.pausa}.` : " Los escalones están desactivados (Ajustes)."}
          </p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {filas.map(({ c, e, tregua }) => (
          <Fila
            key={c.id}
            cliente={c}
            e={e}
            tregua={tregua ? c.mora_tregua_hasta! : null}
            recordado={c.mora_recordado_at ?? null}
            chatId={chats.find((x) => x.proyecto_id === c.id && x.tipo !== "directo")?.id ?? null}
            proximo={cfg.activo ? (e.nivel === "vencido" ? cfg.aviso : e.nivel === "mora" ? cfg.extras : e.nivel === "sin_extras" ? cfg.pausa : null) : null}
          />
        ))}
      </div>
    </section>
  );
}

function Fila({
  cliente,
  e,
  tregua,
  recordado,
  chatId,
  proximo,
}: {
  cliente: import("@/integrations/firebase/types").Project;
  e: ReturnType<typeof estadoMora>;
  tregua: string | null;
  recordado: string | null;
  chatId: string | null;
  proximo: number | null;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"recordar" | "tregua" | null>(null);
  const n = NIVEL_MORA[e.nivel];
  const recordar = async () => {
    setBusy("recordar");
    try {
      assertEditable();
      await callApi("/api/pagos/mora-recordar", { proyecto_id: cliente.id });
      toast.success("Le mandamos el recordatorio");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar");
    } finally {
      setBusy(null);
    }
  };
  const darTregua = async () => {
    setBusy("tregua");
    try {
      assertEditable();
      const hasta = tregua ? null : sumarDias(hoyISO(), 7);
      await updateDoc(doc(db, "projects", cliente.id), { mora_tregua_hasta: hasta });
      await recalcularMora(cliente.id);
      toast.success(hasta ? `Tregua hasta el ${fechaCorta(hasta)}: sigue pudiendo trabajar` : "Tregua quitada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={cn("space-y-3 rounded-2xl border bg-card p-3.5", e.nivel === "pausa" && "border-red-500/60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <ClienteTag cliente={cliente} />
          <p className="text-2xl font-bold tabular-nums leading-none">{formatARS(e.deuda + e.interes)}</p>
          <p className="text-[11px] text-muted-foreground">
            {formatARS(e.deuda)} + {formatARS(e.interes)} de interés · {e.boletas} boleta{e.boletas === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", n.clase)}>
            <n.icono className="h-3 w-3" /> {n.label}
          </span>
          <span className="text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">{e.dias} días de atraso</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {e.desde && <span>Venció el {fechaCorta(e.desde)}</span>}
        {proximo != null && proximo > e.dias && <span>Próximo escalón en {proximo - e.dias} día{proximo - e.dias === 1 ? "" : "s"}</span>}
        {tregua && <span className="font-semibold text-sky-600 dark:text-sky-400">Tregua hasta el {fechaCorta(tregua)}</span>}
        {recordado && <span>Último recordatorio: {fechaCorta(recordado.slice(0, 10))}</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-8 rounded-full" onClick={recordar} disabled={!!busy}>
          {busy === "recordar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BellRing className="mr-1.5 h-3.5 w-3.5" />}
          Recordarle
        </Button>
        {chatId && (
          <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => abrirEnDock(chatId)}>
            <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Escribirle
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={darTregua} disabled={!!busy} title="Durante 7 días no se le frenan los extras ni la producción">
          {busy === "tregua" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Timer className="mr-1.5 h-3.5 w-3.5" />}
          {tregua ? "Quitar tregua" : "Darle 7 días"}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => navigate(`/clientes/${cliente.id}`)}>
          Ver ficha
        </Button>
      </div>
    </div>
  );
}
