import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  Hourglass,
  Repeat,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "@/software/compat";
import { useToast } from "@/software/compat";
import { Drawer } from "@/software/ui/Drawer";
import { FilterBar } from "@/software/ui/FilterBar";
import { PageHeader } from "@/software/ui/PageHeader";
import { KpiCard } from "@/software/ui/KpiCard";
import { EmptyState } from "@/software/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
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
type TabId = "pending" | "plans" | "charges" | "out";

const PAGE_SIZE = 50;
const ALL = "__all";

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
  if (s.frequency_type === "months") {
    return s.frequency > 1 ? `Cada ${s.frequency} meses` : "Por mes";
  }
  return `${s.frequency} ${s.frequency_type}`;
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

function cut(text: string, n: number) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

function fecha(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
}

function chargeNet(p: SubscriptionCharge, pct = Number(p.mp_fee_pct || 0)) {
  if (p.mp_net_amount != null && Number(p.mp_fee_pct || 0) === pct) {
    return Number(p.mp_net_amount);
  }
  return chargeNetAmount(Number(p.amount || 0), pct);
}

/** Pastilla de "¿se pagó?" con el color que corresponde. */
function Pill({ tone, children }: { tone: "ok" | "pending" | "error" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-success/15 text-success",
        tone === "pending" && "bg-warning/15 text-warning",
        tone === "error" && "bg-destructive/15 text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {tone !== "muted" ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:min-w-[150px]", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  allLabel = "Todos",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
}) {
  return (
    <Field label={label}>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger className="h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Comisión de Mercado Pago</Label>
          <div className="relative">
            <Input
              type="text"
              inputMode="decimal"
              aria-label="Comisión Mercado Pago %"
              disabled={busy}
              className="h-11 pr-8 tabular-nums"
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
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Neto que llegó</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              type="text"
              inputMode="decimal"
              aria-label="Neto después de comisión MP"
              disabled={busy}
              className="h-11 pl-7 tabular-nums"
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
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {feeAmt > 0.004 ? `Mercado Pago se quedó ${money2(feeAmt)}` : "Sin comisión cargada"}
        </span>
        {charge.mp_fee_manual ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void onResetAuto(charge.id)}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Volver a detectar
          </Button>
        ) : feeAmt > 0.004 ? (
          <Pill tone="ok">Detectada sola</Pill>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void onResetAuto(charge.id)}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Detectar de Mercado Pago
          </Button>
        )}
      </div>
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
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feeBusyId, setFeeBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("charges");
  const tabTouched = useRef(false);
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
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar los planes mensuales");
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
      // Si hay planes nuevos esperando decisión, arrancamos en esa pestaña.
      if (!tabTouched.current && Number(data.totals?.pending_count || 0) > 0) {
        setTab("pending");
      }
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
      setLoadedOnce(true);
    }
  }, [appId, clientId, status, kind, from, to, q, page, mpStatus, missingFee]);

  useEffect(() => {
    load();
  }, [load]);

  const changeTab = (t: TabId) => {
    tabTouched.current = true;
    setTab(t);
  };

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
        showToast("Volvió a por decidir.");
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
        ? "Comisión de Mercado Pago detectada de nuevo."
        : "Mercado Pago no trajo comisión; quedó 0%. Podés cargarla a mano.",
    );
  };

  // Mantener el panel lateral con los datos frescos después de guardar.
  useEffect(() => {
    if (!feeCharge) return;
    const fresh = charges.find((c) => c.id === feeCharge.id);
    if (fresh && fresh !== feeCharge) setFeeCharge(fresh);
  }, [charges, feeCharge]);

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

  const quickActive = (() => {
    const today = arDay();
    if (!from && !to) return "clear";
    if (from === today && to === today) return "today";
    const ym = today.slice(0, 7);
    if (from === `${ym}-01` && to.startsWith(ym) && to !== from) return "month";
    if (to === today && from && from !== today) return "week";
    return "";
  })();

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

  const activeFilters =
    [appId, clientId, status, kind, from, to, q, mpStatus].filter(Boolean).length +
    (missingFee ? 1 : 0);

  const fromIdx = totals.count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toIdx = Math.min(page * PAGE_SIZE, totals.count);

  const firstLoad = loading && !loadedOnce;

  const filters = (
    <div className="space-y-3">
      <div className="inline-flex max-w-full flex-wrap rounded-xl border bg-muted/40 p-1" role="tablist" aria-label="Fechas">
        {(
          [
            ["today", "Hoy"],
            ["week", "Semana"],
            ["month", "Mes"],
            ["clear", "Todas las fechas"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={quickActive === id}
            onClick={() => setQuick(id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
              quickActive === id ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <FilterBar activeCount={activeFilters} className="gap-3">
        <SelectField
          label="Cliente"
          value={clientId}
          onChange={(v) => pushFilters({ clientId: v, page: 1 })}
          options={clients.map((c) => ({
            value: c.id,
            label: `${c.name}${c.app_name ? ` (${c.app_name})` : ""}`,
          }))}
        />
        <SelectField
          label="App"
          value={appId}
          allLabel="Todas"
          onChange={(v) => pushFilters({ appId: v, page: 1 })}
          options={apps.map((a) => ({ value: a.id, label: a.name }))}
        />
        <SelectField
          label="¿Se pagó?"
          value={status}
          onChange={(v) => pushFilters({ status: v, page: 1 })}
          options={[
            { value: "approved", label: "Pagado" },
            { value: "pending", label: "Pendiente" },
            { value: "rejected", label: "No cobrado" },
            { value: "cancelled", label: "Cancelado" },
          ]}
        />
        <SelectField
          label="Tipo"
          value={kind}
          onChange={(v) => pushFilters({ kind: v, page: 1 })}
          options={[
            { value: "checkout", label: "Alta" },
            { value: "recurring", label: "Cuota" },
          ]}
        />
        <Field label="Desde">
          <Input
            type="date"
            className="h-10"
            value={from}
            onChange={(e) => pushFilters({ from: e.target.value, page: 1 })}
          />
        </Field>
        <Field label="Hasta">
          <Input
            type="date"
            className="h-10"
            value={to}
            onChange={(e) => pushFilters({ to: e.target.value, page: 1 })}
          />
        </Field>
        <SelectField
          label="Estado en Mercado Pago"
          value={mpStatus}
          onChange={setMpStatus}
          options={[
            { value: "authorized", label: "Activa" },
            { value: "paused", label: "Pausada" },
            { value: "cancelled", label: "Cancelada" },
            { value: "pending", label: "No se activó" },
          ]}
        />
        <SelectField
          label="Comisión"
          value={missingFee ? "missing" : ""}
          allLabel="Todas"
          onChange={(v) => {
            setMissingFee(v === "missing");
            setPage(1);
          }}
          options={[{ value: "missing", label: "Sin detectar" }]}
        />
        <Field label="Buscar" className="sm:min-w-[200px] sm:flex-1">
          <Input
            className="h-10"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onBlur={() => pushFilters({ q: qDraft, page: 1 })}
            onKeyDown={(e) => {
              if (e.key === "Enter") pushFilters({ q: qDraft, page: 1 });
            }}
            placeholder="Cliente, id, descripción…"
          />
        </Field>
      </FilterBar>
    </div>
  );

  const listSkeleton = (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-2xl" />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planes mensuales"
        sub={
          <>
            Suscripciones de Mercado Pago de los clientes. Primero decidí si cada plan nuevo
            entra (cuenta para el reparto de Prodi Software); recién ahí se sigue si Mercado Pago
            lo cobró.
            {clientName ? <span className="font-medium text-foreground"> · {clientName}</span> : null}
          </>
        }
        actions={
          <Button type="button" variant="outline" onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" />
            Exportar CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Por decidir"
          value={totals.pending_count}
          hint={totals.pending_count ? "Planes nuevos esperando un sí o un no" : "Nada pendiente"}
          tone={totals.pending_count ? "pending" : "muted"}
          icon={<Hourglass />}
          onClick={() => changeTab("pending")}
          active={tab === "pending"}
        />
        <KpiCard
          label="Planes que entran"
          value={totals.accepted_count}
          hint={`${totals.active_count} activos en Mercado Pago`}
          icon={<Repeat />}
          onClick={() => changeTab("plans")}
          active={tab === "plans"}
        />
        <KpiCard
          label="Cobrado"
          value={money2(totals.approved_amount)}
          hint={`${totals.approved_count} cobro${totals.approved_count === 1 ? "" : "s"} aprobado${totals.approved_count === 1 ? "" : "s"}`}
          tone="ok"
          icon={<CircleDollarSign />}
          onClick={() => changeTab("charges")}
          active={tab === "charges"}
        />
        <KpiCard
          label="Ingreso mensual"
          value={money(totals.monthly_recurring)}
          hint="Lo que suman por mes los planes activos"
          icon={<Repeat />}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => changeTab(v as TabId)} className="space-y-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="h-auto w-max gap-1 rounded-xl p-1">
            <TabsTrigger value="pending" className="gap-2 rounded-lg px-3 py-2">
              Por decidir
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  totals.pending_count ? "bg-warning/20 text-warning" : "bg-muted-foreground/10",
                )}
              >
                {totals.pending_count}
              </span>
            </TabsTrigger>
            <TabsTrigger value="plans" className="gap-2 rounded-lg px-3 py-2">
              Planes
              <span className="rounded-full bg-muted-foreground/10 px-1.5 text-xs tabular-nums">
                {totals.accepted_count}
              </span>
            </TabsTrigger>
            <TabsTrigger value="charges" className="gap-2 rounded-lg px-3 py-2">
              Cobros
              <span className="rounded-full bg-muted-foreground/10 px-1.5 text-xs tabular-nums">
                {totals.approved_count}
              </span>
            </TabsTrigger>
            <TabsTrigger value="out" className="gap-2 rounded-lg px-3 py-2">
              No entran
              <span className="rounded-full bg-muted-foreground/10 px-1.5 text-xs tabular-nums">
                {totals.rejected_count}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ---------- Por decidir ---------- */}
        <TabsContent value="pending" className="mt-0 space-y-4">
          <div>
            <h2 className="text-base font-semibold">¿Entran a Prodi Software?</h2>
            <p className="text-xs text-muted-foreground">
              Planes nuevos que aparecieron en Mercado Pago. Esto no es un cobro: es decidir si el
              plan cuenta para el reparto. Si entra, después se sigue solo si se pagó.
            </p>
          </div>
          {firstLoad ? (
            listSkeleton
          ) : pending.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {pending.map((s) => (
                <div key={s.id} className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{clientLabel(s)}</p>
                      {contactLine(s) ? (
                        <p className="truncate text-xs text-muted-foreground">{contactLine(s)}</p>
                      ) : s.reason ? (
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {cut(s.reason, 56)}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold tabular-nums">{money(s.amount)}</p>
                      <p className="text-xs text-muted-foreground">{freqLabel(s)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="lg"
                      className="h-12 bg-success text-primary-foreground hover:bg-success/90"
                      disabled={busyId === s.id}
                      onClick={() => setHub(s.id, "accepted")}
                    >
                      <Check className="mr-1.5 h-5 w-5" />
                      Sí entra
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      className="h-12 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={busyId === s.id}
                      onClick={() => setHub(s.id, "rejected")}
                    >
                      <X className="mr-1.5 h-5 w-5" />
                      No entra
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No hay planes por decidir">
              Cuando un cliente se suscriba a un plan en Mercado Pago, va a aparecer acá para que
              decidas si entra o no.
            </EmptyState>
          )}
        </TabsContent>

        {/* ---------- Planes ---------- */}
        <TabsContent value="plans" className="mt-0 space-y-4">
          {filters}
          <div>
            <h2 className="text-base font-semibold">Planes que entran a Prodi Software</h2>
            <p className="text-xs text-muted-foreground">
              Ya decidiste que cuentan. Si se pagó o no lo marca Mercado Pago, no esta decisión.
            </p>
          </div>
          {firstLoad ? (
            listSkeleton
          ) : inHub.length ? (
            <div className="space-y-2">
              {inHub.map((s) => {
                const tone = paidClass(s.last_charge_status, s.ever_paid) as "ok" | "pending" | "error";
                return (
                  <div
                    key={s.id}
                    className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm md:flex-row md:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{clientLabel(s)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[contactLine(s), mpPlanLabel(s.status)].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4 md:justify-end">
                      <div className="text-left md:w-32 md:text-right">
                        <p className="font-bold tabular-nums">{money(s.amount)}</p>
                        <p className="text-xs text-muted-foreground">{freqLabel(s)}</p>
                      </div>
                      <div className="text-right md:w-40">
                        <Pill tone={tone}>{paidLabel(s.last_charge_status, s.ever_paid)}</Pill>
                        {s.last_charge_paid_at ? (
                          <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                            {fecha(s.last_charge_paid_at)}
                            {s.last_charge_amount ? ` · ${money(s.last_charge_amount)}` : ""}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start text-muted-foreground hover:text-destructive md:self-center"
                      disabled={busyId === s.id}
                      onClick={() => setHub(s.id, "rejected")}
                    >
                      <Ban className="mr-1.5 h-4 w-4" />
                      Sacar
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No hay planes con estos filtros">
              {pending.length
                ? "Primero decidí los planes de la pestaña Por decidir."
                : "Probá con otras fechas o sacá algún filtro."}
            </EmptyState>
          )}
        </TabsContent>

        {/* ---------- Cobros ---------- */}
        <TabsContent value="charges" className="mt-0 space-y-4">
          {filters}
          <div>
            <h2 className="text-base font-semibold">Cobros de los planes</h2>
            <p className="text-xs text-muted-foreground">
              Solo de planes que entran. La comisión de Mercado Pago se detecta sola (lo que
              realmente llegó) y la podés corregir tocando el neto.
            </p>
          </div>
          {firstLoad ? (
            listSkeleton
          ) : !charges.length && !loading ? (
            <EmptyState title="No hay cobros con estos filtros">
              Probá con otras fechas o sacá algún filtro. Si recién aceptaste un plan, el cobro
              aparece cuando Mercado Pago lo procese.
            </EmptyState>
          ) : (
            <>
              {/* Celular: tarjetas */}
              <div className="space-y-2 md:hidden">
                {charges.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setFeeCharge(p)}
                    className="block w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{clientLabel(p)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {fecha(p.paid_at)} · {kindLabel(p.kind)}
                        </p>
                      </div>
                      <Pill tone={paidClass(p.status) as "ok" | "pending" | "error"}>
                        {paidLabel(p.status)}
                      </Pill>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Bruto</p>
                        <p className="font-bold tabular-nums">{money(p.amount)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          Neto · comisión {formatPctInput(p.mp_fee_pct) || "0"}%
                          {p.mp_fee_manual ? " (a mano)" : ""}
                        </p>
                        <p className="font-semibold tabular-nums text-primary">{money2(chargeNet(p))}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Compu: tabla */}
              <div className="hidden overflow-x-auto rounded-2xl border bg-card shadow-sm md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Fecha</th>
                      <th className="px-4 py-3 font-medium">Cliente</th>
                      <th className="px-4 py-3 font-medium">Tipo</th>
                      <th className="px-4 py-3 text-right font-medium">Bruto</th>
                      <th className="px-4 py-3 font-medium">Neto (comisión MP)</th>
                      <th className="px-4 py-3 font-medium">¿Se pagó?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map((p) => (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{fecha(p.paid_at)}</td>
                        <td className="max-w-[280px] px-4 py-3">
                          <p className="truncate font-medium">{clientLabel(p)}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {contactLine(p) ||
                              (p.description ? cut(p.description, 48) : p.app_name || "—")}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Pill tone="muted">{kindLabel(p.kind)}</Pill>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                          {money(p.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-auto gap-2 py-1.5 tabular-nums"
                            onClick={() => setFeeCharge(p)}
                          >
                            <span className="font-semibold">{money2(chargeNet(p))}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatPctInput(p.mp_fee_pct) || "0"}%
                              {p.mp_fee_manual ? " · a mano" : ""}
                            </span>
                          </Button>
                        </td>
                        <td className="px-4 py-3">
                          <Pill tone={paidClass(p.status) as "ok" | "pending" | "error"}>
                            {paidLabel(p.status)}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {totals.count
                    ? `Mostrando ${fromIdx}–${toIdx} de ${totals.count}`
                    : "Sin resultados"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => pushFilters({ page: page - 1 })}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Pág. {page} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => pushFilters({ page: page + 1 })}
                  >
                    Siguiente
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ---------- No entran ---------- */}
        <TabsContent value="out" className="mt-0 space-y-4">
          <div>
            <h2 className="text-base font-semibold">No entran</h2>
            <p className="text-xs text-muted-foreground">
              {totals.rejected_count} plan{totals.rejected_count === 1 ? "" : "es"} que decidiste
              que no cuentan para el reparto. Si te equivocaste, lo podés hacer entrar o volver a
              por decidir.
            </p>
          </div>
          {firstLoad ? (
            listSkeleton
          ) : rejected.length ? (
            <div className="space-y-2">
              {rejected.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{clientLabel(s)}</p>
                    {s.reason ? (
                      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {cut(s.reason, 56)}
                      </p>
                    ) : null}
                  </div>
                  <p className="font-bold tabular-nums">{money(s.amount)}</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === s.id}
                      onClick={() => setHub(s.id, "accepted")}
                    >
                      <Check className="mr-1.5 h-4 w-4" />
                      Entra
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyId === s.id}
                      onClick={() => setHub(s.id, "pending")}
                    >
                      <Undo2 className="mr-1.5 h-4 w-4" />
                      Volver a por decidir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No hay planes descartados">
              Los planes a los que les digas "No entra" quedan acá.
            </EmptyState>
          )}
        </TabsContent>
      </Tabs>

      {loading && loadedOnce ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : null}

      <Drawer
        open={Boolean(feeCharge)}
        title={feeCharge ? clientLabel(feeCharge) : "Comisión"}
        onClose={() => setFeeCharge(null)}
      >
        {feeCharge ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border bg-card p-3">
                <p className="text-xs text-muted-foreground">Bruto</p>
                <p className="text-lg font-bold tabular-nums">{money(feeCharge.amount)}</p>
              </div>
              <div className="rounded-2xl border bg-card p-3">
                <p className="text-xs text-muted-foreground">Fecha</p>
                <p className="text-lg font-bold tabular-nums">{fecha(feeCharge.paid_at)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Corregí el % o el neto que llegó: uno calcula el otro. No borra el cobro.
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
    <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
      <SubscriptionsInner />
    </Suspense>
  );
}
