import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Clapperboard, Copy, Image as ImageIcon, Loader2, Minus, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/redes/PageShell";
import { DebitoCliente } from "@/components/redes/Debito";
import { BoletaDialog } from "@/components/redes/admin/BoletaDialog";
import { useRedes } from "@/contexts/redes-data-context";
import { mesAR } from "@/lib/fecha";
import { fechaCorta, formatARS, hoyISO, mesActual, mesLabel } from "@/lib/redes/format";
import { planDe, usoPlan } from "@/lib/redes/planes";
import { cupoPiezas, iniciarPago } from "@/lib/redes/piezas";
import { interesMora, nombrePeriodo, textoMora, totalMensual, useFacturasCliente, type FacturaDoc } from "@/lib/redes/facturacion";
import { DATOS_COBRO_DEFAULT } from "@/lib/redes/types";
import type { Project } from "@/integrations/firebase/types";
import { cn } from "@/lib/utils";

const ddmm = (f: string) => f.split("-").reverse().slice(0, 2).join("/");
const ESTADO_PAGO: Record<string, string> = {
  aprobado: "Pagado",
  pendiente: "Esperando el pago",
  rechazado: "No se completó",
  reembolsado: "Devuelto",
  cancelado: "Cancelado",
};

/**
 * "Mi plan" del cliente, en criollo: si está al día o cuánto debe, qué incluye su plan y cuánto
 * usó este mes, cómo paga, sus boletas y los otros pagos.
 */
export function MiPlan({
  cliente,
  email,
  onPedirVideo,
  onPedirPieza,
}: {
  cliente: Project;
  email?: string;
  onPedirVideo: () => void;
  onPedirPieza: () => void;
}) {
  const { planes, videos, piezas, cobros, settings } = useRedes();
  const mes = mesActual();
  const hoy = hoyISO();
  const plan = planDe(cliente, planes);
  const uso = usoPlan(cliente, planes, videos, mes);
  const cupoP = cupoPiezas(cliente, planes, piezas, mes);
  const facturas = useFacturasCliente(cliente.id);
  const cobro = { ...DATOS_COBRO_DEFAULT, ...(settings.cobro ?? {}) };
  const debito = cliente.suscripcion?.estado === "activa";

  const debe = facturas.filter((f) => f.estado === "pendiente").sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
  // Lo que debe hoy: el saldo de cada boleta más el interés por mora a hoy (0,5% por día desde el 6).
  const totalDebe = debe.reduce((a, f) => a + interesMora(f, hoy).totalConInteres, 0);
  // El débito automático cobra el total de la boleta (con IVA y extras fijos), no solo el abono.
  const montoDebito = totalMensual({ abono: plan.precioMensual, facturacion: cliente.facturacion ?? null }, settings.iva_pct ?? 21);
  const vencidas = debe.filter((f) => f.vencimiento < hoy);
  const anio = mes.slice(0, 4);
  const misCobros = cobros.filter((c) => c.proyecto_id === cliente.id);
  const pagadoAnio =
    facturas.filter((f) => f.estado === "cobrada" && f.mes.startsWith(anio)).reduce((a, f) => a + f.bruto + (Number(f.interes_cobrado) || 0), 0) +
    misCobros.filter((c) => c.tipo !== "abono" && c.estado === "aprobado" && mesAR(c.pagado_at ?? c.created_at).startsWith(anio)).reduce((a, c) => a + c.monto, 0);

  // Boleta abierta (también desde el link del aviso o del mail: ?factura=<id>).
  const [params, setParams] = useSearchParams();
  const [ver, setVer] = useState<string | null>(null);
  const deLink = params.get("factura");
  useEffect(() => {
    if (!deLink) return;
    setVer(deLink);
    const next = new URLSearchParams(params);
    next.delete("factura");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deLink]);
  const abierta = facturas.find((f) => f.id === ver) ?? null;

  const copiar = (t: string, que: string) =>
    void navigator.clipboard?.writeText(t).then(
      () => toast.success(`${que} copiado`),
      () => toast.error("No se pudo copiar")
    );

  return (
    <div className="space-y-6">
      {/* 1. Estado de cuenta */}
      {debe.length > 0 ? (
        <div className={cn("rounded-2xl border p-5", vencidas.length ? "border-destructive/40 bg-destructive/[0.06]" : "border-amber-500/40 bg-amber-500/[0.06]")}>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className={cn("h-4 w-4", vencidas.length ? "text-destructive" : "text-amber-500")} />
            {vencidas.length ? "Tenés un pago vencido" : "Tenés un pago pendiente"}
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{formatARS(totalDebe)}</p>
          <div className="mt-3 space-y-1.5">
            {debe.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setVer(f.id)}
                className="flex w-full items-center gap-3 rounded-xl border bg-background/60 px-3 py-2 text-left text-sm transition-colors hover:border-primary/50"
              >
                <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium first-letter:uppercase">
                    {f.tipo} de {nombrePeriodo(f)}
                  </span>
                  <span className={cn("block text-xs", f.vencimiento < hoy ? "font-semibold text-destructive" : "text-muted-foreground")}>
                    {textoMora(f, hoy) ||
                      (f.debito && !f.debitado ? "Se debita sola" : `Vence el ${ddmm(f.vencimiento)} · después, 0,5% de interés por día`)}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{formatARS(interesMora(f, hoy).totalConInteres)}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
          {!debito && (
            <div className="mt-4 rounded-xl bg-background/60 p-3 text-sm">
              <p className="font-medium">Cómo pagar: transferencia</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {cobro.alias && (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => copiar(cobro.alias, "Alias")}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Alias: {cobro.alias}
                  </Button>
                )}
                {cobro.cbu && (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => copiar(cobro.cbu, "CBU")}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> CBU
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {[cobro.titular && `A nombre de ${cobro.titular}`, cobro.banco].filter(Boolean).join(" · ")}
                {cobro.titular || cobro.banco ? ". " : ""}Cuando pagues, avisanos por el chat o por WhatsApp.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div>
            <p className="font-semibold">Estás al día</p>
            <p className="text-sm text-muted-foreground">
              {debito ? "Tu abono se cobra solo cada mes con el débito automático." : `La boleta de cada mes te llega el 27 del mes anterior y la pagás hasta el 5. Después corre un interés del 0,5% por día.`}
              {pagadoAnio > 0 ? ` En ${anio} llevás pagado ${formatARS(pagadoAnio)}.` : ""}
            </p>
          </div>
        </div>
      )}

      {/* 2. Qué incluye y cuánto usaste */}
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tu plan</p>
            <p className="mt-0.5 text-2xl font-bold">{plan.nombre}</p>
            <p className="text-sm text-muted-foreground">
              {formatARS(plan.precioMensual)} por mes{plan.precioMensual ? " · " : ""}incluye {plan.videosMes} videos con publicidad
              {cupoP.incluidas ? ` y ${cupoP.incluidas} piezas gráficas` : ""} por mes
            </p>
          </div>
        </div>
        <p className="mt-5 text-sm font-semibold">Lo que usaste en {mesLabel(mes).split(" ")[0].toLowerCase()}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Medidor
            icono={Clapperboard}
            titulo="Videos"
            usados={uso.usados}
            total={uso.cupo}
            nota={uso.creditosExtra ? `incluye ${uso.creditosExtra} extra que compraste` : undefined}
            accion={uso.disponibles > 0 ? { label: "Pedir un video", onClick: onPedirVideo } : undefined}
          />
          <Medidor
            icono={ImageIcon}
            titulo="Piezas gráficas"
            usados={cupoP.usadas}
            total={cupoP.incluidas}
            nota={cupoP.incluidas ? undefined : "Tu plan no incluye piezas: se pagan aparte"}
            accion={{ label: "Pedir una pieza", onClick: onPedirPieza }}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">El contador vuelve a empezar el 1 de cada mes.</p>
      </div>

      {/* 3. Cómo pagás y extras */}
      <div className="grid gap-4 md:grid-cols-2">
        <DebitoCliente cliente={cliente} monto={montoDebito} email={email} />
        <ComprarExtras clienteId={cliente.id} precio={plan.precioVideoExtra} />
      </div>

      {/* 4. Boletas */}
      <Section title="Tus boletas" description="Tocá una para verla o descargarla en PDF. También te llegan por mail.">
        {facturas.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Todavía no tenés boletas.</p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {facturas.map((f) => (
              <FilaBoleta key={f.id} f={f} hoy={hoy} onClick={() => setVer(f.id)} />
            ))}
          </div>
        )}
      </Section>

      {/* 5. Otros pagos */}
      {misCobros.length > 0 && (
        <details className="rounded-2xl border bg-card px-4 py-3">
          <summary className="cursor-pointer select-none text-sm font-semibold">Otros pagos con Mercado Pago ({misCobros.length})</summary>
          <div className="mt-2 divide-y">
            {misCobros.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.concepto}</p>
                  <p className="text-xs text-muted-foreground">{fechaCorta(c.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatARS(c.monto)}</p>
                  <p className={cn("text-[11px]", c.estado === "aprobado" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                    {ESTADO_PAGO[c.estado] ?? c.estado}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {abierta && <BoletaDialog f={abierta} cobro={cobro} onClose={() => setVer(null)} />}
    </div>
  );
}

function FilaBoleta({ f, hoy, onClick }: { f: FacturaDoc; hoy: string; onClick: () => void }) {
  const vencida = f.estado === "pendiente" && f.vencimiento < hoy;
  const pagada = f.estado === "cobrada";
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40">
      <div className="min-w-0">
        <p className="font-medium first-letter:uppercase">
          {f.tipo} · {nombrePeriodo(f)}
        </p>
        <p className={cn("text-xs", vencida ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {pagada
            ? `Pagada ✓${f.interes_cobrado ? ` · con ${formatARS(f.interes_cobrado)} de interés` : ""}`
            : textoMora(f, hoy) || (f.debito && !f.debitado ? "Se debita sola" : `Vence el ${ddmm(f.vencimiento)}`)}
        </p>
      </div>
      <span className="font-semibold tabular-nums">
        {formatARS(pagada ? f.bruto + (Number(f.interes_cobrado) || 0) : interesMora(f, hoy).totalConInteres)}
      </span>
    </button>
  );
}

function Medidor({
  icono: Icono,
  titulo,
  usados,
  total,
  nota,
  accion,
}: {
  icono: React.ElementType;
  titulo: string;
  usados: number;
  total: number;
  nota?: string;
  accion?: { label: string; onClick: () => void };
}) {
  const quedan = Math.max(0, total - usados);
  const pct = total ? Math.min(100, Math.round((usados / total) * 100)) : 0;
  return (
    <div className="rounded-xl border p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Icono className="h-4 w-4 text-primary" /> {titulo}
        </p>
        {total > 0 && (
          <p className="text-sm tabular-nums">
            <b>{usados}</b> <span className="text-muted-foreground">de {total}</span>
          </p>
        )}
      </div>
      {total > 0 && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all duration-700", quedan ? "bg-primary" : "bg-amber-500")} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {nota ?? (quedan ? `Te ${quedan === 1 ? "queda 1" : `quedan ${quedan}`} este mes` : "Ya usaste todo lo del mes: lo que pidas se paga aparte")}
      </p>
      {accion && (
        <Button size="sm" variant="outline" className="mt-2.5 h-8 w-full" onClick={accion.onClick}>
          {accion.label}
        </Button>
      )}
    </div>
  );
}

function ComprarExtras({ clienteId, precio }: { clienteId: string; precio: number }) {
  const [cantidad, setCantidad] = useState(1);
  const [loading, setLoading] = useState(false);
  const mes = mesActual();
  const comprar = async () => {
    setLoading(true);
    try {
      const { init_point } = await iniciarPago({ tipo: "video_extra", proyecto_id: clienteId, mes, cantidad });
      window.location.href = init_point;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar el pago");
      setLoading(false);
    }
  };
  return (
    <div className="rounded-2xl border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">¿Necesitás más videos?</p>
      <p className="mt-1 text-sm text-muted-foreground">Para una promo o un lanzamiento, sumá videos a este mes.</p>
      {precio > 0 ? (
        <>
          <div className="mt-4 flex items-center gap-3">
            <Button size="icon" variant="outline" onClick={() => setCantidad((c) => Math.max(1, c - 1))} aria-label="Uno menos">
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center text-xl font-bold tabular-nums">{cantidad}</span>
            <Button size="icon" variant="outline" onClick={() => setCantidad((c) => Math.min(10, c + 1))} aria-label="Uno más">
              <Plus className="h-4 w-4" />
            </Button>
            <span className="ml-auto text-right">
              <span className="block text-xl font-bold">{formatARS(precio * cantidad)}</span>
              <span className="text-xs text-muted-foreground">{formatARS(precio)} c/u</span>
            </span>
          </div>
          <Button className="mt-4 w-full" onClick={comprar} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Pagar con Mercado Pago
          </Button>
        </>
      ) : (
        <p className="mt-4 text-sm">Escribinos y te pasamos el precio.</p>
      )}
    </div>
  );
}
