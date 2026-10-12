import Link from "@/software/compat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rutaSoftware, useSearchParams } from "@/software/compat";
import { AlertTriangle, ArrowLeft, Calculator, CheckCircle2, Plus, RotateCcw, Search, Trash2, UsersRound, Percent, Wallet } from "lucide-react";
import { Suspense } from "react";
import { useToast } from "@/software/compat";
import { money } from "@/software/lib/money";
import { swFetch } from "@/software/compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/software/ui/PageHeader";
import { EmptyState } from "@/software/ui/EmptyState";
import { ConfirmDialog } from "@/software/ui/ConfirmDialog";
import { cn } from "@/lib/utils";

type Partner = { id: string; name: string; pct: number; is_cash?: boolean };
type ClientSplit = {
  client_id: string;
  client_name: string;
  custom: boolean;
  pcts: Array<{ partner_id: string; partner_name: string; pct: number }>;
};

type Tab = "socios" | "clientes";

/** Colores de cada persona en la barra de proporción (solo tokens). */
const SEGMENTOS = ["bg-primary", "bg-success", "bg-warning", "bg-primary/50", "bg-success/50", "bg-warning/50", "bg-muted-foreground/60", "bg-primary/25"];
const color = (i: number) => SEGMENTOS[i % SEGMENTOS.length];

const sumaOk = (n: number) => Math.abs(n - 100) < 0.05;

function SociosInner() {
  const showToast = useToast();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "socios";
  const [tab, setTab] = useState<Tab>(initialTab === "clientes" ? "clientes" : "socios");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [clientSplits, setClientSplits] = useState<ClientSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [editClientId, setEditClientId] = useState("");
  const [editPcts, setEditPcts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [calcRaw, setCalcRaw] = useState("");
  const [clientQ, setClientQ] = useState("");
  const [borrar, setBorrar] = useState<Partner | null>(null);
  const [confirmDefault, setConfirmDefault] = useState(false);

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

  const selected = useMemo(() => clientSplits.find((c) => c.client_id === editClientId) || null, [clientSplits, editClientId]);

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
  const calcAmount = Math.round(Number(String(calcRaw).replace(/\./g, "").replace(",", ".")) || 0);
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

  const filteredClients = clientSplits.filter(
    (c) => c.client_id === editClientId || c.client_name.toLowerCase().includes(clientQ.trim().toLowerCase())
  );
  const customCount = clientSplits.filter((c) => c.custom).length;

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
      showToast("Reparto guardado ✓");
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
      showToast("Escribí el nombre de la persona");
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
    setSaving(true);
    try {
      const res = await swFetch(`/api/partners?id=${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) showToast(data.error || "Error");
      else {
        showToast("Eliminado");
        load();
      }
    } finally {
      setSaving(false);
      setBorrar(null);
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
    setSaving(true);
    try {
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
      showToast("Vuelve a usar el % general ✓");
      load();
    } finally {
      setSaving(false);
      setConfirmDefault(false);
    }
  };

  const goTab = (t: Tab) => {
    setTab(t);
    const url = t === "socios" ? "/socios" : "/socios?tab=clientes";
    window.history.replaceState(window.history.state, "", rutaSoftware(url));
  };

  const setPartner = (i: number, cambio: Partial<Partner>) => {
    const next = [...partners];
    next[i] = { ...next[i], ...cambio };
    setPartners(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reparto"
        sub="Quién se lleva cuánto de lo que cobra Prodi Software. Hay un % general y, si hace falta, un % distinto para algún cliente."
        actions={
          <Button variant="outline" asChild>
            <Link href="/liquidacion">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Volver a Liquidación
            </Link>
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => goTab(v as Tab)}>
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl sm:inline-grid sm:w-auto">
          <TabsTrigger value="socios" className="gap-1.5 rounded-lg py-2">
            <UsersRound className="h-4 w-4" />
            Personas del reparto
          </TabsTrigger>
          <TabsTrigger value="clientes" className="gap-1.5 rounded-lg py-2">
            <Percent className="h-4 w-4" />
            % por cliente
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading && !partners.length ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {tab === "socios" ? (
              <section id="lista-socios" className="space-y-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
                <div>
                  <h2 className="text-base font-semibold">% general</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Vale para comisiones, abonos de mantenimiento, trabajos extra, planes mensuales y para los clientes sin % propio. Marcá a una persona
                    como “caja”: ahí se guardan los ahorros y de ahí salen los gastos.
                  </p>
                </div>

                {partners.length ? <Proporcion filas={partners.map((p) => ({ id: p.id, name: p.name, pct: Number(p.pct || 0) }))} /> : null}
                <AvisoSuma suma={defaultSum} />

                {!partners.length ? (
                  <EmptyState title="Todavía no hay nadie en el reparto">Agregá a la primera persona acá abajo y ponele su porcentaje.</EmptyState>
                ) : (
                  <ul className="space-y-2">
                    {partners.map((p, i) => (
                      <li key={p.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className={cn("h-8 w-1.5 shrink-0 rounded-full", color(i))} aria-hidden />
                          <Input
                            value={p.name}
                            onChange={(e) => setPartner(i, { name: e.target.value })}
                            className="h-10 min-w-0 flex-1 font-medium"
                            aria-label="Nombre"
                          />
                        </div>
                        <div className="flex items-center gap-3 pl-[18px] sm:pl-0">
                          <PctInput value={p.pct} onChange={(n) => setPartner(i, { pct: n })} label={`Porcentaje de ${p.name}`} />
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground" title="Dónde se guardan los ahorros y de dónde salen los gastos">
                            <Switch
                              checked={Boolean(p.is_cash)}
                              onCheckedChange={(checked) =>
                                setPartners(
                                  partners.map((x) => ({
                                    ...x,
                                    is_cash: checked ? x.id === p.id : false,
                                  }))
                                )
                              }
                              aria-label={`Marcar ${p.name} como caja`}
                            />
                            <span className={cn("inline-flex items-center gap-1", p.is_cash && "font-medium text-foreground")}>
                              <Wallet className="h-3.5 w-3.5" />
                              Caja
                            </span>
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="ml-auto h-10 w-10 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:ml-0"
                            onClick={() => setBorrar(p)}
                            aria-label={`Eliminar a ${p.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {partners.length ? (
                  <Button type="button" onClick={saveDefaults} disabled={saving} className="w-full sm:w-auto">
                    {saving ? "Guardando…" : "Guardar nombres y porcentajes"}
                  </Button>
                ) : null}

                <div className="space-y-1.5 border-t pt-5">
                  <Label htmlFor="nuevo-socio">Agregar una persona</Label>
                  <div className="flex gap-2">
                    <Input
                      id="nuevo-socio"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Ej. Ana"
                      className="h-10 min-w-0 flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addPartner();
                      }}
                    />
                    <Button type="button" variant="outline" className="h-10 shrink-0" onClick={addPartner} disabled={saving}>
                      <Plus className="mr-1 h-4 w-4" />
                      Agregar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Entra con 0%: después ajustá su porcentaje y guardá.</p>
                </div>
              </section>
            ) : !partners.length ? (
              <EmptyState title="Primero agregá a las personas del reparto">
                <p>Para poner un % distinto a un cliente, antes tiene que haber alguien en el reparto.</p>
                <Button size="sm" className="mt-3" onClick={() => goTab("socios")}>
                  Ir a Personas del reparto
                </Button>
              </EmptyState>
            ) : (
              <section className="space-y-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
                <div>
                  <h2 className="text-base font-semibold">Reparto distinto para un cliente</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Si no cambiás nada, el cliente usa el % general. La cuenta rápida de al lado usa el % del cliente elegido.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">{customCount} con % propio</span>
                  <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
                    {clientSplits.length - customCount} con el % general
                  </span>
                </div>

                {!clientSplits.length ? (
                  <EmptyState title="No hay clientes todavía">
                    Actualizá las apps desde Mercado Pago o andá a{" "}
                    <Link href="/clients" className="font-medium text-primary hover:underline">
                      Clientes
                    </Link>
                    .
                  </EmptyState>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="buscar-cliente">Buscar</Label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="buscar-cliente"
                          value={clientQ}
                          onChange={(e) => setClientQ(e.target.value)}
                          placeholder="Nombre del cliente"
                          className="h-10 pl-9"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cliente</Label>
                      <Select value={editClientId || undefined} onValueChange={setEditClientId}>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Elegí un cliente…" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredClients.length ? (
                            filteredClients.map((c) => (
                              <SelectItem key={c.client_id} value={c.client_id}>
                                {c.client_name}
                                {c.custom ? " · % propio" : ""}
                              </SelectItem>
                            ))
                          ) : (
                            <p className="px-2 py-1.5 text-xs text-muted-foreground">Ningún cliente con ese nombre.</p>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {customCount ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Clientes con % propio (tocá para editar)</p>
                    <div className="flex flex-wrap gap-2">
                      {clientSplits
                        .filter((c) => c.custom)
                        .map((c) => (
                          <button
                            key={c.client_id}
                            type="button"
                            onClick={() => setEditClientId(c.client_id)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/50",
                              c.client_id === editClientId && "border-primary bg-primary/10 text-primary"
                            )}
                          >
                            {c.client_name}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}

                {selected ? (
                  <div className="space-y-4 rounded-xl border bg-muted/20 p-3 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{selected.client_name}</p>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-medium",
                          selected.custom ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {selected.custom ? "% propio" : "Usa el % general"}
                      </span>
                    </div>
                    <Proporcion filas={partners.map((p) => ({ id: p.id, name: p.name, pct: Number(editPcts[p.id] || 0) }))} />
                    <ul className="space-y-2">
                      {partners.map((p, i) => (
                        <li key={p.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                          <span className={cn("h-6 w-1.5 shrink-0 rounded-full", color(i))} aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                          <span className="hidden text-xs text-muted-foreground sm:inline">general {Number(p.pct || 0)}%</span>
                          <PctInput
                            value={editPcts[p.id] ?? 0}
                            onChange={(n) => setEditPcts((prev) => ({ ...prev, [p.id]: n }))}
                            label={`Porcentaje de ${p.name} para ${selected.client_name}`}
                          />
                        </li>
                      ))}
                    </ul>
                    <AvisoSuma suma={clientSum} />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button type="button" onClick={saveClientPct} disabled={saving}>
                        {saving ? "Guardando…" : "Guardar % del cliente"}
                      </Button>
                      {selected.custom ? (
                        <Button type="button" variant="outline" onClick={() => setConfirmDefault(true)} disabled={saving}>
                          <RotateCcw className="mr-1.5 h-4 w-4" />
                          Volver al % general
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : clientSplits.length ? (
                  <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Elegí un cliente para cambiar su reparto.</p>
                ) : null}
              </section>
            )}
          </div>

          <aside className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5 lg:sticky lg:top-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Calculator className="h-4 w-4 text-primary" />
                Cuenta rápida
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tab === "clientes" && selected
                  ? `Usa el % de ${selected.client_name}${selected.custom ? " (propio)" : " (general)"}.`
                  : "Usa el % general. Poné un monto y mirá cuánto le toca a cada uno."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="calc-monto">Monto</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  id="calc-monto"
                  value={calcRaw}
                  onChange={(e) => setCalcRaw(e.target.value)}
                  placeholder="100000"
                  inputMode="numeric"
                  className="h-11 pl-7 text-base tabular-nums"
                />
              </div>
            </div>
            {calcAmount > 0 ? <p className="text-2xl font-bold tabular-nums tracking-tight">{money(calcAmount)}</p> : null}
            {!partners.length ? (
              <p className="text-xs text-muted-foreground">Agregá personas al reparto para ver la cuenta.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {calcShares.map((r, i) => (
                  <li key={r.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color(i))} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{r.pct}%</span>
                    <span className="w-24 text-right font-semibold tabular-nums">{calcAmount > 0 ? money(r.share) : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
            {partners.length ? (
              <p className={cn("text-xs tabular-nums", sumaOk(calcPctSum) ? "text-success" : "text-warning")}>
                Suma {calcPctSum.toFixed(1)}%{calcAmount > 0 ? ` · ${money(calcShareSum)}` : ""}
                {calcAmount > 0 && calcShareSum !== calcAmount ? " (por redondeo)" : ""}
                {!sumaOk(calcPctSum) ? " · debería dar 100%" : ""}
              </p>
            ) : null}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(borrar)}
        title={borrar ? `¿Sacar a ${borrar.name} del reparto?` : ""}
        body="Deja de recibir parte de lo que se cobre. Acordate de repartir su % entre los demás."
        confirmLabel="Eliminar"
        danger
        busy={saving}
        onCancel={() => setBorrar(null)}
        onConfirm={() => borrar && removePartner(borrar)}
      />
      <ConfirmDialog
        open={confirmDefault}
        title="¿Volver al % general?"
        body={selected ? `${selected.client_name} deja de tener un reparto propio y pasa a usar el % general.` : undefined}
        confirmLabel="Volver al % general"
        busy={saving}
        onCancel={() => setConfirmDefault(false)}
        onConfirm={restoreDefault}
      />
    </div>
  );
}

function PctInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="relative w-24 shrink-0">
      <Input
        type="number"
        step="1"
        min={0}
        max={100}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 pr-7 text-right font-semibold tabular-nums"
        aria-label={label}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
    </div>
  );
}

/** Barra con la proporción de cada persona, para ver de un vistazo quién se lleva cuánto. */
function Proporcion({ filas }: { filas: Array<{ id: string; name: string; pct: number }> }) {
  const total = filas.reduce((a, f) => a + Math.max(0, f.pct), 0);
  const base = Math.max(100, total);
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {filas.map((f, i) =>
          f.pct > 0 ? <div key={f.id} className={cn("h-full transition-all", color(i))} style={{ width: `${(f.pct / base) * 100}%` }} title={`${f.name}: ${f.pct}%`} /> : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {filas.map((f, i) => (
          <span key={f.id} className="inline-flex items-center gap-1.5 text-xs">
            <span className={cn("h-2 w-2 rounded-full", color(i))} aria-hidden />
            <span className="max-w-[10rem] truncate">{f.name || "Sin nombre"}</span>
            <span className="font-semibold tabular-nums">{f.pct || 0}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function AvisoSuma({ suma }: { suma: number }) {
  const ok = sumaOk(suma);
  const diff = 100 - suma;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
        ok ? "border-success/30 bg-success/[0.06] text-success" : "border-warning/40 bg-warning/[0.08] text-warning"
      )}
    >
      {ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span className="tabular-nums">
        {ok
          ? "Suma 100%. Todo repartido."
          : `Suma ${suma.toFixed(1)}%: ${diff > 0 ? `faltan ${diff.toFixed(1)}` : `sobran ${Math.abs(diff).toFixed(1)}`} puntos para llegar a 100%.`}
      </span>
    </div>
  );
}

export default function SociosPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
      <SociosInner />
    </Suspense>
  );
}
