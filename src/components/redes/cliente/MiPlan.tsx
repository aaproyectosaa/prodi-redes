import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Clapperboard, Copy, Image as ImageIcon, Loader2, Megaphone, Minus, Plus, Receipt, Smartphone, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/redes/PageShell";
import { DebitoCliente } from "@/components/redes/Debito";
import { BoletaDialog } from "@/components/redes/admin/BoletaDialog";
import { CupoVideos } from "@/components/redes/cliente/CupoVideos";
import { useRedes } from "@/contexts/redes-data-context";
import { mesAR } from "@/lib/fecha";
import { fechaCorta, formatARS, hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { extraPorPlataforma, planDe, PLATAFORMAS_EXTRA, textoDuracion, usoPlan, type PlanEfectivo, type PlataformaExtra } from "@/lib/redes/planes";
import { cupoPiezas, iniciarPago } from "@/lib/redes/piezas";
import { DIA_PAGO_DESDE, DIA_VENCIMIENTO, diaPago, interesMora, nombrePeriodo, textoMora, textoPlazoPago, totalMensual, useFacturasCliente, type FacturaDoc } from "@/lib/redes/facturacion";
import { DATOS_COBRO_DEFAULT } from "@/lib/redes/types";
import type { Project } from "@/integrations/firebase/types";
import { cn } from "@/lib/utils";

const nombreMes = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();
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
  const pagoHasta = diaPago(cliente.facturacion?.pago_hasta) ?? settings.dia_vencimiento ?? DIA_VENCIMIENTO;
  const pagoDesde = Math.min(diaPago(cliente.facturacion?.pago_desde) ?? DIA_PAGO_DESDE, pagoHasta);

  const debe = facturas.filter((f) => f.estado === "pendiente").sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
  // Lo que debe hoy: el saldo de cada boleta más el interés por mora a hoy (0,5% por día desde el 6).
  const totalDebe = debe.reduce((a, f) => a + interesMora(f, hoy).totalConInteres, 0);
  // El débito automático cobra el total de la boleta (con IVA y extras fijos) más la comisión de MP.
  const totalBoleta = totalMensual({ abono: plan.precioMensual, facturacion: cliente.facturacion ?? null }, settings.iva_pct ?? 21);
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
                      (f.debito && !f.debitado ? "Se debita sola" : `${textoPlazoPago(f.vencimiento, f.pago_desde)} · después, 0,5% de interés por día`)}
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
                {cobro.titular || cobro.banco ? ". " : ""}Cuando pagues, avisanos por el chat.
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
              {debito ? "Tu abono se cobra solo cada mes con el débito automático." : `La boleta de cada mes te llega el 27 y la pagás en el mes siguiente: la de ${nombreMes(mes)}, del ${pagoDesde} al ${pagoHasta} de ${nombreMes(sumarMeses(mes, 1))}. Después corre un interés del 0,5% por día.`}
              {pagadoAnio > 0 ? ` En ${anio} llevás pagado ${formatARS(pagadoAnio)}.` : ""}
            </p>
          </div>
        </div>
      )}

      <CupoVideos uso={uso} mes={mes} precioExtra={plan.precioVideoExtra} onPedir={onPedirVideo} />

      {/* 2. Qué incluye y cuánto usaste */}
      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        {/* Encabezado con color: el plan, lo que paga y lo que incluye por mes. */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#6F40FC] via-[#8B5CF6] to-[#E040A0] p-6 text-white">
          <span className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
          <span className="pointer-events-none absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/80">
                <Sparkles className="h-3.5 w-3.5" /> Tu plan
              </p>
              <p className="mt-1 text-3xl font-bold tracking-tight">{plan.nombre}</p>
              <p className="mt-1 text-sm text-white/85">
                {plan.videosMes} videos con publicidad{cupoP.incluidas ? ` y ${cupoP.incluidas} piezas gráficas` : ""} por mes
              </p>
            </div>
            {plan.precioMensual > 0 && (
              <div className="rounded-2xl bg-white/15 px-4 py-2.5 text-right backdrop-blur">
                <p className="text-2xl font-bold tabular-nums">{formatARS(plan.precioMensual)}</p>
                <p className="text-[11px] text-white/80">por mes</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          {(plan.redes.length > 0 || plan.pauta?.incluida || plan.administracionRedes) && (
            <div>
              <p className="mb-2.5 text-sm font-semibold">Qué hacemos por vos</p>
              <ul className="grid gap-3 sm:grid-cols-3">
                {plan.redes.length > 0 && (
                  <Incluye i={0} icono={Smartphone} color="from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-300" titulo="Tus redes">
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {plan.redes.map((r) => (
                        <span key={r} className="rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {r}
                        </span>
                      ))}
                    </span>
                  </Incluye>
                )}
                {plan.pauta?.incluida && (
                  <Incluye i={1} icono={Megaphone} color="from-amber-500/20 to-amber-500/5 text-amber-600 dark:text-amber-300" titulo="Publicidad">
                    {plan.pauta.monto ? (
                      <>
                        <span className="block text-lg font-bold tabular-nums text-foreground">{formatARS(plan.pauta.monto)}</span>
                        <span>por mes invertidos en tus anuncios</span>
                      </>
                    ) : (
                      "Armamos y manejamos tus anuncios"
                    )}
                  </Incluye>
                )}
                {plan.administracionRedes && (
                  <Incluye i={2} icono={CheckCircle2} color="from-emerald-500/20 to-emerald-500/5 text-emerald-600 dark:text-emerald-300" titulo="Administración de redes">
                    Publicamos y cuidamos tu perfil. <span className="whitespace-nowrap">No incluye responder mensajes.</span>
                  </Incluye>
                )}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">Lo que usaste en {mesLabel(mes).split(" ")[0].toLowerCase()}</p>
              <p className="text-[11px] text-muted-foreground">Vuelve a empezar el 1 de cada mes</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Medidor
                icono={Clapperboard}
                titulo="Videos"
                usados={uso.usados}
                total={uso.cupo}
                nota={uso.creditosExtra ? `incluye ${uso.creditosExtra} extra que compraste` : undefined}
                accion={{ label: uso.disponibles > 0 || !uso.cupo ? "Pedir un video" : "Pedir un video extra", onClick: onPedirVideo }}
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
          </div>
        </div>
      </div>

      {/* 3. Cómo pagás y extras */}
      <div className="grid gap-4 md:grid-cols-2">
        <DebitoCliente cliente={cliente} monto={totalBoleta} comision={settings.comision_mp_pct} email={email} />
        <ComprarExtras clienteId={cliente.id} plan={plan} />
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

/** Una cosa que incluye el plan: ícono con color, título y detalle. Entra con una animación suave. */
function Incluye({ i, icono: Icono, color, titulo, children }: { i: number; icono: React.ElementType; color: string; titulo: string; children: React.ReactNode }) {
  return (
    <li
      className="tour-subir group rounded-2xl border bg-background/60 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
      style={{ animationDelay: `${i * 90}ms` }}
    >
      <span className={cn("mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br transition-transform duration-300 group-hover:scale-110", color)}>
        <Icono className="h-5 w-5" />
      </span>
      <b className="block text-sm">{titulo}</b>
      <span className="block text-sm text-muted-foreground">{children}</span>
    </li>
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
  // Anillo: se llena al aparecer.
  const [lleno, setLleno] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setLleno(pct), 120);
    return () => window.clearTimeout(t);
  }, [pct]);
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="group flex flex-col rounded-2xl border bg-background/60 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
            <circle cx="32" cy="32" r={R} fill="none" strokeWidth="7" className="stroke-muted" />
            {total > 0 && (
              <circle
                cx="32"
                cy="32"
                r={R}
                fill="none"
                strokeWidth="7"
                strokeLinecap="round"
                className={cn("transition-[stroke-dashoffset] duration-1000 ease-out", quedan ? "stroke-primary" : "stroke-amber-500")}
                strokeDasharray={C}
                strokeDashoffset={C - (C * lleno) / 100}
              />
            )}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-primary transition-transform duration-300 group-hover:scale-110">
            <Icono className="h-5 w-5" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{titulo}</p>
          {total > 0 && (
            <p className="text-sm tabular-nums">
              <span className="text-2xl font-bold">{quedan}</span> <span className="text-muted-foreground">{quedan === 1 ? "te queda" : "te quedan"} de {total}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">{nota ?? (quedan ? `Usaste ${usados} este mes` : "Ya usaste todo lo del mes: lo que pidas se paga aparte")}</p>
        </div>
      </div>
      {accion && (
        <Button size="sm" className="mt-3.5 h-9 w-full" variant={quedan > 0 || !total ? "default" : "outline"} onClick={accion.onClick}>
          {accion.label}
        </Button>
      )}
    </div>
  );
}

function ComprarExtras({ clienteId, plan }: { clienteId: string; plan: PlanEfectivo }) {
  const [cantidad, setCantidad] = useState(1);
  const [plataforma, setPlataforma] = useState<PlataformaExtra>("meta");
  const precio = plan.precioExtra[plataforma];
  const [loading, setLoading] = useState(false);
  const mes = mesActual();
  const comprar = async () => {
    setLoading(true);
    try {
      const { init_point } = await iniciarPago({ tipo: "video_extra", proyecto_id: clienteId, mes, cantidad, plataforma });
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
      {extraPorPlataforma(plan) && (
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {PLATAFORMAS_EXTRA.map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => setPlataforma(p.v)}
              className={cn(
                "rounded-xl border px-2 py-1.5 text-center text-xs transition-colors",
                plataforma === p.v ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:border-primary/50"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
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
              <span className="text-xs text-muted-foreground">{formatARS(precio)} c/u{plan.duracionExtra[plataforma] ? ` · ${textoDuracion(plan.duracionExtra[plataforma])}` : ""}</span>
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
