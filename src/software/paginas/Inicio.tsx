import Link, { swFetch, useRouter } from "@/software/compat";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ArrowRight,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  CalendarDays,
  Lock,
  Repeat,
  Wallet,
  Wrench,
} from "lucide-react";
import { KpiCard } from "@/software/ui/KpiCard";
import { PageHeader } from "@/software/ui/PageHeader";
import { PeriodBar } from "@/software/ui/PeriodBar";
import { EmptyState } from "@/software/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { mesLabel } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import {
  arDay,
  addDays,
  daysUntilFeeRelease,
  FEE_RELEASE_DAYS,
  feeReleaseOn,
  formatArDay,
  isFeeReleased,
  money,
  paymentsHref,
  periodBounds,
  subscriptionsHref,
  yearMonth,
  type StatsPeriod,
} from "@/software/lib/money";

type SeriesPoint = { key: string; count: number; amount: number; fee: number };

type Stats = {
  period: StatsPeriod;
  month: string;
  from: string | null;
  to: string | null;
  label: string;
  kpis: {
    approved_count: number;
    total_count: number;
    amount: number;
    fee: number;
    fee_released?: number;
    fee_held?: number;
  };
  today?: string;
  releaseDays?: number;
  byClient: Array<{
    id: string;
    name: string;
    collector_id: string | null;
    count: number;
    amount: number;
    fee: number;
  }>;
  series: SeriesPoint[];
  seriesKind: "day" | "month";
  daily: Array<{ day: string; count: number; amount: number; fee: number }>;
  prev?: { approved_count: number; amount: number; fee: number } | null;
};

type Liq = {
  items: Array<{ pending: number }>;
  feeItems?: Array<{ pending: number }>;
  maintenanceItems?: Array<{ pending: number }>;
  extraItems?: Array<{ pending: number }>;
  subscriptionItems?: Array<{ pending: number }>;
  totalExtra?: number;
  totalMaintenance?: number;
};

type MaintClient = {
  id: string;
  name: string;
  monthly_amount: number;
  payment_id: string | null;
  paid_amount: number | null;
};

type MaintData = {
  month: string;
  clients: MaintClient[];
  collected_in_month?: number;
  collected_count?: number;
};

type SubCharge = {
  id: string;
  amount: number;
  paid_at: string | null;
  client_name?: string | null;
  collector_name?: string | null;
  description?: string | null;
  kind: string;
};

type SubData = {
  charges: SubCharge[];
  totals: {
    approved_amount: number;
    approved_count: number;
    active_count: number;
    monthly_recurring: number;
    pending_count?: number;
  };
};

const sumPending = (items?: Array<{ pending: number }>) =>
  (items || []).reduce((a, i) => a + Number(i.pending || 0), 0);

/** "$ 12,3 mil" para ejes y celdas chicas. */
function compacto(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n || 0);
}

/** Sección con el estilo de tarjeta de Prodi. */
function Bloque({
  title,
  sub,
  action,
  children,
  className,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-card p-4 shadow-sm", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Número chico con su explicación debajo. */
function Dato({ value, label, tone }: { value: ReactNode; label: string; tone?: "ok" | "pending" }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 p-3">
      <div
        className={cn(
          "text-lg font-bold tabular-nums tracking-tight [overflow-wrap:anywhere]",
          tone === "ok" && "text-success",
          tone === "pending" && "text-warning",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function VerTodo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm" className="h-9 rounded-lg">
      <Link href={href}>
        {children}
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    </Button>
  );
}

const chartConfig: ChartConfig = {
  fee: { label: "Comisión", color: "hsl(var(--primary))" },
};

function ChartTip({
  active,
  payload,
  kind,
}: {
  active?: boolean;
  payload?: Array<{ payload?: SeriesPoint }>;
  kind: "day" | "month";
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="min-w-[150px] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-semibold">{kind === "month" ? mesLabel(p.key) : formatArDay(p.key)}</p>
      <p className="tabular-nums">
        Comisión: <strong>{money(p.fee)}</strong>
      </p>
      <p className="text-muted-foreground">
        {p.count} {p.count === 1 ? "cobro" : "cobros"}
      </p>
      {p.count ? <p className="mt-1 text-muted-foreground">Tocá para ver los pagos</p> : null}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const [month, setMonth] = useState(yearMonth());
  const [data, setData] = useState<Stats | null>(null);
  const [pending, setPending] = useState(0);
  const [pendingFee, setPendingFee] = useState(0);
  const [pendingMaint, setPendingMaint] = useState(0);
  const [pendingExtra, setPendingExtra] = useState(0);
  const [pendingSub, setPendingSub] = useState(0);
  const [totalExtra, setTotalExtra] = useState(0);
  const [totalMaint, setTotalMaint] = useState(0);
  const [maint, setMaint] = useState<MaintData | null>(null);
  const [subs, setSubs] = useState<SubData | null>(null);
  const [loading, setLoading] = useState(true);

  const maintMonth = period === "month" ? month : yearMonth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = arDay();
      const qs = new URLSearchParams({ period });
      if (period === "month") qs.set("month", month);
      const bounds = periodBounds(period, month);
      const liqFrom = bounds.from || "2018-01-01";
      const liqTo = bounds.to || today;
      const subQs = new URLSearchParams({ status: "approved", limit: "6" });
      if (bounds.from) subQs.set("from", bounds.from);
      if (bounds.to) subQs.set("to", bounds.to);
      const [statsRes, liqRes, maintRes, subRes] = await Promise.all([
        swFetch(`/api/stats?${qs}`),
        swFetch(`/api/liquidacion?from=${liqFrom}&to=${liqTo}`),
        swFetch(`/api/mantenimientos?month=${maintMonth}`),
        swFetch(`/api/subscriptions?${subQs}`),
      ]);
      if (statsRes.ok) setData(await statsRes.json());
      if (liqRes.ok) {
        const liq: Liq = await liqRes.json();
        const feePend = sumPending(liq.feeItems || liq.items);
        const maintPend = sumPending(liq.maintenanceItems);
        const extraPend = sumPending(liq.extraItems);
        const subPend = sumPending(liq.subscriptionItems);
        setPendingFee(feePend);
        setPendingMaint(maintPend);
        setPendingExtra(extraPend);
        setPendingSub(subPend);
        setTotalExtra(Number(liq.totalExtra || 0));
        setTotalMaint(Number(liq.totalMaintenance || 0));
        setPending(feePend + maintPend + extraPend + subPend);
      }
      if (maintRes.ok) setMaint(await maintRes.json());
      if (subRes.ok) setSubs(await subRes.json());
    } finally {
      setLoading(false);
    }
  }, [period, month, maintMonth]);

  useEffect(() => {
    load();
  }, [load]);

  const range = useMemo(() => ({ from: data?.from ?? null, to: data?.to ?? null }), [data]);

  const paymentsLink = (extra?: { clientId?: string; day?: string }) => {
    if (extra?.day) {
      return paymentsHref({
        from: extra.day,
        to: extra.day,
        status: "approved",
        clientId: extra.clientId,
      });
    }
    return paymentsHref({
      from: range.from,
      to: range.to,
      status: "approved",
      clientId: extra?.clientId,
    });
  };

  const releasedFeeLink = () => {
    const today = data?.today || arDay();
    const latest = addDays(today, -FEE_RELEASE_DAYS);
    const from = range.from;
    const to = range.to && range.to < latest ? range.to : latest;
    if (from && from > to) {
      return paymentsLink();
    }
    return paymentsHref({ from, to, status: "approved" });
  };

  const subsLink = subscriptionsHref({ from: range.from, to: range.to, status: "approved" });

  const feeReleased = Number(data?.kpis.fee_released || 0);
  const feeHeld = Number(data?.kpis.fee_held || 0);
  const feeTotal = Number(data?.kpis.fee || 0);
  const subTotal = Number(subs?.totals.approved_amount || 0);
  const incomeTotal = feeTotal + subTotal + totalMaint + totalExtra;
  const subPendingCount = Number(subs?.totals.pending_count || 0);

  const calendar = useMemo(() => {
    if (!data || period !== "month") return [];
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m, 0).getDate();
    const map = Object.fromEntries(data.daily.map((d) => [d.day, d]));
    const cells: Array<{
      key: string;
      label?: number;
      empty?: boolean;
      fee?: number;
      count?: number;
      released?: boolean;
      daysLeft?: number;
      releaseOn?: string;
    }> = [];
    const today = data.today || arDay();
    for (let i = 0; i < startPad; i++) cells.push({ key: `e${i}`, empty: true });
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${month}-${String(d).padStart(2, "0")}`;
      const hit = map[key];
      const count = hit?.count || 0;
      cells.push({
        key,
        label: d,
        fee: hit?.fee || 0,
        count,
        released: count ? isFeeReleased(key, today) : false,
        daysLeft: count ? daysUntilFeeRelease(key, today) : 0,
        releaseOn: count ? feeReleaseOn(key) : undefined,
      });
    }
    return cells;
  }, [data, month, period]);

  const onBarClick = (key: string) => {
    const point = data?.series.find((s) => s.key === key);
    if (!point?.count) return;
    if (data?.seriesKind === "month") {
      const [y, m] = key.split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      router.push(
        paymentsHref({
          from: `${key}-01`,
          to: `${key}-${String(last).padStart(2, "0")}`,
          status: "approved",
        }),
      );
    } else {
      router.push(paymentsHref({ from: key, to: key, status: "approved" }));
    }
  };

  const maintSummary = useMemo(() => {
    const clients = maint?.clients || [];
    const pendingClients = clients.filter((c) => !c.payment_id);
    const paidClients = clients.filter((c) => c.payment_id);
    return {
      clients,
      pendingClients,
      paidClients,
      pendingTotal: pendingClients.reduce((a, c) => a + Number(c.monthly_amount || 0), 0),
      paidTotal: paidClients.reduce((a, c) => a + Number(c.paid_amount || c.monthly_amount || 0), 0),
    };
  }, [maint]);

  const entroText = {
    today: "Entró hoy",
    week: "Entró en los últimos 7 días",
    month: `Entró en ${mesLabel(month)}`,
    year: `Entró en el año ${arDay().slice(0, 4)}`,
    all: "Entró en total",
  }[period];
  const rangeText =
    range.from && range.to
      ? range.from === range.to
        ? formatArDay(range.from)
        : `del ${formatArDay(range.from)} al ${formatArDay(range.to)}`
      : "todo el historial";

  // De dónde vino la plata del período.
  const fuentes = [
    {
      id: "fee",
      label: "Comisiones",
      help: `${data?.kpis.approved_count || 0} cobros con la app de Mercado Pago`,
      value: feeTotal,
      href: paymentsLink(),
      bar: "bg-primary",
    },
    {
      id: "sub",
      label: "Planes mensuales",
      help: `${Number(subs?.totals.approved_count || 0)} cobros de planes`,
      value: subTotal,
      href: subsLink,
      bar: "bg-primary/45",
    },
    {
      id: "maint",
      label: "Abonos de mantenimiento",
      help: "Abonos cobrados en el período",
      value: totalMaint,
      href: "/mantenimientos",
      bar: "bg-success",
    },
    {
      id: "extra",
      label: "Trabajos extra",
      help: "Cargados en el período",
      value: totalExtra,
      href: "/liquidacion",
      bar: "bg-warning",
    },
  ];

  // Cosas que piden que alguien haga algo.
  const tareas: Array<{
    id: string;
    icon: ReactNode;
    title: string;
    text: string;
    cta: string;
    href: string;
  }> = [];
  if (subPendingCount > 0) {
    tareas.push({
      id: "planes",
      icon: <Repeat />,
      title:
        subPendingCount === 1
          ? "Hay 1 alta nueva de plan mensual"
          : `Hay ${subPendingCount} altas nuevas de planes mensuales`,
      text: "Decidí si entran a Prodi Software o no.",
      cta: "Aceptar o rechazar",
      href: "/suscripciones",
    });
  }
  if (pending > 0) {
    tareas.push({
      id: "reparto",
      icon: <Wallet />,
      title: `Hay ${money(pending)} para repartir`,
      text: "Falta pagarle a cada persona del reparto su parte.",
      cta: "Ir a repartir",
      href: "/liquidacion",
    });
  }
  if (maintSummary.pendingClients.length > 0) {
    const n = maintSummary.pendingClients.length;
    tareas.push({
      id: "abonos",
      icon: <Wrench />,
      title: n === 1 ? "1 abono sin cobrar" : `${n} abonos sin cobrar`,
      text: `Faltan ${money(maintSummary.pendingTotal)} de mantenimiento de ${mesLabel(maintMonth)}.`,
      cta: "Ver abonos",
      href: "/mantenimientos",
    });
  }

  const repartoPartes = [
    { label: "comisiones", v: pendingFee },
    { label: "planes", v: pendingSub },
    { label: "abonos", v: pendingMaint },
    { label: "extra", v: pendingExtra },
  ].filter((p) => p.v > 0);

  const topFee = Math.max(...(data?.byClient || []).map((c) => c.fee), 1);
  const series = data?.series || [];
  const kind = data?.seriesKind || "day";
  const todayKey = data?.today || arDay();

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Inicio"
        sub="Cuánto entró, de dónde vino, cuánto está disponible y cuánto hay para repartir. Tocá cualquier número para ver el detalle."
        actions={<PeriodBar period={period} month={month} onPeriod={setPeriod} onMonth={setMonth} />}
      />

      {tareas.length ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <BellRing className="h-4 w-4 text-warning" /> Para hacer
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tareas.map((t) => (
              <div
                key={t.id}
                className="flex min-w-0 flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/[0.06] p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning [&_svg]:h-4 [&_svg]:w-4">
                    {t.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold [overflow-wrap:anywhere]">{t.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.text}</p>
                  </div>
                </div>
                <Button asChild size="sm" className="mt-auto h-10 w-full rounded-lg sm:w-auto sm:self-start">
                  <Link href={t.href}>
                    {t.cta}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56 rounded-2xl lg:col-span-2" />
          <div className="grid gap-4">
            <Skeleton className="h-[104px] rounded-2xl" />
            <Skeleton className="h-[104px] rounded-2xl" />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Lo principal: cuánto entró y de dónde */}
          <section className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5 lg:col-span-2">
            <p className="text-xs font-medium text-muted-foreground">
              {entroText} · {rangeText}
            </p>
            <Link
              href="/liquidacion"
              className="mt-1 block text-[length:clamp(1.75rem,7vw,2.5rem)] font-bold tabular-nums tracking-tight [overflow-wrap:anywhere] hover:text-primary"
            >
              {money(incomeTotal)}
            </Link>
            <p className="text-xs text-muted-foreground">
              Lo que gana Prodi Software (no cuenta lo que venden los clientes).
            </p>

            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              {incomeTotal > 0
                ? fuentes.map((f) =>
                    f.value > 0 ? (
                      <div key={f.id} className={f.bar} style={{ width: `${(f.value / incomeTotal) * 100}%` }} />
                    ) : null,
                  )
                : null}
            </div>

            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {fuentes.map((f) => (
                <li key={f.id} className="min-w-0">
                  <Link
                    href={f.href}
                    className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                  >
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", f.bar)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{f.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{f.help}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums">{money(f.value)}</span>
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {incomeTotal > 0 ? `${Math.round((f.value / incomeTotal) * 100)}%` : "—"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:content-start">
            <KpiCard
              href={releasedFeeLink()}
              icon={feeReleased ? <CheckCircle2 /> : <Lock />}
              label="Comisión disponible"
              tone={feeReleased ? "ok" : undefined}
              value={money(feeReleased)}
              hint={
                feeHeld
                  ? `${money(feeHeld)} retenida por MP (se libera a los ${FEE_RELEASE_DAYS} días)`
                  : "Nada retenido por Mercado Pago"
              }
            />
            <KpiCard
              href="/liquidacion"
              icon={<Wallet />}
              label="Para repartir"
              tone={pending ? "pending" : "ok"}
              value={money(pending)}
              hint={
                repartoPartes.length
                  ? repartoPartes.map((p) => `${p.label} ${money(p.v)}`).join(" · ")
                  : "Ya se le pagó a cada uno"
              }
            />
          </div>
        </div>
      )}

      {/* Detalle */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Bloque
            title={kind === "month" ? "Comisiones por mes" : "Comisiones por día"}
            sub={`Lo que ganó Prodi Software. Tocá una barra para ver los pagos de ese ${kind === "month" ? "mes" : "día"}.`}
            action={<VerTodo href={paymentsLink()}>Ver pagos</VerTodo>}
          >
            {!series.length || !series.some((s) => s.fee) ? (
              <EmptyState title="Sin comisiones en este período">
                Cuando los clientes cobren con la app de Mercado Pago, vas a ver acá cuánto ganó Prodi Software cada día.
              </EmptyState>
            ) : (
              <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
                <BarChart
                  data={series}
                  margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
                  onClick={(s) => {
                    if (s?.activeLabel) onBarClick(String(s.activeLabel));
                  }}
                  className="cursor-pointer"
                >
                  <CartesianGrid vertical={false} strokeOpacity={0.5} />
                  <XAxis
                    dataKey="key"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={6}
                    minTickGap={8}
                    tickFormatter={(k: string) =>
                      kind === "month" ? mesLabel(k, { corto: true }).split(" ")[0] : String(Number(k.slice(8)))
                    }
                  />
                  <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={compacto} />
                  <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTip kind={kind} />} />
                  <Bar dataKey="fee" name="Comisión" fill="var(--color-fee)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ChartContainer>
            )}
          </Bloque>

          {period === "month" ? (
            <Bloque
              title={`Calendario de ${mesLabel(month)}`}
              sub={`Comisión de cada día. Mercado Pago la retiene ${FEE_RELEASE_DAYS} días antes de que esté disponible.`}
            >
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
                {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
                  <div key={d} className="pb-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendar.map((c) =>
                  c.empty ? (
                    <div key={c.key} />
                  ) : c.count ? (
                    <Link
                      key={c.key}
                      href={paymentsLink({ day: c.key })}
                      title={`${formatArDay(c.key)}: comisión ${money(c.fee)} en ${c.count} ${
                        c.count === 1 ? "cobro" : "cobros"
                      }. ${
                        c.released
                          ? "Ya está disponible."
                          : `Se libera el ${formatArDay(c.releaseOn || c.key)} (faltan ${c.daysLeft} días).`
                      }`}
                      className={cn(
                        "flex min-h-[44px] min-w-0 flex-col items-center justify-center rounded-lg border p-1 transition-colors sm:min-h-[56px]",
                        c.released
                          ? "border-success/30 bg-success/10 hover:bg-success/20"
                          : "border-warning/40 bg-warning/10 hover:bg-warning/20",
                        c.key === todayKey && "ring-2 ring-primary/40",
                      )}
                    >
                      <span className="text-xs font-semibold">{c.label}</span>
                      <span
                        className={cn(
                          "hidden max-w-full truncate text-[10px] tabular-nums sm:block",
                          c.released ? "text-success" : "text-warning",
                        )}
                      >
                        {compacto(c.fee || 0)}
                      </span>
                      <span
                        className={cn("mt-0.5 h-1.5 w-1.5 rounded-full sm:hidden", c.released ? "bg-success" : "bg-warning")}
                      />
                    </Link>
                  ) : (
                    <div
                      key={c.key}
                      className={cn(
                        "flex min-h-[44px] items-center justify-center rounded-lg text-xs text-muted-foreground sm:min-h-[56px]",
                        c.key === todayKey && "ring-2 ring-primary/40",
                      )}
                    >
                      {c.label}
                    </div>
                  ),
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-success" aria-hidden /> Disponible
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-warning" aria-hidden /> Retenida por MP
                </span>
                <span>Tocá un día para ver sus pagos.</span>
              </div>
            </Bloque>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <Bloque
            title="Mejores clientes"
            sub="Los que más comisión dejaron en el período."
            action={<VerTodo href="/clients">Clientes</VerTodo>}
          >
            {!data?.byClient?.length ? (
              <EmptyState title="Sin cobros en este período">Probá con otro período arriba.</EmptyState>
            ) : (
              <ul className="space-y-3">
                {data.byClient.map((a, i) => (
                  <li key={`${a.id}-${a.collector_id || ""}`} className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {a.id !== "unknown" ? (
                          <Link href={paymentsLink({ clientId: a.id })} className="hover:text-primary hover:underline">
                            {a.name}
                          </Link>
                        ) : (
                          a.name
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{money(a.fee)}</span>
                    </div>
                    <div className="ml-6 mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(a.fee / topFee) * 100}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {a.count} {a.count === 1 ? "cobro" : "cobros"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Bloque>

          <Bloque
            title="Abonos de mantenimiento"
            sub={mesLabel(maintMonth)}
            action={<VerTodo href="/mantenimientos">Ver abonos</VerTodo>}
          >
            {!maintSummary.clients.length ? (
              <EmptyState title="Todavía no hay abonos de mantenimiento">
                <Link href="/mantenimientos" className="font-semibold text-primary hover:underline">
                  Agregá el primer cliente
                </Link>{" "}
                que paga un abono mensual.
              </EmptyState>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Dato
                    value={money(Number(maint?.collected_in_month || 0))}
                    label={`Cobrado · ${Number(maint?.collected_count || 0)} cobros`}
                  />
                  <Dato
                    value={money(maintSummary.pendingTotal)}
                    label={`Falta cobrar · ${maintSummary.pendingClients.length}`}
                    tone={maintSummary.pendingTotal ? "pending" : "ok"}
                  />
                  <Dato value={money(maintSummary.paidTotal)} label={`Al día · ${maintSummary.paidClients.length}`} />
                  {pendingMaint > 0 ? (
                    <Dato value={money(pendingMaint)} label="Para repartir" tone="pending" />
                  ) : null}
                </div>
                {maintSummary.pendingClients.length ? (
                  <ul className="mt-3 divide-y rounded-xl border">
                    {maintSummary.pendingClients.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <Link
                          href="/mantenimientos"
                          className="min-w-0 truncate text-sm font-medium hover:text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                          {money(c.monthly_amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-success">
                    <CalendarCheck className="h-4 w-4" /> Todos cobrados este mes
                  </p>
                )}
              </>
            )}
          </Bloque>

          <Bloque
            title="Planes mensuales"
            sub="Suscripciones de Mercado Pago que entran a Prodi Software."
            action={<VerTodo href="/suscripciones">Ver planes</VerTodo>}
          >
            <div className="grid grid-cols-2 gap-2">
              <Dato
                value={money(subTotal)}
                label={`Cobrado · ${Number(subs?.totals.approved_count || 0)} en el período`}
              />
              <Dato value={Number(subs?.totals.active_count || 0)} label="Planes activos" />
              <Dato value={money(Number(subs?.totals.monthly_recurring || 0))} label="Ingreso mensual estimado" />
              {subPendingCount > 0 ? (
                <Dato value={subPendingCount} label="Por decidir si entran" tone="pending" />
              ) : null}
            </div>
            {!subs?.charges?.length ? (
              <p className="mt-3 text-xs text-muted-foreground">Todavía no hay cobros de planes en este período.</p>
            ) : (
              <ul className="mt-3 divide-y rounded-xl border">
                {subs.charges.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <Link href={subsLink} className="block truncate text-sm font-medium hover:text-primary hover:underline">
                        {c.client_name || c.collector_name || "Sin cliente"}
                      </Link>
                      {c.description ? (
                        <p className="truncate text-xs text-muted-foreground">{c.description}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-sm tabular-nums">{money(c.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Bloque>

          {totalExtra > 0 || pendingExtra > 0 ? (
            <Bloque
              title="Trabajos extra"
              sub="Cobros por trabajos fuera del abono, en el período."
              action={<VerTodo href="/liquidacion">Repartir</VerTodo>}
            >
              <div className="grid grid-cols-2 gap-2">
                <Dato value={money(totalExtra)} label="Cargados" />
                <Dato
                  value={money(pendingExtra)}
                  label="Para repartir"
                  tone={pendingExtra ? "pending" : "ok"}
                />
              </div>
            </Bloque>
          ) : null}

          {period !== "month" ? (
            <Bloque title="¿Querés ver día por día?" sub="El calendario aparece al elegir “Mes” arriba.">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-9 rounded-lg" onClick={() => setPeriod("month")}>
                  <CalendarDays className="mr-1 h-4 w-4" /> Ver por mes
                </Button>
                <VerTodo href={paymentsLink()}>
                  Pagos filtrados
                </VerTodo>
              </div>
            </Bloque>
          ) : null}
        </div>
      </div>
    </div>
  );
}
