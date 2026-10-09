import { useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { useFacturasHistoricas, type FacturaHistorica } from "@/lib/redes/facturacion";
import { formatARS } from "@/lib/redes/format";
import { cn } from "@/lib/utils";
import { useAppData } from "@/contexts/app-data-context";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const ddmmaa = (f: string) => f.split("-").reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join("/");

/** Lo que se le facturó a un cliente antes del sistema (planilla). Si no hay nada, no muestra nada. */
export function HistorialFacturas({ proyectoId, lista, abierto = false }: { proyectoId?: string; lista?: FacturaHistorica[]; abierto?: boolean }) {
  const propias = useFacturasHistoricas(proyectoId ?? null, !lista && !!proyectoId);
  const facturas = lista ?? propias;
  const [ver, setVer] = useState(abierto);
  if (!facturas.length) return null;
  const total = facturas.reduce((a, f) => a + (f.cobrado || f.bruto || f.neto), 0);
  const meses = [...new Set(facturas.map((f) => f.mes))];
  return (
    <div className="rounded-2xl border bg-card">
      <button type="button" onClick={() => setVer((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <History className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Historial de la planilla</span>
          <span className="block text-xs text-muted-foreground">
            {meses.length} {meses.length === 1 ? "mes" : "meses"} · {nombreMes(meses[meses.length - 1])} a {nombreMes(meses[0])} · cobrado {formatARS(total)}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", ver && "rotate-180")} />
      </button>
      {ver && (
        <ul className="divide-y border-t text-sm">
          {facturas.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-28 shrink-0 capitalize">{nombreMes(f.mes)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {[f.servicio !== "REDES" ? f.servicio.toLowerCase() : null, f.fecha_pago ? `pagó el ${ddmmaa(f.fecha_pago)}` : null, f.forma?.toLowerCase()].filter(Boolean).join(" · ")}
              </span>
              <span className="tabular-nums">{formatARS(f.cobrado || f.bruto || f.neto)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Clientes que ya no están (de la planilla): quedan inactivos, sin chats ni boletas, solo con su historial. */
export function ClientesViejos() {
  const { projects } = useAppData();
  const todas = useFacturasHistoricas(null);
  const viejos = projects.filter((p) => (p as { cliente_viejo?: boolean }).cliente_viejo);
  if (!viejos.length) return null;
  return (
    <div className="mt-8 space-y-3">
      <div>
        <p className="font-semibold">Clientes viejos ({viejos.length})</p>
        <p className="text-xs text-muted-foreground">Ya no están. Quedan acá con lo que se les facturó, según la planilla.</p>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {viejos
          .map((p) => ({ p, lista: todas.filter((f) => f.proyecto_id === p.id) }))
          .sort((a, b) => (b.lista[0]?.mes ?? "").localeCompare(a.lista[0]?.mes ?? "") || a.p.nombre.localeCompare(b.p.nombre))
          .map(({ p, lista }) => (
            <div key={p.id} className="space-y-1">
              <p className="px-1 text-sm font-medium">{p.nombre}</p>
              {lista.length ? <HistorialFacturas lista={lista} /> : <p className="px-1 text-xs text-muted-foreground">Sin facturas cargadas.</p>}
            </div>
          ))}
      </div>
    </div>
  );
}
