import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useToast } from "@/software/compat";
import { addMonthsYm, money, yearMonth } from "@/software/lib/money";
import { swFetch } from "@/software/compat";

type ClientRow = {
  id: string;
  name: string;
  monthly_amount: number;
  notes: string;
  payment_id: string | null;
  paid_amount: number | null;
  paid_at: string | null;
  paid_months?: string[];
  prepaid_until?: string | null;
};

type Recent = {
  id: string;
  year_month: string;
  amount: number;
  paid_at: string;
  client_name: string;
  client_id: string;
  notes?: string;
};

function labelYm(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const txt = new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-AR", {
    month: "short",
    year: "numeric",
  });
  return txt.replace(".", "");
}

export default function MantenimientosPage() {
  const showToast = useToast();
  const [month, setMonth] = useState(yearMonth());
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [collectedInMonth, setCollectedInMonth] = useState(0);
  const [collectedCount, setCollectedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [payClient, setPayClient] = useState<ClientRow | null>(null);
  const [payMonths, setPayMonths] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const [focus, setFocus] = useState<"all" | "pending" | "paid">("all");
  const [list, setList] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [payNotes, setPayNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month });
      if (list === "archived") params.set("list", "archived");
      if (q.trim()) params.set("q", q.trim());
      const res = await swFetch(`/api/mantenimientos?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar");
      setClients(data.clients || []);
      setRecent(data.recent || []);
      setCollectedInMonth(Number(data.collected_in_month || 0));
      setCollectedCount(Number(data.collected_count || 0));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error");
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [month, showToast, list, q]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    const monthly = Math.round(Number(amount || 0));
    if (!name.trim() || monthly <= 0) {
      showToast("Completá nombre y monto mensual");
      return;
    }
    setSaving(true);
    try {
      const res = await swFetch("/api/mantenimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          monthly_amount: monthly,
          notes: notes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear");
      showToast("Cliente de mantenimiento agregado ✓");
      setName("");
      setAmount("");
      setNotes("");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const openPay = (c: ClientRow, count = 1) => {
    setPayClient(c);
    const already = new Set(c.paid_months || []);
    const pick: string[] = [];
    let i = 0;
    while (pick.length < count && i < 24) {
      const ym = addMonthsYm(month, i);
      i += 1;
      if (already.has(ym)) continue;
      pick.push(ym);
    }
    setPayMonths(pick);
  };

  const togglePayMonth = (ym: string, locked: boolean) => {
    if (locked) return;
    setPayMonths((prev) =>
      prev.includes(ym) ? prev.filter((m) => m !== ym) : [...prev, ym].sort(),
    );
  };

  const setPayCount = (n: number) => {
    if (!payClient) return;
    openPay(payClient, n);
  };

  const confirmPay = async () => {
    if (!payClient) return;
    const already = new Set(payClient.paid_months || []);
    const months = payMonths.filter((ym) => !already.has(ym));
    if (!months.length) {
      showToast("Elegí al menos un mes libre");
      return;
    }
    const total = Math.round(payClient.monthly_amount) * months.length;
    setPaying(true);
    try {
      const res = await swFetch("/api/mantenimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_paid",
          id: payClient.id,
          year_months: months,
          notes: payNotes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) showToast(data.error || "Error");
      else {
        showToast(
          months.length > 1
            ? `Adelantado ${months.length} meses · ${money(total)} ✓`
            : "Cobro registrado · ya entra a liquidación ✓",
        );
        setPayClient(null);
        setPayNotes("");
        load();
      }
    } finally {
      setPaying(false);
    }
  };

  const unmark = async (c: ClientRow) => {
    if (!c.payment_id) return;
    if (!confirm(`¿Anular el cobro de ${c.name} en ${month}?`)) return;
    const res = await swFetch("/api/mantenimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "unmark_paid",
        id: c.id,
        year_month: month,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || "Error");
      return;
    }
    showToast("Cobro anulado");
    load();
  };

  const startEdit = (c: ClientRow) => {
    setEditing(c.id);
    setEditName(c.name);
    setEditAmount(String(Math.round(c.monthly_amount)));
    setEditNotes(c.notes || "");
  };

  const saveEdit = async (id: string) => {
    const monthly = Math.round(Number(editAmount || 0));
    if (!editName.trim() || monthly <= 0) {
      showToast("Nombre y monto inválidos");
      return;
    }
    const res = await swFetch("/api/mantenimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        id,
        name: editName.trim(),
        monthly_amount: monthly,
        notes: editNotes.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) showToast(data.error || "Error");
    else {
      showToast("Guardado ✓");
      setEditing(null);
      load();
    }
  };

  const archive = async (c: ClientRow) => {
    if (!confirm(`¿Archivar ${c.name}? Deja de aparecer en la lista.`)) return;
    const res = await swFetch("/api/mantenimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deactivate", id: c.id }),
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || "Error");
      return;
    }
    showToast("Archivado");
    load();
  };

  const restore = async (c: ClientRow) => {
    const res = await swFetch("/api/mantenimientos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reactivate", id: c.id }),
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || "Error");
      return;
    }
    showToast("Restaurado");
    load();
  };

  const pending = clients.filter((c) => !c.payment_id);
  const paid = clients.filter((c) => c.payment_id);
  const recurring = clients.reduce((a, c) => a + Number(c.monthly_amount || 0), 0);
  const pendingTotal = pending.reduce((a, c) => a + Number(c.monthly_amount || 0), 0);
  const paidTotal = paid.reduce(
    (a, c) => a + Number(c.paid_amount || c.monthly_amount || 0),
    0,
  );
  const visible =
    focus === "pending" ? pending : focus === "paid" ? paid : clients;

  return (
    <div>
      <div className="row page-head">
        <div>
          <h1 className="page-title">Mantenimientos</h1>
          <p className="page-sub">
            Abonos mensuales. Marcá cobrado o adelantá meses: la plata suma en
            el mes en que ingresó.
          </p>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 160 }}>
          <label>Mes</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </div>

      <div className="split-work">
      <div className="liq-bags" role="tablist" aria-label="Resumen del mes">
        <button
          type="button"
          className={`liq-bag${focus === "all" ? " active" : ""}`}
          onClick={() => setFocus("all")}
        >
          <div className="t">Ingresado</div>
          <div className="n">{money(collectedInMonth)}</div>
          <div className="meta">{collectedCount} cobros en {labelYm(month)}</div>
        </button>
        <button
          type="button"
          className={`liq-bag${focus === "pending" ? " active" : ""}`}
          onClick={() => setFocus(focus === "pending" ? "all" : "pending")}
        >
          <div className="t">Pendientes</div>
          <div
            className="n"
            style={{ color: pendingTotal ? "var(--pending)" : "var(--ok)" }}
          >
            {money(pendingTotal)}
          </div>
          <div className="meta">{pending.length} clientes este mes</div>
        </button>
        <button
          type="button"
          className={`liq-bag${focus === "paid" ? " active" : ""}`}
          onClick={() => setFocus(focus === "paid" ? "all" : "paid")}
        >
          <div className="t">Cubiertos</div>
          <div className="n">{money(paidTotal)}</div>
          <div className="meta">{paid.length} ya cobrados / adelantados</div>
        </button>
        <div className="liq-bag">
          <div className="t">Abono mensual</div>
          <div className="n">{money(recurring)}</div>
          <div className="meta">Suma de esta lista</div>
        </div>
      </div>

      <div className="tabs-line">
        <button type="button" className={`btn sm ${list === "active" ? "" : "line"}`} onClick={() => setList("active")}>
          Activos
        </button>
        <button type="button" className={`btn sm ${list === "archived" ? "" : "line"}`} onClick={() => setList("archived")}>
          Archivados
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente…"
          style={{
            flex: 1,
            minWidth: 160,
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            padding: "0.45rem 0.7rem",
            background: "var(--input-bg)",
            color: "var(--ink)",
          }}
        />
      </div>

      <div className="card">
        <div className="liq-section-head">
          <div>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
              {focus === "pending"
                ? "Pendientes"
                : focus === "paid"
                  ? "Cubiertos"
                  : "Clientes"}
            </h2>
            <p className="meta" style={{ margin: "0.2rem 0 0" }}>
              {labelYm(month)} · tocá Pendientes o Cubiertos arriba para filtrar.
            </p>
          </div>
        </div>

        {list === "active" ? (
          <button type="button" className="btn sm" style={{ marginBottom: "0.85rem" }} onClick={() => setCreating((v) => !v)}>
            <Plus size={14} /> {creating ? "Cerrar alta" : "Nuevo cliente"}
          </button>
        ) : null}
        {creating && list === "active" ? (
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            alignItems: "end",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            marginBottom: "1.1rem",
            paddingBottom: "1.1rem",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div className="field" style={{ margin: 0, minWidth: 0 }}>
            <label>Nuevo cliente</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Panadería X"
            />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 0, maxWidth: 180 }}>
            <label>Mensual ($)</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="30000"
            />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 0 }}>
            <label>Notas</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <button
            className="btn"
            type="button"
            disabled={saving}
            onClick={create}
            style={{ justifySelf: "start", whiteSpace: "nowrap" }}
          >
            <Plus size={16} /> Agregar
          </button>
        </div>
        ) : null}
        {loading ? (
          <p className="meta">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="meta">
            {clients.length === 0
              ? "Todavía no hay clientes de mantenimiento."
              : focus === "pending"
                ? "Nadie pendiente este mes."
                : "Nadie cubierto este mes."}
          </p>
        ) : (
          <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th style={{ width: 120 }}>Mensual</th>
                <th style={{ width: 170 }}>Estado</th>
                <th style={{ width: 280 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td>
                    {editing === c.id ? (
                      <div style={{ display: "grid", gap: 8, maxWidth: 280 }}>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                        <input
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="Notas"
                        />
                      </div>
                    ) : (
                      <>
                        <strong>{c.name}</strong>
                        {c.notes ? <div className="meta">{c.notes}</div> : null}
                      </>
                    )}
                  </td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    {editing === c.id ? (
                      <input
                        type="number"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        style={{ width: 110 }}
                      />
                    ) : (
                      money(c.monthly_amount)
                    )}
                  </td>
                  <td>
                    {c.payment_id ? (
                      <span className="pill ok">
                        {c.paid_at &&
                        yearMonth(new Date(c.paid_at)) !== month
                          ? `Adelantado · ${money(c.paid_amount || 0)}`
                          : `Cobrado · ${money(c.paid_amount || 0)}`}
                      </span>
                    ) : (
                      <span className="pill pending">Pendiente</span>
                    )}
                    {c.prepaid_until ? (
                      <div className="meta" style={{ marginTop: 4 }}>
                        Cubierto hasta {labelYm(c.prepaid_until)}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div
                      className="actions"
                      style={{
                        flexWrap: "nowrap",
                        gap: "0.45rem",
                        alignItems: "center",
                      }}
                    >
                      {editing === c.id ? (
                        <>
                          <button
                            className="btn sm"
                            type="button"
                            onClick={() => saveEdit(c.id)}
                          >
                            Guardar
                          </button>
                          <button
                            className="btn line sm"
                            type="button"
                            onClick={() => setEditing(null)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          {c.payment_id ? (
                            <button
                              className="btn line sm"
                              type="button"
                              onClick={() => unmark(c)}
                              title="Anular cobro del mes"
                            >
                              <RotateCcw size={14} /> Anular
                            </button>
                          ) : null}
                          <button
                            className="btn sm"
                            type="button"
                            onClick={() => openPay(c, c.payment_id ? 3 : 1)}
                          >
                            <Check size={14} />{" "}
                            {c.payment_id ? "Adelantar" : "Marcar cobrado"}
                          </button>
                          <button
                            className="btn line sm"
                            type="button"
                            onClick={() => startEdit(c)}
                            title="Editar"
                            aria-label="Editar"
                            style={{
                              width: 34,
                              height: 34,
                              padding: 0,
                              flex: "0 0 auto",
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          {list === "archived" ? (
                            <button className="btn sm" type="button" onClick={() => restore(c)}>
                              Restaurar
                            </button>
                          ) : (
                            <button
                              className="btn danger sm"
                              type="button"
                              onClick={() => archive(c)}
                              title="Archivar"
                              aria-label="Archivar"
                              style={{
                                width: 34,
                                height: 34,
                                padding: 0,
                                flex: "0 0 auto",
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      </div>

      {recent.length > 0 ? (
        <div className="card" style={{ marginTop: "1.15rem" }}>
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Últimos cobros</h2>
          <p className="meta" style={{ marginTop: 0 }}>
            Cada fila es un mes cubierto. Si fue adelantado, la fecha es cuando
            ingresó la plata.
          </p>
          <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th style={{ width: 110 }}>Mes</th>
                <th style={{ width: 120 }}>Monto</th>
                <th style={{ width: 180 }}>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.client_name}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    {r.year_month}
                    {r.notes ? (
                      <div className="meta">{r.notes}</div>
                    ) : null}
                  </td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    {money(r.amount)}
                  </td>
                  <td className="meta" style={{ whiteSpace: "nowrap" }}>
                    {r.paid_at
                      ? new Date(r.paid_at).toLocaleString("es-AR", {
                          timeZone: "America/Argentina/Buenos_Aires",
                        })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      {payClient ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !paying && setPayClient(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="maint-pay-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="maint-pay-title">Cobrar {payClient.name}</h3>
            <p className="meta" style={{ marginTop: 0, marginBottom: "0.85rem" }}>
              {money(payClient.monthly_amount)} / mes. Elegí qué meses cubre este
              pago: la plata cuenta como ingresada ahora.
            </p>
            <div className="actions" style={{ marginBottom: "0.75rem" }}>
              <button
                type="button"
                className="btn sm line"
                disabled={paying}
                onClick={() => setPayCount(1)}
              >
                Este mes
              </button>
              <button
                type="button"
                className="btn sm line"
                disabled={paying}
                onClick={() => setPayCount(3)}
              >
                3 meses
              </button>
              <button
                type="button"
                className="btn sm line"
                disabled={paying}
                onClick={() => setPayCount(6)}
              >
                6 meses
              </button>
            </div>
            <div className="month-grid">
              {Array.from({ length: 12 }, (_, i) => addMonthsYm(month, i)).map(
                (ym) => {
                  const locked = (payClient.paid_months || []).includes(ym);
                  const on = locked || payMonths.includes(ym);
                  return (
                    <button
                      key={ym}
                      type="button"
                      className={`month-chip${on ? " active" : ""}`}
                      disabled={paying || locked}
                      onClick={() => togglePayMonth(ym, locked)}
                    >
                      {labelYm(ym)}
                      {locked ? (
                        <span className="meta">ya</span>
                      ) : null}
                    </button>
                  );
                },
              )}
            </div>
            <div className="field" style={{ marginTop: "0.85rem" }}>
              <label>Notas del cobro</label>
              <input
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <p className="meta" style={{ margin: "0.85rem 0 1rem" }}>
              {(() => {
                const already = new Set(payClient.paid_months || []);
                const n = payMonths.filter((ym) => !already.has(ym)).length;
                return n
                  ? `${n} mes${n === 1 ? "" : "es"} · ${money(payClient.monthly_amount * n)}`
                  : "Elegí al menos un mes libre";
              })()}
            </p>
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn line"
                disabled={paying}
                onClick={() => setPayClient(null)}
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
