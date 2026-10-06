import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { collection, onSnapshot, query, where } from "@/lib/db";
import { db } from "@/integrations/firebase/client";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Section } from "@/components/redes/PageShell";
import { useRedes } from "@/contexts/redes-data-context";
import { formatARS, formatNum, mesActual } from "@/lib/redes/format";
import { planDe } from "@/lib/redes/planes";
import { useFacturas, useGastos, useLiquidaciones, useObligaciones, type TipoObligacion } from "@/lib/redes/facturacion";
import type { Video } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// Paleta categórica validada (azul, naranja, verde agua) en sus pasos para fondo claro y oscuro.
const AZUL = { light: "#2a78d6", dark: "#3987e5" };
const NARANJA = { light: "#eb6834", dark: "#d95926" };
const AGUA = { light: "#1baf7a", dark: "#199e70" };

const compacto = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${n < 0 ? "-" : ""}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".", ",")}M`;
  if (a >= 1e3) return `${n < 0 ? "-" : ""}$${Math.round(a / 1e3)}k`;
  return `$${Math.round(n)}`;
};

/** Videos de un año entero (el contexto solo trae los últimos meses). */
function useVideosDelAnio(anio: number): Video[] {
  const [lista, setLista] = useState<Video[]>([]);
  useEffect(() => {
    return onSnapshot(
      query(collection(db, "videos"), where("mes", ">=", `${anio}-01`), where("mes", "<=", `${anio}-12`)),
      (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Video)),
      () => setLista([])
    );
  }, [anio]);
  return lista;
}

interface Punto {
  m: string;
  mes: string;
  ingresos: number | null;
  egresos: number | null;
  resultado: number | null;
  clientes: number | null;
  mensajes: number | null;
  deuda: number;
  estimado: boolean;
  equipo: number;
  gastos: number;
  cuotas: Record<TipoObligacion, number>;
}

/**
 * Estadísticas anuales del dueño: ingresos y gastos, resultado, clientes, mensajes de las campañas y deuda.
 * `equipoActual` es lo que corresponde pagar al equipo en el mes en curso (todavía sin liquidar).
 */
export function EstadisticasAnio({ equipoActual }: { equipoActual: number }) {
  const actual = mesActual();
  const anioActual = Number(actual.slice(0, 4));
  const [anio, setAnio] = useState(anioActual);
  const desde = `${anio}-01`;
  const { clientes, planes, cobros } = useRedes();
  const { facturas } = useFacturas(desde);
  const gastos = useGastos(desde);
  const liqs = useLiquidaciones(desde);
  const obligaciones = useObligaciones();
  const videos = useVideosDelAnio(anio);
  const mrr = clientes.reduce((a, c) => a + planDe(c, planes).precioMensual, 0);

  const datos: Punto[] = useMemo(
    () =>
      MES_CORTO.map((corto, i) => {
        const m = `${anio}-${String(i + 1).padStart(2, "0")}`;
        const futuro = m > actual;
        const fs = facturas.filter((f) => f.mes === m && f.estado !== "anulada");
        const extras = cobros
          .filter((c) => c.tipo !== "abono" && c.estado === "aprobado" && (c.pagado_at ?? c.created_at).startsWith(m))
          .reduce((a, c) => a + c.monto, 0);
        const estimado = m === actual && fs.length === 0;
        const ingresos = (estimado ? mrr : fs.reduce((a, f) => a + f.bruto, 0)) + extras;
        const liqMes = liqs.filter((l) => l.mes === m && l.estado === "pagado").reduce((a, l) => a + (l.total_pagado ?? 0), 0);
        const equipo = m === actual ? Math.max(liqMes, equipoActual) : liqMes;
        const gastosMes = gastos.filter((g) => g.mes === m).reduce((a, g) => a + g.monto, 0);
        const cuotas: Record<TipoObligacion, number> = { credito: 0, arca: 0, impuesto: 0 };
        obligaciones.forEach((o) => o.cuotas.forEach((c) => c.vence.startsWith(m) && (cuotas[o.tipo] += c.monto)));
        const egresos = equipo + gastosMes + cuotas.credito + cuotas.arca + cuotas.impuesto;
        const finDeMes = `${m}-31`;
        const deuda = obligaciones
          .filter((o) => o.tipo !== "impuesto")
          .reduce((a, o) => a + o.cuotas.filter((c) => c.vence > finDeMes && !(c.pagada && (c.pagada_at ?? "") <= finDeMes)).reduce((x, c) => x + c.monto, 0), 0);
        const mensajes = videos.filter((v) => v.mes === m && v.etapa === "publicado").reduce((a, v) => a + (v.resultados?.mensajes ?? 0), 0);
        return {
          m,
          mes: corto,
          ingresos: futuro ? null : ingresos,
          egresos: futuro ? null : egresos,
          resultado: futuro ? null : ingresos - egresos,
          clientes: futuro ? null : estimado ? clientes.length : new Set(fs.map((f) => f.proyecto_id)).size || null,
          mensajes: futuro ? null : mensajes,
          deuda,
          estimado,
          equipo,
          gastos: gastosMes,
          cuotas,
        };
      }),
    [anio, actual, facturas, cobros, mrr, liqs, equipoActual, gastos, obligaciones, videos, clientes.length]
  );

  const pasados = datos.filter((d) => d.ingresos !== null);
  const tot = (k: "ingresos" | "egresos" | "mensajes") => pasados.reduce((a, d) => a + (d[k] ?? 0), 0);
  const ingresosAnio = tot("ingresos");
  const egresosAnio = tot("egresos");
  const mensajesAnio = tot("mensajes");
  const conClientes = pasados.filter((d) => d.clientes);
  const clientesIni = conClientes[0]?.clientes ?? 0;
  const clientesFin = conClientes.at(-1)?.clientes ?? 0;
  const mejor = [...pasados].sort((a, b) => (b.ingresos ?? 0) - (a.ingresos ?? 0))[0];

  // En qué se fue la plata en el año.
  const destino = useMemo(() => {
    const m = new Map<string, number>();
    const add = (k: string, v: number) => v > 0 && m.set(k, (m.get(k) ?? 0) + v);
    pasados.forEach((d) => {
      add("Equipo", d.equipo);
      add("Créditos del banco", d.cuotas.credito);
      add("Convenio con ARCA", d.cuotas.arca);
      add("Impuestos", d.cuotas.impuesto);
    });
    gastos.filter((g) => g.mes.startsWith(String(anio)) && g.mes <= actual).forEach((g) => add(g.categoria, g.monto));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pasados, gastos, anio, actual]);
  const maxDestino = Math.max(1, ...destino.map(([, v]) => v));

  const deudaHoy = datos.find((d) => d.m === actual)?.deuda ?? datos.at(-1)!.deuda;
  const deudaPorTipo = (t: TipoObligacion) =>
    obligaciones.filter((o) => o.tipo === t).reduce((a, o) => a + o.cuotas.filter((c) => !c.pagada).reduce((x, c) => x + c.monto, 0), 0);
  const impuestosVencidos = obligaciones
    .filter((o) => o.tipo === "impuesto")
    .reduce((a, o) => a + o.cuotas.filter((c) => !c.pagada && c.vence < `${actual}-01`).reduce((x, c) => x + c.monto, 0), 0);

  const cfgPlata: ChartConfig = {
    ingresos: { label: "Ingresos", theme: AZUL },
    egresos: { label: "Gastos", theme: NARANJA },
  };

  return (
    <Section
      title="Estadísticas del año"
      description="Mes a mes: lo facturado, lo que salió (equipo, gastos, cuotas e impuestos), clientes, mensajes y deuda."
      actions={
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setAnio(anio - 1)} aria-label="Año anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[56px] text-center text-sm font-semibold tabular-nums">{anio}</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setAnio(anio + 1)} disabled={anio >= anioActual} aria-label="Año siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Facturado en ${anio}`} valor={formatARS(ingresosAnio)} sub={mejor?.ingresos ? `Mejor mes: ${MES_LARGO[Number(mejor.m.slice(5)) - 1].toLowerCase()}` : undefined} />
        <Kpi label="Salió" valor={formatARS(egresosAnio)} sub="Equipo, gastos, cuotas e impuestos" />
        <Kpi
          label="Resultado"
          valor={formatARS(ingresosAnio - egresosAnio)}
          sub={ingresosAnio ? `${Math.round(((ingresosAnio - egresosAnio) / ingresosAnio) * 100)}% de lo facturado` : undefined}
          tono={ingresosAnio - egresosAnio < 0 ? "mal" : "bien"}
        />
        <Kpi label="Mensajes de las campañas" valor={formatNum(mensajesAnio)} sub={clientesFin ? `${clientesFin} clientes (${clientesFin - clientesIni >= 0 ? "+" : ""}${clientesFin - clientesIni} en el año)` : undefined} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Grafico titulo="Ingresos y gastos" detalle="Por mes. El mes en curso es estimado hasta que se factura el 27.">
          <ChartContainer config={cfgPlata} className="aspect-auto h-60 w-full">
            <BarChart data={datos} barGap={2} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={compacto} />
              <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<Tip fmt={formatARS} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="ingresos" name="Ingresos" fill="var(--color-ingresos)" radius={[4, 4, 0, 0]} maxBarSize={16} />
              <Bar dataKey="egresos" name="Gastos" fill="var(--color-egresos)" radius={[4, 4, 0, 0]} maxBarSize={16} />
            </BarChart>
          </ChartContainer>
        </Grafico>

        <Grafico titulo="Lo que te quedó" detalle="Ingresos menos todo lo que salió, mes a mes.">
          <ChartContainer config={{ resultado: { label: "Resultado", theme: AGUA } }} className="aspect-auto h-60 w-full">
            <LineChart data={datos} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={compacto} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
              <ChartTooltip content={<Tip fmt={formatARS} />} />
              <Line dataKey="resultado" name="Resultado" stroke="var(--color-resultado)" strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: "var(--color-resultado)" }} activeDot={{ r: 5 }} />
            </LineChart>
          </ChartContainer>
        </Grafico>

        <Grafico titulo="Clientes activos" detalle="Clientes a los que se les facturó cada mes.">
          <ChartContainer config={{ clientes: { label: "Clientes", theme: AZUL } }} className="aspect-auto h-52 w-full">
            <LineChart data={datos} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <ChartTooltip content={<Tip fmt={(n) => `${n} clientes`} />} />
              <Line type="stepAfter" dataKey="clientes" name="Clientes" stroke="var(--color-clientes)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ChartContainer>
        </Grafico>

        <Grafico titulo="Mensajes que generaron las campañas" detalle="Suma de los mensajes de todos los videos publicados en el mes.">
          <ChartContainer config={{ mensajes: { label: "Mensajes", theme: AZUL } }} className="aspect-auto h-52 w-full">
            <BarChart data={datos} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(n: number) => formatNum(n)} />
              <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<Tip fmt={(n) => `${formatNum(n)} mensajes`} />} />
              <Bar dataKey="mensajes" name="Mensajes" fill="var(--color-mensajes)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ChartContainer>
        </Grafico>

        <Grafico titulo="Cómo baja la deuda" detalle="Lo que queda por pagar de créditos y convenios al cierre de cada mes (incluye lo que viene).">
          <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
            {[
              { l: "Créditos", v: deudaPorTipo("credito") },
              { l: "Convenio ARCA", v: deudaPorTipo("arca") },
              { l: "Impuestos vencidos", v: impuestosVencidos },
            ].map((x) => (
              <div key={x.l} className="rounded-lg bg-muted/50 px-2.5 py-2">
                <p className="text-muted-foreground">{x.l}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{formatARS(x.v)}</p>
              </div>
            ))}
          </div>
          <ChartContainer config={{ deuda: { label: "Deuda", theme: AZUL } }} className="aspect-auto h-40 w-full">
            <LineChart data={datos} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={compacto} />
              <ChartTooltip content={<Tip fmt={formatARS} />} />
              {anio === anioActual && <ReferenceLine x={MES_CORTO[Number(actual.slice(5)) - 1]} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />}
              <Line dataKey="deuda" name="Deuda" stroke="var(--color-deuda)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ChartContainer>
          <p className="mt-1 text-[11px] text-muted-foreground">Hoy: {formatARS(deudaHoy)}. La línea punteada es este mes; lo de la derecha es lo que falta pagar.</p>
        </Grafico>

        <Grafico titulo="En qué se fue la plata" detalle={`Todo lo que salió en ${anio}, de mayor a menor.`}>
          {destino.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin datos del año.</p>
          ) : (
            <div className="space-y-2.5">
              {destino.slice(0, 8).map(([k, v]) => (
                <div key={k} className="space-y-1">
                  <div className="flex justify-between gap-2 text-xs">
                    <span>{k}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatARS(v)} · {egresosAnio ? Math.round((v / egresosAnio) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-[#eb6834] dark:bg-[#d95926]" style={{ width: `${(v / maxDestino) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Grafico>
      </div>
    </Section>
  );
}

function Kpi({ label, valor, sub, tono }: { label: string; valor: string; sub?: string; tono?: "bien" | "mal" }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 text-xl font-bold tabular-nums tracking-tight sm:text-2xl", tono === "mal" && "text-destructive")}>{valor}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Grafico({ titulo, detalle, children }: { titulo: string; detalle?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-sm font-semibold">{titulo}</p>
      {detalle && <p className="mb-3 text-xs text-muted-foreground">{detalle}</p>}
      {children}
    </div>
  );
}

function Tip({
  active,
  payload,
  label,
  fmt,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | null; color?: string; payload?: Punto }[];
  label?: string;
  fmt: (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  const i = MES_CORTO.indexOf(String(label));
  return (
    <div className="min-w-[160px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1.5 font-semibold">
        {i >= 0 ? MES_LARGO[i] : label}
        {p?.estimado ? " (estimado)" : ""}
      </p>
      {payload
        .filter((x) => x.value != null)
        .map((x) => (
          <div key={x.name} className="flex items-center gap-2 py-0.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: x.color }} />
            <span className="text-muted-foreground">{x.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">{fmt(x.value as number)}</span>
          </div>
        ))}
    </div>
  );
}
