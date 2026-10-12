import Link from "@/software/compat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, RefreshCw, RotateCcw } from "lucide-react";
import { useToast } from "@/software/compat";
import { EmptyState } from "@/software/ui/EmptyState";
import { FilterBar } from "@/software/ui/FilterBar";
import { PageHeader } from "@/software/ui/PageHeader";
import { PeriodBar } from "@/software/ui/PeriodBar";
import { money, periodBounds, yearMonth, type StatsPeriod } from "@/software/lib/money";
import type { HubClient } from "@/software/lib/types";
import type { MpAppPublic, Payment } from "@/software/lib/types";
import { swFetch } from "@/software/compat";

type Tab = "active" | "blacklisted";

export default function ClientsPage() {
  const showToast = useToast();
  const [tab, setTab] = useState<Tab>("active");
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const [month, setMonth] = useState(yearMonth());
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [appId, setAppId] = useState("");
  const [apps, setApps] = useState<MpAppPublic[]>([]);
  const [clients, setClients] = useState<HubClient[]>([]);
  const [counts, setCounts] = useState({ active: 0, blacklisted: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HubClient | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [recent, setRecent] = useState<Payment[]>([]);

  const bounds = useMemo(() => periodBounds(period, month), [period, month]);

  const load = useCallback(
    async (backfill = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ list: tab });
        if (backfill) params.set("backfill", "1");
        if (q) params.set("q", q);
        if (appId) params.set("appId", appId);
        if (bounds.from) params.set("from", bounds.from);
        if (bounds.to) params.set("to", bounds.to);
        const res = await swFetch(`/api/clients?${params}`);
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(data.error || "No se pudieron cargar clientes");
        setClients(data.clients || []);
        setCounts({
          active: Number(data.counts?.active || 0),
          blacklisted: Number(data.counts?.blacklisted || 0),
        });
        if (backfill) showToast("Clientes actualizados");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Error al cargar");
        setClients([]);
      } finally {
        setLoading(false);
      }
    },
    [showToast, tab, q, appId, bounds.from, bounds.to],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    swFetch("/api/apps")
      .then((r) => r.json())
      .then((d) => setApps(d.apps || []));
  }, []);

  const open = async (c: HubClient) => {
    setSelected(c);
    setEditName(c.name);
    setEditNotes(c.notes || "");
    const res = await swFetch(`/api/payments?clientId=${c.id}&status=approved&limit=10`);
    const data = await res.json().catch(() => ({}));
    setRecent(data.payments || []);
  };

  const save = async () => {
    if (!selected) return;
    const name = editName.trim();
    if (!name) return;
    const res = await swFetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, name, notes: editNotes }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Error");
      return;
    }
    showToast("Cliente guardado");
    setSelected(null);
    load(false);
  };

  const setBlacklisted = async (c: HubClient, blacklisted: boolean) => {
    const res = await swFetch("/api/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, blacklisted }),
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || "Error");
      return;
    }
    showToast(blacklisted ? "Movido a lista negra" : "Sacado de lista negra");
    setSelected(null);
    load(false);
  };

  const feeSum = clients.reduce((a, c) => a + Number(c.fee_total || 0), 0);
  const amountSum = clients.reduce((a, c) => a + Number(c.amount_total || 0), 0);
  const activeFilters = Number(Boolean(q)) + Number(Boolean(appId));

  return (
    <div>
      <PageHeader
        title="Clientes"
        sub="Activos suman fee. Lista negra queda fuera de Inicio y Pagos."
        actions={
          <button type="button" className="btn line sm" onClick={() => load(true)}>
            <RefreshCw size={16} />
            Detectar de nuevo
          </button>
        }
      />

      <div className="split-master">
      <div>
      <PeriodBar period={period} month={month} onPeriod={setPeriod} onMonth={setMonth} />

      <div className="tabs-line">
        <button
          type="button"
          className={`btn sm ${tab === "active" ? "" : "line"}`}
          onClick={() => setTab("active")}
        >
          Activos ({counts.active})
        </button>
        <button
          type="button"
          className={`btn sm ${tab === "blacklisted" ? "" : "line"}`}
          onClick={() => setTab("blacklisted")}
        >
          Lista negra ({counts.blacklisted})
        </button>
      </div>

      <FilterBar activeCount={activeFilters}>
        <div className="field" style={{ margin: 0 }}>
          <label>Buscar</label>
          <input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onBlur={() => setQ(qDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(qDraft);
            }}
            placeholder="Nombre, ID, app…"
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>App</label>
          <select value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">Todas</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </FilterBar>

      {loading ? <p className="meta">Cargando…</p> : null}

      <div className="card">
        {!loading && !clients.length ? (
          <EmptyState title={tab === "blacklisted" ? "Nadie en lista negra" : "Sin clientes"}>
            Sync en Apps o Detectar de nuevo.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table table-clients">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Fee</th>
                  <th>Ventas</th>
                  <th className="col-count">Pagos</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                      <tr key={c.id} className={selected?.id === c.id ? "client-row is-on" : "client-row"} style={{ cursor: "pointer" }} onClick={() => open(c)}>
                    <td data-label="Cliente">
                      <strong>{c.name}</strong>
                      <div className="meta">
                        {c.app_name} · ID {c.collector_id}
                      </div>
                    </td>
                    <td data-label="Fee">
                      <strong>{money(c.fee_total || 0)}</strong>
                      {period !== "all" ? (
                        <div className="meta">Total {money(c.fee_all || 0)}</div>
                      ) : null}
                    </td>
                    <td data-label="Ventas">{money(c.amount_total || 0)}</td>
                    <td className="col-count" data-label="Pagos">
                      {c.payments_count || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {clients.length ? (
          <div className="table-foot">
            <span className="meta">
              {clients.length} clientes · fee {money(feeSum)} · ventas {money(amountSum)}
            </span>
          </div>
        ) : null}
      </div>
      </div>

      <aside className="detail-pane card">
        {selected ? (
          <>
            <div className="kv">
              <span>App</span>
              <strong>{selected.app_name}</strong>
            </div>
            <div className="kv">
              <span>ID Mercado Pago</span>
              <strong className="mono">{selected.collector_id}</strong>
            </div>
            <div className="field">
              <label>Nombre</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="field">
              <label>Notas</label>
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            </div>
            <div className="actions">
              <button type="button" className="btn sm" onClick={save}>
                Guardar
              </button>
              <Link className="btn sm line" href={`/payments?clientId=${selected.id}`}>
                Pagos
              </Link>
              <Link className="btn sm line" href={`/suscripciones?clientId=${selected.id}`}>
                Suscripciones
              </Link>
              <Link className="btn sm line" href={`/socios?tab=clientes`}>
                Porcentaje
              </Link>
            </div>
            {tab === "active" ? (
              <button type="button" className="btn sm line" onClick={() => setBlacklisted(selected, true)}>
                <Ban size={14} /> Lista negra
              </button>
            ) : (
              <button type="button" className="btn sm" onClick={() => setBlacklisted(selected, false)}>
                <RotateCcw size={14} /> Restaurar
              </button>
            )}
            <div>
              <div className="meta" style={{ marginBottom: 6 }}>
                Últimos pagos
              </div>
              {!recent.length ? (
                <p className="meta">Sin pagos con fee.</p>
              ) : (
                recent.map((p) => (
                  <div key={p.id} className="liq-share-row" style={{ marginBottom: 6 }}>
                    <span>
                      {(p.description || "Sin descripción").slice(0, 64)}
                      <div className="meta">
                        {p.paid_at ? new Date(p.paid_at).toLocaleDateString("es-AR") : "—"}
                      </div>
                    </span>
                    <strong>{money(p.fee)}</strong>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <p className="meta" style={{ margin: 0 }}>
            Elegí un cliente de la lista para ver notas, pagos y acciones.
          </p>
        )}
      </aside>
      </div>
    </div>
  );
}
