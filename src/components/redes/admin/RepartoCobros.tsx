import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Clock, Loader2, MapPin, Sparkles } from "lucide-react";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { callApi } from "@/lib/redes/api";
import { useConfigPagos, useLiquidaciones } from "@/lib/redes/facturacion";
import { doc, setDoc } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { assertEditable } from "@/lib/redes/vistaComo";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { fechaCorta, formatARS } from "@/lib/redes/format";
import { NOMBRE_ROL, repartoDe, SE_REPARTE, type CobroConMp, type Reparto } from "@/lib/redes/reparto";
import type { Cobro } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

const dia = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" });

/** Trae de Mercado Pago la comisión, lo neto y la liberación de los cobros que todavía no lo tienen (una vez por pantalla). */
export function useDetalleMp(cobros: Cobro[]) {
  const pedidos = useRef(new Set<string>());
  const [cargando, setCargando] = useState(false);
  const faltan = cobros
    .filter((c) => c.estado === "aprobado" && SE_REPARTE.includes(c.tipo))
    .filter((c) => {
      const m = c as CobroConMp;
      return m.mp_neto == null || (!m.mp_liberado && !!m.mp_libera_at && new Date(m.mp_libera_at).getTime() <= Date.now());
    })
    .map((c) => c.id)
    .filter((id) => !pedidos.current.has(id));
  const clave = faltan.slice(0, 30).join(",");
  useEffect(() => {
    if (!clave) return;
    const ids = clave.split(",");
    ids.forEach((id) => pedidos.current.add(id));
    setCargando(true);
    callApi("/api/pagos/mp-detalle", { cobro_ids: ids, solo_vista: true })
      .catch(() => undefined)
      .finally(() => setCargando(false));
  }, [clave]);
  return cargando;
}

/** Los repartos de esos cobros (los que se reparten). */
export function useRepartos(cobros: Cobro[]): Reparto[] {
  const { videos, piezas, clientes } = useRedes();
  const pagos = useConfigPagos();
  return useMemo(
    () =>
      cobros
        .filter((c) => c.estado === "aprobado" && SE_REPARTE.includes(c.tipo))
        .map((c) =>
          repartoDe(c as CobroConMp, {
            videos,
            piezas,
            pagos,
            equipoDiseno: clientes.find((x) => x.id === c.proyecto_id)?.team_roles?.diseno ?? [],
          })
        ),
    [cobros, videos, piezas, pagos, clientes]
  );
}

function Linea({ label, monto, signo, tono, sub, icon: Icon }: { label: string; monto: number; signo?: "-" | "="; tono?: "fuerte" | "ganancia"; sub?: string; icon?: React.ElementType }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 py-1.5", tono === "fuerte" && "border-t pt-2.5 font-semibold", tono === "ganancia" && "mt-1 rounded-xl bg-success/10 px-3 py-2.5 font-bold text-success")}>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />}
          {label}
        </span>
        {sub && <span className="block text-[11px] font-normal text-muted-foreground">{sub}</span>}
      </span>
      <span className="shrink-0 tabular-nums">
        {signo === "-" && monto ? "− " : ""}
        {formatARS(monto)}
      </span>
    </div>
  );
}

/** El reparto de un cobro: lo que entró, la comisión, viáticos, el equipo y lo que le queda a Prodi. */
export function DetalleReparto({ r }: { r: Reparto }) {
  const { profiles } = useAppData();
  const nombre = (uid: string | null) => (uid ? profiles.find((p) => p.id === uid)?.nombre?.split(" ")[0] ?? "Alguien" : "Sin asignar");
  return (
    <div className="space-y-0.5 text-sm">
      <Linea label="Cobrado" monto={r.bruto} />
      <Linea label="Comisión de Mercado Pago" monto={r.comision} signo="-" sub={r.estimado ? "Todavía sin el dato de Mercado Pago" : undefined} />
      <Linea
        label="Te entra"
        monto={r.neto}
        tono="fuerte"
        sub={r.liberaAt ? (r.liberado ? `Liberado el ${dia(r.liberaAt)}` : `Se libera el ${dia(r.liberaAt)}`) : undefined}
      />
      {r.viaticos > 0 && <Linea label="Viáticos (para el viaje)" monto={r.viaticos} signo="-" icon={MapPin} />}
      {r.equipo.map((e) => (
        <Linea
          key={e.clave}
          label={`${NOMBRE_ROL[e.rol]} · ${nombre(e.uid)}`}
          monto={e.monto}
          signo="-"
          sub={e.nota ? `${e.titulo} · ${e.nota}` : `${e.titulo}${r.liberado ? "" : " · se le paga cuando se libere"}`}
        />
      ))}
      <Linea label="Ganancia de Prodi" monto={r.ganancia} tono="ganancia" icon={Sparkles} />
    </div>
  );
}

/** Lista de cobros por Mercado Pago; los extras se abren para ver el reparto. */
export function CobrosConReparto({ cobros }: { cobros: Cobro[] }) {
  const cargando = useDetalleMp(cobros);
  const repartos = useRepartos(cobros);
  const [abierto, setAbierto] = useState<string | null>(null);
  if (!cobros.length) return <p className="text-sm text-muted-foreground">Sin cobros por Mercado Pago.</p>;
  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-card">
      {cobros.map((c) => {
        const r = repartos.find((x) => x.cobro.id === c.id);
        const open = abierto === c.id && !!r;
        return (
          <div key={c.id}>
            <button
              type="button"
              disabled={!r}
              onClick={() => setAbierto(open ? null : c.id)}
              className={cn("flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm", r && "transition-colors hover:bg-muted/40")}
            >
              <div className="min-w-0">
                <p className="font-medium">{c.concepto}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {fechaCorta(c.created_at)}
                  {c.mp_payment_id ? <span>· MP #{c.mp_payment_id}</span> : null}
                  {r && r.liberaAt && (
                    <span className={cn("inline-flex items-center gap-1", r.liberado ? "text-success" : "text-amber-600 dark:text-amber-400")}>
                      · {r.liberado ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {r.liberado ? "liberado" : `se libera el ${dia(r.liberaAt)}`}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatARS(c.monto)}</p>
                  {r ? (
                    <p className="text-[11px] font-medium text-success">ganancia {formatARS(r.ganancia)}</p>
                  ) : (
                    <p className={cn("text-[11px] capitalize", c.estado === "aprobado" ? "text-success" : "text-muted-foreground")}>{c.estado}</p>
                  )}
                </div>
                {r && <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />}
              </div>
            </button>
            {open && r && (
              <div className="border-t bg-muted/30 px-4 py-3 animate-in fade-in">
                <DetalleReparto r={r} />
              </div>
            )}
          </div>
        );
      })}
      {cargando && (
        <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Trayendo los datos de Mercado Pago…
        </p>
      )}
    </div>
  );
}

/**
 * Pagos al equipo: la parte de cada uno en los extras cobrados ese mes. Se paga aparte del mes, recién cuando
 * Mercado Pago libera la plata. "Marcar pagado" queda en su liquidación del mes (extras_pagados).
 */
export function ExtrasEquipo({ mes }: { mes: string }) {
  const { cobros } = useRedes();
  const { profiles } = useAppData();
  const delMes = useMemo(() => cobros.filter((c) => c.estado === "aprobado" && SE_REPARTE.includes(c.tipo)), [cobros]);
  useDetalleMp(delMes);
  const repartos = useRepartos(delMes).filter((r) => r.mes === mes);
  const liqs = useLiquidaciones(mes);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const partes = repartos.flatMap((r) => r.equipo.filter((e) => e.uid && e.monto > 0).map((e) => ({ r, e })));
  if (!partes.length) return null;
  const pagadoDe = (uid: string, clave: string) =>
    (liqs.find((l) => l.uid === uid && l.mes === mes) as { extras_pagados?: Record<string, { at: string }> } | undefined)?.extras_pagados?.[clave];
  const total = partes.reduce((a, x) => a + x.e.monto, 0);
  const marcar = async (uid: string, clave: string, monto: number) => {
    setOcupado(clave);
    try {
      assertEditable();
      await setDoc(doc(db, "equipo_liquidaciones", `${uid}_${mes}`), { uid, mes, extras_pagados: { [clave]: { monto, at: new Date().toISOString() } } }, { merge: true });
      toast.success("Marcado como pagado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo marcar");
    } finally {
      setOcupado(null);
    }
  };
  return (
    <section className="space-y-2.5 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold">Extras cobrados por Mercado Pago</p>
          <p className="text-xs text-muted-foreground">Se pagan aparte del mes, cuando Mercado Pago libera la plata. No cuentan en el pago del mes.</p>
        </div>
        <p className="text-sm font-semibold tabular-nums">{formatARS(total)}</p>
      </div>
      <ul className="divide-y rounded-xl border">
        {partes.map(({ r, e }) => {
          const pagado = pagadoDe(e.uid!, e.clave);
          return (
            <li key={e.clave} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {profiles.find((p) => p.id === e.uid)?.nombre ?? "Alguien"} <span className="font-normal text-muted-foreground">· {NOMBRE_ROL[e.rol]}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{e.titulo}</p>
              </div>
              <span className="tabular-nums font-semibold">{formatARS(e.monto)}</span>
              {pagado ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Pagado el {dia(pagado.at)}
                </span>
              ) : r.liberado ? (
                <Button size="sm" className="h-8 rounded-full" disabled={ocupado === e.clave} onClick={() => void marcar(e.uid!, e.clave, e.monto)}>
                  {ocupado === e.clave ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  Marcar pagado
                </Button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <Clock className="h-3.5 w-3.5" /> {r.liberaAt ? `Se libera el ${dia(r.liberaAt)}` : "Esperando a Mercado Pago"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
