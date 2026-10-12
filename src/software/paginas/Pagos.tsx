import { ChevronLeft, ChevronRight, Coins, Download, Lock, Search, Unlock, X } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, useToast } from "@/software/compat";
import { Drawer } from "@/software/ui/Drawer";
import { EmptyState } from "@/software/ui/EmptyState";
import { FilterBar } from "@/software/ui/FilterBar";
import { KpiCard } from "@/software/ui/KpiCard";
import { PageHeader } from "@/software/ui/PageHeader";
import { StatusPill } from "@/software/ui/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { cn } from "@/lib/utils";
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

type ClientOpt = { id: string; name: string; app_name?: string; app_id?: string };
type AppOpt = Pick<MpAppPublic, "id" | "name">;

const PAGE_SIZE = 50;
/** Radix Select no acepta "" como valor: usamos esto para "Todos". */
const TODOS = "__todos__";

type Quick = "today" | "week" | "month" | "clear";

/** Un filtro con su etiqueta arriba. */
function Campo({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-1.5 sm:w-[calc(50%-0.375rem)] md:w-auto", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Desplegable con opción "Todos" que equivale a "" (sin filtro). */
function Desplegable({
  value,
  onChange,
  todos,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  todos?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value || TODOS} onValueChange={(v) => onChange(v === TODOS ? "" : v)}>
      <SelectTrigger className="h-10 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {todos ? <SelectItem value={TODOS}>{todos}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Fila "dato: valor" del detalle. */
function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2.5 last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

function fechaDePago(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function PaymentsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const { roles } = useUserProfileContext();
  const esDireccion = roles.includes("admin") || roles.includes("administracion");
  const [apps, setApps] = useState<AppOpt[]>([]);
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
  const [exporting, setExporting] = useState(false);
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
    // La lista de apps es solo de dirección; el equipo de programación la saca de los clientes.
    if (esDireccion) {
      swFetch("/api/apps")
        .then((r) => r.json())
        .then((d) => setApps(d.apps || []))
        .catch(() => setApps([]));
    }
    swFetch("/api/clients?list=active")
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []))
      .catch(() => setClients([]));
  }, [esDireccion]);

  const appOptions = useMemo<AppOpt[]>(() => {
    if (apps.length) return apps;
    const seen = new Map<string, string>();
    for (const c of clients) if (c.app_id && !seen.has(c.app_id)) seen.set(c.app_id, c.app_name || "App");
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [apps, clients]);

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

  const quickRange = (kind: Quick): { from: string; to: string } => {
    const today = arDay();
    if (kind === "clear") return { from: "", to: "" };
    if (kind === "today") return { from: today, to: today };
    if (kind === "week") {
      const d = new Date(`${today}T12:00:00-03:00`);
      d.setTime(d.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { from: arDay(d), to: today };
    }
    const ym = today.slice(0, 7);
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
  };

  const setQuick = (kind: Quick) => {
    pushFilters({ ...quickRange(kind), page: 1 });
  };

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (appId) params.set("appId", appId);
    if (clientId) params.set("clientId", clientId);
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    if (feeState) params.set("feeState", feeState);
    if (unassigned) params.set("unassigned", "1");
    // Con swFetch para que lleve la sesión de Prodi (un link directo llegaba sin usuario).
    setExporting(true);
    try {
      const res = await swFetch(`/api/payments/export?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo exportar");
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `pagos-${arDay()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo exportar");
    } finally {
      setExporting(false);
    }
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
  const hayFiltros = activeFilters > 0 || status !== "approved" || Boolean(from) || Boolean(to);

  const quickActivo = (["today", "week", "month", "clear"] as Quick[]).find((k) => {
    const r = quickRange(k);
    return r.from === from && r.to === to;
  });

  const releaseOf = (p: Payment) => {
    if (!p.paid_at || !(Number(p.fee) > 0)) return null;
    const day = arDay(new Date(p.paid_at));
    const released = isFeeReleased(day);
    return {
      released,
      on: feeReleaseOn(day),
    };
  };

  const releaseTag = (p: Payment) => {
    const rel = releaseOf(p);
    if (!rel) return null;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs",
          rel.released ? "text-success" : "text-warning",
        )}
      >
        {rel.released ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        {rel.released ? "Disponible" : `Se libera el ${formatArDay(rel.on)}`}
      </span>
    );
  };

  const nombreCliente = (p: Payment) => p.client_name || p.collector_name || "Sin cliente";
  const corto = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

  const openRel = open ? releaseOf(open) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagos"
        sub={
          <>
            Lo que cobraron los clientes con su app de Mercado Pago y la comisión que le queda a Prodi Software.
            {clientName ? (
              <>
                {" "}
                Viendo: <span className="font-medium text-foreground">{clientName}</span>.
              </>
            ) : null}
          </>
        }
        actions={
          esDireccion ? (
            <Button variant="outline" onClick={exportCsv} disabled={exporting}>
              <Download className="mr-1.5 h-4 w-4" />
              {exporting ? "Exportando…" : "Exportar CSV"}
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          icon={<Coins />}
          value={money(totals.fee)}
          label="Comisión total"
          hint={`${totals.count} ${totals.count === 1 ? "pago" : "pagos"} · ventas ${money(totals.amount)}`}
        />
        <KpiCard
          icon={<Unlock />}
          value={money(totals.fee_released || 0)}
          label="Disponible"
          tone="ok"
          hint={`Ya pasaron los ${FEE_RELEASE_DAYS} días del cobro`}
        />
        <KpiCard
          icon={<Lock />}
          value={money(totals.fee_held || 0)}
          label="Retenida por MP"
          tone={totals.fee_held ? "pending" : "muted"}
          hint={`Mercado Pago la libera a los ${FEE_RELEASE_DAYS} días`}
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex max-w-full overflow-x-auto rounded-xl border bg-muted/40 p-1" role="tablist" aria-label="Fechas">
            {(
              [
                ["today", "Hoy"],
                ["week", "Últimos 7 días"],
                ["month", "Este mes"],
                ["clear", "Todas"],
              ] as Array<[Quick, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={quickActivo === k}
                onClick={() => setQuick(k)}
                className={cn(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
                  quickActivo === k ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            className="relative w-full lg:max-w-sm"
            onSubmit={(e) => {
              e.preventDefault();
              pushFilters({ q: qDraft, page: 1 });
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onBlur={() => {
                if (qDraft !== q) pushFilters({ q: qDraft, page: 1 });
              }}
              placeholder="Buscar por email, descripción o ID de pago"
              className="h-10 pl-9"
              aria-label="Buscar pagos"
            />
          </form>
        </div>

        <FilterBar activeCount={activeFilters} className="gap-3 p-4 md:grid md:grid-cols-3 xl:grid-cols-4">
          <Campo label="Cliente">
            <Desplegable
              value={clientId}
              onChange={(v) => pushFilters({ clientId: v, page: 1 })}
              todos="Todos los clientes"
              options={clients.map((c) => ({
                value: c.id,
                label: `${c.name}${c.app_name ? ` (${c.app_name})` : ""}`,
              }))}
            />
          </Campo>
          <Campo label="App">
            <Desplegable
              value={appId}
              onChange={(v) => pushFilters({ appId: v, page: 1 })}
              todos="Todas las apps"
              options={appOptions.map((a) => ({ value: a.id, label: a.name }))}
            />
          </Campo>
          <Campo label="Estado del cobro">
            <Desplegable
              value={status}
              onChange={(v) => pushFilters({ status: v, page: 1 })}
              todos="Todos"
              options={[
                { value: "approved", label: "Aprobado" },
                { value: "pending", label: "Pendiente" },
                { value: "rejected", label: "Rechazado" },
                { value: "cancelled", label: "Cancelado" },
              ]}
            />
          </Campo>
          <Campo label="Comisión">
            <Desplegable
              value={feeState}
              onChange={(v) => pushFilters({ feeState: v, page: 1 })}
              todos="Todas"
              options={[
                { value: "released", label: "Disponible" },
                { value: "held", label: "Retenida por MP" },
                { value: "with_fee", label: "Solo con comisión" },
              ]}
            />
          </Campo>
          <Campo label="Desde">
            <Input
              type="date"
              className="h-10"
              value={from}
              onChange={(e) => pushFilters({ from: e.target.value, page: 1 })}
            />
          </Campo>
          <Campo label="Hasta">
            <Input
              type="date"
              className="h-10"
              value={to}
              onChange={(e) => pushFilters({ to: e.target.value, page: 1 })}
            />
          </Campo>
          <Campo label="Ordenar por">
            <Desplegable
              value={sort}
              onChange={(v) => pushFilters({ sort: v || "date", page: 1 })}
              options={[
                { value: "date", label: "Más recientes" },
                { value: "fee", label: "Mayor comisión" },
                { value: "amount", label: "Mayor monto" },
              ]}
            />
          </Campo>
          <Campo label="Pagos sin cliente">
            <Desplegable
              value={unassigned ? "1" : "0"}
              onChange={(v) => pushFilters({ unassigned: v === "1", page: 1 })}
              options={[
                { value: "0", label: "Mostrar todos" },
                { value: "1", label: "Solo sin cliente asignado" },
              ]}
            />
          </Campo>
          {hayFiltros ? (
            <div className="flex w-full items-end md:col-span-3 xl:col-span-4">
              <Button variant="ghost" size="sm" onClick={() => router.replace("/payments")}>
                <X className="mr-1.5 h-4 w-4" />
                Limpiar filtros
              </Button>
            </div>
          ) : null}
        </FilterBar>
      </section>

      <section className="space-y-3">
        {loading && !payments.length ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-2xl" />
            ))}
          </div>
        ) : !payments.length ? (
          <EmptyState title="No hay pagos con estos filtros">
            Probá con otras fechas o tocá "Limpiar filtros" para ver todo.
          </EmptyState>
        ) : (
          <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")}>
            {/* Celular: tarjetas */}
            <ul className="space-y-2 md:hidden">
              {payments.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(p)}
                    className="w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors active:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{nombreCliente(p)}</p>
                        <p className="text-xs text-muted-foreground">
                          {fechaDePago(p.paid_at)}
                          {p.app_name ? ` · ${p.app_name}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-bold tabular-nums">{money(p.fee)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">de {money(p.amount)}</p>
                      </div>
                    </div>
                    {p.description ? (
                      <p className="mt-2 truncate text-xs text-muted-foreground">{corto(p.description)}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill status={p.status} />
                      {releaseTag(p)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {/* Compu: tabla */}
            <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-sm md:block">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="hidden lg:table-cell">App</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-right">Comisión</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => setOpen(p)}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {fechaDePago(p.paid_at)}
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <p className="truncate font-medium">{nombreCliente(p)}</p>
                          {p.description ? (
                            <p className="truncate text-xs text-muted-foreground">{corto(p.description, 48)}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">
                          {p.app_name || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(p.amount)}</TableCell>
                        <TableCell className="text-right">
                          <p className="font-semibold tabular-nums">{money(p.fee)}</p>
                          {releaseTag(p)}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={p.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {totals.count
                  ? `Mostrando ${fromIdx}–${toIdx} de ${totals.count} · ventas ${money(totals.amount)} · comisión ${money(totals.fee)}`
                  : "Sin resultados"}
              </p>
              {totalPages > 1 ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => pushFilters({ page: page - 1 })}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Anterior
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    Página {page} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => pushFilters({ page: page + 1 })}
                  >
                    Siguiente
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <Drawer open={Boolean(open)} title="Detalle del pago" onClose={() => setOpen(null)}>
        {open ? (
          <>
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Comisión de Prodi Software</p>
              <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{money(open.fee)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                sobre una venta de <span className="tabular-nums">{money(open.amount)}</span>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusPill status={open.status} />
                {openRel ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                      openRel.released ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                    )}
                  >
                    {openRel.released ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {openRel.released
                      ? `Disponible desde el ${formatArDay(openRel.on)}`
                      : `Retenida por MP hasta el ${formatArDay(openRel.on)}`}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border bg-card px-4 py-1 shadow-sm">
              <Dato label="Cliente">{nombreCliente(open)}</Dato>
              <Dato label="Fecha">
                {open.paid_at
                  ? new Date(open.paid_at).toLocaleString("es-AR", {
                      timeZone: "America/Argentina/Buenos_Aires",
                    })
                  : "—"}
              </Dato>
              <Dato label="App">{open.app_name || "—"}</Dato>
              <Dato label="Email de quien pagó">{open.payer_email || "—"}</Dato>
              <Dato label="Descripción">{open.description || "—"}</Dato>
              <Dato label="ID de Mercado Pago">
                <span className="font-mono text-xs">{open.mp_payment_id}</span>
              </Dato>
            </div>

            {open.client_id && open.client_id !== clientId ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setOpen(null);
                  pushFilters({ clientId: open.client_id || "", page: 1 });
                }}
              >
                Ver todos los pagos de este cliente
              </Button>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
      <PaymentsInner />
    </Suspense>
  );
}
