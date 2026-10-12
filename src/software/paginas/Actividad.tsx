import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  ArrowDownToLine,
  BadgeDollarSign,
  CalendarClock,
  ChevronRight,
  EyeOff,
  Pencil,
  Percent,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Undo2,
  UsersRound,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer } from "@/software/ui/Drawer";
import { EmptyState } from "@/software/ui/EmptyState";
import { FilterBar } from "@/software/ui/FilterBar";
import { PageHeader } from "@/software/ui/PageHeader";
import { swFetch } from "@/software/compat";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  type: string;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type Tono = "primary" | "success" | "warning" | "destructive" | "muted";

/** Cada tipo de evento: nombre en palabras simples, ícono y color. */
const TIPOS: Record<string, { label: string; icon: LucideIcon; tono: Tono }> = {
  sync: { label: "Actualizado desde Mercado Pago", icon: RefreshCw, tono: "primary" },
  ingest: { label: "Ingreso", icon: ArrowDownToLine, tono: "success" },
  payout: { label: "Pago a cada uno", icon: BadgeDollarSign, tono: "success" },
  payout_undo: { label: "Pago anulado", icon: Undo2, tono: "destructive" },
  subscription: { label: "Plan mensual", icon: CalendarClock, tono: "primary" },
  maintenance: { label: "Abono de mantenimiento", icon: Wrench, tono: "primary" },
  extra: { label: "Trabajo extra", icon: Sparkles, tono: "primary" },
  expense: { label: "Gasto", icon: Receipt, tono: "warning" },
  client_blacklist: { label: "Cliente oculto (no suma)", icon: EyeOff, tono: "warning" },
  client_restore: { label: "Cliente restaurado", icon: RotateCcw, tono: "success" },
  client_rename: { label: "Cambio de nombre", icon: Pencil, tono: "muted" },
  client_pct: { label: "Reparto de un cliente", icon: Percent, tono: "muted" },
  partner_update: { label: "Cambio en el reparto", icon: UsersRound, tono: "muted" },
  app_save: { label: "App de Mercado Pago", icon: AppWindow, tono: "muted" },
  cleanup: { label: "Limpieza", icon: RotateCcw, tono: "muted" },
};

const TIPOS_FILTRO = [
  "sync",
  "ingest",
  "payout",
  "payout_undo",
  "subscription",
  "maintenance",
  "extra",
  "expense",
  "client_blacklist",
  "client_restore",
  "client_rename",
  "client_pct",
  "partner_update",
  "app_save",
];

function tipo(t: string) {
  return TIPOS[t] || { label: t || "Actividad", icon: Sparkles, tono: "muted" as Tono };
}

const TONO_CLS: Record<Tono, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

const TZ = "America/Argentina/Buenos_Aires";

export default function ActivityPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: "200" });
      if (type) p.set("type", type);
      if (q) p.set("q", q);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const res = await swFetch(`/api/activity?${p}`);
      const data = await res.json();
      setRows(data.activity || []);
    } finally {
      setLoading(false);
    }
  }, [type, q, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const porDia = useMemo(
    () =>
      Array.from(
        rows.reduce((map, row) => {
          const day = new Date(row.created_at).toLocaleDateString("es-AR", {
            timeZone: TZ,
            weekday: "long",
            day: "numeric",
            month: "long",
          });
          const list = map.get(day) || [];
          list.push(row);
          map.set(day, list);
          return map;
        }, new Map<string, Row[]>())
      ),
    [rows]
  );

  const activos = Number(Boolean(type)) + Number(Boolean(q)) + Number(Boolean(from || to));
  const limpiar = () => {
    setType("");
    setQ("");
    setQDraft("");
    setFrom("");
    setTo("");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Actividad"
        sub="Todo lo que pasó en Prodi Software: actualizaciones desde Mercado Pago, pagos a cada uno, altas y cambios. Tocá un evento para ver el detalle."
      />

      <FilterBar activeCount={activos}>
        <div className="w-full space-y-1.5 md:w-56">
          <Label className="text-xs">Tipo</Label>
          <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {TIPOS_FILTRO.map((t) => (
                <SelectItem key={t} value={t}>
                  {tipo(t).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label className="text-xs">Desde</Label>
          <Input type="date" className="h-10" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" className="h-10" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="w-full min-w-0 flex-1 space-y-1.5 md:min-w-[200px]">
          <Label className="text-xs">Buscar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 pl-9"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onBlur={() => setQ(qDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setQ(qDraft);
              }}
              placeholder="Texto del evento…"
            />
          </div>
        </div>
        {activos ? (
          <Button variant="ghost" size="sm" className="h-10" onClick={limpiar}>
            <X className="mr-1 h-4 w-4" />
            Limpiar
          </Button>
        ) : null}
      </FilterBar>

      {loading && !rows.length ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState title="Sin actividad con estos filtros">
          {activos ? "Probá con otro tipo o sacá las fechas para ver más." : "Cuando se registre algún movimiento va a aparecer acá."}
        </EmptyState>
      ) : (
        <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
          {porDia.map(([day, list]) => (
            <section key={day} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</h2>
              <ol className="relative space-y-1 rounded-2xl border bg-card p-2 shadow-sm">
                {list.map((r, i) => {
                  const t = tipo(r.type);
                  const Icon = t.icon;
                  return (
                    <li key={r.id} className="relative">
                      {i < list.length - 1 ? <span className="absolute bottom-[-4px] left-[27px] top-11 w-px bg-border" aria-hidden /> : null}
                      <button
                        type="button"
                        onClick={() => setOpen(r)}
                        className="flex w-full items-start gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className={cn("relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-full", TONO_CLS[t.tono])}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-xs font-medium text-muted-foreground">{t.label}</span>
                            <span className="text-xs tabular-nums text-muted-foreground/80">
                              {new Date(r.created_at).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {typeof r.meta?.por === "string" ? <span className="text-xs font-medium text-foreground/80">· {r.meta.por}</span> : null}
                          </span>
                          <span className="mt-0.5 block text-sm [overflow-wrap:anywhere]">{r.message}</span>
                        </span>
                        <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {rows.length >= 200 ? (
            <p className="text-center text-xs text-muted-foreground">Se muestran los últimos 200 eventos. Usá los filtros para buscar más atrás.</p>
          ) : null}
        </div>
      )}

      <Drawer open={Boolean(open)} title={open ? tipo(open.type).label : ""} onClose={() => setOpen(null)}>
        {open ? (
          <>
            <div className="rounded-2xl border bg-muted/30 p-4">
              <p className="text-sm [overflow-wrap:anywhere]">{open.message}</p>
              {typeof open.meta?.por === "string" ? <p className="mt-1 text-sm font-medium">Hecho por {open.meta.por}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {new Date(open.created_at).toLocaleString("es-AR", { timeZone: TZ, dateStyle: "full", timeStyle: "short" })}
              </p>
            </div>
            {open.meta && Object.keys(open.meta).length ? (
              <div className="space-y-2">
                <h3 className="text-base font-semibold">Detalle</h3>
                <dl className="divide-y rounded-2xl border">
                  {Object.entries(open.meta)
                    .filter(([k]) => k !== "por_uid")
                    .map(([k, v]) => (
                    <div key={k} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-3">
                      <dt className="shrink-0 text-xs text-muted-foreground sm:w-32">{k === "por" ? "Hecho por" : k}</dt>
                      <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
                        {v !== null && typeof v === "object" ? (
                          <pre className="whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre>
                        ) : (
                          String(v ?? "—")
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sin detalle extra.</p>
            )}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
