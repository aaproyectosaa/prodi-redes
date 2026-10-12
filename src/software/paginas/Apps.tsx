import Link from "@/software/compat";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, AppWindow, Check, Copy, CreditCard, Pencil, Plus, RefreshCw, Webhook } from "lucide-react";
import { useToast } from "@/software/compat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/software/ui/PageHeader";
import { EmptyState } from "@/software/ui/EmptyState";
import { StatusPill } from "@/software/ui/StatusPill";
import { relTime } from "@/software/lib/labels";
import type { MpAppPublic } from "@/software/lib/types";
import { swFetch } from "@/software/compat";

type AppRow = MpAppPublic & {
  counts?: { clients: number; payments: number; subscriptions: number };
};

function conexionLabel(s: string) {
  return s === "ok" ? "Conectada" : s === "error" ? "Error de conexión" : "Sin conectar";
}

function webhookLabel(s: string) {
  return s === "ok" ? "Webhook OK" : s === "error" ? "Webhook con error" : "Webhook pendiente";
}

export default function AppsPage() {
  const showToast = useToast();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await swFetch("/api/apps");
      const data = await res.json();
      setApps(data.apps || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sync = async (id: string) => {
    setSyncing(id);
    showToast("Actualizando comisiones y clientes desde Mercado Pago…");
    try {
      const res = await swFetch(`/api/apps/${id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 30, purgeOthers: true }),
      });
      const data = await res.json();
      if (!res.ok) showToast(data.error || "No se pudo actualizar desde Mercado Pago");
      else {
        await swFetch("/api/clients?backfill=1");
        showToast(`Listo: ${data.imported} pagos con comisión encontrados`);
      }
      load();
    } finally {
      setSyncing(null);
    }
  };

  const probarWebhook = async (id: string) => {
    setTesting(id);
    try {
      const res = await swFetch(`/api/apps/${id}/test-webhook`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.webhook_url) setUrls((u) => ({ ...u, [id]: String(data.webhook_url) }));
      showToast(res.ok ? "El webhook respondió bien ✓" : data.error || "El webhook no respondió");
      load();
    } catch {
      showToast("No se pudo probar el webhook");
    } finally {
      setTesting(null);
    }
  };

  const webhookPending = apps.some((a) => a.webhook_status !== "ok");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Apps de Mercado Pago"
        sub="Las cuentas de Mercado Pago de donde salen las comisiones. Desde acá se conectan, se actualizan y se revisa que Mercado Pago avise cada venta."
        actions={
          <Button asChild>
            <Link href="/apps/new">
              <Plus className="mr-1.5 h-4 w-4" />
              Nueva app
            </Link>
          </Button>
        }
      />

      {webhookPending && apps.length ? (
        <div className="flex gap-3 rounded-2xl border border-warning/40 bg-warning/[0.06] p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Falta configurar el webhook en alguna app</p>
            <p className="text-xs text-muted-foreground">
              Para que cada venta aparezca al instante, en Mercado Pago Developers → Tus integraciones → Webhooks pegá la URL de la app (la ves al
              tocar Editar) y marcá el evento “Pagos”. Mientras tanto, “Actualizar desde Mercado Pago” igual trae las ventas cada vez que lo tocás.
            </p>
          </div>
        </div>
      ) : null}

      {loading && !apps.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : !apps.length ? (
        <EmptyState title="Todavía no hay apps">
          <p>Cargá la app de Mercado Pago con su Client ID, Client Secret y Access Token.</p>
          <Button asChild size="sm" className="mt-3">
            <Link href="/apps/new">
              <Plus className="mr-1.5 h-4 w-4" />
              Cargar app de Mercado Pago
            </Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {apps.map((a) => (
            <article key={a.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <AppWindow className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold">{a.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.mp_nickname ? `@${a.mp_nickname}` : "Sin usuario de Mercado Pago"}
                    {a.last_sync_at ? ` · actualizada ${relTime(a.last_sync_at)}` : " · nunca se actualizó"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <StatusPill status={a.connection_status} label={conexionLabel(a.connection_status)} />
                <StatusPill status={a.webhook_status} label={webhookLabel(a.webhook_status)} />
              </div>
              {a.connection_status === "error" && a.connection_error ? (
                <p className="-mt-2 text-xs text-destructive [overflow-wrap:anywhere]">{a.connection_error}</p>
              ) : null}

              <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-3 text-center">
                <Dato label="Clientes" value={a.counts?.clients || 0} />
                <Dato label="Pagos con comisión" value={a.counts?.payments || 0} />
                <Dato label="Planes mensuales" value={a.counts?.subscriptions || 0} />
              </dl>

              {urls[a.id] ? <UrlCopiable url={urls[a.id]} /> : null}

              <div className="mt-auto grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button className="col-span-2 sm:col-auto" disabled={syncing === a.id} onClick={() => sync(a.id)}>
                  <RefreshCw className={`mr-1.5 h-4 w-4 ${syncing === a.id ? "animate-spin" : ""}`} />
                  {syncing === a.id ? "Actualizando…" : "Actualizar desde Mercado Pago"}
                </Button>
                <Button variant="outline" disabled={testing === a.id} onClick={() => probarWebhook(a.id)}>
                  <Webhook className="mr-1.5 h-4 w-4" />
                  {testing === a.id ? "Probando…" : "Probar webhook"}
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/apps/${a.id}`}>
                    <Pencil className="mr-1.5 h-4 w-4" />
                    Editar
                  </Link>
                </Button>
                <Button variant="ghost" asChild className="col-span-2 sm:col-auto">
                  <Link href={`/payments?appId=${a.id}`}>
                    <CreditCard className="mr-1.5 h-4 w-4" />
                    Ver pagos
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Dato({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="text-[11px] leading-tight text-muted-foreground">{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function UrlCopiable({ url }: { url: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-muted/30 p-2">
      <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{url}</code>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => {
          navigator.clipboard?.writeText(url).then(
            () => {
              setOk(true);
              window.setTimeout(() => setOk(false), 1500);
            },
            () => undefined
          );
        }}
      >
        {ok ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
        {ok ? "Copiada" : "Copiar"}
      </Button>
    </div>
  );
}
