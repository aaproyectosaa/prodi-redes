import { ChevronLeft, ChevronRight, Coins, Download, Lock, Unlock } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "@/software/compat";
import { Drawer } from "@/software/ui/Drawer";
import { EmptyState } from "@/software/ui/EmptyState";
import { FilterBar } from "@/software/ui/FilterBar";
import { KpiCard } from "@/software/ui/KpiCard";
import { PageHeader } from "@/software/ui/PageHeader";
import { StatusPill } from "@/software/ui/StatusPill";
import {
  arDay,
  FEE_RELEASE_DAYS,
  feeReleaseOn,
  formatArDay,
  isFeeReleased,
  money,
} from "@/software/lib/money";
import type { MpAppPublic, Payment } from "@/software/lib/types";
import { swFetch } from "@/software/compat";

type ClientOpt = { id: string; name: string; app_name?: string };

const PAGE_SIZE = 50;

function PaymentsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apps, setApps] = useState<MpAppPublic[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totals, setTotals] = useState({
    count: 0,
    amount: 0,
    fee: 0,
    fee_released: 0,
    fee_held: 0,
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [appId, setAppId] = useState(searchParams.get("appId") || "");
  const [clientId, setClientId] = useState(searchParams.get("clientId") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "approved");
  const [from, setFrom] = useState(searchParams.get("from") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [qDraft, setQDraft] = useState(searchParams.get("q") || "");
  const [feeState, setFeeState] = useState(searchParams.get("feeState") || "");
  const [unassigned, setUnassigned] = useState(searchParams.get("unassigned") === "1");
  const [sort, setSort] = useState(searchParams.get("sort") || "date");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Payment | null>(null);
  const q = searchParams.get("q") || "";

  useEffect(() => {
    setAppId(searchParams.get("appId") || "");
    setClientId(searchParams.get("clientId") || "");
    setStatus(searchParams.has("status") ? searchParams.get("status") || "" : "approved");
    setFrom(searchParams.get("from") || "");
    setTo(searchParams.get("to") || "");
    setQDraft(searchParams.get("q") || "");
    setFeeState(searchParams.get("feeState") || "");
    setUnassigned(searchParams.get("unassigned") === "1");
    setSort(searchParams.get("sort") || "date");
    setPage(Math.max(Number(searchParams.get("page") || 1), 1));
  }, [searchParams]);

  useEffect(() => {
    swFetch("/api/apps")
      .then((r) => r.json())
      .then((d) => setApps(d.apps || []));
    swFetch("/api/clients?list=active")
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []));
  }, []);

  const pushFilters = useCallback(
    (next: {
      appId?: string;
      clientId?: string;
      status?: string;
      from?: string;
      to?: string;
      q?: string;
      feeState?: string;
      unassigned?: boolean;
      sort?: string;
      page?: number;
    }) => {
      const p = new URLSearchParams();
      const a = next.appId ?? appId;
      const c = next.clientId ?? clientId;
      const s = next.status ?? status;
      const f = next.from ?? from;
      const t = next.to ?? to;
      const query = next.q !== undefined ? next.q : q;
      const fs = next.feeState ?? feeState;
      const ua = next.unassigned ?? unassigned;
      const so = next.sort ?? sort;
      const pg = next.page ?? 1;
      if (a) p.set("appId", a);
      if (c) p.set("clientId", c);
      p.set("status", s);
      if (f) p.set("from", f);
      if (t) p.set("to", t);
      if (query) p.set("q", query);
      if (fs) p.set("feeState", fs);
      if (ua) p.set("unassigned", "1");
      if (so && so !== "date") p.set("sort", so);
      if (pg > 1) p.set("page", String(pg));
      const qs = p.toString();
      router.replace(qs ? `/payments?${qs}` : "/payments");
    },
    [router, appId, clientId, status, from, to, q, feeState, unassigned, sort],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (appId) params.set("appId", appId);
      if (clientId) params.set("clientId", clientId);
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q) params.set("q", q);
      if (feeState) params.set("feeState", feeState);
      if (unassigned) params.set("unassigned", "1");
      if (sort) params.set("sort", sort);
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      const res = await swFetch(`/api/payments?${params}`);
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar los pagos");
      setPayments(data.payments || []);
      setTotals(
        data.totals || { count: 0, amount: 0, fee: 0, fee_released: 0, fee_held: 0 },
      );
      setTotalPages(Number(data.totalPages || 1));
    } catch {
      setPayments([]);
      setTotals({ count: 0, amount: 0, fee: 0, fee_released: 0, fee_held: 0 });
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [appId, clientId, status, from, to, q, feeState, unassigned, sort, page]);

  useEffect(() => {
    load();
  }, [load]);

  const setQuick = (kind: "today" | "week" | "month" | "clear") => {
    const today = arDay();
    if (kind === "clear") {
      pushFilters({ from: "", to: "", page: 1 });
      return;
    }
    if (kind === "today") {
      pushFilters({ from: today, to: today, page: 1 });
      return;
    }
    if (kind === "week") {
      const d = new Date(`${today}T12:00:00-03:00`);
      d.setTime(d.getTime() - 6 * 24 * 60 * 60 * 1000);
      pushFilters({ from: arDay(d), to: today, page: 1 });
      return;
    }
    const ym = today.slice(0, 7);
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    pushFilters({
      from: `${ym}-01`,
      to: `${ym}-${String(last).padStart(2, "0")}`,
      page: 1,
    });
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (appId) params.set("appId", appId);
    if (clientId) params.set("clientId", clientId);
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    if (feeState) params.set("feeState", feeState);
    if (unassigned) params.set("unassigned", "1");
    window.location.href = `/api/payments/export?${params}`;
  };

  const clientName =
    clients.find((c) => c.id === clientId)?.name || (clientId ? "Cliente filtrado" : "");
  const fromIdx = totals.count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toIdx = Math.min(page * PAGE_SIZE, totals.count);
  const activeFilters =
    Number(Boolean(appId)) +
    Number(Boolean(clientId)) +
    Number(Boolean(feeState)) +
    Number(unassigned) +
    Number(Boolean(q));

  const releaseOf = (p: Payment) => {
    if (!p.paid_at || !(Number(p.fee) > 0)) return null;
    const day = arDay(new Date(p.paid_at));
    const released = isFeeReleased(day);
    return {
      released,
      on: feeReleaseOn(day),
    };
  };

  return (
    <div>
      <PageHeader
        title="Pagos"
        sub={
          clientName
            ? `${totals.count} resultados · ${clientName}`
            : `${totals.count} resultados del filtro actual`
        }
        actions={
          <button type="button" className="btn sm line" onClick={exportCsv}>
            <Download size={14} />
            Exportar CSV
          </button>
        }
      />

      <div className="kpi-grid kpi-secondary">
        <KpiCard icon={<Coins size={16} />} value={money(totals.fee)} label="Fee" hint={`${totals.count} pagos`} />
        <KpiCard
          icon={<Unlock size={16} />}
          value={money(totals.fee_released || 0)}
          label="Liberado"
          tone="ok"
          hint={`${FEE_RELEASE_DAYS} días después del cobro`}
        />
        <KpiCard
          icon={<Lock size={16} />}
          value={money(totals.fee_held || 0)}
          label="Retenido"
          tone={totals.fee_held ? "pending" : "ok"}
        />
      </div>

      <div className="split-work">
      <aside className="filter-rail card">
      <div className="period-tabs" style={{ marginBottom: "0.75rem" }}>
        <button type="button" className="period-tab" onClick={() => setQuick("today")}>
          Hoy
        </button>
        <button type="button" className="period-tab" onClick={() => setQuick("week")}>
          Semana
        </button>
        <button type="button" className="period-tab" onClick={() => setQuick("month")}>
          Mes
        </button>
        <button type="button" className="period-tab" onClick={() => setQuick("clear")}>
          Todas las fechas
        </button>
      </div>

      <FilterBar activeCount={activeFilters}>
        <div className="field" style={{ margin: 0 }}>
          <label>Cliente</label>
          <select value={clientId} onChange={(e) => pushFilters({ clientId: e.target.value, page: 1 })}>
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.app_name ? ` (${c.app_name})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>App</label>
          <select value={appId} onChange={(e) => pushFilters({ appId: e.target.value, page: 1 })}>
            <option value="">Todas</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Estado</label>
          <select value={status} onChange={(e) => pushFilters({ status: e.target.value, page: 1 })}>
            <option value="">Todos</option>
            <option value="approved">Aprobado</option>
            <option value="pending">Pendiente</option>
            <option value="rejected">Rechazado</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Fee</label>
          <select value={feeState} onChange={(e) => pushFilters({ feeState: e.target.value, page: 1 })}>
            <option value="">Todos</option>
            <option value="released">Liberado</option>
            <option value="held">Retenido</option>
            <option value="with_fee">Con fee</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Orden</label>
          <select value={sort} onChange={(e) => pushFilters({ sort: e.target.value, page: 1 })}>
            <option value="date">Fecha</option>
            <option value="fee">Fee</option>
            <option value="amount">Monto</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Desde</label>
          <input type="date" value={from} onChange={(e) => pushFilters({ from: e.target.value, page: 1 })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Hasta</label>
          <input type="date" value={to} onChange={(e) => pushFilters({ to: e.target.value, page: 1 })} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Buscar</label>
          <input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onBlur={() => pushFilters({ q: qDraft, page: 1 })}
            onKeyDown={(e) => {
              if (e.key === "Enter") pushFilters({ q: qDraft, page: 1 });
            }}
            placeholder="email, id, desc…"
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Sin cliente</label>
          <select
            value={unassigned ? "1" : ""}
            onChange={(e) => pushFilters({ unassigned: e.target.value === "1", page: 1 })}
          >
            <option value="">No</option>
            <option value="1">Solo sin asignar</option>
          </select>
        </div>
      </FilterBar>
      </aside>
      <div>

      {loading ? <p className="meta">Cargando…</p> : null}

      <div className="card">
        {!payments.length && !loading ? (
          <EmptyState title="No hay pagos con estos filtros" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table table-payments">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th className="col-app">App</th>
                    <th>Monto</th>
                    <th>Fee</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => {
                    const rel = releaseOf(p);
                    return (
                      <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setOpen(p)}>
                        <td data-label="Fecha" style={{ whiteSpace: "nowrap" }}>
                          {p.paid_at ? new Date(p.paid_at).toLocaleDateString("es-AR") : "—"}
                        </td>
                        <td data-label="Cliente">
                          <strong>{p.client_name || p.collector_name || "Sin cliente"}</strong>
                          {p.description ? (
                            <div className="meta">
                              {p.description.length > 48
                                ? `${p.description.slice(0, 48)}…`
                                : p.description}
                            </div>
                          ) : null}
                          {rel ? (
                            <div className="meta">
                              {rel.released ? "Liberado" : `Se libera el ${formatArDay(rel.on)}`}
                            </div>
                          ) : null}
                        </td>
                        <td className="meta col-app" data-label="App">
                          {p.app_name || "—"}
                        </td>
                        <td data-label="Monto">{money(p.amount)}</td>
                        <td data-label="Fee">
                          <strong>{money(p.fee)}</strong>
                        </td>
                        <td data-label="Estado">
                          <StatusPill status={p.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span className="meta">
                {totals.count
                  ? `Mostrando ${fromIdx}–${toIdx} de ${totals.count} · ventas ${money(totals.amount)} · fee ${money(totals.fee)}`
                  : "Sin resultados"}
              </span>
              <div className="actions">
                <button
                  type="button"
                  className="btn sm line"
                  disabled={page <= 1 || loading}
                  onClick={() => pushFilters({ page: page - 1 })}
                >
                  <ChevronLeft size={14} />
                  Anterior
                </button>
                <span className="meta">
                  Pág. {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn sm line"
                  disabled={page >= totalPages || loading}
                  onClick={() => pushFilters({ page: page + 1 })}
                >
                  Siguiente
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      </div>
      </div>

      <Drawer open={Boolean(open)} title="Pago" onClose={() => setOpen(null)}>
        {open ? (
          <>
            <div className="kv">
              <span>Cliente</span>
              <strong>{open.client_name || open.collector_name || "Sin cliente"}</strong>
            </div>
            <div className="kv">
              <span>Fee</span>
              <strong>{money(open.fee)}</strong>
            </div>
            <div className="kv">
              <span>Monto</span>
              <strong>{money(open.amount)}</strong>
            </div>
            <div className="kv">
              <span>Estado</span>
              <StatusPill status={open.status} />
            </div>
            <div className="kv">
              <span>Fecha</span>
              <strong>
                {open.paid_at
                  ? new Date(open.paid_at).toLocaleString("es-AR", {
                      timeZone: "America/Argentina/Buenos_Aires",
                    })
                  : "—"}
              </strong>
            </div>
            {releaseOf(open) ? (
              <div className="kv">
                <span>Liberación</span>
                <strong>
                  {releaseOf(open)?.released
                    ? `Liberado el ${formatArDay(releaseOf(open)!.on)}`
                    : `Retenido hasta el ${formatArDay(releaseOf(open)!.on)}`}
                </strong>
              </div>
            ) : null}
            <div className="kv">
              <span>Email</span>
              <strong>{open.payer_email || "—"}</strong>
            </div>
            <div className="kv">
              <span>ID Mercado Pago</span>
              <strong className="mono">{open.mp_payment_id}</strong>
            </div>
            <div className="kv">
              <span>Descripción</span>
              <strong>{open.description || "—"}</strong>
            </div>
            <div className="kv">
              <span>App</span>
              <strong>{open.app_name || "—"}</strong>
            </div>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<p className="meta">Cargando…</p>}>
      <PaymentsInner />
    </Suspense>
  );
}
