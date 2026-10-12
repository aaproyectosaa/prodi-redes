import Link from "@/software/compat";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Percent, Plus, Trash2, Undo2, Wallet } from "lucide-react";
import { useToast } from "@/software/compat";
import { arDay, FEE_RELEASE_DAYS, formatArDay, money, money2 } from "@/software/lib/money";
import { expenseCategoryLabel } from "@/software/lib/expense-category";
import {
  parsePayoutSource,
  sourceKindLabel,
} from "@/software/lib/payout-source";
import { exportLiquidacionCsv } from "./export-csv";
import { BreakdownTable } from "./BreakdownTable";
import type {
  BreakdownRow,
  Caja,
  ExtraPayment,
  Item,
  Partner,
  Payout,
  Source,
} from "./types";
import { swFetch } from "@/software/compat";

export function LiquidacionClient() {
  const showToast = useToast();
  const today = arDay();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [totalFee, setTotalFee] = useState(0);
  const [paymentsCount, setPaymentsCount] = useState(0);
  const [totalFeeHeld, setTotalFeeHeld] = useState(0);
  const [heldCount, setHeldCount] = useState(0);
  const [releasedUntil, setReleasedUntil] = useState("");
  const [totalMaintenance, setTotalMaintenance] = useState(0);
  const [maintenanceCount, setMaintenanceCount] = useState(0);
  const [totalExtra, setTotalExtra] = useState(0);
  const [extraCount, setExtraCount] = useState(0);
  const [totalSubscription, setTotalSubscription] = useState(0);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [feeItems, setFeeItems] = useState<Item[]>([]);
  const [maintenanceItems, setMaintenanceItems] = useState<Item[]>([]);
  const [extraItems, setExtraItems] = useState<Item[]>([]);
  const [subscriptionItems, setSubscriptionItems] = useState<Item[]>([]);
  const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [caja, setCaja] = useState<Caja | null>(null);
  const [loading, setLoading] = useState(true);
  const [payModal, setPayModal] = useState<{
    partnerId: string;
    partnerName: string;
    source: Source;
    amount: string;
  } | null>(null);
  const [paying, setPaying] = useState(false);
  const [extraName, setExtraName] = useState("");
  const [extraAmount, setExtraAmount] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [extraDate, setExtraDate] = useState(today);
  const [extraSaving, setExtraSaving] = useState(false);
  const [bag, setBag] = useState<Source>("fee");
  const [extraOpen, setExtraOpen] = useState(false);
  const [payoutPartner, setPayoutPartner] = useState("");
  const [payoutSource, setPayoutSourceFilter] = useState("");
  const urlReady = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await swFetch(`/api/liquidacion?from=${from}&to=${to}`);
      const data = await res.json();
      setTotalFee(data.totalFee || 0);
      setPaymentsCount(data.paymentsCount || 0);
      setTotalFeeHeld(Number(data.totalFeeHeld || 0));
      setHeldCount(Number(data.heldCount || 0));
      setReleasedUntil(String(data.releasedUntil || ""));
      setTotalMaintenance(data.totalMaintenance || 0);
      setMaintenanceCount(data.maintenanceCount || 0);
      setTotalExtra(data.totalExtra || 0);
      setExtraCount(data.extraCount || 0);
      setTotalSubscription(data.totalSubscription || 0);
      setSubscriptionCount(data.subscriptionCount || 0);
      setFeeItems(data.feeItems || data.items || []);
      setMaintenanceItems(data.maintenanceItems || []);
      setExtraItems(data.extraItems || []);
      setSubscriptionItems(data.subscriptionItems || []);
      setExtraPayments(data.extraPayments || []);
      setPayouts(data.payouts || []);
      setPartners(data.partners || []);
      setBreakdown(data.breakdown || []);
      setCaja(data.caja || null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("from")) setFrom(sp.get("from") || from);
    if (sp.get("to")) setTo(sp.get("to") || to);
    urlReady.current = true;
    // solo al entrar, para respetar un link compartido
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!urlReady.current) return;
    const p = new URLSearchParams();
    p.set("from", from);
    p.set("to", to);
    window.history.replaceState(null, "", `/liquidacion?${p}`);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const openPayModal = (item: Item) => {
    if (item.pending <= 0) {
      showToast("Nada pendiente");
      return;
    }
    setPayModal({
      partnerId: item.partner_id,
      partnerName: item.partner_name,
      source: item.source,
      amount: String(Math.round(item.pending)),
    });
  };

  const pendingForSource = (partnerId: string, source: Source) => {
    const pool =
      source === "maintenance"
        ? maintenanceItems
        : source === "extra"
          ? extraItems
          : source === "subscription"
            ? subscriptionItems
            : feeItems;
    return Math.round(
      pool.find((i) => i.partner_id === partnerId)?.pending || 0,
    );
  };

  const confirmPay = async () => {
    if (!payModal) return;
    const { partnerId, source } = payModal;
    const kind = sourceKindLabel(source);
    const pending = pendingForSource(partnerId, source);
    if (pending <= 0) {
      showToast(`Nada pendiente en ${kind}`);
      return;
    }
    const amount = Math.round(
      Number(String(payModal.amount).replace(/\./g, "").replace(",", ".")),
    );
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Monto inválido");
      return;
    }
    if (amount > pending) {
      showToast(`No puede superar el pendiente de ${kind} (${money(pending)})`);
      return;
    }
    setPaying(true);
    try {
      const res = await swFetch("/api/liquidacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pay",
          partner_id: partnerId,
          amount,
          from,
          to,
          source,
        }),
      });
      const data = await res.json();
      if (!res.ok) showToast(data.error || "Error");
      else {
        showToast(
          amount < pending
            ? `Parcial ${money(amount)} (${kind}) ✓`
            : `Transferencia ${kind} marcada ✓`,
        );
        setPayModal(null);
        load();
      }
    } finally {
      setPaying(false);
    }
  };

  const setPayoutSource = async (p: Payout, source: Source) => {
    const res = await swFetch("/api/liquidacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_source", id: p.id, source }),
    });
    const data = await res.json();
    if (!res.ok) showToast(data.error || "Error");
    else {
      showToast(
        source === "maintenance"
          ? "Marcado como mant. ✓"
          : source === "extra"
            ? "Marcado como extra ✓"
            : source === "subscription"
              ? "Marcado como suscrip. ✓"
              : "Marcado como fee ✓",
      );
      load();
    }
  };

  const undo = async (id: string) => {
    if (!confirm("¿Anular esta transferencia?")) return;
    await swFetch("/api/liquidacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", id }),
    });
    showToast("Anulada");
    load();
  };

  const addExtra = async () => {
    const payer = extraName.trim();
    const amount = Math.round(
      Number(String(extraAmount).replace(/\./g, "").replace(",", ".")),
    );
    if (!payer || !Number.isFinite(amount) || amount <= 0) {
      showToast("Empresa/persona y monto son obligatorios");
      return;
    }
    setExtraSaving(true);
    try {
      const res = await swFetch("/api/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          payer_name: payer,
          amount,
          notes: extraNotes.trim(),
          paid_at: extraDate || to,
        }),
      });
      const data = await res.json();
      if (!res.ok) showToast(data.error || "Error");
      else {
        showToast(`Cobro extra ${money(amount)} ✓`);
        setExtraName("");
        setExtraAmount("");
        setExtraNotes("");
        setExtraOpen(false);
        load();
      }
    } finally {
      setExtraSaving(false);
    }
  };

  const deleteExtra = async (item: ExtraPayment) => {
    if (!confirm(`¿Anular el cobro extra de ${item.payer_name}?`)) return;
    const res = await swFetch("/api/extras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: item.id }),
    });
    const data = await res.json();
    if (!res.ok) showToast(data.error || "Error");
    else {
      showToast("Cobro extra anulado");
      load();
    }
  };

  const feePending = feeItems.reduce((a, i) => a + i.pending, 0);
  const maintPending = maintenanceItems.reduce((a, i) => a + i.pending, 0);
  const extraPending = extraItems.reduce((a, i) => a + i.pending, 0);
  const subPending = subscriptionItems.reduce((a, i) => a + i.pending, 0);
  const feeBreakdown = breakdown.filter(
    (b) => !b.source || b.source === "fee" || b.source === "mp",
  );
  const maintBreakdown = breakdown.filter((b) => b.source === "maintenance");
  const extraBreakdown = breakdown.filter((b) => b.source === "extra");
  const subBreakdown = breakdown.filter((b) => b.source === "subscription");

  const bags: Array<{
    id: Source;
    title: string;
    hint: string;
    total: number;
    pending: number;
    count: number;
    countLabel: string;
    items: Item[];
    empty: string;
    held?: number;
    heldCount?: number;
  }> = [
    {
      id: "fee",
      title: "Fee MP",
      hint: `solo ya liberado (${FEE_RELEASE_DAYS} días)`,
      total: totalFee,
      pending: feePending,
      count: paymentsCount,
      countLabel: "pagos liberados",
      items: feeItems,
      empty: "No hay fee liberado en este período.",
      held: totalFeeHeld,
      heldCount,
    },
    {
      id: "maintenance",
      title: "Mantenimientos",
      hint: "% default de socios",
      total: totalMaintenance,
      pending: maintPending,
      count: maintenanceCount,
      countLabel: "cobros",
      items: maintenanceItems,
      empty: "No hay mantenimientos cobrados en este período.",
    },
    {
      id: "subscription",
      title: "Suscripciones",
      hint: "neto después de comisión MP",
      total: totalSubscription,
      pending: subPending,
      count: subscriptionCount,
      countLabel: subscriptionCount === 1 ? "cobro" : "cobros",
      items: subscriptionItems,
      empty: "No hay suscripciones cobradas en este período.",
    },
    {
      id: "extra",
      title: "Otros cobros",
      hint: "% default de socios",
      total: totalExtra,
      pending: extraPending,
      count: extraCount,
      countLabel: extraCount === 1 ? "cobro" : "cobros",
      items: extraItems,
      empty: "No hay cobros extra en este período.",
    },
  ];
  const visiblePayouts = payouts.filter((p) => {
    if (payoutPartner && p.partner_name !== payoutPartner) return false;
    if (payoutSource && parsePayoutSource(p.source) !== payoutSource) return false;
    return true;
  });
  const payoutSum = visiblePayouts.reduce((a, p) => a + Number(p.amount || 0), 0);

  const current = bags.find((b) => b.id === bag) || bags[0];
  const currentBreakdown =
    bag === "maintenance"
      ? maintBreakdown
      : bag === "extra"
        ? extraBreakdown
        : bag === "subscription"
          ? subBreakdown
          : feeBreakdown;

  const exportCsv = () => exportLiquidacionCsv({
    from, to, totalFee, paymentsCount, totalMaintenance, maintenanceCount,
    totalExtra, extraCount, totalSubscription, subscriptionCount,
    feeItems, maintenanceItems, extraItems, subscriptionItems, breakdown,
  });

  return (
    <div>
      <div className="row page-head">
        <div>
          <h1 className="page-title">Liquidación</h1>
          <p className="page-sub">
            Elegí una bolsa, mirá cuánto le toca a cada socio y marcá lo
            transferido. El fee MP solo se puede liquidar cuando ya se liberó
            ({FEE_RELEASE_DAYS} días).
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn line sm" onClick={exportCsv}>
            <Download size={14} />
            CSV
          </button>
          <Link className="btn line sm" href="/socios">
            <Percent size={14} />
            Porcentajes
          </Link>
        </div>
      </div>

      <div className="period-tabs" style={{ marginBottom: "0.75rem" }}>
        <button
          type="button"
          className="period-tab"
          onClick={() => {
            const t = arDay();
            const ym = t.slice(0, 7);
            const [y, m] = ym.split("-").map(Number);
            const last = new Date(y, m, 0).getDate();
            setFrom(`${ym}-01`);
            setTo(`${ym}-${String(last).padStart(2, "0")}`);
          }}
        >
          Este mes
        </button>
        <button
          type="button"
          className="period-tab"
          onClick={() => {
            const t = arDay();
            setFrom(`${t.slice(0, 4)}-01-01`);
            setTo(t);
          }}
        >
          Este año
        </button>
      </div>
      <div className="filters filters-dates">
        <div className="field" style={{ margin: 0 }}>
          <label>Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="actions filter-actions">
          <button
            type="button"
            className="btn sm line"
            onClick={() => setFrom(`${arDay().slice(0, 4)}-01-01`)}
          >
            Inicio del año
          </button>
          <button type="button" className="btn sm" onClick={() => setTo(arDay())}>
            Hasta hoy
          </button>
        </div>
      </div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Total por socio</h2>
        <p className="meta" style={{ marginTop: 0 }}>
          Suma de las cuatro bolsas en este período.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Socio</th>
                <th>Corresponde</th>
                <th>Transferido</th>
                <th>Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const rows = [feeItems, maintenanceItems, subscriptionItems, extraItems];
                const share = rows.reduce(
                  (a, list) => a + (list.find((i) => i.partner_id === p.id)?.share || 0),
                  0,
                );
                const paid = rows.reduce(
                  (a, list) => a + (list.find((i) => i.partner_id === p.id)?.paid || 0),
                  0,
                );
                const pend = rows.reduce(
                  (a, list) => a + (list.find((i) => i.partner_id === p.id)?.pending || 0),
                  0,
                );
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td className="mono">{money(share)}</td>
                    <td className="mono">{money(paid)}</td>
                    <td className="mono" style={{ fontWeight: 700, color: pend ? "var(--pending)" : "var(--ok)" }}>
                      {money(pend)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="row card-head" style={{ marginBottom: "0.5rem" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
              Caja de socios{caja?.partner_name ? ` · ${caja.partner_name}` : ""}
            </h2>
            <p className="meta" style={{ margin: "0.2rem 0 0" }}>
              {caja?.partner_name
                ? `${caja.partner_name} es la caja: lo transferido a este socio menos los gastos.`
                : "Transferido − gastos en este período. Marcá cuál socio es la caja en Porcentajes."}
            </p>
          </div>
          <Link className="btn line sm" href="/gastos">
            <Wallet size={14} />
            Ver gastos
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
              {money(caja?.period.transferred || 0)}
            </div>
            <div className="meta">
              Transferido{caja?.partner_name ? ` · ${caja.partner_name}` : ""}{" "}
              (período)
            </div>
          </div>
          <div>
            <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {money(caja?.period.expenses || 0)}
            </div>
            <div className="meta">
              Gastos (período) · {caja?.expenseCount || 0}
            </div>
          </div>
          <div>
            <div
              className="n"
              style={{
                fontSize: "1.15rem",
                fontWeight: 700,
                color:
                  (caja?.period.saldo || 0) < 0 ? "var(--danger)" : "var(--ok)",
              }}
            >
              {money(caja?.period.saldo || 0)}
            </div>
            <div className="meta">Saldo del período</div>
          </div>
          <div>
            <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {money(caja?.allTime.saldo || 0)}
            </div>
            <div className="meta">Ahorro acumulado (transf. − gastos)</div>
          </div>
        </div>
        {caja?.expenseCount ? (
          <>
            <div
              className="actions"
              style={{ marginTop: "0.9rem", gap: "0.45rem" }}
            >
              {caja.expensesByCategory.map((c) => (
                <span key={c.category} className="pill">
                  {expenseCategoryLabel(c.category)} · {money(c.amount)}
                </span>
              ))}
            </div>
            {caja.expensesByPartner.some((p) => p.partner_id) ? (
              <div
                className="actions"
                style={{ marginTop: "0.55rem", gap: "0.45rem" }}
              >
                {caja.expensesByPartner.map((p) => (
                  <span key={p.partner_id || "caja"} className="pill">
                    {p.partner_name} · {money(p.amount)}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="meta" style={{ margin: "0.85rem 0 0" }}>
            Sin gastos registrados en este período.
          </p>
        )}
      </div>

      <div className="split-work">
      <div className="liq-bags" role="tablist" aria-label="Bolsa a liquidar">
        {bags.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={bag === b.id}
            className={`liq-bag${bag === b.id ? " active" : ""}`}
            onClick={() => setBag(b.id)}
          >
            <div className="t">{b.title}</div>
            <div className="n">
              {b.id === "subscription" ? money2(b.total) : money(b.total)}
            </div>
            <div
              className="meta"
              style={{
                color: b.pending ? "var(--pending)" : "var(--ok)",
                fontWeight: 600,
              }}
            >
              {b.pending
                ? `Pendiente ${b.id === "subscription" ? money2(b.pending) : money(b.pending)}`
                : "Nada pendiente"}
            </div>
            <div className="meta">
              {b.count} {b.countLabel}
            </div>
            {b.id === "fee" && (b.held || 0) > 0 ? (
              <div className="meta" style={{ color: "var(--muted)", fontWeight: 500 }}>
                Retenido {money(b.held || 0)} · no se transfiere
              </div>
            ) : null}
          </button>
        ))}
      </div>

      {loading ? <p className="meta">Cargando…</p> : null}

      <div className="card" style={{ marginBottom: "1.15rem" }}>
        <div className="liq-section-head">
          <div>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{current.title}</h2>
            <p className="meta" style={{ margin: "0.2rem 0 0" }}>
              {bag === "fee"
                ? `Solo fee liberado hasta el ${releasedUntil ? formatArDay(releasedUntil) : "—"}. Transferí a cada socio lo pendiente.${
                    totalFeeHeld
                      ? ` MP todavía retiene ${money(totalFeeHeld)} (${heldCount} pago${heldCount === 1 ? "" : "s"}).`
                      : ""
                  }`
                : `${current.hint}. Transferí a cada socio lo pendiente.`}
            </p>
          </div>
        </div>

        {bag === "extra" ? (
          <div
            style={{
              marginBottom: "1.1rem",
              paddingBottom: "1.1rem",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <button type="button" className="btn sm" onClick={() => setExtraOpen(true)}>
              <Plus size={14} /> Registrar cobro
            </button>
            {extraOpen ? (
            <div className="modal-backdrop" role="presentation" onClick={() => !extraSaving && setExtraOpen(false)}>
            <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Registrar cobro extra</h3>
            <div className="liq-extra-form">
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Empresa / persona</label>
                <input
                  value={extraName}
                  onChange={(e) => setExtraName(e.target.value)}
                  placeholder="Ej: Estudio López"
                />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Monto ($)</label>
                <input
                  type="number"
                  min={1}
                  value={extraAmount}
                  onChange={(e) => setExtraAmount(e.target.value)}
                  placeholder="100000"
                />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Fecha</label>
                <input
                  type="date"
                  value={extraDate}
                  onChange={(e) => setExtraDate(e.target.value)}
                />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Notas</label>
                <input
                  value={extraNotes}
                  onChange={(e) => setExtraNotes(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <button
                className="btn"
                type="button"
                disabled={extraSaving}
                onClick={addExtra}
                style={{ justifySelf: "start", whiteSpace: "nowrap" }}
              >
                <Plus size={16} /> Agregar
              </button>
            </div>
            </div>
            </div>
            ) : null}
            {extraPayments.length ? (
              <>
                <div className="liq-mobile-only" style={{ marginTop: "0.9rem" }}>
                  {extraPayments.map((e) => (
                    <div key={e.id} className="liq-row-card">
                      <div className="liq-extra-card-row">
                        <div style={{ minWidth: 0 }}>
                          <strong>{e.payer_name}</strong>
                          <div className="meta">
                            {new Date(e.paid_at).toLocaleDateString("es-AR", {
                              timeZone: "America/Argentina/Buenos_Aires",
                            })}
                          </div>
                          {e.notes ? <div className="meta">{e.notes}</div> : null}
                        </div>
                        <span className="amount mono">{money(e.amount)}</span>
                      </div>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => deleteExtra(e)}
                        title="Anular"
                        aria-label="Anular cobro extra"
                        style={{ width: "100%", marginTop: "0.55rem" }}
                      >
                        <Trash2 size={14} /> Anular
                      </button>
                    </div>
                  ))}
                </div>
                <div className="table-wrap liq-desktop-only" style={{ marginTop: "0.9rem" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Quién pagó</th>
                        <th style={{ width: 120 }}>Monto</th>
                        <th style={{ width: 140 }}>Fecha</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {extraPayments.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.payer_name}</strong>
                            {e.notes ? (
                              <div className="meta">{e.notes}</div>
                            ) : null}
                          </td>
                          <td className="mono" style={{ whiteSpace: "nowrap" }}>
                            {money(e.amount)}
                          </td>
                          <td className="meta" style={{ whiteSpace: "nowrap" }}>
                            {new Date(e.paid_at).toLocaleDateString("es-AR", {
                              timeZone: "America/Argentina/Buenos_Aires",
                            })}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={() => deleteExtra(e)}
                              title="Anular"
                              aria-label="Anular cobro extra"
                              style={{ width: 34, height: 34, padding: 0 }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {!current.items.some((i) => i.share > 0 || i.paid > 0) ? (
          <p className="meta" style={{ margin: 0 }}>
            {current.empty}
          </p>
        ) : (
          <>
            <div className="liq-mobile-only">
              {current.items.map((item) => (
                <div
                  key={`${item.source}-${item.partner_id}-m`}
                  className="liq-row-card"
                >
                  <div className="liq-row-card-head">
                    <strong>{item.partner_name}</strong>
                    <span className="meta">{item.pct}%</span>
                  </div>
                  <div className="liq-row-card-grid">
                    <div>
                      <span className="lbl">Corresponde</span>
                      <span className="val mono">{money(item.share)}</span>
                    </div>
                    <div>
                      <span className="lbl">Transferido</span>
                      <span className="val mono">{money(item.paid)}</span>
                    </div>
                    <div>
                      <span className="lbl">Pendiente</span>
                      <span
                        className="val mono"
                        style={{
                          fontWeight: 700,
                          color: item.pending ? "var(--pending)" : "var(--ok)",
                        }}
                      >
                        {money(item.pending)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={item.pending <= 0}
                    onClick={() => openPayModal(item)}
                    style={{ width: "100%" }}
                  >
                    Transferir
                  </button>
                </div>
              ))}
            </div>
            <div className="table-wrap liq-desktop-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Socio</th>
                    <th>Corresponde</th>
                    <th>Transferido</th>
                    <th>Pendiente</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {current.items.map((item) => (
                    <tr key={`${item.source}-${item.partner_id}`}>
                      <td>
                        <strong>{item.partner_name}</strong>
                        <div className="meta">{item.pct}%</div>
                      </td>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>
                        {money(item.share)}
                      </td>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>
                        {money(item.paid)}
                      </td>
                      <td
                        className="mono"
                        style={{
                          whiteSpace: "nowrap",
                          fontWeight: 700,
                          color: item.pending ? "var(--pending)" : "var(--ok)",
                        }}
                      >
                        {money(item.pending)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm"
                          disabled={item.pending <= 0}
                          onClick={() => openPayModal(item)}
                        >
                          Transferir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <BreakdownTable
          rows={currentBreakdown}
          amountLabel={bag === "fee"
            ? "Fee"
            : bag === "maintenance"
              ? "Mant."
              : bag === "subscription"
                ? "Suscrip."
                : "Monto"}
          title={bag === "fee"
            ? "Origen por cliente"
            : bag === "maintenance"
              ? "Origen por mantenimiento"
              : bag === "subscription"
                ? "Origen por cliente"
                : "Origen de cada cobro"}
          partners={partners}
        />
      </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
          Transferencias
        </h2>
        <p className="meta" style={{ marginTop: 0 }}>
          Historial de lo marcado como transferido. {visiblePayouts.length ? `Total ${money(payoutSum)}.` : ""}
        </p>
        <div className="filters filters-dates">
          <div className="field" style={{ margin: 0 }}>
            <label>Socio</label>
            <select value={payoutPartner} onChange={(e) => setPayoutPartner(e.target.value)}>
              <option value="">Todos</option>
              {partners.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Tipo</label>
            <select value={payoutSource} onChange={(e) => setPayoutSourceFilter(e.target.value)}>
              <option value="">Todos</option>
              <option value="fee">Fee</option>
              <option value="subscription">Suscripciones</option>
              <option value="maintenance">Mantenimientos</option>
              <option value="extra">Otros cobros</option>
            </select>
          </div>
        </div>
        {!visiblePayouts.length ? (
          <p className="meta">Todavía no marcaste ninguna.</p>
        ) : (
          <>
            <div className="liq-mobile-only">
              {visiblePayouts.map((p) => {
                const src = parsePayoutSource(p.source);
                return (
                  <div key={p.id} className="liq-row-card liq-payout-card">
                    <div className="liq-payout-card-top">
                      <div style={{ minWidth: 0 }}>
                        <strong>{p.partner_name}</strong>
                        <div className="meta">
                          {new Date(p.paid_at).toLocaleDateString("es-AR", {
                            timeZone: "America/Argentina/Buenos_Aires",
                          })}
                        </div>
                      </div>
                      <span className="amount">{money(p.amount)}</span>
                    </div>
                    <div className="liq-payout-actions">
                      <select
                        className="mono"
                        value={src}
                        onChange={(e) =>
                          setPayoutSource(p, parsePayoutSource(e.target.value))
                        }
                        aria-label="Tipo de transferencia"
                      >
                        <option value="fee">Fee</option>
                        <option value="subscription">Suscrip.</option>
                        <option value="maintenance">Mant.</option>
                        <option value="extra">Extra</option>
                      </select>
                      <button
                        type="button"
                        className="btn sm line icon-only"
                        onClick={() => undo(p.id)}
                        title="Anular"
                        aria-label="Anular transferencia"
                      >
                        <Undo2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="table-wrap liq-desktop-only">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Socio</th>
                    <th>Monto</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePayouts.map((p) => {
                    const src = parsePayoutSource(p.source);
                    return (
                      <tr key={p.id}>
                        <td>
                          {new Date(p.paid_at).toLocaleDateString("es-AR")}
                          <div className="meta">
                            {String(p.period_from).slice(0, 10)} → {String(p.period_to).slice(0, 10)}
                          </div>
                        </td>
                        <td>
                          <select
                            className="mono"
                            value={src}
                            onChange={(e) =>
                              setPayoutSource(
                                p,
                                parsePayoutSource(e.target.value),
                              )
                            }
                            style={{
                              padding: "0.35rem 0.5rem",
                              borderRadius: 8,
                              border: "1px solid var(--line)",
                              background: "var(--card)",
                              color: "var(--text)",
                            }}
                            aria-label="Tipo de transferencia"
                          >
                            <option value="fee">Fee</option>
                            <option value="subscription">Suscrip.</option>
                            <option value="maintenance">Mant.</option>
                            <option value="extra">Extra</option>
                          </select>
                        </td>
                        <td>{p.partner_name}</td>
                        <td>{money(p.amount)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn sm line"
                            onClick={() => undo(p.id)}
                          >
                            Anular
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {payModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !paying && setPayModal(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="pay-modal-title">Transferir a {payModal.partnerName}</h3>
            <p className="meta" style={{ marginTop: 0, marginBottom: "0.9rem" }}>
              {payModal.source === "fee"
                ? `El pendiente de Fee MP es solo lo ya liberado (${FEE_RELEASE_DAYS} días).`
                : "Elegí la bolsa y el monto."}
            </p>

            <div className="field" style={{ marginBottom: "0.85rem" }}>
              <label>Bolsa</label>
              <div className="seg seg-4" role="group" aria-label="Tipo de transferencia">
                <button
                  type="button"
                  className={`seg-btn${payModal.source === "fee" ? " active" : ""}`}
                  disabled={paying || pendingForSource(payModal.partnerId, "fee") <= 0}
                  onClick={() => {
                    const pending = pendingForSource(payModal.partnerId, "fee");
                    setPayModal({
                      ...payModal,
                      source: "fee",
                      amount: String(pending),
                    });
                  }}
                >
                  Fee MP
                  <div className="meta" style={{ fontWeight: 500, marginTop: 2 }}>
                    {money(pendingForSource(payModal.partnerId, "fee"))}
                  </div>
                </button>
                <button
                  type="button"
                  className={`seg-btn${payModal.source === "maintenance" ? " active" : ""}`}
                  disabled={
                    paying ||
                    pendingForSource(payModal.partnerId, "maintenance") <= 0
                  }
                  onClick={() => {
                    const pending = pendingForSource(
                      payModal.partnerId,
                      "maintenance",
                    );
                    setPayModal({
                      ...payModal,
                      source: "maintenance",
                      amount: String(pending),
                    });
                  }}
                >
                  Mant.
                  <div className="meta" style={{ fontWeight: 500, marginTop: 2 }}>
                    {money(pendingForSource(payModal.partnerId, "maintenance"))}
                  </div>
                </button>
                <button
                  type="button"
                  className={`seg-btn${payModal.source === "extra" ? " active" : ""}`}
                  disabled={
                    paying || pendingForSource(payModal.partnerId, "extra") <= 0
                  }
                  onClick={() => {
                    const pending = pendingForSource(payModal.partnerId, "extra");
                    setPayModal({
                      ...payModal,
                      source: "extra",
                      amount: String(pending),
                    });
                  }}
                >
                  Extra
                  <div className="meta" style={{ fontWeight: 500, marginTop: 2 }}>
                    {money(pendingForSource(payModal.partnerId, "extra"))}
                  </div>
                </button>
                <button
                  type="button"
                  className={`seg-btn${payModal.source === "subscription" ? " active" : ""}`}
                  disabled={
                    paying ||
                    pendingForSource(payModal.partnerId, "subscription") <= 0
                  }
                  onClick={() => {
                    const pending = pendingForSource(
                      payModal.partnerId,
                      "subscription",
                    );
                    setPayModal({
                      ...payModal,
                      source: "subscription",
                      amount: String(pending),
                    });
                  }}
                >
                  Suscrip.
                  <div className="meta" style={{ fontWeight: 500, marginTop: 2 }}>
                    {money(pendingForSource(payModal.partnerId, "subscription"))}
                  </div>
                </button>
              </div>
            </div>

            <div className="field" style={{ marginBottom: "1rem" }}>
              <label>
                Monto · pendiente{" "}
                {money(pendingForSource(payModal.partnerId, payModal.source))}
              </label>
              <input
                type="number"
                min={1}
                max={pendingForSource(payModal.partnerId, payModal.source)}
                value={payModal.amount}
                disabled={paying}
                autoFocus
                onChange={(e) =>
                  setPayModal({ ...payModal, amount: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmPay();
                  if (e.key === "Escape") setPayModal(null);
                }}
              />
            </div>

            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn line"
                disabled={paying}
                onClick={() => setPayModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                disabled={paying}
                onClick={confirmPay}
              >
                {paying ? "Guardando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
