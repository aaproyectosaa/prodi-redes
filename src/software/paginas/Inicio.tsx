import Link from "@/software/compat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Coins, Repeat, Unlock } from "lucide-react";
import { KpiCard } from "@/software/ui/KpiCard";
import {
  arDay,
  addDays,
  daysUntilFeeRelease,
  FEE_RELEASE_DAYS,
  feeReleaseOn,
  isFeeReleased,
  money,
  money2,
  paymentsHref,
  periodBounds,
  subscriptionsHref,
  yearMonth,
  type StatsPeriod,
} from "@/software/lib/money";
import { swFetch } from "@/software/compat";

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

const PERIODS: Array<{ id: StatsPeriod; label: string; tip: string }> = [
  { id: "today", label: "Hoy", tip: "Solo lo de hoy" },
  { id: "week", label: "Semana", tip: "Últimos 7 días" },
  { id: "month", label: "Mes", tip: "Un mes completo (elegís cuál)" },
  { id: "year", label: "Año", tip: "Desde el 1 de enero hasta hoy" },
  { id: "all", label: "Todo", tip: "Todo el historial de fees" },
];

function FeeChart({
  series,
  kind,
  onBarClick,
}: {
  series: SeriesPoint[];
  kind: "day" | "month";
  onBarClick: (key: string) => void;
}) {
  const max = Math.max(...series.map((s) => s.fee), 1);
  if (!series.length) {
    return <p className="meta">Sin datos de fee en este período.</p>;
  }

  const w = Math.max(320, series.length * 28);
  const h = 160;
  const pad = { t: 12, r: 8, b: 28, l: 8 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const gap = 4;
  const barW = Math.max(6, (innerW - gap * (series.length - 1)) / series.length);

  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Fee por período">
        {series.map((s, i) => {
          const bh = (s.fee / max) * innerH;
          const x = pad.l + i * (barW + gap);
          const y = pad.t + innerH - bh;
          const label =
            kind === "month"
              ? s.key.slice(5)
              : s.key.slice(8);
          return (
            <g
              key={s.key}
              className="chart-bar"
              style={{ cursor: s.count ? "pointer" : "default" }}
              onClick={() => s.count && onBarClick(s.key)}
            >
              <title>
                {kind === "month"
                  ? `${s.key}: fee ${money(s.fee)}. Tocá para ver los pagos de ese mes.`
                  : `${s.key}: fee ${money(s.fee)}. Tocá para ver los pagos de ese día.`}
              </title>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(bh, s.fee ? 2 : 0)}
                rx={3}
                  fill={s.fee ? "var(--accent)" : "var(--line)"}
                  opacity={s.fee ? 0.92 : 0.4}
              />
              {(series.length <= 16 || i % Math.ceil(series.length / 10) === 0) && (
                <text
                  x={x + barW / 2}
                  y={h - 8}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--muted)"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function DashboardPage() {
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
        const feePend = (liq.feeItems || liq.items || []).reduce(
          (a, i) => a + Number(i.pending || 0),
          0,
        );
        const maintPend = (liq.maintenanceItems || []).reduce(
          (a, i) => a + Number(i.pending || 0),
          0,
        );
        const extraPend = (liq.extraItems || []).reduce(
          (a, i) => a + Number(i.pending || 0),
          0,
        );
        const subPend = (liq.subscriptionItems || []).reduce(
          (a, i) => a + Number(i.pending || 0),
          0,
        );
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

  const range = useMemo(
    () => ({ from: data?.from ?? null, to: data?.to ?? null }),
    [data],
  );

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
    const to =
      range.to && range.to < latest ? range.to : latest;
    if (from && from > to) {
      return paymentsLink();
    }
    return paymentsHref({ from, to, status: "approved" });
  };

  const feeReleased = Number(data?.kpis.fee_released || 0);
  const feeHeld = Number(data?.kpis.fee_held || 0);
  const feeTotal = Number(data?.kpis.fee || 0);
  const subTotal = Number(subs?.totals.approved_amount || 0);
  const incomeTotal = feeTotal + subTotal + totalMaint + totalExtra;

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
    if (data?.seriesKind === "month") {
      const [y, m] = key.split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      window.location.href = paymentsHref({
        from: `${key}-01`,
        to: `${key}-${String(last).padStart(2, "0")}`,
        status: "approved",
      });
    } else {
      window.location.href = paymentsHref({ from: key, to: key, status: "approved" });
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
      pendingTotal: pendingClients.reduce(
        (a, c) => a + Number(c.monthly_amount || 0),
        0,
      ),
      paidTotal: paidClients.reduce(
        (a, c) => a + Number(c.paid_amount || c.monthly_amount || 0),
        0,
      ),
    };
  }, [maint]);

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 className="page-title">Inicio</h1>
          <p className="page-sub">
            {data?.label || "Período"}
            {range.from ? ` · ${range.from}` : ""}
            {range.to ? ` → ${range.to}` : ""}. Tocá un número para abrir el detalle.
          </p>
        </div>
      </div>

      <div className="period-tabs" role="tablist" aria-label="Período">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={period === p.id}
            className={`period-tab${period === p.id ? " active" : ""}`}

            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
        {period === "month" ? (
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="period-month"
            aria-label="Mes"

          />
        ) : null}
      </div>

      {loading && !data ? <p className="meta">Cargando…</p> : null}

      <div className="hero-band">
        <Link href="/liquidacion" className="card hero-total">
          <div className="l">Total del período</div>
          <div className="n">{money2(incomeTotal)}</div>
          <p className="meta" style={{ marginBottom: 0 }}>
            Fee {money(feeTotal)} · Suscrip. {money2(subTotal)} · Mant. {money(totalMaint)} · Extra {money(totalExtra)}. Sin ventas.
          </p>
        </Link>
        <div className="hero-bits">
          <KpiCard href={paymentsLink()} icon={<Coins size={16} />} label="Fee" value={money(feeTotal)} hint={feeHeld ? `Retenido ${money(feeHeld)}` : "Nada retenido"} />
          <KpiCard href={releasedFeeLink()} icon={<Unlock size={16} />} label="Liberado" tone={feeReleased ? "ok" : undefined} value={money(feeReleased)} />
          <KpiCard href="/liquidacion" icon={<ArrowRightLeft size={16} />} label="A transferir" tone={pending ? "pending" : "ok"} value={money(pending)} />
          <KpiCard href={subscriptionsHref({ from: range.from, to: range.to, status: "approved" })} icon={<Repeat size={16} />} label="Suscripciones" value={money2(subTotal)} hint={`${data?.kpis.approved_count || 0} pagos con fee`} />
        </div>
      </div>

      <div className="split-home">
      <div className="home-queue">
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row card-head" style={{ marginBottom: "0.65rem" }}>
          <h2
            style={{ margin: 0, fontSize: "1.05rem" }}

          >
            Mantenimientos · {maintMonth}
          </h2>
          <Link
            className="btn sm line"
            href="/mantenimientos"

          >
            Ver todos
          </Link>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "0.65rem",
            marginBottom: maintSummary.clients.length ? "0.85rem" : 0,
          }}
        >
          <div>
            <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {money(Number(maint?.collected_in_month || 0))}
            </div>
            <div className="meta">
              Ingresado · {Number(maint?.collected_count || 0)} cobros
            </div>
          </div>
          <div>
            <div
              className="n"
              style={{
                fontSize: "1.15rem",
                fontWeight: 700,
                color: maintSummary.pendingTotal ? "var(--pending)" : "var(--ok)",
              }}
            >
              {money(maintSummary.pendingTotal)}
            </div>
            <div className="meta">
              Pendientes · {maintSummary.pendingClients.length}
            </div>
          </div>
          <div>
            <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {money(maintSummary.paidTotal)}
            </div>
            <div className="meta">
              Cubiertos · {maintSummary.paidClients.length}
            </div>
          </div>
          {pendingMaint > 0 ? (
            <div>
              <div
                className="n"
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: "var(--pending)",
                }}
              >
                {money(pendingMaint)}
              </div>
              <div className="meta">A transferir (mant.)</div>
            </div>
          ) : null}
        </div>
        {!maintSummary.clients.length ? (
          <p className="meta" style={{ margin: 0 }}>
            Todavía no hay clientes de mantenimiento.{" "}
            <Link
              href="/mantenimientos"
              style={{ color: "var(--accent)", fontWeight: 600 }}
            >
              Agregar
            </Link>
          </p>
        ) : maintSummary.pendingClients.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pendiente este mes</th>
                  <th style={{ width: 120 }}>Mensual</th>
                </tr>
              </thead>
              <tbody>
                {maintSummary.pendingClients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link
                        href="/mantenimientos"
                        style={{ color: "var(--accent)", fontWeight: 700 }}
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {money(c.monthly_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="meta" style={{ margin: 0, color: "var(--ok)" }}>
            Todos cobrados este mes ✓
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row card-head" style={{ marginBottom: "0.65rem" }}>
          <h2
            style={{ margin: 0, fontSize: "1.05rem" }}

          >
            Suscripciones
          </h2>
          <Link className="btn sm line" href="/suscripciones">
            Ver todas
          </Link>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "0.65rem",
            marginBottom:
              subs?.charges?.length || Number(subs?.totals.pending_count || 0)
                ? "0.85rem"
                : 0,
          }}
        >
          <div>
            <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {money2(Number(subs?.totals.approved_amount || 0))}
            </div>
            <div className="meta">
              Cobrado · {Number(subs?.totals.approved_count || 0)} en el período
            </div>
          </div>
          <div>
            <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {Number(subs?.totals.active_count || 0)}
            </div>
            <div className="meta">Planes en Prodi Software</div>
          </div>
          <div>
            <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {money(Number(subs?.totals.monthly_recurring || 0))}
            </div>
            <div className="meta">Mensual estimado</div>
          </div>
          {Number(subs?.totals.pending_count || 0) > 0 ? (
            <div>
              <div
                className="n"
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: "var(--pending)",
                }}
              >
                {Number(subs?.totals.pending_count || 0)}
              </div>
              <div className="meta">Por decidir si entran</div>
            </div>
          ) : null}
        </div>
        {Number(subs?.totals.pending_count || 0) > 0 ? (
          <p className="meta" style={{ margin: "0 0 0.85rem" }}>
            Hay altas nuevas.{" "}
            <Link
              href="/suscripciones"
              style={{ color: "var(--accent)", fontWeight: 600 }}
            >
              Aceptar o rechazar
            </Link>{" "}
            si entran a Prodi Software.
          </p>
        ) : null}
        {!subs?.charges?.length ? (
          <p className="meta" style={{ margin: 0 }}>
            Todavía no hay cobros de planes en Prodi Software en este período.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th style={{ width: 120 }}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {subs.charges.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link
                        href={subscriptionsHref({
                          from: range.from,
                          to: range.to,
                          status: "approved",
                        })}
                        style={{ color: "var(--accent)", fontWeight: 700 }}
                      >
                        {c.client_name || c.collector_name || "Sin cliente"}
                      </Link>
                      {c.description ? (
                        <div className="meta">
                          {c.description.length > 42
                            ? `${c.description.slice(0, 42)}…`
                            : c.description}
                        </div>
                      ) : null}
                    </td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {money(c.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalExtra > 0 || pendingExtra > 0 ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="row card-head" style={{ marginBottom: "0.35rem" }}>
            <h2
              style={{ margin: 0, fontSize: "1.05rem" }}

            >
              Otros cobros · este año
            </h2>
            <Link className="btn sm line" href="/liquidacion">
              Liquidar
            </Link>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "0.65rem",
            }}
          >
            <div>
              <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                {money(totalExtra)}
              </div>
              <div className="meta">Cargados</div>
            </div>
            <div>
              <div
                className="n"
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: pendingExtra ? "var(--pending)" : "var(--ok)",
                }}
              >
                {money(pendingExtra)}
              </div>
              <div className="meta">A transferir</div>
            </div>
          </div>
        </div>
      ) : null}

      </div>
      <div className="home-main">
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row card-head" style={{ marginBottom: "0.5rem" }}>
          <h2
            style={{ margin: 0, fontSize: "1.05rem" }}

          >
            Fee {data?.seriesKind === "month" ? "por mes" : "por día"}
          </h2>
          <Link
            className="btn sm line"
            href={paymentsLink()}

          >
            Ver pagos
          </Link>
        </div>
        <FeeChart
          series={data?.series || []}
          kind={data?.seriesKind || "day"}
          onBarClick={onBarClick}
        />
      </div>

      <div className="stack-2">
        {period === "month" ? (
          <div className="card">
            <h2
              style={{ marginTop: 0, fontSize: "1.05rem" }}

            >
              Calendario
            </h2>
            <div className="cal" style={{ marginBottom: "0.4rem" }}>
              {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
                <div key={d} className="dow">
                  {d}
                </div>
              ))}
            </div>
            <div className="cal">
              {calendar.map((c) =>
                c.empty ? (
                  <div key={c.key} className="day empty" />
                ) : (
                  <Link
                    key={c.key}
                    href={paymentsLink({ day: c.key })}
                    className={`day${c.count ? " has" : ""}${
                      c.count ? (c.released ? " released" : " held") : ""
                    }${c.count ? " clickable" : ""}`}

                  >
                    <div className="d">{c.label}</div>
                    {c.count ? (
                      <div className="day-fee">{money(c.fee || 0)}</div>
                    ) : null}
                  </Link>
                ),
              )}
            </div>
            <div className="cal-legend">
              <span>
                <i className="cal-swatch released" aria-hidden /> Liberado
              </span>
              <span>
                <i className="cal-swatch held" aria-hidden /> Por liberar
              </span>
              <span className="meta">MP retiene {FEE_RELEASE_DAYS} días</span>
            </div>
          </div>
        ) : (
          <div className="card">
            <h2
              style={{ marginTop: 0, fontSize: "1.05rem" }}

            >
              Resumen
            </h2>
            <p className="meta" style={{ marginTop: 0 }}>
              Período: <strong>{data?.label}</strong>
              {range.from ? ` · ${range.from}` : ""}
              {range.to ? ` → ${range.to}` : ""}
            </p>
            <p className="meta">
              Usá las barras del gráfico o las tarjetas de arriba para abrir Pagos con el
              mismo filtro.
            </p>
            <Link
              className="btn sm"
              href={paymentsLink()}

            >
              Ir a Pagos filtrados
            </Link>
          </div>
        )}

        <div className="card">
          <div className="row" style={{ marginBottom: "0.75rem" }}>
            <h2
              style={{ margin: 0, fontSize: "1.05rem" }}

            >
              Top clientes
            </h2>
            <Link className="btn sm line" href="/clients">
              Ver todos
            </Link>
          </div>
          {!data?.byClient?.length ? (
            <div className="empty">Sin pagos en este período.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Pagos</th>
                    <th>Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byClient.map((a) => (
                    <tr key={`${a.id}-${a.collector_id || ""}`}>
                      <td>
                        {a.id !== "unknown" ? (
                          <Link
                            href={paymentsLink({ clientId: a.id })}
                            style={{ color: "var(--accent)", fontWeight: 700 }}

                          >
                            {a.name}
                          </Link>
                        ) : (
                          <strong>{a.name}</strong>
                        )}
                      </td>
                      <td>{a.count}</td>
                      <td>{money(a.fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
