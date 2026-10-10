import { useMemo, useState } from "react";
import { CheckCircle2, Clock, HandCoins, Hourglass, Sparkles, TrendingUp } from "lucide-react";
import { PageShell, Section } from "@/components/redes/PageShell";
import { MesNav } from "@/components/redes/admin/FacturaPartes";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { fechaCorta, formatARS, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import {
  calcularPago,
  totalParciales,
  trabajosDelMes,
  UNIDAD_POR_ROL,
  useConfigPagos,
  useLiquidaciones,
  type ConfigPago,
} from "@/lib/redes/facturacion";
import type { PiezaIA, Video } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

const nombreMes = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();

/** Desde cuándo cada uno ve sus ganancias en el sistema (lo anterior quedó en la planilla). */
const DESDE_GANANCIAS = "2026-10";

/** Lo que tiene en la mano y todavía no cuenta (cuando lo termine, suma). */
function enCamino(uid: string, role: string, videos: Video[], piezas: PiezaIA[], misClientes: Set<string>): { cantidad: number; texto: string } {
  const mio = (v: Video, campo: "productor_id" | "editor_id" | "pauta_id") => v[campo] === uid || (!v[campo] && misClientes.has(v.proyecto_id));
  if (role === "productor") {
    const n = videos.filter((v) => ["planificado", "agendado"].includes(v.etapa) && !v.filma_cliente && mio(v, "productor_id")).length;
    return { cantidad: n, texto: `${n} ${n === 1 ? "video por filmar" : "videos por filmar"}` };
  }
  if (role === "editor") {
    const n = videos.filter((v) => v.etapa === "edicion" && mio(v, "editor_id")).length;
    return { cantidad: n, texto: `${n} ${n === 1 ? "video en edición" : "videos en edición"}` };
  }
  if (role === "pauta") {
    const n = videos.filter((v) => v.etapa === "para_publicar" && mio(v, "pauta_id")).length;
    return { cantidad: n, texto: `${n} ${n === 1 ? "video para publicar" : "videos para publicar"}` };
  }
  if (role === "diseno") {
    const n = piezas.filter((p) => p.estado === "para_aprobar" && (p.historial ?? []).some((h) => h.by === uid && h.accion.startsWith("Enviada al cliente"))).length;
    return { cantidad: n, texto: `${n} ${n === 1 ? "pieza esperando el OK del cliente" : "piezas esperando el OK del cliente"}` };
  }
  return { cantidad: 0, texto: "" };
}

/**
 * "Mis ganancias": cada integrante del equipo ve solo lo suyo. Lo que lleva ganado en el mes (con el
 * mismo cálculo que usa administración en "Pagos al equipo"), qué trabajos cuentan, si ya se le pagó,
 * lo que tiene en camino y los meses anteriores.
 */
export default function MisGanancias() {
  const [mes, setMes] = useState(mesActual());
  const { user, role } = useUserProfileContext();
  const { videos, piezas, clientes } = useRedes();
  const uid = user?.uid ?? "";
  const rol = role ?? "";
  const cfgs = useConfigPagos(!!uid);
  const desde = sumarMeses(mesActual(), -5);
  const liqs = useLiquidaciones(desde < mes ? desde : mes, !!uid);
  const cfg: ConfigPago | undefined = cfgs[uid];
  const unidad = UNIDAD_POR_ROL[rol] ?? { label: "trabajo", plural: "trabajos" };
  const idsClientes = clientes.map((c) => c.id);
  const misClientes = useMemo(
    () => new Set(clientes.filter((c) => Object.values(c.team_roles ?? {}).some((l) => Array.isArray(l) && l.includes(uid))).map((c) => c.id)),
    [clientes, uid]
  );

  const delMes = (m: string) => {
    const trabajos = trabajosDelMes(uid, rol, m, videos, piezas);
    const liq = liqs.find((l) => l.mes === m);
    const calc = calcularPago(cfg, trabajos.length, liq?.ajustes ?? [], idsClientes, { mes, trabajos });
    const pagado = liq?.estado === "pagado";
    return { trabajos, liq, calc, pagado, total: pagado ? (liq?.total_pagado ?? calc.total) : calc.total };
  };
  const actual = delMes(mes);
  const esEsteMes = mes === mesActual();
  const camino = enCamino(uid, rol, videos, piezas, misClientes);
  const porUnidad = cfg && cfg.modo !== "fijo" && cfg.modo !== "por_cliente" ? Number(cfg.por_unidad) || 0 : 0;
  // Lo de antes del sistema (planilla) lo ve solo administración: acá, de octubre 2026 en adelante.
  const historial = Array.from({ length: 6 }, (_, i) => sumarMeses(mesActual(), -i))
    .filter((m) => m >= DESDE_GANANCIAS)
    .map((m) => ({ mes: m, ...delMes(m) }));

  return (
    <PageShell
      title="Mis ganancias"
      subtitle="Lo que llevás ganado, lo que ya te pagamos y lo que tenés en camino."
      actions={<MesNav mes={mes} setMes={(m) => setMes(m < DESDE_GANANCIAS ? DESDE_GANANCIAS : m)} max={mesActual()} />}
    >
      {!cfg ? (
        <div className="rounded-2xl border border-dashed p-6 text-center">
          <HandCoins className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 font-semibold">Todavía no está cargado cómo se te paga</p>
          <p className="text-sm text-muted-foreground">Cuando administración lo cargue, acá vas a ver lo que vas ganando mes a mes.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Total del mes */}
          <div
            className={cn(
              "rounded-2xl border p-5 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
              actual.pagado ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-primary/30 bg-gradient-to-br from-primary/[0.10] to-transparent"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">
                  {actual.pagado ? `Te pagamos ${nombreMes(mes)}` : esEsteMes ? `Llevás ganado en ${nombreMes(mes)}` : `Te corresponde de ${nombreMes(mes)}`}
                </p>
                <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight">{formatARS(actual.total)}</p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                  actual.pagado ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                )}
              >
                {actual.pagado ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                {actual.pagado
                  ? `Pagado${actual.liq?.pagado_at ? ` el ${fechaCorta(actual.liq.pagado_at)}` : ""}`
                  : esEsteMes
                    ? "El mes sigue: va sumando"
                    : "Falta pagar"}
              </span>
            </div>

            {/* Cómo se arma */}
            <div className="mt-4 space-y-1.5 rounded-xl bg-background/70 p-3 text-sm">
              {actual.calc.fijo > 0 && <Linea texto="Fijo del mes" monto={actual.calc.fijo} />}
              {cfg.modo === "acuerdos"
                ? actual.calc.detalle.map((d) => (
                    <Linea
                      key={d.proyecto_id}
                      texto={`${clientes.find((c) => c.id === d.proyecto_id)?.nombre ?? "Cliente"}${[d.fijo ? " · fijo" : "", d.unidades ? ` · ${d.unidades} × ${formatARS(d.por_unidad)}` : ""].join("")}`}
                      monto={d.total}
                    />
                  ))
                : cfg.modo === "por_cliente"
                ? Object.entries(cfg.por_cliente ?? {})
                    .filter(([id, m]) => Number(m) > 0 && idsClientes.includes(id))
                    .map(([id, m]) => <Linea key={id} texto={clientes.find((c) => c.id === id)?.nombre ?? "Cliente"} monto={Number(m)} />)
                : cfg.modo !== "fijo" && (
                    <Linea
                      texto={`${actual.trabajos.length} ${actual.trabajos.length === 1 ? unidad.label : unidad.plural} × ${formatARS(porUnidad)}`}
                      monto={actual.calc.variable}
                    />
                  )}
              {(actual.liq?.ajustes ?? []).map((a, i) => (
                <Linea key={i} texto={a.concepto} monto={a.monto} />
              ))}
              <div className="flex items-center justify-between border-t pt-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatARS(actual.total)}</span>
              </div>
              {!actual.pagado && totalParciales(actual.liq) > 0 && (
                <>
                  {(actual.liq?.pagos_parciales ?? []).map((x, i) => (
                    <Linea key={`pp${i}`} texto={`Ya te pagaron el ${new Date(x.at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`} monto={-x.monto} />
                  ))}
                  <div className="flex items-center justify-between font-semibold text-primary">
                    <span>Falta que te paguen</span>
                    <span className="tabular-nums">{formatARS(actual.total - totalParciales(actual.liq))}</span>
                  </div>
                </>
              )}
            </div>

            {/* En camino */}
            {esEsteMes && porUnidad > 0 && camino.cantidad > 0 && (
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-dashed border-primary/40 p-3">
                <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-sm">
                  Tenés <b>{camino.texto}</b>. Si los terminás este mes, sumás <b>{formatARS(camino.cantidad * porUnidad)}</b> y llegás a{" "}
                  <b>{formatARS(actual.total + camino.cantidad * porUnidad)}</b>.
                </p>
              </div>
            )}
          </div>

          {/* Qué contó */}
          {cfg.modo !== "fijo" && cfg.modo !== "por_cliente" && (
            <Section
              title={`Lo que hiciste en ${nombreMes(mes)}`}
              description={`Cuenta cada ${unidad.label} del mes. Sale solo del sistema: si falta algo, avisale a administración.`}
            >
              {actual.trabajos.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Todavía no hay {unidad.plural} este mes.</p>
              ) : (
                <ul className="divide-y rounded-xl border bg-card">
                  {actual.trabajos
                    .slice()
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((t) => (
                      <Trabajo key={t.id} t={t} cliente={clientes.find((c) => c.id === t.proyecto_id)} monto={porUnidad} />
                    ))}
                </ul>
              )}
            </Section>
          )}

          {/* Meses anteriores */}
          <Section title="Últimos meses" description="Lo que te correspondió cada mes y si ya se pagó.">
            <ul className="divide-y rounded-xl border bg-card">
              {historial.map((h) => (
                <li key={h.mes}>
                  <button
                    type="button"
                    onClick={() => setMes(h.mes)}
                    className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50", h.mes === mes && "bg-primary/[0.05]")}
                  >
                    <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-sm font-medium first-letter:uppercase">{mesLabel(h.mes)}</span>
                    {cfg.modo !== "fijo" && cfg.modo !== "por_cliente" && (
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {h.trabajos.length} {h.trabajos.length === 1 ? unidad.label : unidad.plural}
                      </span>
                    )}
                    <span className="w-28 text-right font-semibold tabular-nums">{formatARS(h.total)}</span>
                    <span
                      className={cn(
                        "w-24 rounded-full px-2 py-0.5 text-center text-[11px] font-medium",
                        h.pagado
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : h.mes === mesActual()
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {h.pagado ? "Pagado" : h.mes === mesActual() ? "En curso" : "Falta pagar"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </PageShell>
  );
}

function Linea({ texto, monto }: { texto: string; monto: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-muted-foreground">{texto}</span>
      <span className={cn("shrink-0 tabular-nums", monto < 0 && "text-destructive")}>{formatARS(monto)}</span>
    </div>
  );
}

function Trabajo({
  t,
  cliente,
  monto,
}: {
  t: ReturnType<typeof trabajosDelMes>[number];
  cliente: ReturnType<typeof useRedes>["clientes"][number] | undefined;
  monto: number;
}) {
  const abrir = useOpenVideo();
  const contenido = (
    <>
      <Sparkles className="h-4 w-4 shrink-0 text-primary/70" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{t.titulo}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {cliente && <ClienteTag cliente={cliente} />} · {fechaCorta(t.at)}
        </span>
      </span>
      {monto > 0 && <span className="shrink-0 text-sm font-semibold tabular-nums">{formatARS(monto)}</span>}
    </>
  );
  return (
    <li>
      {t.tipo === "video" ? (
        <button type="button" onClick={() => abrir(t.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50">
          {contenido}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">{contenido}</div>
      )}
    </li>
  );
}
