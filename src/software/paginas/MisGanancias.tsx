import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownLeft, CalendarRange, CheckCircle2, Clock, HandCoins, Info } from "lucide-react";
import { Section } from "@/components/redes/PageShell";
import { MesNav } from "@/components/redes/admin/FacturaPartes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/software/ui/PageHeader";
import { EmptyState } from "@/software/ui/EmptyState";
import { fechaCorta, formatARS, mesActual, mesLabel } from "@/lib/redes/format";
import { swFetch } from "@/software/compat";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { cn } from "@/lib/utils";

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

const ORIGENES: Array<[keyof Datos["porOrigen"], string, string]> = [
  ["fees", "Comisiones", "Lo que gana Prodi Software por cada venta que cobra un cliente con la app de Mercado Pago"],
  ["suscripciones", "Planes mensuales", "Suscripciones de Mercado Pago"],
  ["mantenimientos", "Abonos de mantenimiento", "Lo que pagan los clientes por mes"],
  ["extras", "Trabajos extra", "Cobros sueltos fuera del abono"],
];

function origenTransferencia(source: string) {
  if (source === "maintenance") return "Abono de mantenimiento";
  if (source === "extra") return "Trabajo extra";
  if (source === "subscription") return "Plan mensual";
  return "Comisiones";
}

/** Prodi Software: lo que le toca a cada programador por su porcentaje (mismo cálculo que la liquidación). */
export default function MisGananciasSoftware() {
  const [mes, setMes] = useState(mesActual());
  const [anio, setAnio] = useState(false);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  // Con "Ver como" el admin ve las de esa persona.
  const { user, viewingAs } = useUserProfileContext();
  const como = viewingAs ? user?.uid ?? "" : "";

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setError("");
    swFetch(`/api/mis-ganancias?mes=${anio ? "" : mes}${como ? `&uid=${encodeURIComponent(como)}` : ""}`)
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
  }, [mes, anio, como]);

  const periodo = anio ? "en el año" : `en ${mesLabel(mes)}`;
  const corresponde = datos?.total.corresponde ?? 0;
  const cobrado = datos?.total.cobrado ?? 0;
  const avance = corresponde > 0 ? Math.min(100, Math.round((cobrado / corresponde) * 100)) : 0;
  const maxOrigen = datos ? Math.max(0, ...ORIGENES.map(([k]) => Number(datos.porOrigen[k]?.share ?? 0))) : 0;
  const totalTransferido = datos ? datos.transferencias.reduce((a, t) => a + Number(t.amount || 0), 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={datos?.nombre && viewingAs ? `Ganancias de ${datos.nombre}` : "Mis ganancias"}
        sub={
          datos
            ? `Lo que te toca de Prodi Software por tu ${datos.pct}%, cuánto ya te pagaron y cuánto falta.`
            : "Lo que te toca de Prodi Software por tu porcentaje, cuánto ya te pagaron y cuánto falta."
        }
        actions={
          <>
            {!anio && <MesNav mes={mes} setMes={setMes} max={mesActual()} />}
            <Button variant={anio ? "default" : "outline"} size="sm" className="h-9" onClick={() => setAnio((a) => !a)}>
              <CalendarRange className="mr-1.5 h-4 w-4" />
              {anio ? "Ver por mes" : "Todo el año"}
            </Button>
          </>
        }
      />

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.06] p-4 text-sm text-destructive">{error}</div>
      )}

      {!error && !datos && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      )}

      {datos && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Grande
              icono={<HandCoins />}
              titulo="Te corresponde"
              valor={datos.total.corresponde}
              ayuda={`Tu ${datos.pct}% de lo cobrado ${periodo}`}
              tono="primary"
            />
            <Grande
              icono={<CheckCircle2 />}
              titulo="Ya cobraste"
              valor={datos.total.cobrado}
              ayuda={corresponde > 0 ? `${avance}% de lo que te toca` : "Lo que ya te transfirieron"}
              tono="success"
            />
            <Grande
              icono={<Clock />}
              titulo="Falta cobrar"
              valor={datos.total.falta}
              ayuda={datos.total.falta > 0 ? "Te lo pagan en la próxima liquidación" : "Estás al día"}
              tono={datos.total.falta > 0 ? "warning" : "muted"}
            />
          </div>

          {corresponde > 0 && (
            <div className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium">Cuánto ya cobraste</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatARS(cobrado)} de {formatARS(corresponde)}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-success transition-all" style={{ width: `${avance}%` }} />
              </div>
            </div>
          )}

          {datos.liberadoHasta && (
            <p className="flex items-start gap-2 rounded-2xl border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Mercado Pago retiene las comisiones {datos.diasParaLiberar ?? 0} días antes de dejarlas disponibles: acá cuenta lo cobrado hasta el{" "}
                {fechaCorta(datos.liberadoHasta)}.
              </span>
            </p>
          )}

          <Section title="De dónde sale" description="Tu parte de cada tipo de cobro. La barra muestra cuánto pesa cada uno.">
            <div className="divide-y rounded-2xl border bg-card shadow-sm">
              {ORIGENES.map(([k, nombre, ayuda]) => {
                const p = datos.porOrigen[k];
                const share = Number(p?.share ?? 0);
                const pending = Number(p?.pending ?? 0);
                const ancho = maxOrigen > 0 ? Math.max(share > 0 ? 3 : 0, (share / maxOrigen) * 100) : 0;
                const peso = corresponde > 0 ? Math.round((share / corresponde) * 100) : 0;
                return (
                  <div key={k} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{nombre}</p>
                        <p className="text-xs text-muted-foreground">{ayuda}</p>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p className={cn("text-sm font-semibold", share === 0 && "text-muted-foreground")}>{formatARS(share)}</p>
                        {pending > 0 ? (
                          <p className="text-xs text-warning">falta {formatARS(pending)}</p>
                        ) : share > 0 ? (
                          <p className="text-xs text-success">cobrado</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${ancho}%` }} />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{peso}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Transferencias que recibiste"
            description={(datos.transferencias ?? []).length ? `${(datos.transferencias ?? []).length} ${periodo} · ${formatARS(totalTransferido)} en total` : undefined}
          >
            {(datos.transferencias ?? []).length === 0 ? (
              <EmptyState title="Ninguna en este período">Cuando te paguen tu parte, la transferencia va a aparecer acá.</EmptyState>
            ) : (
              <div className="divide-y rounded-2xl border bg-card shadow-sm">
                {datos.transferencias.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 p-4 text-sm">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
                      <ArrowDownLeft className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{origenTransferencia(t.source)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.paid_at ? fechaCorta(String(t.paid_at)) : "Sin fecha"}
                        {t.notes ? ` · ${t.notes}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{formatARS(Number(t.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Grande({
  icono,
  titulo,
  valor,
  ayuda,
  tono,
}: {
  icono: ReactNode;
  titulo: string;
  valor: number;
  ayuda: string;
  tono: "primary" | "success" | "warning" | "muted";
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border bg-card p-5 shadow-sm",
        tono === "primary" && "border-primary/30 bg-primary/[0.06]",
        tono === "success" && "border-success/30 bg-success/[0.05]",
        tono === "warning" && "border-warning/40 bg-warning/[0.06]"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{titulo}</span>
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&_svg]:h-4 [&_svg]:w-4",
            tono === "primary" && "bg-primary/15 text-primary",
            tono === "success" && "bg-success/15 text-success",
            tono === "warning" && "bg-warning/15 text-warning",
            tono === "muted" && "bg-muted text-muted-foreground"
          )}
        >
          {icono}
        </span>
      </div>
      <p
        className={cn(
          "mt-3 text-3xl font-bold tabular-nums tracking-tight [overflow-wrap:anywhere]",
          tono === "primary" && "text-primary",
          tono === "success" && "text-success",
          tono === "warning" && "text-warning",
          tono === "muted" && "text-muted-foreground"
        )}
      >
        {formatARS(valor)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{ayuda}</p>
    </div>
  );
}
