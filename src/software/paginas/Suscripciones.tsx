import { Check, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "@/software/compat";
import { useToast } from "@/software/compat";
import { Drawer } from "@/software/ui/Drawer";
import { FilterBar } from "@/software/ui/FilterBar";
import {
  arDay,
  chargeMpFeeAmount,
  chargeNetAmount,
  formatNetInput,
  formatPctInput,
  money,
  money2,
  parseDecimalInput,
} from "@/software/lib/money";
import { subscriptionPlanName } from "@/software/lib/subscription-label";
import type {
  HubStatus,
  MpAppPublic,
  Subscription,
  SubscriptionCharge,
} from "@/software/lib/types";
import { swFetch } from "@/software/compat";

type ClientOpt = { id: string; name: string; app_name?: string };

const PAGE_SIZE = 50;

function kindLabel(kind: string) {
  if (kind === "checkout") return "Alta";
  if (kind === "authorized") return "Autorización";
  return "Cuota";
}

function paidClass(status?: string | null, everPaid?: boolean) {
  if (status === "approved" || status === "authorized" || everPaid) return "ok";
  if (!status) return "pending";
  if (status === "rejected" || status === "cancelled" || status === "refunded") {
    return "error";
  }
  return "pending";
}

function paidLabel(status?: string | null, everPaid?: boolean) {
  if (status === "approved" || status === "authorized") return "Pagado";
  if (everPaid) return "Pagado";
  if (!status) return "Sin cobro";
  if (status === "rejected" || status === "cancelled" || status === "refunded") {
    return "No cobrado";
  }
  return "Pendiente";
}

function freqLabel(s: Subscription) {
  const unit = s.frequency_type === "months" ? "mes" : s.frequency_type;
  return `${s.frequency} ${unit}${s.frequency > 1 ? "es" : ""}`;
}

function clientLabel(s: {
  client_name?: string | null;
  collector_name?: string | null;
  reason?: string | null;
  description?: string | null;
}) {
  return subscriptionPlanName({
    reason: s.reason,
    description: s.description,
    clientName: s.client_name,
    collectorName: s.collector_name,
  });
}

function mpPlanLabel(status?: string | null) {
  const s = String(status || "").toLowerCase();
  if (s === "authorized") return "Activa en Mercado Pago";
  if (s === "paused") return "Pausada";
  if (s === "cancelled" || s === "canceled") return "Cancelada";
  if (s === "pending") return "No se activó";
  return "";
}

function contactLine(s: { payer_email?: string | null }) {
  return String(s.payer_email || "").trim();
}

function chargeNet(p: SubscriptionCharge, pct = Number(p.mp_fee_pct || 0)) {
  if (p.mp_net_amount != null && Number(p.mp_fee_pct || 0) === pct) {
    return Number(p.mp_net_amount);
  }
  return chargeNetAmount(Number(p.amount || 0), pct);
}

function MpFeeCell({
  charge,
  busy,
  onSavePct,
  onSaveNet,
  onResetAuto,
}: {
  charge: SubscriptionCharge;
  busy: boolean;
  onSavePct: (id: string, pct: number) => Promise<unknown>;
  onSaveNet: (id: string, net: number) => Promise<unknown>;
  onResetAuto: (id: string) => Promise<unknown>;
}) {
  const [pctDraft, setPctDraft] = useState(() => formatPctInput(charge.mp_fee_pct));
  const [netDraft, setNetDraft] = useState(() =>
    formatNetInput(chargeNet(charge)),
  );
  const [focus, setFocus] = useState<"pct" | "net" | null>(null);

  useEffect(() => {
    setPctDraft(formatPctInput(charge.mp_fee_pct));
    setNetDraft(formatNetInput(chargeNet(charge)));
  }, [charge.id, charge.mp_fee_pct, charge.mp_net_amount, charge.amount]);

  const livePct =
    focus === "pct"
      ? (parseDecimalInput(pctDraft) ?? Number(charge.mp_fee_pct || 0))
      : Number(charge.mp_fee_pct || 0);
  const liveNet =
    focus === "net"
      ? (parseDecimalInput(netDraft) ?? chargeNet(charge))
      : chargeNet(charge, livePct);
  const feeAmt = chargeMpFeeAmount(Number(charge.amount || 0), livePct);

  const commitPct = async () => {
    setFocus(null);
    const parsed = parseDecimalInput(pctDraft);
    if (parsed == null) {
      setPctDraft(formatPctInput(charge.mp_fee_pct));
      return;
    }
    const pct = Math.min(100, Math.max(0, parsed));
    if (Math.abs(pct - Number(charge.mp_fee_pct || 0)) < 0.0000005) return;
    await onSavePct(charge.id, pct);
  };

  const commitNet = async () => {
    setFocus(null);
    const parsed = parseDecimalInput(netDraft);
    if (parsed == null) {
      setNetDraft(formatNetInput(chargeNet(charge)));
      return;
    }
    const gross = Number(charge.amount || 0);
    const net = Math.round(Math.min(Math.max(parsed, 0), gross > 0 ? gross : parsed) * 100) / 100;
    if (Math.abs(net - chargeNet(charge)) < 0.005) return;
    await onSaveNet(charge.id, net);
  };

  return (
    <div className="mp-fee-cell">
      <div className="mp-fee-row">
        <input
          type="text"
          inputMode="decimal"
          aria-label="Comisión Mercado Pago %"
          disabled={busy}
          value={
            focus === "pct"
              ? pctDraft
              : focus === "net"
                ? formatPctInput(
                    Number(charge.amount || 0) > 0
                      ? (1 - liveNet / Number(charge.amount || 0)) * 100
                      : 0,
                  )
                : pctDraft
          }
          onFocus={() => setFocus("pct")}
          onChange={(e) => setPctDraft(e.target.value)}
          onBlur={() => void commitPct()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="0"
        />
        <span className="meta">%</span>
      </div>
      <div className="mp-fee-row">
        <span className="meta">neto</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Neto después de comisión MP"
          disabled={busy}
          value={
            focus === "net"
              ? netDraft
              : focus === "pct"
                ? formatNetInput(chargeNetAmount(Number(charge.amount || 0), livePct))
                : netDraft
          }
          onFocus={() => setFocus("net")}
          onChange={(e) => setNetDraft(e.target.value)}
          onBlur={() => void commitNet()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      {feeAmt > 0.004 ? (
        <div className="meta">− {money2(feeAmt)}</div>
      ) : null}
      {charge.mp_fee_manual ? (
        <button
          type="button"
          className="mp-fee-reset"
          disabled={busy}
          onClick={() => void onResetAuto(charge.id)}
        >
          volver a detectar
        </button>
      ) : feeAmt > 0.004 ? (
        <div className="meta" style={{ color: "var(--ok)" }}>
          detectada
        </div>
      ) : (
        <button
          type="button"
          className="mp-fee-reset"
          disabled={busy}
          onClick={() => void onResetAuto(charge.id)}
        >
          detectar de MP
        </button>
      )}
    </div>
  );
}

function SubscriptionsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const [apps, setApps] = useState<MpAppPublic[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [charges, setCharges] = useState<SubscriptionCharge[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [totals, setTotals] = useState({
    count: 0,
    amount: 0,
    approved_amount: 0,
    approved_amount_gross: 0,
    approved_count: 0,
    active_count: 0,
    monthly_recurring: 0,
    pending_count: 0,
    accepted_count: 0,
    rejected_count: 0,
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [appId, setAppId] = useState(searchParams.get("appId") || "");
  const [clientId, setClientId] = useState(searchParams.get("clientId") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [kind, setKind] = useState(searchParams.get("kind") || "");
  const [from, setFrom] = useState(searchParams.get("from") || "");
  const [to, setTo] = useState(searchParams.get("to") || "");
  const [qDraft, setQDraft] = useState(searchParams.get("q") || "");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feeBusyId, setFeeBusyId] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [tab, setTab] = useState<"pending" | "plans" | "charges" | "out">("charges");
  const [feeCharge, setFeeCharge] = useState<SubscriptionCharge | null>(null);
  const [mpStatus, setMpStatus] = useState("");
  const [missingFee, setMissingFee] = useState(false);
  const q = searchParams.get("q") || "";

  useEffect(() => {
    setAppId(searchParams.get("appId") || "");
    setClientId(searchParams.get("clientId") || "");
    setStatus(searchParams.get("status") || "");
    setKind(searchParams.get("kind") || "");
    setFrom(searchParams.get("from") || "");
    setTo(searchParams.get("to") || "");
    setQDraft(searchParams.get("q") || "");
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
      kind?: string;
      from?: string;
      to?: string;
      q?: string;
      page?: number;
    }) => {
      const p = new URLSearchParams();
      const a = next.appId ?? appId;
      const c = next.clientId ?? clientId;
      const s = next.status ?? status;
      const k = next.kind ?? kind;
      const f = next.from ?? from;
      const t = next.to ?? to;
      const query = next.q !== undefined ? next.q : q;
      const pg = next.page ?? 1;
      if (a) p.set("appId", a);
      if (c) p.set("clientId", c);
      if (s) p.set("status", s);
      if (k) p.set("kind", k);
      if (f) p.set("from", f);
      if (t) p.set("to", t);
      if (query) p.set("q", query);
      if (pg > 1) p.set("page", String(pg));
      const qs = p.toString();
      router.replace(qs ? `/suscripciones?${qs}` : "/suscripciones");
    },
    [router, appId, clientId, status, kind, from, to, q],
  );

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (appId) params.set("appId", appId);
      if (clientId) params.set("clientId", clientId);
      if (status) params.set("status", status);
      if (kind) params.set("kind", kind);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q) params.set("q", q);
      if (mpStatus) params.set("mpStatus", mpStatus);
      if (missingFee) params.set("missingFee", "1");
      params.set("hubStatus", "all");
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      const res = await swFetch(`/api/subscriptions?${params}`);
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar las suscripciones");
      setCharges(data.charges || []);
      setSubscriptions(data.subscriptions || []);
      setTotals(
        data.totals || {
          count: 0,
          amount: 0,
          approved_amount: 0,
          approved_amount_gross: 0,
          approved_count: 0,
          active_count: 0,
          monthly_recurring: 0,
          pending_count: 0,
          accepted_count: 0,
          rejected_count: 0,
        },
      );
      setTotalPages(Number(data.totalPages || 1));
    } catch {
      setCharges([]);
      setSubscriptions([]);
      setTotals({
        count: 0,
        amount: 0,
        approved_amount: 0,
        approved_amount_gross: 0,
        approved_count: 0,
        active_count: 0,
        monthly_recurring: 0,
        pending_count: 0,
        accepted_count: 0,
        rejected_count: 0,
      });
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [appId, clientId, status, kind, from, to, q, page, mpStatus, missingFee]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = useMemo(
    () => subscriptions.filter((s) => s.hub_status === "pending"),
    [subscriptions],
  );
  const inHub = useMemo(
    () =>
      subscriptions
        .filter((s) => s.hub_status === "accepted")
        .sort((a, b) => {
          const aPaid = a.ever_paid || a.status === "authorized" ? 1 : 0;
          const bPaid = b.ever_paid || b.status === "authorized" ? 1 : 0;
          return bPaid - aPaid;
        }),
    [subscriptions],
  );
  const rejected = useMemo(
    () => subscriptions.filter((s) => s.hub_status === "rejected"),
    [subscriptions],
  );

  const setHub = async (id: string, hubStatus: HubStatus) => {
    setBusyId(id);
    try {
      const res = await swFetch("/api/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, hub_status: hubStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar");
      if (hubStatus === "accepted") {
        showToast("Entró a Prodi Software. Ahora se detecta si se pagó.");
      } else if (hubStatus === "rejected") {
        showToast("No entra a Prodi Software.");
      } else {
        showToast("Volvió a pendiente.");
      }
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al actualizar");
    } finally {
      setBusyId(null);
    }
  };

  const patchChargeFee = async (body: Record<string, unknown>, id: string) => {
    setFeeBusyId(id);
    try {
      const res = await swFetch("/api/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo guardar la comisión");
      await load({ quiet: true });
      return data as {
        results?: Array<{ detected?: boolean }>;
      };
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al guardar comisión");
      await load({ quiet: true });
      return null;
    } finally {
      setFeeBusyId(null);
    }
  };

  const saveFeePct = (id: string, pct: number) =>
    patchChargeFee({ charge_id: id, mp_fee_pct: pct }, id);

  const saveFeeNet = (id: string, net: number) =>
    patchChargeFee({ charge_id: id, mp_net_amount: net }, id);

  const resetFeeAuto = async (id: string) => {
    const data = await patchChargeFee({ charge_id: id, mp_fee_auto: true }, id);
    if (!data) return;
    const detected = data.results?.[0]?.detected;
    showToast(
      detected
        ? "Comisión MP detectada de nuevo."
        : "MP no trajo comisión; quedó 0%. Podés cargarla a mano.",
    );
  };

  const setQuick = (which: "today" | "week" | "month" | "clear") => {
    const today = arDay();
    if (which === "clear") {
      pushFilters({ from: "", to: "", page: 1 });
      return;
    }
    if (which === "today") {
      pushFilters({ from: today, to: today, page: 1 });
      return;
    }
    if (which === "week") {
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
    if (kind) params.set("kind", kind);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    window.location.href = `/api/subscriptions/export?${params}`;
  };

  const clientName =
    clients.find((c) => c.id === clientId)?.name ||
    (clientId ? "Cliente filtrado" : "");

  const fromIdx = totals.count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toIdx = Math.min(page * PAGE_SIZE, totals.count);

  return (
    <div>
      <div className="row page-head">
        <div>
          <h1 className="page-title">Suscripciones</h1>
          <p className="page-sub">
            Primero decidí si el plan entra a Prodi Software. Recién ahí el sistema
            mira si Mercado Pago cobró o no.
            {clientName ? ` · ${clientName}` : ""}
          </p>
        </div>
        <button type="button" className="btn sm line" onClick={exportCsv}>
          <Download size={14} />
          Exportar CSV
        </button>
      </div>

      <div className="split-work">
      <div className="tabs-line" role="tablist">
        <button type="button" className={`btn sm ${tab === "pending" ? "" : "line"}`} onClick={() => setTab("pending")}>
          Por decidir ({totals.pending_count})
        </button>
        <button type="button" className={`btn sm ${tab === "plans" ? "" : "line"}`} onClick={() => setTab("plans")}>
          Planes ({totals.accepted_count})
        </button>
        <button type="button" className={`btn sm ${tab === "charges" ? "" : "line"}`} onClick={() => setTab("charges")}>
          Cobros ({totals.approved_count})
        </button>
        <button type="button" className={`btn sm ${tab === "out" ? "" : "line"}`} onClick={() => setTab("out")}>
          No entran ({totals.rejected_count})
        </button>
        <p className="meta" style={{ margin: "0.35rem 0.4rem 0.2rem" }}>
          Cobrado {money2(totals.approved_amount)} · mensual {money(totals.monthly_recurring)}
        </p>
      </div>
      <div className="pane">

      {tab === "pending" && pending.length ? (
        <div className="card" style={{ marginBottom: "1.15rem" }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
            ¿Entran a Prodi Software?
          </h2>
          <p className="meta" style={{ marginTop: 0 }}>
            Altas detectadas en Mercado Pago. Esto no es un cobro: es si el plan
            queda en el sistema o no.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Monto</th>
                  <th>Frecuencia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((s) => (
                  <tr key={s.id}>
                      <td>
                      <strong>{clientLabel(s)}</strong>
                      {contactLine(s) ? (
                        <div className="meta">{contactLine(s)}</div>
                      ) : s.reason ? (
                        <div className="meta">
                          {s.reason.length > 56 ? `${s.reason.slice(0, 56)}…` : s.reason}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <strong>{money(s.amount)}</strong>
                    </td>
                    <td className="meta">{freqLabel(s)}</td>
                    <td>
                      <div className="actions" style={{ flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          className="btn sm"
                          disabled={busyId === s.id}
                          onClick={() => setHub(s.id, "accepted")}
                        >
                          <Check size={14} />
                          Entra
                        </button>
                        <button
                          type="button"
                          className="btn sm danger"
                          disabled={busyId === s.id}
                          onClick={() => setHub(s.id, "rejected")}
                        >
                          <X size={14} />
                          No entra
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "charges" || tab === "plans" ? (
      <>
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

      <FilterBar>
        <div className="field" style={{ margin: 0 }}>
          <label>Cliente</label>
          <select
            value={clientId}
            onChange={(e) => pushFilters({ clientId: e.target.value, page: 1 })}
          >
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
          <select
            value={appId}
            onChange={(e) => pushFilters({ appId: e.target.value, page: 1 })}
          >
            <option value="">Todas</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>¿Se pagó?</label>
          <select
            value={status}
            onChange={(e) => pushFilters({ status: e.target.value, page: 1 })}
          >
            <option value="">Todos</option>
            <option value="approved">Pagado</option>
            <option value="pending">Pendiente</option>
            <option value="rejected">No cobrado</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Tipo</label>
          <select
            value={kind}
            onChange={(e) => pushFilters({ kind: e.target.value, page: 1 })}
          >
            <option value="">Todos</option>
            <option value="checkout">Alta</option>
            <option value="recurring">Cuota</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => pushFilters({ from: e.target.value, page: 1 })}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => pushFilters({ to: e.target.value, page: 1 })}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Estado en MP</label>
          <select value={mpStatus} onChange={(e) => setMpStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="authorized">Activa</option>
            <option value="paused">Pausada</option>
            <option value="cancelled">Cancelada</option>
            <option value="pending">No se activó</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Comisión</label>
          <select
            value={missingFee ? "missing" : ""}
            onChange={(e) => {
              setMissingFee(e.target.value === "missing");
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            <option value="missing">Sin detectar</option>
          </select>
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
            placeholder="cliente, id, desc…"
          />
        </div>
      </FilterBar>
      </>
      ) : null}

      {tab === "plans" && inHub.length ? (
        <div className="card" style={{ marginBottom: "1.15rem" }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>En Prodi Software</h2>
          <p className="meta" style={{ marginTop: 0 }}>
            Planes aceptados. El cobro lo marca Mercado Pago, no la admisión.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Monto</th>
                  <th>Frecuencia</th>
                  <th>¿Se pagó?</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {inHub.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{clientLabel(s)}</strong>
                      {contactLine(s) ? <div className="meta">{contactLine(s)}</div> : null}
                      {mpPlanLabel(s.status) ? (
                        <div className="meta">{mpPlanLabel(s.status)}</div>
                      ) : null}
                    </td>
                    <td>
                      <strong>{money(s.amount)}</strong>
                    </td>
                    <td className="meta">{freqLabel(s)}</td>
                    <td>
                      <span className={`pill ${paidClass(s.last_charge_status, s.ever_paid)}`}>
                        {paidLabel(s.last_charge_status, s.ever_paid)}
                      </span>
                      {s.last_charge_paid_at ? (
                        <div className="meta" style={{ whiteSpace: "nowrap" }}>
                          {new Date(s.last_charge_paid_at).toLocaleDateString("es-AR")}
                          {s.last_charge_amount
                            ? ` · ${money(s.last_charge_amount)}`
                            : ""}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn sm line"
                        disabled={busyId === s.id}
                        onClick={() => setHub(s.id, "rejected")}
                      >
                        Sacar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "plans" && !pending.length && !loading ? (
        <p className="meta" style={{ marginBottom: "1.15rem" }}>
          No hay planes en Prodi Software con estos filtros.
        </p>
      ) : null}

      {tab === "out" && totals.rejected_count ? (
        <div className="card" style={{ marginBottom: "1.15rem" }}>
          <div className="row" style={{ marginBottom: showRejected ? "0.75rem" : 0 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>No entran</h2>
              <p className="meta" style={{ margin: "0.2rem 0 0" }}>
                {totals.rejected_count} plan{totals.rejected_count === 1 ? "" : "es"}{" "}
                rechazado{totals.rejected_count === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              className="btn sm line"
              onClick={() => setShowRejected((v) => !v)}
            >
              {showRejected ? "Ocultar" : "Ver"}
            </button>
          </div>
          {showRejected ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Monto</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rejected.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{clientLabel(s)}</strong>
                        {s.reason ? (
                          <div className="meta">
                            {s.reason.length > 56
                              ? `${s.reason.slice(0, 56)}…`
                              : s.reason}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <strong>{money(s.amount)}</strong>
                      </td>
                      <td>
                        <div className="actions" style={{ flexWrap: "nowrap" }}>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={busyId === s.id}
                            onClick={() => setHub(s.id, "accepted")}
                          >
                            Entra
                          </button>
                          <button
                            type="button"
                            className="btn sm line"
                            disabled={busyId === s.id}
                            onClick={() => setHub(s.id, "pending")}
                          >
                            Pendiente
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? <p className="meta">Cargando…</p> : null}

      {tab === "charges" ? <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Cobros en Prodi Software</h2>
        <p className="meta" style={{ marginTop: 0 }}>
          Solo planes aceptados. La comisión de Mercado Pago se detecta sola
          (lo que realmente acreditó) y se puede corregir.
        </p>
        {!charges.length && !loading ? (
          <p className="meta">No hay cobros de planes en Prodi Software con estos filtros.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table table-payments">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Tipo</th>
                    <th>Monto</th>
                    <th>Comisión MP</th>
                    <th>¿Se pagó?</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((p) => (
                    <tr key={p.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {p.paid_at
                          ? new Date(p.paid_at).toLocaleDateString("es-AR")
                          : "—"}
                      </td>
                      <td>
                        <strong>{clientLabel(p)}</strong>
                        {contactLine(p) ? (
                          <div className="meta">{contactLine(p)}</div>
                        ) : p.description ? (
                          <div className="meta">
                            {p.description.length > 48
                              ? `${p.description.slice(0, 48)}…`
                              : p.description}
                          </div>
                        ) : (
                          <div className="meta">{p.app_name || "—"}</div>
                        )}
                      </td>
                      <td>
                        <span className="pill pending">{kindLabel(p.kind)}</span>
                      </td>
                      <td>
                        <strong>{money(p.amount)}</strong>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm line"
                          onClick={() => setFeeCharge(p)}
                        >
                          {money2(chargeNet(p))}
                          <span className="meta">
                            {" "}
                            {formatPctInput(p.mp_fee_pct) || "0"}%
                            {p.mp_fee_manual ? " · manual" : ""}
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className={`pill ${paidClass(p.status)}`}>
                          {paidLabel(p.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: "0.85rem" }}>
              <span className="meta">
                {totals.count
                  ? `Mostrando ${fromIdx}–${toIdx} de ${totals.count}`
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
      </div> : null}
      </div>
      </div>

      <Drawer
        open={Boolean(feeCharge)}
        title={feeCharge ? clientLabel(feeCharge) : "Comisión"}
        onClose={() => setFeeCharge(null)}
      >
        {feeCharge ? (
          <>
            <p className="meta" style={{ marginTop: 0 }}>
              Bruto {money(feeCharge.amount)}. La comisión se puede corregir; no borra el cobro.
            </p>
            <MpFeeCell
              charge={feeCharge}
              busy={feeBusyId === feeCharge.id}
              onSavePct={saveFeePct}
              onSaveNet={saveFeeNet}
              onResetAuto={resetFeeAuto}
            />
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<p className="meta">Cargando…</p>}>
      <SubscriptionsInner />
    </Suspense>
  );
}
