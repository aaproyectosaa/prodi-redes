import Link from "@/software/compat";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { useToast, swFetch } from "@/software/compat";
import { addMonthsYm, arDay, money } from "@/software/lib/money";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/software/lib/expense-category";
import { mesLabel } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/software/ui/PageHeader";
import { KpiCard } from "@/software/ui/KpiCard";
import { EmptyState } from "@/software/ui/EmptyState";
import { ConfirmDialog } from "@/software/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportGastosCsv } from "./export-csv";
import type { Expense, ExpenseTotals, GastoPartner } from "./types";

const EMPTY_TOTALS: ExpenseTotals = {
  total: 0,
  count: 0,
  byCategory: [],
  byPartner: [],
};

/** Valor del Select para "Caja común" (Radix no acepta value vacío). */
const NO_PARTNER = "__caja_comun";

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric",
    month: "short",
  });
}

function fmtRangeDay(day: string) {
  if (!day) return "—";
  return new Date(`${day}T12:00:00-03:00`).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function dayInput(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

const EMPTY_FORM = {
  description: "",
  amount: "",
  category: "otros",
  partnerId: "",
  date: "",
  notes: "",
};

type Mode = "month" | "year" | "custom";

export function GastosClient() {
  const showToast = useToast();
  const today = arDay();
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(monthRange(today.slice(0, 7)).from);
  const [to, setTo] = useState(monthRange(today.slice(0, 7)).to);
  const [items, setItems] = useState<Expense[]>([]);
  const [totals, setTotals] = useState<ExpenseTotals>(EMPTY_TOTALS);
  const [partners, setPartners] = useState<GastoPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [cajaTransferred, setCajaTransferred] = useState(0);
  const [toRemove, setToRemove] = useState<Expense | null>(null);
  const [removing, setRemoving] = useState(false);

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

  const goMonth = (ym: string) => {
    setMode("month");
    setMonth(ym);
    const r = monthRange(ym);
    setFrom(r.from);
    setTo(r.to);
  };

  const goYear = () => {
    const t = arDay();
    setMode("year");
    setFrom(`${t.slice(0, 4)}-01-01`);
    setTo(t);
  };

  const changeMode = (m: Mode) => {
    if (m === "month") goMonth(month);
    else if (m === "year") goYear();
    else setMode("custom");
  };

  const openNew = () => {
    setEditingId(null);
    const t = arDay();
    const defDate = t >= from && t <= to ? t : to || t;
    setForm({ ...EMPTY_FORM, date: defDate, partnerId: caja ? caja.id : "" });
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
    setRemoving(true);
    try {
      const res = await swFetch("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: e.id }),
      });
      const data = await res.json();
      if (!res.ok) showToast(data.error || "Error");
      else {
        showToast("Gasto anulado");
        setToRemove(null);
        load();
      }
    } finally {
      setRemoving(false);
    }
  };

  const average = totals.count ? Math.round(totals.total / totals.count) : 0;
  const assigned = totals.byPartner
    .filter((p) => p.partner_id)
    .reduce((a, p) => a + Number(p.amount || 0), 0);
  const common = totals.total - assigned;
  const cajaSaldo = cajaTransferred - totals.total;

  /** Gastos agrupados por mes (más nuevo primero, como vienen). */
  const groups = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of items) {
      const ym = dayInput(e.paid_at).slice(0, 7);
      const arr = map.get(ym);
      if (arr) arr.push(e);
      else map.set(ym, [e]);
    }
    return Array.from(map.entries()).map(([ym, list]) => ({
      ym,
      list,
      total: list.reduce((a, e) => a + Number(e.amount || 0), 0),
    }));
  }, [items]);

  const maxCat = Math.max(1, ...totals.byCategory.map((c) => Number(c.amount || 0)));
  const periodLabel =
    mode === "month"
      ? mesLabel(month)
      : `${fmtRangeDay(from)} → ${fmtRangeDay(to)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gastos"
        sub="Lo que se paga antes de repartir (sueldos, servicios, herramientas). Se resta de la plata antes del reparto. Podés dejarlo en la caja común o marcar de quién salió."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => exportGastosCsv({ from, to, items, totals })}
            >
              <Download /> Exportar CSV
            </Button>
            <Button onClick={openNew}>
              <Plus /> Cargar gasto
            </Button>
          </>
        }
      />

      {/* Período */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Tabs value={mode} onValueChange={(v) => changeMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="month">Por mes</TabsTrigger>
            <TabsTrigger value="year">Este año</TabsTrigger>
            <TabsTrigger value="custom">Fechas</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "month" ? (
          <div className="inline-flex w-fit items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg"
              onClick={() => goMonth(addMonthsYm(month, -1))}
              aria-label="Mes anterior"
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-[140px] text-center text-sm font-semibold">
              {mesLabel(month)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg"
              onClick={() => goMonth(addMonthsYm(month, 1))}
              disabled={month >= today.slice(0, 7)}
              aria-label="Mes siguiente"
            >
              <ChevronRight />
            </Button>
          </div>
        ) : mode === "custom" ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="gastos-from" className="text-xs text-muted-foreground">
                Desde
              </Label>
              <Input
                id="gastos-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gastos-to" className="text-xs text-muted-foreground">
                Hasta
              </Label>
              <Input
                id="gastos-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setFrom(`${arDay().slice(0, 4)}-01-01`)}
            >
              Inicio del año
            </Button>
            <Button variant="outline" onClick={() => setTo(arDay())}>
              Hasta hoy
            </Button>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{periodLabel}</span>
        )}
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total gastado"
          value={money(totals.total)}
          hint={`${totals.count} gasto${totals.count === 1 ? "" : "s"} · ${periodLabel}`}
          icon={<Receipt />}
        />
        <KpiCard
          label="Promedio"
          value={money(average)}
          hint="Por gasto"
          tone="muted"
          icon={<Receipt />}
        />
        <KpiCard
          label="Salió de alguien del equipo"
          value={money(assigned)}
          hint="Lo pagó una persona del reparto"
          icon={<Users />}
        />
        <KpiCard
          label="Caja común"
          value={money(common)}
          hint="Sin persona asignada"
          icon={<Wallet />}
        />
      </div>

      {/* Caja */}
      {caja ? (
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Caja · {caja.name}</h2>
              <p className="text-xs text-muted-foreground">
                Lo transferido a {caja.name} menos los gastos de este período.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/liquidacion">
                <ArrowRightLeft /> Ver liquidación
              </Link>
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-muted/40 p-3">
              <div className="text-lg font-bold tabular-nums">{money(cajaTransferred)}</div>
              <div className="text-xs text-muted-foreground">Transferido a la caja</div>
            </div>
            <div className="rounded-xl bg-muted/40 p-3">
              <div className="text-lg font-bold tabular-nums">{money(totals.total)}</div>
              <div className="text-xs text-muted-foreground">Gastos del período</div>
            </div>
            <div
              className={cn(
                "rounded-xl p-3",
                cajaSaldo < 0 ? "bg-destructive/10" : "bg-success/10",
              )}
            >
              <div
                className={cn(
                  "text-lg font-bold tabular-nums",
                  cajaSaldo < 0 ? "text-destructive" : "text-success",
                )}
              >
                {money(cajaSaldo)}
              </div>
              <div className="text-xs text-muted-foreground">Saldo de la caja</div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Lista */}
      <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-base font-semibold">Gastos del período</h2>
          <p className="text-xs text-muted-foreground">{periodLabel}</p>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : !items.length ? (
          <EmptyState title="No hay gastos en este período.">
            Tocá “Cargar gasto” para anotar el primero.
          </EmptyState>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.ym} className="space-y-2">
                {groups.length > 1 || mode !== "month" ? (
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <span className="text-sm font-semibold">{mesLabel(g.ym)}</span>
                    <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                      {money(g.total)}
                    </span>
                  </div>
                ) : null}
                <ul className="divide-y">
                  {g.list.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0 break-words font-medium">
                            {e.description}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums sm:hidden">
                            {money(e.amount)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{fmtDay(e.paid_at)}</span>
                          <Badge variant="secondary" className="font-normal">
                            {expenseCategoryLabel(e.category)}
                          </Badge>
                          <span>Salió de: {e.partner_name || "Caja común"}</span>
                        </div>
                        {e.notes ? (
                          <div className="mt-0.5 break-words text-xs text-muted-foreground">
                            {e.notes}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 sm:gap-2">
                        <span className="hidden w-28 text-right font-semibold tabular-nums sm:block">
                          {money(e.amount)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(e)}
                          aria-label="Editar gasto"
                        >
                          <Pencil /> <span className="sm:sr-only">Editar</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setToRemove(e)}
                          aria-label="Anular gasto"
                        >
                          <Trash2 /> <span className="sm:sr-only">Anular</span>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Desgloses */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-base font-semibold">Por categoría</h2>
          {!totals.byCategory.length ? (
            <p className="text-xs text-muted-foreground">Sin datos en este período.</p>
          ) : (
            <ul className="space-y-3">
              {totals.byCategory.map((c) => (
                <li key={c.category} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {expenseCategoryLabel(c.category)}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {c.count}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {money(c.amount)}
                    </span>
                  </div>
                  <Progress value={(Number(c.amount || 0) / maxCat) * 100} className="h-1.5" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="text-base font-semibold">De quién salió</h2>
          {!totals.byPartner.length ? (
            <p className="text-xs text-muted-foreground">Sin datos en este período.</p>
          ) : (
            <ul className="divide-y">
              {totals.byPartner.map((p) => (
                <li
                  key={p.partner_id || "caja"}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">{p.partner_name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {money(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Alta / edición */}
      <Dialog open={open} onOpenChange={(v) => !v && !saving && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar gasto" : "Cargar gasto"}</DialogTitle>
            <DialogDescription>
              Se resta de la plata antes del reparto.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="gasto-desc">Descripción</Label>
              <Input
                id="gasto-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ej: Sueldo Ana"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gasto-monto">Monto ($)</Label>
                <Input
                  id="gasto-monto"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="50000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gasto-fecha">Fecha</Label>
                <Input
                  id="gasto-fecha"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Salió de</Label>
                <Select
                  value={form.partnerId || NO_PARTNER}
                  onValueChange={(v) =>
                    setForm({ ...form, partnerId: v === NO_PARTNER ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {caja ? (
                      <SelectItem value={caja.id}>Caja ({caja.name})</SelectItem>
                    ) : (
                      <SelectItem value={NO_PARTNER}>Caja común</SelectItem>
                    )}
                    {partners
                      .filter((p) => !p.is_cash)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gasto-notas">Notas</Label>
              <Input
                id="gasto-notas"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Opcional"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Cargar gasto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toRemove)}
        busy={removing}
        danger
        title={toRemove ? `¿Anular el gasto "${toRemove.description}"?` : ""}
        body="Deja de restarse antes del reparto."
        confirmLabel="Anular gasto"
        onCancel={() => setToRemove(null)}
        onConfirm={() => toRemove && remove(toRemove)}
      />
    </div>
  );
}
