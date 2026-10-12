import Link, { rutaSoftware } from "@/software/compat";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  HandCoins,
  Percent,
  Plus,
  Receipt,
  Trash2,
  Undo2,
  Wallet,
} from "lucide-react";
import { useToast } from "@/software/compat";
import { addMonthsYm, arDay, FEE_RELEASE_DAYS, formatArDay, money, money2, yearMonth } from "@/software/lib/money";
import { expenseCategoryLabel } from "@/software/lib/expense-category";
import { parsePayoutSource } from "@/software/lib/payout-source";
import { mesLabel } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Section } from "@/components/redes/PageShell";
import { PageHeader } from "@/software/ui/PageHeader";
import { KpiCard } from "@/software/ui/KpiCard";
import { EmptyState } from "@/software/ui/EmptyState";
import { ConfirmDialog } from "@/software/ui/ConfirmDialog";
import { exportLiquidacionCsv } from "./export-csv";
import { BreakdownTable } from "./BreakdownTable";
import type { BreakdownRow, Caja, ExtraPayment, Item, Partner, Payout, Source } from "./types";
import { swFetch } from "@/software/compat";

/** Nombres de cada bolsa, en palabras simples. */
const BAG: Record<Source, { title: string; short: string; kind: string }> = {
  fee: { title: "Comisiones", short: "Comisión", kind: "comisiones" },
  subscription: { title: "Planes mensuales", short: "Plan mensual", kind: "planes mensuales" },
  maintenance: { title: "Abonos de mantenimiento", short: "Abono", kind: "abonos de mantenimiento" },
  extra: { title: "Trabajos extra", short: "Trabajo extra", kind: "trabajos extra" },
};
const BAG_ORDER: Source[] = ["fee", "subscription", "maintenance", "extra"];

const AR_TZ = "America/Argentina/Buenos_Aires";
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: AR_TZ });

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

const parseAmount = (raw: string) => Math.round(Number(String(raw).replace(/\./g, "").replace(",", ".")));

type Confirm = { kind: "undo"; payout: Payout } | { kind: "extra"; item: ExtraPayment } | null;

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
  const [loadedOnce, setLoadedOnce] = useState(false);
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
  const [customDates, setCustomDates] = useState(false);
  const [confirmState, setConfirmState] = useState<Confirm>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
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
      setLoadedOnce(true);
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
    window.history.replaceState(window.history.state, "", rutaSoftware(`/liquidacion?${p}`));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const itemsFor = (source: Source) =>
    source === "maintenance"
      ? maintenanceItems
      : source === "extra"
        ? extraItems
        : source === "subscription"
          ? subscriptionItems
          : feeItems;

  const pendingForSource = (partnerId: string, source: Source) =>
    Math.round(itemsFor(source).find((i) => i.partner_id === partnerId)?.pending || 0);

  const openPayModal = (item: Item) => {
    if (item.pending <= 0) {
      showToast("No hay nada pendiente para pagarle");
      return;
    }
    setPayModal({
      partnerId: item.partner_id,
      partnerName: item.partner_name,
      source: item.source,
      amount: String(Math.round(item.pending)),
    });
  };

  /** Desde la tarjeta de la persona: arranca por la bolsa que se está mirando, o la primera con algo pendiente. */
  const openPayForPartner = (p: Partner) => {
    const order = [bag, ...BAG_ORDER.filter((b) => b !== bag)];
    const source = order.find((s) => pendingForSource(p.id, s) > 0);
    if (!source) {
      showToast(`A ${p.name} no le falta cobrar nada en este período`);
      return;
    }
    setPayModal({
      partnerId: p.id,
      partnerName: p.name,
      source,
      amount: String(pendingForSource(p.id, source)),
    });
  };

  const confirmPay = async () => {
    if (!payModal) return;
    const { partnerId, source } = payModal;
    const kind = BAG[source].kind;
    const pending = pendingForSource(partnerId, source);
    if (pending <= 0) {
      showToast(`No hay nada pendiente en ${kind}`);
      return;
    }
    const amount = parseAmount(payModal.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Poné un monto válido");
      return;
    }
    if (amount > pending) {
      showToast(`No puede superar lo que falta pagar en ${kind} (${money(pending)})`);
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
      if (!res.ok) showToast(data.error || "No se pudo registrar el pago");
      else {
        showToast(
          amount < pending
            ? `Pago parcial de ${money(amount)} (${kind}) registrado`
            : `Pago de ${kind} registrado`,
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
    if (!res.ok) showToast(data.error || "No se pudo cambiar");
    else {
      showToast(`Ahora cuenta como ${BAG[source].kind}`);
      load();
    }
  };

  const undo = async (id: string) => {
    await swFetch("/api/liquidacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", id }),
    });
    showToast("Pago anulado");
    load();
  };

  const addExtra = async () => {
    const payer = extraName.trim();
    const amount = parseAmount(extraAmount);
    if (!payer || !Number.isFinite(amount) || amount <= 0) {
      showToast("Completá quién pagó y el monto");
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
      if (!res.ok) showToast(data.error || "No se pudo guardar");
      else {
        showToast(`Trabajo extra de ${money(amount)} registrado`);
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
    const res = await swFetch("/api/extras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: item.id }),
    });
    const data = await res.json();
    if (!res.ok) showToast(data.error || "No se pudo anular");
    else {
      showToast("Trabajo extra anulado");
      load();
    }
  };

  const runConfirm = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      if (confirmState.kind === "undo") await undo(confirmState.payout.id);
      else await deleteExtra(confirmState.item);
      setConfirmState(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  // ---- Números ----
  const sumPending = (list: Item[]) => list.reduce((a, i) => a + i.pending, 0);
  const sumPaid = (list: Item[]) => list.reduce((a, i) => a + i.paid, 0);
  const allLists = [feeItems, subscriptionItems, maintenanceItems, extraItems];
  const totalPending = allLists.reduce((a, l) => a + sumPending(l), 0);
  const totalPaid = allLists.reduce((a, l) => a + sumPaid(l), 0);

  const bags: Record<
    Source,
    { total: number; pending: number; count: number; countLabel: string; hint: string; empty: string; breakdown: BreakdownRow[]; detailTitle: string; amountLabel: string }
  > = {
    fee: {
      total: totalFee,
      pending: sumPending(feeItems),
      count: paymentsCount,
      countLabel: paymentsCount === 1 ? "venta disponible" : "ventas disponibles",
      hint: `Lo que gana Prodi Software por cada venta que cobra un cliente con su app de Mercado Pago. Solo cuenta lo disponible: Mercado Pago la libera a los ${FEE_RELEASE_DAYS} días.`,
      empty: "No hay comisiones disponibles en este período.",
      breakdown: breakdown.filter((b) => !b.source || b.source === "fee" || b.source === "mp"),
      detailTitle: "De qué cliente sale cada comisión",
      amountLabel: "Comisión",
    },
    subscription: {
      total: totalSubscription,
      pending: sumPending(subscriptionItems),
      count: subscriptionCount,
      countLabel: subscriptionCount === 1 ? "cobro" : "cobros",
      hint: "Suscripciones de Mercado Pago de los clientes. Se reparte lo neto, después de la comisión de Mercado Pago.",
      empty: "No hay planes mensuales cobrados en este período.",
      breakdown: breakdown.filter((b) => b.source === "subscription"),
      detailTitle: "De qué cliente sale cada plan",
      amountLabel: "Plan mensual",
    },
    maintenance: {
      total: totalMaintenance,
      pending: sumPending(maintenanceItems),
      count: maintenanceCount,
      countLabel: maintenanceCount === 1 ? "cobro" : "cobros",
      hint: "Abonos de mantenimiento cobrados. Se reparten con el % general de cada persona.",
      empty: "No hay abonos de mantenimiento cobrados en este período.",
      breakdown: breakdown.filter((b) => b.source === "maintenance"),
      detailTitle: "De qué abono sale cada parte",
      amountLabel: "Abono",
    },
    extra: {
      total: totalExtra,
      pending: sumPending(extraItems),
      count: extraCount,
      countLabel: extraCount === 1 ? "cobro" : "cobros",
      hint: "Trabajos por fuera de las apps que cargás a mano. Se reparten con el % general de cada persona.",
      empty: "No hay trabajos extra en este período. Cargá uno con «Registrar trabajo extra».",
      breakdown: breakdown.filter((b) => b.source === "extra"),
      detailTitle: "De dónde sale cada trabajo extra",
      amountLabel: "Monto",
    },
  };
  const current = bags[bag];
  const currentItems = itemsFor(bag);
  const bagMoney = (s: Source, n: number) => (s === "subscription" ? money2(n) : money(n));

  const visiblePayouts = payouts.filter((p) => {
    if (payoutPartner && p.partner_name !== payoutPartner) return false;
    if (payoutSource && parsePayoutSource(p.source) !== payoutSource) return false;
    return true;
  });
  const payoutSum = visiblePayouts.reduce((a, p) => a + Number(p.amount || 0), 0);

  const exportCsv = () =>
    exportLiquidacionCsv({
      from, to, totalFee, paymentsCount, totalMaintenance, maintenanceCount,
      totalExtra, extraCount, totalSubscription, subscriptionCount,
      feeItems, maintenanceItems, extraItems, subscriptionItems, breakdown,
    });

  // ---- Período ----
  const ym = from.slice(0, 7);
  const isFullMonth = from === monthRange(ym).from && to === monthRange(ym).to;
  const thisYear = today.slice(0, 4);
  const isThisYear = from === `${thisYear}-01-01` && to === today;
  const isThisMonth = isFullMonth && ym === yearMonth();
  const prevYm = addMonthsYm(yearMonth(), -1);
  const isPrevMonth = isFullMonth && ym === prevYm;
  const goMonth = (m: string) => {
    const r = monthRange(m);
    setCustomDates(false);
    setFrom(r.from);
    setTo(r.to);
  };
  const periodLabel = isFullMonth
    ? mesLabel(ym)
    : isThisYear
      ? `Año ${thisYear} hasta hoy`
      : `Del ${formatArDay(from)} al ${formatArDay(to)}`;

  const presetBtn = (label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  const showSkeleton = loading && !loadedOnce;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liquidación"
        sub="Cuánto le toca a cada persona del reparto por lo que entró en el período, cuánto ya se le pagó y cuánto falta. Registrá cada pago acá."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download /> Bajar CSV
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/socios">
                <Percent /> Reparto
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/gastos">
                <Wallet /> Gastos
              </Link>
            </Button>
          </>
        }
      />

      {/* Período */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Período</p>
            <p className="text-lg font-semibold">{periodLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap rounded-xl border bg-muted/40 p-1">
              {presetBtn("Este mes", isThisMonth && !customDates, () => goMonth(yearMonth()))}
              {presetBtn("Mes anterior", isPrevMonth && !customDates, () => goMonth(prevYm))}
              {presetBtn("Este año", isThisYear && !customDates, () => {
                setCustomDates(false);
                setFrom(`${arDay().slice(0, 4)}-01-01`);
                setTo(arDay());
              })}
              {presetBtn("Elegir fechas", customDates || (!isFullMonth && !isThisYear), () => setCustomDates(true))}
            </div>
            {isFullMonth && !customDates ? (
              <div className="inline-flex items-center gap-1 rounded-xl border p-1">
                <button
                  type="button"
                  className="rounded-lg p-2 hover:bg-muted"
                  onClick={() => goMonth(addMonthsYm(ym, -1))}
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 hover:bg-muted disabled:opacity-40"
                  onClick={() => goMonth(addMonthsYm(ym, 1))}
                  disabled={ym >= yearMonth()}
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {customDates || (!isFullMonth && !isThisYear) ? (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 sm:flex sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="liq-from" className="text-xs">Desde</Label>
              <Input id="liq-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="liq-to" className="text-xs">Hasta</Label>
              <Input id="liq-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button variant="outline" size="sm" onClick={() => setFrom(`${arDay().slice(0, 4)}-01-01`)}>
              Desde el 1 de enero
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTo(arDay())}>
              Hasta hoy
            </Button>
          </div>
        ) : null}
      </div>

      {/* Resumen */}
      {showSkeleton ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Falta pagar"
            value={money(totalPending)}
            hint="Entre todas las personas del reparto"
            tone={totalPending > 0 ? "pending" : "ok"}
            icon={<HandCoins />}
          />
          <KpiCard
            label="Ya se pagó"
            value={money(totalPaid)}
            hint="Pagos registrados en el período"
            tone="ok"
            icon={<CheckCircle2 />}
          />
          <KpiCard
            label="Retenida por MP"
            value={money(totalFeeHeld)}
            hint={
              totalFeeHeld
                ? `${heldCount} ${heldCount === 1 ? "venta" : "ventas"} · se libera a los ${FEE_RELEASE_DAYS} días, todavía no se reparte`
                : "Nada esperando a Mercado Pago"
            }
            tone="muted"
            icon={<Clock />}
          />
          <KpiCard
            label="Gastos del período"
            value={money(caja?.period.expenses || 0)}
            hint={`${caja?.expenseCount || 0} ${caja?.expenseCount === 1 ? "gasto" : "gastos"} · salen de la caja`}
            href="/gastos"
            icon={<Receipt />}
          />
        </div>
      )}

      {/* Una tarjeta por persona */}
      <Section
        title="Cuánto le toca a cada uno"
        description="Suma de las cuatro bolsas en el período. Tocá «Registrar pago» cuando le transfieras."
      >
        {showSkeleton ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : !partners.length ? (
          <EmptyState title="Todavía no hay personas en el reparto">
            Cargalas con su porcentaje en la pantalla <Link href="/socios" className="font-medium text-primary underline">Reparto</Link>.
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {partners.map((p) => {
              const perBag = BAG_ORDER.map((s) => ({ s, item: itemsFor(s).find((i) => i.partner_id === p.id) }));
              const share = perBag.reduce((a, b) => a + (b.item?.share || 0), 0);
              const paid = perBag.reduce((a, b) => a + (b.item?.paid || 0), 0);
              const pend = perBag.reduce((a, b) => a + (b.item?.pending || 0), 0);
              const pct = share > 0 ? Math.min(100, Math.round((paid / share) * 100)) : 0;
              const isCaja = !!caja?.partner_id && caja.partner_id === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-sm",
                    pend > 0 ? "border-warning/40" : share > 0 && "border-success/30",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.pct}% general</p>
                    </div>
                    {isCaja ? <Badge variant="secondary">Caja de Prodi</Badge> : null}
                  </div>

                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-muted-foreground">Le toca</dt>
                      <dd className="font-medium tabular-nums">{money(share)}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-muted-foreground">Ya se le pagó</dt>
                      <dd className="tabular-nums text-success">{money(paid)}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 border-t pt-1.5">
                      <dt className="font-medium">Falta pagar</dt>
                      <dd className={cn("text-xl font-bold tabular-nums", pend > 0 ? "text-warning" : "text-success")}>
                        {money(pend)}
                      </dd>
                    </div>
                  </dl>

                  {share > 0 ? (
                    <div className="mt-2">
                      <Progress value={pct} className="h-1.5 [&>div]:bg-success" />
                      <p className="mt-1 text-xs text-muted-foreground">{pct}% pagado</p>
                    </div>
                  ) : null}

                  <ul className="mt-3 space-y-1 text-xs">
                    {perBag
                      .filter((b) => (b.item?.share || 0) > 0 || (b.item?.paid || 0) > 0)
                      .map(({ s, item }) => (
                        <li key={s} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-muted-foreground">
                            {BAG[s].title} · {item?.pct}%
                          </span>
                          <span className={cn("shrink-0 tabular-nums", (item?.pending || 0) > 0 ? "text-warning" : "text-success")}>
                            {(item?.pending || 0) > 0 ? `falta ${money(item?.pending)}` : "pagado"}
                          </span>
                        </li>
                      ))}
                  </ul>

                  {isCaja ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Lo que se le paga a {p.name} va a la caja de Prodi; de ahí salen los gastos.
                    </p>
                  ) : null}

                  <div className="mt-auto pt-4">
                    <Button className="w-full" disabled={pend <= 0} onClick={() => openPayForPartner(p)}>
                      <HandCoins /> {pend > 0 ? "Registrar pago" : "Está al día"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Caja y gastos */}
      <Section
        title={`Caja de Prodi${caja?.partner_name ? ` · ${caja.partner_name}` : ""}`}
        description={
          caja?.partner_name
            ? `Lo que se le pagó a ${caja.partner_name} menos los gastos.`
            : "Lo pagado a la caja menos los gastos. Elegí quién es la caja en la pantalla Reparto."
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/gastos">
              <Wallet /> Ver gastos
            </Link>
          </Button>
        }
      >
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Entró a la caja (período)</p>
              <p className="text-lg font-bold tabular-nums">{money(caja?.period.transferred || 0)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Menos gastos ({caja?.expenseCount || 0})</p>
              <p className="text-lg font-bold tabular-nums text-destructive">− {money(caja?.period.expenses || 0)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Queda en el período</p>
              <p
                className={cn(
                  "text-lg font-bold tabular-nums",
                  (caja?.period.saldo || 0) < 0 ? "text-destructive" : "text-success",
                )}
              >
                {money(caja?.period.saldo || 0)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Ahorro acumulado (siempre)</p>
              <p className="text-lg font-bold tabular-nums">{money(caja?.allTime.saldo || 0)}</p>
            </div>
          </div>
          {caja?.expenseCount ? (
            <div className="mt-4 space-y-2 border-t pt-3">
              <div className="flex flex-wrap gap-1.5">
                {caja.expensesByCategory.map((c) => (
                  <Badge key={c.category} variant="outline" className="font-normal">
                    {expenseCategoryLabel(c.category)} · <span className="ml-1 tabular-nums">{money(c.amount)}</span>
                  </Badge>
                ))}
              </div>
              {caja.expensesByPartner.some((p) => p.partner_id) ? (
                <div className="flex flex-wrap gap-1.5">
                  {caja.expensesByPartner.map((p) => (
                    <Badge key={p.partner_id || "caja"} variant="secondary" className="font-normal">
                      {p.partner_name} · <span className="ml-1 tabular-nums">{money(p.amount)}</span>
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Sin gastos registrados en este período.</p>
          )}
        </div>
      </Section>

      {/* Por bolsa */}
      <Section
        title="Por bolsa"
        description="De dónde sale la plata: elegí una bolsa para ver cuánto le toca a cada uno de esa bolsa y el detalle por cliente."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {BAG_ORDER.map((s) => (
            <KpiCard
              key={s}
              label={BAG[s].title}
              value={bagMoney(s, bags[s].total)}
              hint={bags[s].pending ? `Falta pagar ${bagMoney(s, bags[s].pending)}` : "Nada pendiente"}
              tone={bag === s ? undefined : bags[s].pending ? "pending" : undefined}
              active={bag === s}
              onClick={() => setBag(s)}
            />
          ))}
        </div>

        <div className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-base font-semibold">{BAG[bag].title}</h3>
              <p className="text-xs text-muted-foreground">{current.hint}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {current.count} {current.countLabel}
                {bag === "fee" && releasedUntil ? ` · disponible hasta el ${formatArDay(releasedUntil)}` : ""}
                {bag === "fee" && totalFeeHeld
                  ? ` · ${money(totalFeeHeld)} retenida por MP (${heldCount} ${heldCount === 1 ? "venta" : "ventas"})`
                  : ""}
              </p>
            </div>
            {bag === "extra" ? (
              <Button size="sm" onClick={() => setExtraOpen(true)} className="shrink-0">
                <Plus /> Registrar trabajo extra
              </Button>
            ) : null}
          </div>

          {loading && loadedOnce ? <p className="text-xs text-muted-foreground">Actualizando…</p> : null}

          {!currentItems.some((i) => i.share > 0 || i.paid > 0) ? (
            <EmptyState title={current.empty} />
          ) : (
            <>
              {/* Celular */}
              <div className="space-y-2 md:hidden">
                {currentItems.map((item) => (
                  <div key={`${item.source}-${item.partner_id}-m`} className="rounded-xl border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{item.partner_name}</p>
                      <span className="text-xs text-muted-foreground">{item.pct}%</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Le toca</p>
                        <p className="text-sm tabular-nums">{money(item.share)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Pagado</p>
                        <p className="text-sm tabular-nums">{money(item.paid)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Falta</p>
                        <p className={cn("text-sm font-semibold tabular-nums", item.pending ? "text-warning" : "text-success")}>
                          {money(item.pending)}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={item.pending > 0 ? "default" : "outline"}
                      className="mt-3 w-full"
                      disabled={item.pending <= 0}
                      onClick={() => openPayModal(item)}
                    >
                      {item.pending > 0 ? "Registrar pago" : "Al día"}
                    </Button>
                  </div>
                ))}
              </div>
              {/* Compu */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Persona</th>
                      <th className="py-2 pr-3 text-right font-medium">Le toca</th>
                      <th className="py-2 pr-3 text-right font-medium">Ya se le pagó</th>
                      <th className="py-2 pr-3 text-right font-medium">Falta pagar</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {currentItems.map((item) => (
                      <tr key={`${item.source}-${item.partner_id}`} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <p className="font-medium">{item.partner_name}</p>
                          <p className="text-xs text-muted-foreground">{item.pct}%</p>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{money(item.share)}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{money(item.paid)}</td>
                        <td
                          className={cn(
                            "whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums",
                            item.pending ? "text-warning" : "text-success",
                          )}
                        >
                          {money(item.pending)}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant={item.pending > 0 ? "default" : "outline"}
                            disabled={item.pending <= 0}
                            onClick={() => openPayModal(item)}
                          >
                            {item.pending > 0 ? "Registrar pago" : "Al día"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {bag === "extra" && extraPayments.length ? (
            <div className="space-y-2 border-t pt-4">
              <h4 className="text-sm font-semibold">Trabajos extra cargados</h4>
              <ul className="divide-y rounded-xl border">
                {extraPayments.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{e.payer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fecha(e.paid_at)}
                        {e.notes ? ` · ${e.notes}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{money(e.amount)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => setConfirmState({ kind: "extra", item: e })}
                      aria-label="Anular trabajo extra"
                      title="Anular"
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <BreakdownTable
          rows={current.breakdown}
          amountLabel={current.amountLabel}
          title={current.detailTitle}
          partners={partners}
        />
      </Section>

      {/* Historial */}
      <Section
        title="Pagos registrados"
        description={`Lo que ya se le pagó a cada uno en el período.${visiblePayouts.length ? ` Total ${money(payoutSum)}.` : ""}`}
      >
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Select value={payoutPartner || "all"} onValueChange={(v) => setPayoutPartner(v === "all" ? "" : v)}>
            <SelectTrigger className="sm:w-48" aria-label="Persona">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las personas</SelectItem>
              {partners.map((p) => (
                <SelectItem key={p.id} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={payoutSource || "all"} onValueChange={(v) => setPayoutSourceFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="sm:w-56" aria-label="Bolsa">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las bolsas</SelectItem>
              {BAG_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {BAG[s].title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!visiblePayouts.length ? (
          <EmptyState title="Todavía no hay pagos registrados">
            Cuando le transfieras a alguien, tocá «Registrar pago» en su tarjeta.
          </EmptyState>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card shadow-sm">
            {visiblePayouts.map((p) => {
              const src = parsePayoutSource(p.source);
              return (
                <li key={p.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.partner_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fecha(p.paid_at)} · por {formatArDay(String(p.period_from).slice(0, 10))} →{" "}
                        {formatArDay(String(p.period_to).slice(0, 10))}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums sm:hidden">{money(p.amount)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={src} onValueChange={(v) => setPayoutSource(p, parsePayoutSource(v))}>
                      <SelectTrigger className="h-9 flex-1 sm:w-48" aria-label="De qué bolsa es este pago">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BAG_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>
                            {BAG[s].title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="hidden w-28 shrink-0 text-right font-semibold tabular-nums sm:inline">
                      {money(p.amount)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setConfirmState({ kind: "undo", payout: p })}
                    >
                      <Undo2 /> Anular
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Registrar pago */}
      <Dialog open={!!payModal} onOpenChange={(v) => !v && !paying && setPayModal(null)}>
        <DialogContent className="max-w-md">
          {payModal ? (
            <>
              <DialogHeader>
                <DialogTitle>Registrar pago a {payModal.partnerName}</DialogTitle>
                <DialogDescription>
                  Elegí de qué bolsa es y cuánto le transferiste.
                  {payModal.source === "fee"
                    ? ` En Comisiones solo se paga lo disponible (Mercado Pago la libera a los ${FEE_RELEASE_DAYS} días).`
                    : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Bolsa</Label>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Bolsa del pago">
                    {BAG_ORDER.map((s) => {
                      const pend = pendingForSource(payModal.partnerId, s);
                      const active = payModal.source === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={paying || pend <= 0}
                          onClick={() => setPayModal({ ...payModal, source: s, amount: String(pend) })}
                          className={cn(
                            "rounded-xl border p-3 text-left transition-colors disabled:opacity-40",
                            active ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20" : "hover:border-primary/40",
                          )}
                        >
                          <p className="text-sm font-medium">{BAG[s].title}</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {pend > 0 ? `Falta ${money(pend)}` : "Nada pendiente"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="liq-pay-amount">
                    Monto · falta pagar {money(pendingForSource(payModal.partnerId, payModal.source))}
                  </Label>
                  <Input
                    id="liq-pay-amount"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={pendingForSource(payModal.partnerId, payModal.source)}
                    value={payModal.amount}
                    disabled={paying}
                    autoFocus
                    onChange={(e) => setPayModal({ ...payModal, amount: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmPay();
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Si le pagaste una parte, poné solo ese monto.</p>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" disabled={paying} onClick={() => setPayModal(null)}>
                  Cancelar
                </Button>
                <Button disabled={paying} onClick={confirmPay}>
                  {paying ? "Guardando…" : "Registrar pago"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Registrar trabajo extra */}
      <Dialog open={extraOpen} onOpenChange={(v) => !extraSaving && setExtraOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar trabajo extra</DialogTitle>
            <DialogDescription>Un cobro por fuera de las apps. Se reparte con el % general de cada persona.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="liq-extra-name">Quién pagó (empresa o persona)</Label>
              <Input
                id="liq-extra-name"
                value={extraName}
                onChange={(e) => setExtraName(e.target.value)}
                placeholder="Ej: Estudio López"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="liq-extra-amount">Monto ($)</Label>
                <Input
                  id="liq-extra-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={extraAmount}
                  onChange={(e) => setExtraAmount(e.target.value)}
                  placeholder="100000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="liq-extra-date">Fecha</Label>
                <Input id="liq-extra-date" type="date" value={extraDate} onChange={(e) => setExtraDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="liq-extra-notes">Notas</Label>
              <Input
                id="liq-extra-notes"
                value={extraNotes}
                onChange={(e) => setExtraNotes(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={extraSaving} onClick={() => setExtraOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={extraSaving} onClick={addExtra}>
              <Plus /> {extraSaving ? "Guardando…" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmState}
        danger
        busy={confirmBusy}
        title={confirmState?.kind === "undo" ? "¿Anular este pago?" : "¿Anular este trabajo extra?"}
        body={
          confirmState?.kind === "undo"
            ? `Se borra el pago de ${money(confirmState.payout.amount)} a ${confirmState.payout.partner_name} y vuelve a figurar como pendiente.`
            : confirmState?.kind === "extra"
              ? `Se saca el cobro de ${confirmState.item.payer_name} (${money(confirmState.item.amount)}) y deja de repartirse.`
              : undefined
        }
        confirmLabel="Anular"
        onCancel={() => setConfirmState(null)}
        onConfirm={runConfirm}
      />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5" /> Las comisiones de Mercado Pago se pueden repartir recién a los {FEE_RELEASE_DAYS} días de cada venta.
      </p>
    </div>
  );
}
