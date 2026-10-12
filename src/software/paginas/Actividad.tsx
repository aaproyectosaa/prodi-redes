import { useCallback, useEffect, useState } from "react";
import { Drawer } from "@/software/ui/Drawer";
import { EmptyState } from "@/software/ui/EmptyState";
import { FilterBar } from "@/software/ui/FilterBar";
import { PageHeader } from "@/software/ui/PageHeader";
import { activityTypeEs } from "@/software/lib/labels";
import { swFetch } from "@/software/compat";

type Row = {
  id: string;
  type: string;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

const TYPES = [
  "",
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

  return (
    <div>
      <PageHeader
        title="Actividad"
        sub="Lo que el panel fue registrando: sync, transferencias, altas y cambios."
      />
      <FilterBar activeCount={Number(Boolean(type)) + Number(Boolean(q)) + Number(Boolean(from || to))}>
        <div className="field" style={{ margin: 0 }}>
          <label>Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t || "all"} value={t}>
                {t ? activityTypeEs(t) : "Todos"}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Buscar</label>
          <input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onBlur={() => setQ(qDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(qDraft);
            }}
            placeholder="Texto del evento…"
          />
        </div>
      </FilterBar>

      {loading ? <p className="meta">Cargando…</p> : null}

      {!loading && !rows.length ? (
        <EmptyState title="Sin actividad con estos filtros" />
      ) : (
        <div className="timeline">
          {Array.from(
            rows.reduce((map, row) => {
              const day = new Date(row.created_at).toLocaleDateString("es-AR", {
                timeZone: "America/Argentina/Buenos_Aires",
                weekday: "long",
                day: "numeric",
                month: "long",
              });
              const list = map.get(day) || [];
              list.push(row);
              map.set(day, list);
              return map;
            }, new Map<string, Row[]>()),
          ).map(([day, list]) => (
            <section key={day} className="day-block card">
              <h3>{day}</h3>
              {list.map((r) => (
                <button key={r.id} type="button" className="event-row" onClick={() => setOpen(r)}>
                  <span className="meta">
                    {new Date(r.created_at).toLocaleTimeString("es-AR", {
                      timeZone: "America/Argentina/Buenos_Aires",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="pill pending">{activityTypeEs(r.type)}</span>
                  <span>{r.message}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      <Drawer open={Boolean(open)} title={open ? activityTypeEs(open.type) : ""} onClose={() => setOpen(null)}>
        {open ? (
          <>
            <p style={{ margin: 0 }}>{open.message}</p>
            <div className="meta">
              {new Date(open.created_at).toLocaleString("es-AR", {
                timeZone: "America/Argentina/Buenos_Aires",
              })}
            </div>
            {open.meta && Object.keys(open.meta).length ? (
              <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "0.78rem" }}>
                {JSON.stringify(open.meta, null, 2)}
              </pre>
            ) : (
              <p className="meta">Sin detalle extra.</p>
            )}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
