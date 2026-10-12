import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FastForward,
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Wallet,
} from "lucide-react";
import { useToast, swFetch } from "@/software/compat";
import { addMonthsYm, money, yearMonth } from "@/software/lib/money";
import { mesLabel } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/software/ui/PageHeader";
import { KpiCard } from "@/software/ui/KpiCard";
import { StatusPill } from "@/software/ui/StatusPill";
import { EmptyState } from "@/software/ui/EmptyState";
import { ConfirmDialog } from "@/software/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

type Confirm =
  | { kind: "unmark"; client: ClientRow }
  | { kind: "archive"; client: ClientRow }
  | null;

function labelYm(ym: string) {
  return mesLabel(ym);
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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
      setCreating(false);
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
    setSaving(true);
    try {
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
    } finally {
      setSaving(false);
    }
  };

  const archive = async (c: ClientRow) => {
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

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === "unmark") await unmark(confirm.client);
      else await archive(confirm.client);
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const isAdvance = (c: ClientRow) =>
    Boolean(c.payment_id && c.paid_at && yearMonth(new Date(c.paid_at)) !== month);

  const pending = clients.filter((c) => !c.payment_id);
  const paid = clients.filter((c) => c.payment_id);
  const advanced = paid.filter(isAdvance);
  const recurring = clients.reduce((a, c) => a + Number(c.monthly_amount || 0), 0);
  const pendingTotal = pending.reduce((a, c) => a + Number(c.monthly_amount || 0), 0);
  const paidTotal = paid.reduce(
    (a, c) => a + Number(c.paid_amount || c.monthly_amount || 0),
    0,
  );
  const visible =
    focus === "pending" ? pending : focus === "paid" ? paid : clients;
  const isCurrent = month === yearMonth();

  const editingClient = editing ? clients.find((c) => c.id === editing) || null : null;
  const formOpen = creating || Boolean(editing);
  const closeForm = () => {
    if (saving) return;
    setCreating(false);
    setEditing(null);
  };

  const payFree = payClient
    ? payMonths.filter((ym) => !(payClient.paid_months || []).includes(ym)).length
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Abonos de mantenimiento"
        sub="Lo que cada cliente paga por mes por el mantenimiento. Marcá quién ya pagó o adelantá meses: la plata cuenta en el mes en que entró."
        actions={
          list === "active" ? (
            <Button
              onClick={() => {
                setEditing(null);
                setCreating(true);
              }}
            >
              <Plus /> Nuevo cliente
            </Button>
          ) : null
        }
      />

      {/* Mes */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg"
            onClick={() => setMonth(addMonthsYm(month, -1))}
            aria-label="Mes anterior"
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-semibold">
            {labelYm(month)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg"
            onClick={() => setMonth(addMonthsYm(month, 1))}
            aria-label="Mes siguiente"
          >
            <ChevronRight />
          </Button>
        </div>
        {!isCurrent ? (
          <Button variant="outline" size="sm" onClick={() => setMonth(yearMonth())}>
            Volver a este mes
          </Button>
        ) : null}
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Cobrado"
          value={money(collectedInMonth)}
          hint={`${collectedCount} cobro${collectedCount === 1 ? "" : "s"} en ${labelYm(month)}`}
          tone="ok"
          icon={<Wallet />}
          active={focus === "all"}
          onClick={() => setFocus("all")}
        />
        <KpiCard
          label="Pendiente"
          value={money(pendingTotal)}
          hint={`${pending.length} cliente${pending.length === 1 ? "" : "s"} sin pagar`}
          tone={pendingTotal ? "pending" : "ok"}
          icon={<Clock />}
          active={focus === "pending"}
          onClick={() => setFocus(focus === "pending" ? "all" : "pending")}
        />
        <KpiCard
          label="Al día / Adelantado"
          value={money(paidTotal)}
          hint={`${paid.length} al día · ${advanced.length} adelantado${advanced.length === 1 ? "" : "s"}`}
          icon={<FastForward />}
          active={focus === "paid"}
          onClick={() => setFocus(focus === "paid" ? "all" : "paid")}
        />
        <KpiCard
          label="Abono mensual total"
          value={money(recurring)}
          hint="Suma de todos los clientes de la lista"
          tone="muted"
          icon={<Repeat />}
        />
      </div>

      {/* Lista */}
      <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {focus === "pending"
                ? "Pendientes"
                : focus === "paid"
                  ? "Al día"
                  : list === "archived"
                    ? "Clientes archivados"
                    : "Clientes"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {labelYm(month)} · tocá las tarjetas de arriba para filtrar.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Tabs value={list} onValueChange={(v) => setList(v as "active" | "archived")}>
              <TabsList>
                <TabsTrigger value="active">Activos</TabsTrigger>
                <TabsTrigger value="archived">Archivados</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar cliente…"
                className="pl-9"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              clients.length === 0
                ? list === "archived"
                  ? "No hay clientes archivados."
                  : "Todavía no hay clientes de mantenimiento."
                : focus === "pending"
                  ? "Nadie pendiente este mes."
                  : "Nadie al día este mes."
            }
          >
            {clients.length === 0 && list === "active"
              ? "Tocá “Nuevo cliente” para cargar el primero con su abono mensual."
              : focus === "pending"
                ? "Todos pagaron. Bien ahí."
                : null}
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {visible.map((c) => {
              const adv = isAdvance(c);
              return (
                <li
                  key={c.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between",
                    !c.payment_id && list === "active" && "border-warning/40 bg-warning/[0.04]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{c.name}</span>
                      {c.payment_id ? (
                        <StatusPill
                          status="ok"
                          label={`${adv ? "Adelantado" : "Cobrado"} · ${money(c.paid_amount || 0)}`}
                        />
                      ) : (
                        <StatusPill status="pending" label="Pendiente" />
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {money(c.monthly_amount)} / mes
                      </span>
                      {c.prepaid_until ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarCheck className="h-3.5 w-3.5" />
                          Cubierto hasta {labelYm(c.prepaid_until)}
                        </span>
                      ) : null}
                      {c.notes ? <span className="min-w-0 break-words">{c.notes}</span> : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {list === "archived" ? (
                      <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => restore(c)}>
                        <RotateCcw /> Restaurar
                      </Button>
                    ) : c.payment_id ? (
                      <Button
                        className="flex-1 sm:flex-none"
                        variant="outline"
                        onClick={() => openPay(c, 3)}
                      >
                        <FastForward /> Adelantar meses
                      </Button>
                    ) : (
                      <Button className="h-11 flex-1 sm:flex-none" onClick={() => openPay(c, 1)}>
                        <Check /> Marcar cobrado
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          aria-label={`Más opciones de ${c.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setCreating(false);
                            startEdit(c);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" /> Editar
                        </DropdownMenuItem>
                        {!c.payment_id && list === "active" ? (
                          <DropdownMenuItem onClick={() => openPay(c, 3)}>
                            <FastForward className="mr-2 h-4 w-4" /> Adelantar meses
                          </DropdownMenuItem>
                        ) : null}
                        {list === "archived" ? (
                          <DropdownMenuItem onClick={() => openPay(c, c.payment_id ? 3 : 1)}>
                            <Check className="mr-2 h-4 w-4" />{" "}
                            {c.payment_id ? "Adelantar meses" : "Marcar cobrado"}
                          </DropdownMenuItem>
                        ) : null}
                        {c.payment_id ? (
                          <DropdownMenuItem onClick={() => setConfirm({ kind: "unmark", client: c })}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Anular cobro del mes
                          </DropdownMenuItem>
                        ) : null}
                        {list === "active" ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setConfirm({ kind: "archive", client: c })}
                            >
                              <Archive className="mr-2 h-4 w-4" /> Archivar
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Últimos cobros */}
      {recent.length > 0 ? (
        <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
          <div>
            <h2 className="text-base font-semibold">Últimos cobros</h2>
            <p className="text-xs text-muted-foreground">
              Cada fila es un mes cubierto. Si fue adelantado, la fecha es cuando
              entró la plata.
            </p>
          </div>
          <ul className="divide-y">
            {recent.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.client_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Cubre {labelYm(r.year_month)} ·{" "}
                    {r.paid_at ? fmtDateTime(r.paid_at) : "—"}
                  </div>
                  {r.notes ? (
                    <div className="break-words text-xs text-muted-foreground">{r.notes}</div>
                  ) : null}
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {money(r.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Alta / edición */}
      <Dialog open={formOpen} onOpenChange={(v) => !v && closeForm()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingClient ? `Editar ${editingClient.name}` : "Nuevo cliente de mantenimiento"}
            </DialogTitle>
            <DialogDescription>
              El abono es lo que paga por mes. Lo podés cambiar cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (editing) saveEdit(editing);
              else create();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="mant-name">Cliente</Label>
              <Input
                id="mant-name"
                value={editing ? editName : name}
                onChange={(e) => (editing ? setEditName(e.target.value) : setName(e.target.value))}
                placeholder="Ej: Panadería X"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mant-amount">Abono mensual ($)</Label>
              <Input
                id="mant-amount"
                type="number"
                inputMode="numeric"
                min={1}
                value={editing ? editAmount : amount}
                onChange={(e) => (editing ? setEditAmount(e.target.value) : setAmount(e.target.value))}
                placeholder="30000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mant-notes">Notas</Label>
              <Input
                id="mant-notes"
                value={editing ? editNotes : notes}
                onChange={(e) => (editing ? setEditNotes(e.target.value) : setNotes(e.target.value))}
                placeholder="Opcional"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" disabled={saving} onClick={closeForm}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar cliente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cobro / adelanto */}
      <Dialog open={Boolean(payClient)} onOpenChange={(v) => !v && !paying && setPayClient(null)}>
        <DialogContent className="max-w-md">
          {payClient ? (
            <>
              <DialogHeader>
                <DialogTitle>Cobrar a {payClient.name}</DialogTitle>
                <DialogDescription>
                  {money(payClient.monthly_amount)} por mes. Elegí qué meses cubre este
                  pago: la plata cuenta como entrada hoy.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {[
                    { n: 1, label: "Solo este mes" },
                    { n: 3, label: "3 meses" },
                    { n: 6, label: "6 meses" },
                  ].map((o) => (
                    <Button
                      key={o.n}
                      type="button"
                      size="sm"
                      variant={payFree === o.n ? "default" : "outline"}
                      disabled={paying}
                      onClick={() => setPayCount(o.n)}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 12 }, (_, i) => addMonthsYm(month, i)).map((ym) => {
                    const locked = (payClient.paid_months || []).includes(ym);
                    const on = locked || payMonths.includes(ym);
                    return (
                      <button
                        key={ym}
                        type="button"
                        disabled={paying || locked}
                        onClick={() => togglePayMonth(ym, locked)}
                        className={cn(
                          "flex min-h-[44px] flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-xs font-medium transition-colors",
                          on && !locked && "border-primary bg-primary/10 text-primary",
                          locked && "cursor-not-allowed border-success/30 bg-success/10 text-success",
                          !on && "hover:border-primary/40 hover:bg-muted",
                        )}
                      >
                        {mesLabel(ym, { corto: true })}
                        {locked ? <span className="text-[10px] font-normal">ya pagado</span> : null}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mant-pay-notes">Notas del cobro</Label>
                  <Input
                    id="mant-pay-notes"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>

                <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm">
                  {payFree ? (
                    <span>
                      {payFree} mes{payFree === 1 ? "" : "es"} ·{" "}
                      <strong className="tabular-nums">
                        {money(payClient.monthly_amount * payFree)}
                      </strong>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Elegí al menos un mes libre</span>
                  )}
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" disabled={paying} onClick={() => setPayClient(null)}>
                  Cancelar
                </Button>
                <Button disabled={paying || !payFree} onClick={confirmPay}>
                  <Check /> {paying ? "Guardando…" : "Confirmar cobro"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirm)}
        busy={confirmBusy}
        danger
        title={
          confirm?.kind === "unmark"
            ? `¿Anular el cobro de ${confirm.client.name}?`
            : confirm
              ? `¿Archivar ${confirm.client.name}?`
              : ""
        }
        body={
          confirm?.kind === "unmark"
            ? `Se borra el cobro de ${labelYm(month)} y vuelve a quedar pendiente.`
            : "Deja de aparecer en la lista. Lo podés restaurar desde Archivados."
        }
        confirmLabel={confirm?.kind === "unmark" ? "Anular cobro" : "Archivar"}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirm}
      />
    </div>
  );
}
