import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronRight, Link2Off, Megaphone, MousePointerClick, Target, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { PageShell } from "@/components/redes/PageShell";
import { FilaKpis, Kpi, Pestanias } from "@/components/redes/admin/AdminUI";
import { AlertasPauta, useAlertasPauta } from "@/components/redes/AlertasPauta";
import { PautaMeta } from "@/components/redes/PautaMeta";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import type { Project } from "@/integrations/firebase/types";
import { estadoPresupuesto, presupuestoPauta } from "@/lib/redes/alertasPauta";
import { formatARS } from "@/lib/redes/format";
import { NOMBRE_RESULTADO, dinero, fechasDe, resumirPauta, sumarDiasF, usePautaMeta, type PautaDia, type Rango } from "@/lib/redes/metaPauta";
import { cn } from "@/lib/utils";

// Módulo de pauta: cómo viene la publicidad de cada cliente en Meta (se trae sola todos los días), para quien la maneja.
// Arriba lo que hay que tocar hoy; después cliente por cliente: presupuesto, resultados, costo y si se está cansando.

const fmt = (n: number | null | undefined, dec = 0) =>
  n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(n);
const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const RANGOS_PAUTA: { k: Rango; label: string }[] = [
  { k: "mes", label: "Este mes" },
  { k: "7", label: "7 días" },
  { k: "30", label: "30 días" },
  { k: "mes_pasado", label: "Mes pasado" },
];

interface FilaCliente {
  c: Project;
  r: ReturnType<typeof resumirPauta>;
  ant: ReturnType<typeof resumirPauta>;
  pres: ReturnType<typeof estadoPresupuesto>;
  ultimoGasto: string | null;
  frecuencia: number | null;
  alertas: number;
  urgente: boolean;
}

function BarraMini({ uso }: { uso: number | null }) {
  if (uso == null) return <span className="text-[11px] text-muted-foreground">Sin presupuesto</span>;
  const color = uso >= 1 ? "bg-red-500" : uso >= 0.9 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="w-full min-w-[90px]">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(uso * 100, 100)}%` }} />
      </div>
      <p className={cn("mt-0.5 text-[11px] tabular-nums", uso >= 1 ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground")}>{Math.round(uso * 100)}% usado</p>
    </div>
  );
}

function Cambio({ ahora, antes }: { ahora: number | null; antes: number | null }) {
  if (ahora == null || !antes) return null;
  const pct = Math.round((ahora / antes - 1) * 100);
  if (!isFinite(pct) || pct === 0) return null;
  // En el costo, subir es malo.
  const malo = pct > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold", malo ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
      {malo ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

const hace = (fecha: string | null, hoy: string) => {
  if (!fecha) return "nunca";
  const d = Math.round((new Date(`${hoy}T12:00:00`).getTime() - new Date(`${fecha}T12:00:00`).getTime()) / 86_400_000);
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
};

export default function Pauta() {
  const navigate = useNavigate();
  const { clientes } = useRedes();
  const { user, tieneRol } = useUserProfileContext();
  const uid = user?.uid ?? "";
  const admin = tieneRol("admin");
  const [rango, setRango] = useState<Rango>("mes");
  const [vista, setVista] = useState<"conectados" | "sin_conectar">("conectados");
  const [abierto, setAbierto] = useState<string | null>(null);
  const hoy = hoyISO();
  const f = fechasDe(rango, hoy);
  // Lo que hace falta: el rango, el anterior (para comparar) y el mes en curso (presupuesto).
  const desde = [f.antDesde, `${hoy.slice(0, 7)}-01`, sumarDiasF(hoy, -14)].sort()[0];
  const filas = usePautaMeta(null, desde);
  const { alertas } = useAlertasPauta();

  const mios = useMemo(
    () => clientes.filter((c) => c.enabled !== false && (admin || (c.team_roles?.pauta ?? []).includes(uid))).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [clientes, admin, uid]
  );
  const conectados = mios.filter((c) => c.meta?.ad_account_id);
  const sinConectar = mios.filter((c) => !c.meta?.ad_account_id);

  const lista: FilaCliente[] = useMemo(() => {
    const todas = filas ?? [];
    return conectados
      .map((c) => {
        const suyas: PautaDia[] = todas.filter((x) => x.proyecto_id === c.id);
        const conGasto = suyas.filter((x) => x.gasto > 0).map((x) => x.fecha).sort();
        const fr = (c.meta_sync?.frecuencia ?? []).map((x) => x.frecuencia);
        const susAlertas = alertas.filter((a) => a.proyectoId === c.id && a.nivel >= 1);
        return {
          c,
          r: resumirPauta(suyas, f.desde, f.hasta),
          ant: resumirPauta(suyas, f.antDesde, f.antHasta),
          pres: estadoPresupuesto(c, suyas, hoy),
          ultimoGasto: conGasto[conGasto.length - 1] ?? null,
          frecuencia: fr.length ? Math.max(...fr) : null,
          alertas: susAlertas.length,
          urgente: susAlertas.some((a) => a.nivel === 2),
        };
      })
      .sort((a, b) => Number(b.urgente) - Number(a.urgente) || b.alertas - a.alertas || b.r.gasto - a.r.gasto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, conectados.map((c) => c.id).join(), alertas, f.desde, f.hasta, f.antDesde, f.antHasta, hoy]);

  // Los totales en pesos; las cuentas en dólares van aparte (no se suman monedas distintas).
  const enPesos = lista.filter((x) => x.r.moneda === "ARS");
  const total = enPesos.reduce((a, x) => a + x.r.gasto, 0);
  const totalAnt = enPesos.reduce((a, x) => a + x.ant.gasto, 0);
  const totalUsd = lista.filter((x) => x.r.moneda === "USD").reduce((a, x) => a + x.r.gasto, 0);
  const mensajes = lista.reduce((a, x) => a + x.r.mensajes, 0);
  const ventas = lista.reduce((a, x) => a + x.r.compras, 0);
  const conAlertas = lista.filter((x) => x.alertas > 0).length;
  // Solo los que tienen presupuesto y la cuenta en pesos (el presupuesto es en pesos).
  const conTope = lista.filter((x) => x.pres.tope);
  const presTotal = conTope.reduce((a, x) => a + (x.pres.tope ?? 0), 0);
  const gastoMes = conTope.reduce((a, x) => a + x.pres.gasto, 0);
  const elegido = abierto ? mios.find((c) => c.id === abierto) : null;

  return (
    <PageShell title="Pauta" subtitle="Cómo viene la publicidad de tus clientes en Meta. Se trae sola todos los días.">
      <div className="mb-4 flex flex-wrap gap-1">
        {RANGOS_PAUTA.map((x) => (
          <button
            key={x.k}
            type="button"
            onClick={() => setRango(x.k)}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", rango === x.k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {x.label}
          </button>
        ))}
      </div>

      <FilaKpis className="mb-4">
        <Kpi icono={Wallet} label="Inversión" valor={!total && totalUsd ? dinero(totalUsd, "USD") : formatARS(total)} sub={[totalAnt ? `antes ${formatARS(totalAnt)}` : "", total && totalUsd ? `+ ${dinero(totalUsd, "USD")} en cuentas en dólares` : ""].filter(Boolean).join(" · ") || undefined} />
        <Kpi icono={MousePointerClick} tono="verde" label="Resultados" valor={`${fmt(mensajes)} mensajes`} sub={ventas ? `${fmt(ventas)} ventas` : undefined} />
        <Kpi
          icono={Target}
          tono={presTotal && gastoMes > presTotal ? "rojo" : "azul"}
          label="Presupuesto del mes"
          valor={presTotal ? `${Math.round((gastoMes / presTotal) * 100)}%` : "—"}
          sub={presTotal ? `${formatARS(gastoMes)} de ${formatARS(presTotal)}` : "Ningún cliente con presupuesto"}
          avance={presTotal ? Math.min(gastoMes / presTotal, 1) : undefined}
        />
        <Kpi icono={AlertTriangle} tono={conAlertas ? "ambar" : "gris"} label="Para revisar" valor={`${conAlertas} ${conAlertas === 1 ? "cliente" : "clientes"}`} sub={`${conectados.length} de ${mios.length} conectados a Meta`} />
      </FilaKpis>

      <AlertasPauta />

      <div className="mb-3">
        <Pestanias<"conectados" | "sin_conectar">
          items={[
            { k: "conectados", label: "Clientes", n: conectados.length },
            { k: "sin_conectar", label: "Sin conectar a Meta", n: sinConectar.length, alerta: sinConectar.length > 0 },
          ]}
          valor={vista}
          onChange={(k) => setVista(k)}
        />
      </div>

      {vista === "conectados" ? (
        lista.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Todavía ningún cliente tiene la cuenta publicitaria cargada. Mirá la pestaña «Sin conectar a Meta».
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 font-medium">Cliente</th>
                  <th className="p-3 font-medium">Presupuesto del mes</th>
                  <th className="p-3 text-right font-medium">Inversión</th>
                  <th className="p-3 text-right font-medium">Resultados</th>
                  <th className="p-3 text-right font-medium">Costo c/u</th>
                  <th className="p-3 text-right font-medium">CTR</th>
                  <th className="p-3 text-right font-medium" title="Veces que vio el anuncio cada persona (últimos 7 días, la campaña más alta)">
                    Frecuencia
                  </th>
                  <th className="p-3 font-medium">Último gasto</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {lista.map((x) => {
                  const n = NOMBRE_RESULTADO[x.r.principal];
                  const sinGasto = x.ultimoGasto == null || x.ultimoGasto < sumarDiasF(hoy, -2);
                  return (
                    <tr key={x.c.id} onClick={() => setAbierto(x.c.id)} className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/40", x.urgente && "bg-red-500/[0.04]")}>
                      <td className="p-3">
                        <p className="flex items-center gap-1.5 font-medium">
                          {x.urgente ? <span className="h-2 w-2 rounded-full bg-red-500" /> : x.alertas ? <span className="h-2 w-2 rounded-full bg-amber-500" /> : null}
                          {x.c.nombre}
                          {x.r.moneda !== "ARS" && <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">{x.r.moneda}</span>}
                        </p>
                        {x.alertas > 0 && <p className="text-[11px] text-muted-foreground">{x.alertas} para revisar</p>}
                      </td>
                      <td className="p-3">
                        <BarraMini uso={x.pres.uso} />
                        {x.pres.tope && <p className="text-[11px] tabular-nums text-muted-foreground">{formatARS(x.pres.gasto)} de {formatARS(x.pres.tope)}</p>}
                      </td>
                      <td className="p-3 text-right tabular-nums">{x.r.gasto ? dinero(x.r.gasto, x.r.moneda) : "—"}</td>
                      <td className="p-3 text-right tabular-nums">
                        {x.r.resultados ? `${fmt(x.r.resultados)} ${n.varios.toLowerCase()}` : "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        <span className="block">{x.r.costo != null ? dinero(x.r.costo, x.r.moneda) : "—"}</span>
                        <Cambio ahora={x.r.costo} antes={x.ant.costo} />
                      </td>
                      <td className="p-3 text-right tabular-nums">{x.r.ctr != null ? `${fmt(x.r.ctr, 2)}%` : "—"}</td>
                      <td className={cn("p-3 text-right tabular-nums", x.frecuencia != null && x.frecuencia >= 3.5 && "font-semibold text-amber-600 dark:text-amber-400")}>{x.frecuencia != null ? fmt(x.frecuencia, 1) : "—"}</td>
                      <td className={cn("p-3 text-xs", sinGasto ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>{hace(x.ultimoGasto, hoy)}</td>
                      <td className="p-3">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            De estos clientes el sistema no puede leer la pauta. Para conectarlos: en Meta, asignar su cuenta publicitaria al usuario del sistema de Prodi
            {admin ? " y cargarla en su ficha (Configuración → Meta)." : "; después el admin la carga en su ficha."}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sinConectar.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!admin}
                  onClick={() => navigate(`/clientes/${c.id}?tab=config`)}
                  className="flex w-full items-center gap-2 rounded-xl border bg-card p-3 text-left text-sm transition-colors enabled:hover:bg-muted/50"
                >
                  <Link2Off className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 font-medium">{c.nombre}</span>
                  {presupuestoPauta(c) && <span className="text-[11px] text-muted-foreground">{formatARS(presupuestoPauta(c))}/mes</span>}
                  {admin && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={!!elegido} onOpenChange={(o) => !o && setAbierto(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" /> {elegido?.nombre}
            </DialogTitle>
          </DialogHeader>
          {elegido && <PautaMeta cliente={elegido} modo={admin ? "admin" : "equipo"} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
