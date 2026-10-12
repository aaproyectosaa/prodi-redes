import { useEffect, useState } from "react";
import { CheckCircle2, Clock, HandCoins } from "lucide-react";
import { PageShell, Section } from "@/components/redes/PageShell";
import { MesNav } from "@/components/redes/admin/FacturaPartes";
import { Button } from "@/components/ui/button";
import { fechaCorta, formatARS, mesActual } from "@/lib/redes/format";
import { swFetch } from "@/software/compat";

type Parte = { share?: number; paid?: number; pending?: number } | null;
type Datos = {
  nombre: string;
  pct: number;
  desde: string;
  hasta: string;
  liberadoHasta?: string;
  diasParaLiberar?: number;
  total: { corresponde: number; cobrado: number; falta: number };
  porOrigen: { fees: Parte; mantenimientos: Parte; extras: Parte; suscripciones: Parte };
  transferencias: Array<{ id: string; amount: number; paid_at: string | null; notes: string | null; source: string }>;
};

const ORIGENES: Array<[keyof Datos["porOrigen"], string]> = [
  ["fees", "Comisiones de pagos (apps de Mercado Pago)"],
  ["suscripciones", "Suscripciones"],
  ["mantenimientos", "Mantenimientos"],
  ["extras", "Trabajos extra"],
];

/** Prodi Software: lo que le toca a cada programador por su porcentaje (mismo cálculo que la liquidación). */
export default function MisGananciasSoftware() {
  const [mes, setMes] = useState(mesActual());
  const [anio, setAnio] = useState(false);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setError("");
    swFetch(`/api/mis-ganancias?mes=${anio ? "" : mes}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) setError(d.error ?? "No se pudo cargar.");
        else setDatos(d as Datos);
      })
      .catch(() => vivo && setError("No se pudo cargar."));
    return () => {
      vivo = false;
    };
  }, [mes, anio]);

  return (
    <PageShell
      title="Mis ganancias"
      subtitle={datos ? `Prodi Software · tu parte es el ${datos.pct}%` : "Prodi Software"}
      actions={
        <div className="flex items-center gap-2">
          {!anio && <MesNav mes={mes} setMes={setMes} max={mesActual()} />}
          <Button variant={anio ? "default" : "outline"} size="sm" onClick={() => setAnio((a) => !a)}>
            {anio ? "Ver por mes" : "Todo el año"}
          </Button>
        </div>
      }
    >
      {error && <p className="rounded-lg border p-4 text-sm text-muted-foreground">{error}</p>}
      {!error && !datos && <p className="p-4 text-sm text-muted-foreground">Cargando…</p>}
      {datos && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tarjeta icono={<HandCoins className="h-4 w-4" />} titulo="Te corresponde" valor={datos.total.corresponde} />
            <Tarjeta icono={<CheckCircle2 className="h-4 w-4" />} titulo="Ya cobraste" valor={datos.total.cobrado} />
            <Tarjeta icono={<Clock className="h-4 w-4" />} titulo="Falta cobrar" valor={datos.total.falta} />
          </div>
          {datos.liberadoHasta && (
            <p className="text-xs text-muted-foreground">
              Las comisiones de Mercado Pago se liberan a los {datos.diasParaLiberar ?? 0} días: cuenta lo cobrado hasta el {fechaCorta(datos.liberadoHasta)}.
            </p>
          )}

          <Section title="De dónde sale">
            <div className="divide-y rounded-lg border">
              {ORIGENES.map(([k, nombre]) => {
                const p = datos.porOrigen[k];
                return (
                  <div key={k} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>{nombre}</span>
                    <span className="text-right tabular-nums">
                      <span className="font-semibold">{formatARS(p?.share ?? 0)}</span>
                      {(p?.pending ?? 0) > 0 && <span className="block text-xs text-muted-foreground">falta {formatARS(p?.pending ?? 0)}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Transferencias que recibiste">
            {datos.transferencias.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguna en este período.</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {datos.transferencias.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>
                      {t.paid_at ? fechaCorta(String(t.paid_at)) : "—"}
                      {t.notes && <span className="block text-xs text-muted-foreground">{t.notes}</span>}
                    </span>
                    <span className="font-semibold tabular-nums">{formatARS(Number(t.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </PageShell>
  );
}

function Tarjeta({ icono, titulo, valor }: { icono: React.ReactNode; titulo: string; valor: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icono}
        {titulo}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{formatARS(valor)}</div>
    </div>
  );
}
