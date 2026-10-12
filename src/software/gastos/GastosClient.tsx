import Link from "@/software/compat";
import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Download, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useToast } from "@/software/compat";
import { arDay, money } from "@/software/lib/money";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/software/lib/expense-category";
import { exportGastosCsv } from "./export-csv";
import type { Expense, ExpenseTotals, GastoPartner } from "./types";
import { swFetch } from "@/software/compat";

const EMPTY_TOTALS: ExpenseTotals = {
  total: 0,
  count: 0,
  byCategory: [],
  byPartner: [],
};

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function dayInput(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

const EMPTY_FORM = {
  description: "",
  amount: "",
  category: "otros",
  partnerId: "",
  date: "",
  notes: "",
};

export function GastosClient() {
  const showToast = useToast();
  const today = arDay();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [items, setItems] = useState<Expense[]>([]);
  const [totals, setTotals] = useState<ExpenseTotals>(EMPTY_TOTALS);
  const [partners, setPartners] = useState<GastoPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [cajaTransferred, setCajaTransferred] = useState(0);

  const caja = partners.find((p) => p.is_cash) || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await swFetch(`/api/gastos?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar");
      setItems(data.items || []);
      setTotals(data.totals || EMPTY_TOTALS);
      setPartners(data.partners || []);
      setCajaTransferred(Number(data.caja?.transferred || 0));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error");
      setItems([]);
      setTotals(EMPTY_TOTALS);
    } finally {
      setLoading(false);
    }
  }, [from, to, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, date: to || today, partnerId: caja ? caja.id : "" });
    setOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditingId(e.id);
    setForm({
      description: e.description,
      amount: String(Math.round(e.amount)),
      category: e.category || "otros",
      partnerId: e.partner_id || (caja ? caja.id : ""),
      date: dayInput(e.paid_at),
      notes: e.notes || "",
    });
    setOpen(true);
  };

  const save = async () => {
    const description = form.description.trim();
    const amount = Math.round(
      Number(String(form.amount).replace(/\./g, "").replace(",", ".")),
    );
    if (!description || !Number.isFinite(amount) || amount <= 0) {
      showToast("Descripción y monto son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const res = await swFetch("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: editingId ? "update" : "create",
          id: editingId || undefined,
          description,
          amount,
          category: form.category,
          partner_id: form.partnerId || null,
          notes: form.notes.trim(),
          paid_at: form.date || to,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar");
      showToast(editingId ? "Gasto actualizado ✓" : `Gasto ${money(amount)} ✓`);
      setOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: Expense) => {
    if (!confirm(`¿Anular el gasto "${e.description}"?`)) return;
    const res = await swFetch("/api/gastos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: e.id }),
    });
    const data = await res.json();
    if (!res.ok) showToast(data.error || "Error");
    else {
      showToast("Gasto anulado");
      load();
    }
  };

  const average = totals.count ? Math.round(totals.total / totals.count) : 0;
  const assigned = totals.byPartner
    .filter((p) => p.partner_id)
    .reduce((a, p) => a + Number(p.amount || 0), 0);
  const common = totals.total - assigned;
  const cajaSaldo = cajaTransferred - totals.total;

  return (
    <div>
      <div className="row page-head">
        <div>
          <h1 className="page-title">Gastos</h1>
          <p className="page-sub">
            Egresos que salen de la plata de los socios. Podés dejarlos en la
            caja común o marcar de qué socio salieron (ej. PRODI).
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn line sm"
            onClick={() =>
              exportGastosCsv({ from, to, items, totals })
            }
          >
            <Download size={14} />
            CSV
          </button>
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

      {caja ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="row card-head" style={{ marginBottom: "0.5rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
                Caja · {caja.name}
              </h2>
              <p className="meta" style={{ margin: "0.2rem 0 0" }}>
                Lo transferido a {caja.name} menos los gastos de este período.
              </p>
            </div>
            <Link className="btn line sm" href="/liquidacion">
              <ArrowRightLeft size={14} />
              Ver liquidación
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
                {money(cajaTransferred)}
              </div>
              <div className="meta">Transferido a la caja</div>
            </div>
            <div>
              <div className="n" style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                {money(totals.total)}
              </div>
              <div className="meta">Gastos (período)</div>
            </div>
            <div>
              <div
                className="n"
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: cajaSaldo < 0 ? "var(--danger)" : "var(--ok)",
                }}
              >
                {money(cajaSaldo)}
              </div>
              <div className="meta">Saldo de la caja</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="split-work">
        <div className="liq-bags" role="tablist" aria-label="Resumen de gastos">
          <div className="liq-bag active">
            <div className="t">Total del período</div>
            <div className="n">{money(totals.total)}</div>
            <div className="meta">
              {totals.count} gasto{totals.count === 1 ? "" : "s"}
            </div>
          </div>
          <div className="liq-bag">
            <div className="t">Promedio</div>
            <div className="n">{money(average)}</div>
            <div className="meta">Por gasto</div>
          </div>
          <div className="liq-bag">
            <div className="t">Asignado a socios</div>
            <div className="n">{money(assigned)}</div>
            <div className="meta">Sin socio: {money(common)}</div>
          </div>
          <div className="liq-bag">
            <div className="t">
              <Wallet size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
              Sin socio
            </div>
            <div className="n">{money(common)}</div>
            <div className="meta">Gastos sin socio asignado</div>
          </div>
        </div>

        <div className="card">
          <div className="liq-section-head">
            <div>
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Gastos del período</h2>
              <p className="meta" style={{ margin: "0.2rem 0 0" }}>
                {from} → {to}
              </p>
            </div>
          </div>

          <button type="button" className="btn sm" style={{ marginBottom: "0.85rem" }} onClick={openNew}>
            <Plus size={14} /> Registrar gasto
          </button>

          {loading ? (
            <p className="meta">Cargando…</p>
          ) : !items.length ? (
            <p className="meta" style={{ margin: 0 }}>
              No hay gastos en este período.
            </p>
          ) : (
            <>
              <div className="liq-mobile-only">
                {items.map((e) => (
                  <div key={e.id} className="liq-row-card">
                    <div className="liq-extra-card-row">
                      <div style={{ minWidth: 0 }}>
                        <strong>{e.description}</strong>
                        <div className="meta">
                          {fmtDay(e.paid_at)} · {expenseCategoryLabel(e.category)}
                        </div>
                        <div className="meta">{e.partner_name || "Caja común"}</div>
                        {e.notes ? <div className="meta">{e.notes}</div> : null}
                      </div>
                      <span className="amount mono">{money(e.amount)}</span>
                    </div>
                    <div className="actions" style={{ marginTop: "0.55rem" }}>
                      <button
                        type="button"
                        className="btn sm line"
                        onClick={() => openEdit(e)}
                        style={{ flex: 1 }}
                      >
                        <Pencil size={14} /> Editar
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => remove(e)}
                        style={{ flex: 1 }}
                      >
                        <Trash2 size={14} /> Anular
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="table-wrap liq-desktop-only">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Fecha</th>
                      <th>Descripción</th>
                      <th style={{ width: 130 }}>Categoría</th>
                      <th style={{ width: 150 }}>Socio</th>
                      <th style={{ width: 120 }}>Monto</th>
                      <th style={{ width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((e) => (
                      <tr key={e.id}>
                        <td className="meta" style={{ whiteSpace: "nowrap" }}>
                          {fmtDay(e.paid_at)}
                        </td>
                        <td>
                          <strong>{e.description}</strong>
                          {e.notes ? <div className="meta">{e.notes}</div> : null}
                        </td>
                        <td>
                          <span className="pill">{expenseCategoryLabel(e.category)}</span>
                        </td>
                        <td>{e.partner_name || "Caja común"}</td>
                        <td className="mono" style={{ whiteSpace: "nowrap" }}>
                          {money(e.amount)}
                        </td>
                        <td>
                          <div className="actions" style={{ flexWrap: "nowrap", gap: "0.4rem" }}>
                            <button
                              type="button"
                              className="btn sm line"
                              onClick={() => openEdit(e)}
                              title="Editar"
                              aria-label="Editar gasto"
                              style={{ width: 34, height: 34, padding: 0 }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={() => remove(e)}
                              title="Anular"
                              aria-label="Anular gasto"
                              style={{ width: 34, height: 34, padding: 0 }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="split-master" style={{ marginTop: "1.15rem" }}>
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Por categoría</h2>
          {!totals.byCategory.length ? (
            <p className="meta" style={{ margin: 0 }}>
              Sin datos en este período.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th style={{ width: 100 }}>Cantidad</th>
                    <th style={{ width: 130 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.byCategory.map((c) => (
                    <tr key={c.category}>
                      <td>
                        <span className="pill">{expenseCategoryLabel(c.category)}</span>
                      </td>
                      <td>{c.count}</td>
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

        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Por socio</h2>
          {!totals.byPartner.length ? (
            <p className="meta" style={{ margin: 0 }}>
              Sin datos en este período.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sale de</th>
                    <th style={{ width: 130 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.byPartner.map((p) => (
                    <tr key={p.partner_id || "caja"}>
                      <td>
                        <strong>{p.partner_name}</strong>
                      </td>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>
                        {money(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {open ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gasto-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="gasto-modal-title">
              {editingId ? "Editar gasto" : "Registrar gasto"}
            </h3>
            <div className="liq-extra-form">
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Descripción</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Ej: Sueldo Ana"
                  autoFocus
                />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Monto ($)</label>
                <input
                  type="number"
                  min={1}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="50000"
                />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Categoría</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Sale de</label>
                <select
                  value={form.partnerId}
                  onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
                >
                  {caja ? (
                    <option value={caja.id}>Caja ({caja.name})</option>
                  ) : (
                    <option value="">Caja común</option>
                  )}
                  {partners
                    .filter((p) => !p.is_cash)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Fecha</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 0 }}>
                <label>Notas</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Opcional"
                />
              </div>
            </div>
            <div className="actions" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn line"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button type="button" className="btn" disabled={saving} onClick={save}>
                {saving ? "Guardando…" : editingId ? "Guardar" : "Agregar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
