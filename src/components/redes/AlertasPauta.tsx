import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, CheckCircle2, ChevronRight } from "lucide-react";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useRedes } from "@/contexts/redes-data-context";
import { alertasPauta, estadoPresupuesto, presupuestoPauta, type AlertaPauta } from "@/lib/redes/alertasPauta";
import { reglasActivas, REGLAS_INFO, type ReglaPauta } from "../../../api/_lib/pauta-reglas";
import { Switch } from "@/components/ui/switch";
import { sumarDiasF, usePautaMeta } from "@/lib/redes/metaPauta";
import { cn } from "@/lib/utils";

// Alertas de pauta en el tablero de quien la maneja (y del admin): lo que hay que tocar hoy en Meta.

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Las alertas de los clientes que ve esta persona (la pauta de los últimos 31 días, para comparar semanas y el mes). */
export type VistaPauta = "propia" | "clientes";
/**
 * Los clientes de pauta de cada uno: los que tiene asignados en Pauta (el admin, todos).
 * Con `vista`: "propia" = las cuentas de Prodi (cuenta propia), "clientes" = el resto.
 */
export function clientesDePauta<T extends { enabled?: boolean; cuenta_propia?: boolean | null; team_roles?: { pauta?: string[] } | null }>(
  clientes: T[],
  uid: string,
  admin: boolean,
  vista?: VistaPauta
): T[] {
  const suyos = clientes.filter((c) => c.enabled !== false && (admin || (c.team_roles?.pauta ?? []).includes(uid)));
  if (!vista) return suyos;
  return suyos.filter((c) => !!c.cuenta_propia === (vista === "propia"));
}

export function useAlertasPauta(activo = true) {
  const { clientes, settings } = useRedes();
  const reglas = useMemo(() => reglasActivas(settings.reglas_pauta), [settings.reglas_pauta]);
  const hoy = hoyISO();
  const desde = [sumarDiasF(hoy, -15), `${hoy.slice(0, 7)}-01`].sort()[0];
  const filas = usePautaMeta(activo ? null : undefined, desde);
  const alertas = useMemo(() => (filas ? alertasPauta({ clientes, filas, hoy, reglas }) : []), [filas, clientes, hoy, reglas]);
  return { alertas, filas, cargando: activo && filas === null };
}

const CHIP = [
  "bg-muted text-muted-foreground",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-red-500/15 text-red-700 dark:text-red-300",
];

/**
 * Panel del tablero: una fila por cliente con lo que le pasa (en pastillas). Solo lo que hay que mirar hoy;
 * el detalle de cada una, al pasar el mouse, y tocando la fila se abre su pauta.
 */
export function AlertasPauta({ onAbrir, vista }: { onAbrir?: (clienteId: string) => void; vista?: VistaPauta } = {}) {
  const navigate = useNavigate();
  const { clienteById, clientes } = useRedes();
  const { user, tieneRol } = useUserProfileContext();
  const uid = user?.uid ?? "";
  // Sus clientes: los que tiene en pauta (el admin, todos).
  const mios = clientesDePauta(clientes, uid, tieneRol("admin"), vista);
  const idsMios = new Set(mios.map((c) => c.id));
  const conectados = mios.filter((c) => c.meta?.ad_account_id);
  const sinPresupuesto = conectados.filter((c) => !presupuestoPauta(c)).length;
  const { alertas, cargando } = useAlertasPauta();
  const [abierto, setAbierto] = useState(false);
  const porCliente = useMemo(() => {
    const m = new Map<string, AlertaPauta[]>();
    for (const a of alertas.filter((x) => x.nivel >= 1 && idsMios.has(x.proyectoId))) m.set(a.proyectoId, [...(m.get(a.proyectoId) ?? []), a]);
    return [...m.entries()].map(([id, lista]) => ({ id, lista, nivel: Math.max(...lista.map((x) => x.nivel)) })).sort((x, y) => y.nivel - x.nivel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertas, [...idsMios].join()]);
  if (cargando || !mios.length) return null;
  const urgentes = porCliente.filter((x) => x.nivel === 2).length;
  // Cuántos de sus clientes el sistema puede controlar (los que tienen la cuenta publicitaria cargada).
  const cobertura = (
    <p className="px-4 pb-3 text-[11px] text-muted-foreground">
      Se controlan {conectados.length} de {mios.length} clientes (los que tienen la cuenta publicitaria cargada en su ficha)
      {sinPresupuesto ? ` · ${sinPresupuesto} sin presupuesto de pauta cargado` : ""}.
    </p>
  );
  if (!porCliente.length) {
    return (
      <section className="mb-4 rounded-2xl border bg-card">
        <div className="flex items-center gap-2 px-4 pb-1 pt-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">Pauta en orden</h3>
          <span className="text-xs text-muted-foreground">nada para revisar hoy</span>
        </div>
        {cobertura}
      </section>
    );
  }
  const visibles = abierto ? porCliente : porCliente.slice(0, 3);
  return (
    <section className="mb-4 rounded-2xl border bg-card">
      <div className="flex items-center gap-2 px-4 pt-3">
        <BellRing className={cn("h-4 w-4", urgentes ? "text-red-500" : "text-amber-500")} />
        <h3 className="text-sm font-semibold">Pauta para revisar</h3>
        <span className="text-xs text-muted-foreground">
          {porCliente.length} {porCliente.length === 1 ? "cliente" : "clientes"}
          {urgentes ? ` · ${urgentes} urgente${urgentes === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <ul className="divide-y px-2 py-1">
        {visibles.map(({ id, lista }) => {
          const c = clienteById(id);
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => (onAbrir ? onAbrir(id) : navigate(`/clientes/${id}?tab=resultados`))}
                className="flex w-full flex-wrap items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span className="min-w-[8rem] text-sm font-medium">{c?.nombre ?? "Cliente"}</span>
                <span className="flex flex-1 flex-wrap gap-1.5">
                  {lista.map((a) => (
                    <span key={a.id} title={a.detalle} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CHIP[a.nivel])}>
                      {a.titulo}
                    </span>
                  ))}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
      {porCliente.length > 3 && (
        <button type="button" onClick={() => setAbierto(!abierto)} className="w-full border-t py-2 text-xs font-medium text-primary hover:bg-muted/40">
          {abierto ? "Ver menos" : `Ver los ${porCliente.length - 3} restantes`}
        </button>
      )}
      {cobertura}
    </section>
  );
}

/** Barra de presupuesto del mes en la ficha del cliente. */
export function BarraPresupuesto({ cliente, filas }: { cliente: Parameters<typeof estadoPresupuesto>[0]; filas: Parameters<typeof estadoPresupuesto>[1] }) {
  const e = estadoPresupuesto(cliente, filas, hoyISO());
  if (!e.tope) return null;
  const uso = e.uso ?? 0;
  const color = uso >= 1 ? "bg-red-500" : uso >= 0.9 ? "bg-amber-500" : "bg-emerald-500";
  const ars = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Presupuesto de pauta del mes</p>
        <p className="text-sm font-semibold tabular-nums">
          {ars(e.gasto)} <span className="font-normal text-muted-foreground">de {ars(e.tope)}</span>
        </p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(uso * 100, 100)}%` }} />
      </div>
      <p className={cn("mt-1.5 text-[11px]", uso >= 1 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        {uso >= 1
          ? `Se pasó por ${ars(e.gasto - e.tope)}.`
          : `${Math.round(uso * 100)}% usado · día ${e.dia} de ${e.diasMes}${e.proyectado != null ? ` · al ritmo actual termina en ${ars(e.proyectado)}` : ""}`}
      </p>
    </div>
  );
}

/** Ajustes → qué alertas de pauta están prendidas (las ve pauta en su tablero y le llegan como aviso). */
export function ReglasPautaAjustes({ actual, onCambiar }: { actual: unknown; onCambiar: (reglas: Record<ReglaPauta, boolean>) => Promise<void> }) {
  const reglas = reglasActivas(actual);
  return (
    <div className="divide-y rounded-xl border bg-card">
      {(Object.keys(REGLAS_INFO) as ReglaPauta[]).map((k) => (
        <label key={k} className="flex items-start justify-between gap-3 p-3">
          <span>
            <span className="block text-sm font-medium">{REGLAS_INFO[k].label}</span>
            <span className="block text-xs text-muted-foreground">{REGLAS_INFO[k].detalle}</span>
          </span>
          <Switch checked={reglas[k]} onCheckedChange={(v) => void onCambiar({ ...reglas, [k]: v })} />
        </label>
      ))}
    </div>
  );
}
