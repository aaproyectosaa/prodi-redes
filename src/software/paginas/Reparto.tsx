import Link from "@/software/compat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "@/software/compat";
import { Plus, Trash2, ArrowLeft, UsersRound, Percent } from "lucide-react";
import { Suspense } from "react";
import { useToast } from "@/software/compat";
import { money } from "@/software/lib/money";
import { swFetch } from "@/software/compat";

type Partner = { id: string; name: string; pct: number; is_cash?: boolean };
type ClientSplit = {
  client_id: string;
  client_name: string;
  custom: boolean;
  pcts: Array<{ partner_id: string; partner_name: string; pct: number }>;
};

type Tab = "socios" | "clientes";

function SociosInner() {
  const showToast = useToast();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "socios";
  const [tab, setTab] = useState<Tab>(
    initialTab === "clientes" ? "clientes" : "socios",
  );
  const [partners, setPartners] = useState<Partner[]>([]);
  const [clientSplits, setClientSplits] = useState<ClientSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [editClientId, setEditClientId] = useState("");
  const [editPcts, setEditPcts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [calcRaw, setCalcRaw] = useState("");
  const [clientQ, setClientQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await swFetch("/api/partners");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setPartners(data.partners || []);
      setClientSplits(data.clientSplits || []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "clientes" || t === "socios") setTab(t);
  }, [searchParams]);

  const selected = useMemo(
    () => clientSplits.find((c) => c.client_id === editClientId) || null,
    [clientSplits, editClientId],
  );

  useEffect(() => {
    if (!selected) {
      setEditPcts({});
      return;
    }
    const map: Record<string, number> = {};
    for (const p of selected.pcts) map[p.partner_id] = p.pct;
    setEditPcts(map);
  }, [selected]);

  const defaultSum = partners.reduce((a, p) => a + Number(p.pct || 0), 0);
  const clientSum = partners.reduce((a, p) => a + Number(editPcts[p.id] || 0), 0);
  const calcAmount = Math.round(
    Number(String(calcRaw).replace(/\./g, "").replace(",", ".")) || 0,
  );
  const calcRows =
    tab === "clientes" && selected
      ? partners.map((p) => ({
          id: p.id,
          name: p.name,
          pct: Number(editPcts[p.id] || 0),
        }))
      : partners.map((p) => ({
          id: p.id,
          name: p.name,
          pct: Number(p.pct || 0),
        }));
  const calcShares = calcRows.map((p) => ({
    ...p,
    share: Math.round((calcAmount * p.pct) / 100),
  }));
  const calcShareSum = calcShares.reduce((a, r) => a + r.share, 0);
  const calcPctSum = calcRows.reduce((a, r) => a + r.pct, 0);

  const saveDefaults = async () => {
    setSaving(true);
    try {
      const res = await swFetch("/api/partners", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partners }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setPartners(data.partners || partners);
      showToast("Default guardado ✓");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const addPartner = async () => {
    const name = newName.trim();
    if (!name) {
      showToast("Escribí el nombre del socio");
      return;
    }
    setSaving(true);
    try {
      const res = await swFetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pct: 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setNewName("");
      showToast(`${name} agregado ✓ · ajustá su porcentaje`);
      await load();
      document.getElementById("lista-socios")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const removePartner = async (p: Partner) => {
    if (!confirm(`¿Eliminar a ${p.name}?`)) return;
    const res = await swFetch(`/api/partners?id=${p.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) showToast(data.error || "Error");
    else {
      showToast("Eliminado");
      load();
    }
  };

  const saveClientPct = async () => {
    if (!editClientId) {
      showToast("Elegí un cliente");
      return;
    }
    setSaving(true);
    try {
      const pcts = partners.map((p) => ({
        partner_id: p.id,
        pct: Number(editPcts[p.id] || 0),
      }));
      const res = await swFetch("/api/liquidacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_client_pct", client_id: editClientId, pcts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      showToast("Porcentaje del cliente guardado ✓");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const restoreDefault = async () => {
    if (!editClientId) return;
    if (!confirm("¿Este cliente vuelve a usar el porcentaje default?")) return;
    const res = await swFetch("/api/liquidacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_client_pct",
        client_id: editClientId,
        use_default: true,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || "Error");
      return;
    }
    showToast("Usa default otra vez ✓");
    load();
  };

  const goTab = (t: Tab) => {
    setTab(t);
    const url = t === "socios" ? "/socios" : "/socios?tab=clientes";
    window.history.replaceState(null, "", url);
  };

  return (
    <div>
      <div className="row page-head">
        <div>
          <h1 className="page-title">Socios y porcentajes</h1>
          <p className="page-sub">
            Socios, % default, % por cliente y una cuenta rápida del reparto.
          </p>
        </div>
        <Link className="btn line sm" href="/liquidacion">
          <ArrowLeft size={14} />
          Volver a Liquidación
        </Link>
      </div>

      <div className="period-tabs" role="tablist" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className={`period-tab${tab === "socios" ? " active" : ""}`}
          onClick={() => goTab("socios")}
        >
          <UsersRound size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
          1 · Socios
        </button>
        <button
          type="button"
          className={`period-tab${tab === "clientes" ? " active" : ""}`}
          onClick={() => goTab("clientes")}
        >
          <Percent size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
          2 · Por cliente
        </button>
      </div>

      {loading ? <p className="meta">Cargando…</p> : null}

      <div className="socios-layout">
      <div className="socios-main">
      {tab === "socios" ? (
        <>
          <div className="card" id="lista-socios">
            <div className="liq-section-head">
              <div>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Quiénes cobran</h2>
                <p className="meta" style={{ margin: "0.2rem 0 0" }}>
                  Este % vale para mantenimientos, extras, suscripciones y clientes sin % propio.
                  Marcá uno como &quot;es la caja&quot;: ahí se guardan los ahorros (lo transferido)
                  y de ahí salen los gastos.
                </p>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th style={{ width: 130 }}>Porcentaje</th>
                    <th style={{ width: 90 }} title="Dónde se guardan los ahorros y de dónde salen los gastos">
                      Es la caja
                    </th>
                    <th style={{ width: 70 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p, i) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          value={p.name}
                          onChange={(e) => {
                            const next = [...partners];
                            next[i] = { ...p, name: e.target.value };
                            setPartners(next);
                          }}
                          style={{
                            width: "100%",
                            border: "1px solid var(--line)",
                            borderRadius: "var(--radius-sm)",
                            padding: "0.5rem 0.65rem",
                            background: "var(--input-bg)",
                            color: "var(--ink)",
                          }}
                        />
                      </td>
                      <td>
                        <div className="actions" style={{ flexWrap: "nowrap" }}>
                          <input
                            type="number"
                            step="1"
                            min={0}
                            max={100}
                            value={p.pct}
                            onChange={(e) => {
                              const next = [...partners];
                              next[i] = { ...p, pct: Number(e.target.value) };
                              setPartners(next);
                            }}
                            style={{
                              width: 72,
                              border: "1px solid var(--line)",
                              borderRadius: "var(--radius-sm)",
                              padding: "0.5rem 0.55rem",
                              background: "var(--input-bg)",
                              color: "var(--ink)",
                            }}
                          />
                          <span className="meta">%</span>
                        </div>
                        <div className="pct-bar" aria-hidden>
                          <i style={{ width: `${Math.max(0, Math.min(100, Number(p.pct) || 0))}%` }} />
                        </div>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(p.is_cash)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setPartners(
                              partners.map((x) => ({
                                ...x,
                                is_cash: checked ? x.id === p.id : false,
                              })),
                            );
                          }}
                          aria-label={`Marcar ${p.name} como caja`}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm line"
                          onClick={() => removePartner(p)}
                          aria-label={`Eliminar ${p.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn sm"
                onClick={saveDefaults}
                disabled={saving}
              >
                Guardar nombres y porcentajes
              </button>
              <span
                className="meta"
                style={{
                  color:
                    Math.abs(defaultSum - 100) < 0.05
                      ? "var(--ok)"
                      : "var(--pending)",
                }}
              >
                Suma {defaultSum.toFixed(1)}
                {Math.abs(defaultSum - 100) >= 0.05 ? " (ideal 100)" : ""}
              </span>
            </div>

            <div
              className="actions"
              style={{
                marginTop: "1.1rem",
                paddingTop: "1.1rem",
                borderTop: "1px solid var(--line)",
                alignItems: "center",
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Agregar socio… Ej. Ana"
                onKeyDown={(e) => {
                  if (e.key === "Enter") addPartner();
                }}
                style={{
                  flex: 1,
                  minWidth: 160,
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.55rem 0.75rem",
                  background: "var(--input-bg)",
                  color: "var(--ink)",
                }}
              />
              <button
                type="button"
                className="btn sm"
                onClick={addPartner}
                disabled={saving}
              >
                <Plus size={16} />
                Agregar
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {!partners.length ? (
            <div className="card">
              <p className="meta" style={{ marginTop: 0 }}>
                Todavía no hay socios. Primero agregá uno en{" "}
                <button type="button" className="tip-link" onClick={() => goTab("socios")}>
                  1 · Socios
                </button>
                .
              </p>
              <button type="button" className="btn sm" onClick={() => goTab("socios")}>
                Ir a Socios
              </button>
            </div>
          ) : (
            <div className="card">
              <div className="liq-section-head">
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
                    Reparto distinto por cliente
                  </h2>
                  <p className="meta" style={{ margin: "0.2rem 0 0" }}>
                    Si no configurás nada, usa el default. La calculadora de
                    arriba usa el % del cliente elegido.
                  </p>
                </div>
              </div>

              <p className="meta">
                {clientSplits.filter((c) => c.custom).length} con porcentaje propio ·{" "}
                {clientSplits.filter((c) => !c.custom).length} con el default
              </p>
              <div className="field">
                <label>Buscar</label>
                <input
                  value={clientQ}
                  onChange={(e) => setClientQ(e.target.value)}
                  placeholder="Nombre del cliente"
                />
              </div>
              <div className="field">
                <label>Cliente</label>
                <select
                  value={editClientId}
                  onChange={(e) => setEditClientId(e.target.value)}
                >
                  <option value="">Elegí un cliente…</option>
                  {clientSplits.filter((c) =>
                    c.client_name.toLowerCase().includes(clientQ.trim().toLowerCase()),
                  ).map((c) => (
                    <option key={c.client_id} value={c.client_id}>
                      {c.client_name}
                      {c.custom ? " · personalizado" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {!clientSplits.length ? (
                <p className="meta">
                  No hay clientes todavía. Sincronizá apps o andá a{" "}
                  <Link href="/clients" className="tip-link">
                    Clientes
                  </Link>
                  .
                </p>
              ) : null}

              {selected ? (
                <>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Socio</th>
                          <th style={{ width: 130 }}>Porcentaje</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partners.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td>
                              <div className="actions" style={{ flexWrap: "nowrap" }}>
                                <input
                                  type="number"
                                  step="1"
                                  min={0}
                                  max={100}
                                  value={editPcts[p.id] ?? 0}
                                  onChange={(e) =>
                                    setEditPcts((prev) => ({
                                      ...prev,
                                      [p.id]: Number(e.target.value),
                                    }))
                                  }
                                  style={{
                                    width: 72,
                                    border: "1px solid var(--line)",
                                    borderRadius: "var(--radius-sm)",
                                    padding: "0.5rem 0.55rem",
                                    background: "var(--input-bg)",
                                    color: "var(--ink)",
                                  }}
                                />
                                <span className="meta">%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={saveClientPct}
                      disabled={saving}
                    >
                      Guardar porcentaje
                    </button>
                    {selected.custom ? (
                      <button
                        type="button"
                        className="btn sm line"
                        onClick={restoreDefault}
                      >
                        Usar default
                      </button>
                    ) : null}
                    <span className="meta">
                      Suma {clientSum.toFixed(1)}
                      {selected.custom ? " · personalizado" : " · aún usa default"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="meta">Elegí un cliente para editar su reparto.</p>
              )}

              {clientSplits.some((c) => c.custom) ? (
                <div style={{ marginTop: "1.25rem" }}>
                  <div className="meta" style={{ marginBottom: 6 }}>
                    Clientes con porcentaje propio
                  </div>
                  <div className="actions">
                    {clientSplits
                      .filter((c) => c.custom)
                      .map((c) => (
                        <button
                          key={c.client_id}
                          type="button"
                          className="btn sm line"
                          onClick={() => setEditClientId(c.client_id)}
                        >
                          {c.client_name}
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
      </div>

      <aside className="socios-calc card">
        <div className="liq-section-head">
          <div>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Calculadora</h2>
            <p className="meta" style={{ margin: "0.2rem 0 0" }}>
              {tab === "clientes" && selected
                ? `Usa el % de ${selected.client_name}${selected.custom ? " (propio)" : ""}.`
                : "Usa el % default."}
            </p>
          </div>
        </div>
        <div className="field" style={{ marginBottom: "0.85rem" }}>
          <label>Monto ($)</label>
          <input
            value={calcRaw}
            onChange={(e) => setCalcRaw(e.target.value)}
            placeholder="Ej: 100000"
            inputMode="numeric"
          />
        </div>
        {calcAmount > 0 ? (
          <div className="calc-amount" style={{ marginBottom: "0.75rem" }}>
            {money(calcAmount)}
          </div>
        ) : null}
        {!partners.length ? (
          <p className="meta" style={{ margin: 0 }}>
            Agregá socios para ver el reparto.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Socio</th>
                  <th>%</th>
                  <th>Le toca</th>
                </tr>
              </thead>
              <tbody>
                {calcShares.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td className="mono">{r.pct}%</td>
                    <td
                      className="mono"
                      style={{ whiteSpace: "nowrap", fontWeight: 700 }}
                    >
                      {calcAmount > 0 ? money(r.share) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {partners.length ? (
          <p
            className="meta"
            style={{
              margin: "0.65rem 0 0",
              color:
                Math.abs(calcPctSum - 100) < 0.05 ? "var(--ok)" : "var(--pending)",
            }}
          >
            Suma {calcPctSum.toFixed(1)}%
            {calcAmount > 0 ? ` · ${money(calcShareSum)}` : ""}
            {calcAmount > 0 && calcShareSum !== calcAmount
              ? ` (redondeo)`
              : ""}
            {Math.abs(calcPctSum - 100) >= 0.05 ? " · ideal 100%" : ""}
          </p>
        ) : null}
      </aside>
      </div>
    </div>
  );
}

export default function SociosPage() {
  return (
    <Suspense fallback={<p className="meta">Cargando…</p>}>
      <SociosInner />
    </Suspense>
  );
}
