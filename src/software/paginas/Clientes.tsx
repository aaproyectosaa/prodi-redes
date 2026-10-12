import Link from "@/software/compat";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, EyeOff, Receipt, RefreshCw, RotateCcw, Search, Users } from "lucide-react";
import { useToast } from "@/software/compat";
import { ConfirmDialog } from "@/software/ui/ConfirmDialog";
import { Drawer } from "@/software/ui/Drawer";
import { EmptyState } from "@/software/ui/EmptyState";
import { KpiCard } from "@/software/ui/KpiCard";
import { PageHeader } from "@/software/ui/PageHeader";
import { PeriodBar } from "@/software/ui/PeriodBar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { cn } from "@/lib/utils";
import { money, periodBounds, yearMonth, type StatsPeriod } from "@/software/lib/money";
import type { HubClient } from "@/software/lib/types";
import type { MpAppPublic, Payment } from "@/software/lib/types";
import { swFetch } from "@/software/compat";

type Tab = "active" | "blacklisted";
type AppOpt = Pick<MpAppPublic, "id" | "name">;

/** Radix Select no acepta "" como valor. */
const TODAS = "__todas__";

const PERIODO_TEXTO: Record<StatsPeriod, string> = {
  today: "hoy",
  week: "esta semana",
  month: "en el mes",
  year: "en el año",
  all: "en total",
};

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

export default function ClientsPage() {
  const showToast = useToast();
  const { roles } = useUserProfileContext();
  const esDireccion = roles.includes("admin") || roles.includes("administracion");
  const [tab, setTab] = useState<Tab>("active");
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const [month, setMonth] = useState(yearMonth());
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [appId, setAppId] = useState("");
  const [apps, setApps] = useState<AppOpt[]>([]);
  const [clients, setClients] = useState<HubClient[]>([]);
  const [counts, setCounts] = useState({ active: 0, blacklisted: 0 });
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [selected, setSelected] = useState<HubClient | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [recent, setRecent] = useState<Payment[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);

  const bounds = useMemo(() => periodBounds(period, month), [period, month]);

  const load = useCallback(
    async (backfill = false) => {
      setLoading(true);
      if (backfill) setDetecting(true);
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
        setDetecting(false);
      }
    },
    [showToast, tab, q, appId, bounds.from, bounds.to],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    // La lista de apps es solo de dirección; para el resto sale de los clientes.
    if (!esDireccion) return;
    swFetch("/api/apps")
      .then((r) => r.json())
      .then((d) => setApps(d.apps || []))
      .catch(() => setApps([]));
  }, [esDireccion]);

  const [appsDeClientes, setAppsDeClientes] = useState<AppOpt[]>([]);
  useEffect(() => {
    if (esDireccion || appId) return;
    const seen = new Map<string, string>();
    for (const c of clients) if (c.app_id && !seen.has(c.app_id)) seen.set(c.app_id, c.app_name || "App");
    setAppsDeClientes((prev) => {
      const merged = new Map(prev.map((a) => [a.id, a.name]));
      for (const [id, name] of seen) merged.set(id, name);
      return [...merged].map(([id, name]) => ({ id, name }));
    });
  }, [clients, esDireccion, appId]);
  const appOptions = esDireccion ? apps : appsDeClientes;

  const open = async (c: HubClient) => {
    setSelected(c);
    setEditName(c.name);
    setEditNotes(c.notes || "");
    setRecent([]);
    setRecentLoading(true);
    try {
      const res = await swFetch(`/api/payments?clientId=${c.id}&status=approved&limit=10`);
      const data = await res.json().catch(() => ({}));
      setRecent(data.payments || []);
    } finally {
      setRecentLoading(false);
    }
  };

  const save = async () => {
    if (!selected) return;
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    try {
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
    } finally {
      setSaving(false);
    }
  };

  const setBlacklisted = async (c: HubClient, blacklisted: boolean) => {
    setSaving(true);
    try {
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
      showToast(blacklisted ? "Cliente ocultado: ya no suma" : "Cliente restaurado: vuelve a sumar");
      setConfirmHide(false);
      setSelected(null);
      load(false);
    } finally {
      setSaving(false);
    }
  };

  const feeSum = clients.reduce((a, c) => a + Number(c.fee_total || 0), 0);
  const amountSum = clients.reduce((a, c) => a + Number(c.amount_total || 0), 0);
  const ordenados = useMemo(
    () => [...clients].sort((a, b) => Number(b.fee_total || 0) - Number(a.fee_total || 0)),
    [clients],
  );
  const cuando = PERIODO_TEXTO[period];
  const ocultos = tab === "blacklisted";
  const cambioNombre = selected ? editName.trim() !== selected.name || editNotes !== (selected.notes || "") : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        sub="Cada cliente cobra con una app de Mercado Pago y le deja una comisión a Prodi Software. Los ocultos no suman en Inicio ni en Pagos."
        actions={
          esDireccion ? (
            <Button variant="outline" onClick={() => load(true)} disabled={detecting}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", detecting && "animate-spin")} />
              {detecting ? "Buscando…" : "Buscar clientes nuevos"}
            </Button>
          ) : null
        }
      />

      <PeriodBar period={period} month={month} onPeriod={setPeriod} onMonth={setMonth} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          icon={<Receipt />}
          value={money(feeSum)}
          label={ocultos ? `Comisión de ocultos ${cuando}` : `Comisión ${cuando}`}
          tone={ocultos ? "muted" : undefined}
          hint={ocultos ? "No se cuenta en ningún total" : "Lo que dejaron estos clientes"}
        />
        <KpiCard
          value={money(amountSum)}
          label={`Ventas ${cuando}`}
          tone="muted"
          hint="Lo que cobraron ellos con su app"
        />
        <KpiCard
          icon={<Users />}
          value={clients.length}
          label={ocultos ? "Clientes ocultos" : "Clientes en la lista"}
          tone="muted"
          hint={q || appId ? "Con la búsqueda actual" : undefined}
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="active">Activos ({counts.active})</TabsTrigger>
              <TabsTrigger value="blacklisted">Ocultos, no suman ({counts.blacklisted})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <form
              className="relative w-full sm:min-w-[260px]"
              onSubmit={(e) => {
                e.preventDefault();
                setQ(qDraft);
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                onBlur={() => setQ(qDraft)}
                placeholder="Buscar por nombre, ID o app"
                className="h-10 pl-9"
                aria-label="Buscar clientes"
              />
            </form>
            {appOptions.length > 1 || appId ? (
              <div className="w-full sm:w-52">
                <Label className="sr-only">App</Label>
                <Select value={appId || TODAS} onValueChange={(v) => setAppId(v === TODAS ? "" : v)}>
                  <SelectTrigger className="h-10 w-full" aria-label="App">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODAS}>Todas las apps</SelectItem>
                    {appOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        </div>

        {ocultos ? (
          <p className="text-xs text-muted-foreground">
            Los clientes ocultos no suman comisión en Inicio ni aparecen en Pagos. Podés restaurarlos cuando quieras.
          </p>
        ) : null}

        {loading && !clients.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-2xl" />
            ))}
          </div>
        ) : !clients.length ? (
          <EmptyState title={ocultos ? "No hay clientes ocultos" : q || appId ? "Ningún cliente coincide" : "Todavía no hay clientes"}>
            {ocultos
              ? "Cuando ocultes un cliente desde su detalle, va a aparecer acá."
              : q || appId
                ? "Probá con otra búsqueda o elegí todas las apps."
                : esDireccion
                  ? 'Actualizá desde Mercado Pago en Apps o tocá "Buscar clientes nuevos".'
                  : "Todavía no se detectaron clientes en las apps."}
          </EmptyState>
        ) : (
          <div className={cn("grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 xl:grid-cols-3", loading && "opacity-60")}>
            {ordenados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => open(c)}
                className={cn(
                  "group flex min-w-0 flex-col rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                  selected?.id === c.id && "border-primary ring-2 ring-primary/20",
                  ocultos && "opacity-80",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.app_name || "Sin app"}</p>
                  </div>
                  <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground">Comisión {cuando}</p>
                  <p className={cn("text-2xl font-bold tabular-nums tracking-tight", ocultos && "text-muted-foreground")}>
                    {money(c.fee_total || 0)}
                  </p>
                  {period !== "all" ? (
                    <p className="text-xs text-muted-foreground tabular-nums">Desde siempre: {money(c.fee_all || 0)}</p>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">Ventas {money(c.amount_total || 0)}</span>
                  <span className="tabular-nums">
                    {c.payments_count || 0} {Number(c.payments_count || 0) === 1 ? "pago" : "pagos"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {clients.length ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {clients.length} {clients.length === 1 ? "cliente" : "clientes"} · comisión {money(feeSum)} · ventas {money(amountSum)}
          </p>
        ) : null}
      </section>

      <Drawer open={Boolean(selected)} title={selected?.name || "Cliente"} onClose={() => setSelected(null)}>
        {selected ? (
          <>
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Comisión {cuando}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{money(selected.fee_total || 0)}</p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                Ventas {money(selected.amount_total || 0)} · {selected.payments_count || 0} pagos
                {period !== "all" ? ` · desde siempre ${money(selected.fee_all || 0)}` : ""}
              </p>
              {ocultos ? (
                <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  <EyeOff className="h-3 w-3" /> Oculto, no suma
                </span>
              ) : null}
            </div>

            <div className="rounded-2xl border bg-card px-4 py-1 shadow-sm">
              <Dato label="App">{selected.app_name || "—"}</Dato>
              <Dato label="ID de Mercado Pago">
                <span className="font-mono text-xs">{selected.collector_id}</span>
              </Dato>
              {!esDireccion ? <Dato label="Notas">{selected.notes || "—"}</Dato> : null}
            </div>

            {esDireccion ? (
              <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
                <h3 className="text-base font-semibold">Datos del cliente</h3>
                <div className="space-y-1.5">
                  <Label htmlFor="cliente-nombre">Nombre</Label>
                  <Input id="cliente-nombre" value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cliente-notas">Notas</Label>
                  <Textarea
                    id="cliente-notas"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Algo para recordar de este cliente"
                  />
                </div>
                <Button className="w-full sm:w-auto" onClick={save} disabled={saving || !editName.trim() || !cambioNombre}>
                  {saving ? "Guardando…" : "Guardar cambios"}
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Link
                className={cn(buttonVariants({ variant: "outline" }), "w-full")}
                href={`/payments?clientId=${selected.id}`}
              >
                Ver sus pagos
              </Link>
              {esDireccion ? (
                <>
                  <Link
                    className={cn(buttonVariants({ variant: "outline" }), "w-full")}
                    href={`/suscripciones?clientId=${selected.id}`}
                  >
                    Planes mensuales
                  </Link>
                  <Link className={cn(buttonVariants({ variant: "outline" }), "w-full sm:col-span-2")} href={`/socios?tab=clientes`}>
                    Reparto de este cliente
                  </Link>
                </>
              ) : null}
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-semibold">Últimos pagos</h3>
              {recentLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              ) : !recent.length ? (
                <p className="text-xs text-muted-foreground">Todavía no hay pagos aprobados de este cliente.</p>
              ) : (
                <ul className="divide-y rounded-2xl border bg-card shadow-sm">
                  {recent.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{(p.description || "Sin descripción").slice(0, 64)}</p>
                        <p className="text-xs text-muted-foreground">{fechaDePago(p.paid_at)}</p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums">{money(p.fee)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {esDireccion ? (
              <div className="border-t pt-4">
                {ocultos ? (
                  <Button className="w-full" onClick={() => setBlacklisted(selected, false)} disabled={saving}>
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    Restaurar (vuelve a sumar)
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full text-destructive hover:text-destructive"
                    onClick={() => setConfirmHide(true)}
                    disabled={saving}
                  >
                    <EyeOff className="mr-1.5 h-4 w-4" />
                    Ocultar cliente (no suma)
                  </Button>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={confirmHide && Boolean(selected)}
        title={`¿Ocultar a ${selected?.name || "este cliente"}?`}
        body="Su comisión deja de sumar en Inicio y sus pagos no aparecen en Pagos. Lo podés restaurar cuando quieras desde la pestaña Ocultos."
        confirmLabel="Ocultar"
        danger
        busy={saving}
        onCancel={() => setConfirmHide(false)}
        onConfirm={() => selected && setBlacklisted(selected, true)}
      />
    </div>
  );
}
