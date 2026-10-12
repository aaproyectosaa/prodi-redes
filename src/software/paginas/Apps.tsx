import Link from "@/software/compat";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/software/compat";
import { PageHeader } from "@/software/ui/PageHeader";
import { relTime } from "@/software/lib/labels";
import { statusTone } from "@/software/lib/labels";
import type { MpAppPublic } from "@/software/lib/types";
import { swFetch } from "@/software/compat";

type AppRow = MpAppPublic & {
  counts?: { clients: number; payments: number; subscriptions: number };
};

export default function AppsPage() {
  const showToast = useToast();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);

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
    showToast("Sincronizando fees QR + clientes…");
    try {
      const res = await swFetch(`/api/apps/${id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 30, purgeOthers: true }),
      });
      const data = await res.json();
      if (!res.ok) showToast(data.error || "Error al sync");
      else {
        await swFetch("/api/clients?backfill=1");
        showToast(`${data.imported} pagos con fee detectados`);
      }
      load();
    } finally {
      setSyncing(null);
    }
  };

  const webhookPending = apps.some((a) => a.webhook_status !== "ok");

  return (
    <div>
      <PageHeader
        title="Apps Mercado Pago"
        sub="Credenciales, webhook y sync de fees."
        actions={
          <Link className="btn" href="/apps/new">
            + Nueva app
          </Link>
        }
      />

      {webhookPending ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <strong style={{ color: "var(--pending)" }}>Webhook pendiente</strong>
          <p className="meta" style={{ margin: "0.35rem 0 0" }}>
            Para detectar QR al instante, en MP Developers → Webhooks cargá la URL de
            esta app (la que figura al editarla, pagos / payment). El Sync
            igual los busca cada vez que abrís el panel o tocás Sync.
          </p>
        </div>
      ) : null}

      {loading ? <p className="meta">Cargando…</p> : null}

      {!loading && !apps.length ? (
        <div className="card empty">
          No hay apps todavía. Cargá la app de Mercado Pago (Client ID / Secret / Token).
          <div style={{ marginTop: 12 }}>
            <Link className="btn" href="/apps/new">
              Cargar app MP
            </Link>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Estado</th>
                  <th>Clientes</th>
                  <th>Pagos</th>
                  <th>Planes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <div className="meta">
                        {a.mp_nickname ? `@${a.mp_nickname}` : "Sin nickname"}
                        {a.last_sync_at ? ` · sync ${relTime(a.last_sync_at)}` : ""}
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${statusTone(a.connection_status)}`}>
                        {a.connection_status === "ok" ? "Conectada" : a.connection_status === "error" ? "Error" : "Pendiente"}
                      </span>
                      <div className="meta">
                        webhook {a.webhook_status === "ok" ? "ok" : a.webhook_status}
                      </div>
                    </td>
                    <td>{a.counts?.clients || 0}</td>
                    <td>{a.counts?.payments || 0}</td>
                    <td>{a.counts?.subscriptions || 0}</td>
                    <td>
                      <div className="actions">
                        <button className="btn sm line" type="button" disabled={syncing === a.id} onClick={() => sync(a.id)}>
                          {syncing === a.id ? "Sync…" : "Sync"}
                        </button>
                        <Link className="btn sm line" href={`/payments?appId=${a.id}`}>Pagos</Link>
                        <Link className="btn sm" href={`/apps/${a.id}`}>Credenciales</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
