import { useMemo } from "react";
import { AlertTriangle, Clock, Gauge, TrendingUp, Users } from "lucide-react";
import { PageShell, Section, StatCard } from "@/components/redes/PageShell";
import { ClienteTag } from "@/components/redes/ClienteTag";
import UserAvatar from "@/components/UserAvatar";
import { useRedes } from "@/contexts/redes-data-context";
import { useAppData } from "@/contexts/app-data-context";
import { mesAR } from "@/lib/fecha";
import { formatARS, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { planDe } from "@/lib/redes/planes";
import { quienFilma } from "@/lib/redes/etapas";
import { calcularPago, trabajosDelMes, useConfigPagos, useGastos, useLiquidaciones, UNIDAD_POR_ROL } from "@/lib/redes/facturacion";
import { getRoleInfo } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/redes/types";

const ROLES = ["editor", "productor", "pauta", "diseno"] as const;
type Rol = (typeof ROLES)[number];

/** Días entre dos fechas ISO. */
const dias = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
const prom = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const uno = (n: number | null) => (n == null ? "—" : n.toLocaleString("es-AR", { maximumFractionDigits: 1 }));

/** Cuándo pasó algo en el video (la primera vez que aparece esa acción en el historial). */
function cuando(v: Video, prueba: (accion: string) => boolean): string | null {
  return (v.historial ?? []).find((h) => prueba(h.accion))?.at ?? null;
}
const esCrudo = (a: string) => a.startsWith("Crudo cargado");
const esEntregada = (a: string) => a === "Edición entregada";
const esAprobado = (a: string) => a.startsWith("Aprobado por el cliente");
const esPublicado = (a: string) => a.startsWith("Publicado");

/**
 * Escalabilidad: cuánto trabajo entra con el equipo de hoy, dónde se traba, cuánto tarda cada etapa y qué
 * clientes dejan plata. Todo sale de lo que ya registra el sistema (historial de los videos, piezas,
 * planes y pagos al equipo).
 */
export default function Escalabilidad() {
  const { clientes: todos, planes, videos, piezas } = useRedes();
  const { profiles } = useAppData();
  // Solo los clientes con plan (abono o videos): los viejos o sin plan no piden trabajo ni pagan.
  const clientes = useMemo(() => todos.filter((c) => { const pl = planDe(c, planes); return pl.precioMensual > 0 || pl.videosMes > 0; }), [todos, planes]);
  const mes = mesActual();
  // Para la plata, el último mes completo; para el ritmo, los últimos 3 y el mejor de los últimos 6.
  const mesRef = sumarMeses(mes, -1);
  const ultimos3 = [1, 2, 3].map((d) => sumarMeses(mes, -d));
  const ultimos6 = [1, 2, 3, 4, 5, 6].map((d) => sumarMeses(mes, -d));
  const cfg = useConfigPagos();
  const liqs = useLiquidaciones(sumarMeses(mes, -6));
  const gastosRef = useGastos(mesRef)
    .filter((g) => g.mes === mesRef)
    .reduce((a, g) => a + g.monto, 0);

  const equipo = useMemo(
    () => profiles.filter((p) => ROLES.includes(p.role as Rol) && p.activo !== false).map((p) => ({ ...p, role: p.role as Rol })),
    [profiles]
  );
  const ids = clientes.map((c) => c.id);

  // ---------------- Equipo: ritmo, mejor mes y costo
  const personas = useMemo(
    () =>
      equipo.map((p) => {
        const porMes = ultimos6.map((m) => ({ m, trabajos: trabajosDelMes(p.id, p.role, m, videos, piezas) }));
        const n3 = porMes.filter((x) => ultimos3.includes(x.m)).map((x) => x.trabajos.length);
        const mejor = Math.max(0, ...porMes.map((x) => x.trabajos.length));
        const ref = porMes.find((x) => x.m === mesRef)?.trabajos ?? [];
        const liq = liqs.find((l) => l.uid === p.id && l.mes === mesRef);
        const costo =
          liq?.estado === "pagado" ? Number(liq.total_pagado ?? 0) : calcularPago(cfg[p.id], ref.length, liq?.ajustes ?? [], ids, { mes: mesRef, trabajos: ref }).total;
        const esteMes = trabajosDelMes(p.id, p.role, mes, videos, piezas).length;
        return { p, promedio: prom(n3) ?? 0, mejor, esteMes, ref, costo, porUnidad: ref.length ? costo / ref.length : null };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [equipo, videos, piezas, cfg, liqs, mesRef]
  );

  // ---------------- Capacidad contra demanda, por rol
  const videosPlan = clientes.reduce((a, c) => a + planDe(c, planes).videosMes, 0);
  const videosFilmaProdi = clientes.filter((c) => quienFilma(c) !== "cliente").reduce((a, c) => a + planDe(c, planes).videosMes, 0);
  const piezasPlan = clientes.reduce((a, c) => a + Number(c.plan_redes_override?.piezas_mes ?? planDe(c, planes).plan?.piezas_mes ?? 0), 0);
  const demanda: Record<Rol, number> = { editor: videosPlan, productor: videosFilmaProdi, pauta: videosPlan, diseno: piezasPlan };
  const capacidad = (rol: Rol) => personas.filter((x) => x.p.role === rol).reduce((a, x) => a + x.mejor, 0);
  const porRol = ROLES.map((rol) => {
    const cap = capacidad(rol);
    const dem = demanda[rol];
    const gente = personas.filter((x) => x.p.role === rol).length;
    return { rol, cap, dem, gente, uso: cap ? Math.round((dem / cap) * 100) : null };
  }).filter((r) => r.gente > 0 || r.dem > 0);
  const cuello = [...porRol].filter((r) => r.uso != null).sort((a, b) => (b.uso ?? 0) - (a.uso ?? 0))[0];
  const videosPorCliente = clientes.length ? videosPlan / clientes.length : 0;
  // Cuántos clientes más entran: lo que sobra en el rol más cargado, dividido lo que pide un cliente promedio.
  const entran = (() => {
    if (!cuello || !videosPorCliente) return null;
    const porClienteRol = cuello.rol === "diseno" ? (clientes.length ? piezasPlan / clientes.length : 0) : videosPorCliente;
    if (!porClienteRol) return null;
    return Math.max(0, Math.floor((cuello.cap - cuello.dem) / porClienteRol));
  })();

  // ---------------- Tiempos de cada etapa (videos que terminaron la etapa en los últimos 3 meses)
  const desde3 = `${ultimos3[2]}-01`;
  const tiempos = useMemo(() => {
    const t = { aCrudo: [] as number[], edicion: [] as number[], aprobacion: [] as number[], total: [] as number[], rondas: [] as number[] };
    for (const v of videos) {
      const crudo = cuando(v, esCrudo);
      const entregada = cuando(v, esEntregada);
      const aprobado = cuando(v, esAprobado);
      const publicado = cuando(v, esPublicado);
      if (crudo && crudo >= desde3 && v.created_at) t.aCrudo.push(dias(v.created_at, crudo));
      if (crudo && entregada && entregada >= desde3) t.edicion.push(dias(crudo, entregada));
      if (entregada && aprobado && aprobado >= desde3) t.aprobacion.push(dias(entregada, aprobado));
      if (publicado && publicado >= desde3 && v.created_at) {
        t.total.push(dias(v.created_at, publicado));
        t.rondas.push(Number(v.rondas ?? 0));
      }
    }
    return t;
  }, [videos, desde3]);

  // ---------------- Rentabilidad por cliente (último mes completo)
  const rentabilidad = useMemo(() => {
    const costoEquipo: Record<string, number> = {};
    const sumar = (cid: string, n: number) => (costoEquipo[cid] = (costoEquipo[cid] ?? 0) + n);
    for (const x of personas) {
      if (!x.costo) continue;
      const c = cfg[x.p.id];
      if (c?.modo === "por_cliente") {
        // Lo que se le paga por cada cliente va a ese cliente; el fijo (si hay), repartido entre todos.
        let asignado = 0;
        for (const [cid, monto] of Object.entries(c.por_cliente ?? {})) {
          if (!ids.includes(cid) || !(Number(monto) > 0)) continue;
          sumar(cid, Number(monto));
          asignado += Number(monto);
        }
        const resto = x.costo - asignado;
        if (resto > 0 && ids.length) ids.forEach((cid) => sumar(cid, resto / ids.length));
        continue;
      }
      // Fijo o por unidad: según cuánto trabajó para cada cliente ese mes (sin trabajos, parejo entre todos).
      const porCliente = x.ref.reduce<Record<string, number>>((a, tr) => ((a[tr.proyecto_id] = (a[tr.proyecto_id] ?? 0) + 1), a), {});
      const total = Object.values(porCliente).reduce((a, n) => a + n, 0);
      if (total) Object.entries(porCliente).forEach(([cid, n]) => sumar(cid, (x.costo * n) / total));
      else if (ids.length) ids.forEach((cid) => sumar(cid, x.costo / ids.length));
    }
    const gastoPorCliente = ids.length ? gastosRef / ids.length : 0;
    return clientes
      .map((c) => {
        const abono = planDe(c, planes).precioMensual;
        const equipoC = costoEquipo[c.id] ?? 0;
        const delMes = videos.filter((v) => v.proyecto_id === c.id && (v.historial ?? []).some((h) => esEntregada(h.accion) && mesAR(h.at) === mesRef));
        const rondas = prom(delMes.map((v) => Number(v.rondas ?? 0)));
        const margen = abono - equipoC - gastoPorCliente;
        return { c, abono, equipo: equipoC, gastos: gastoPorCliente, margen, pct: abono ? Math.round((margen / abono) * 100) : null, videos: delMes.length, rondas };
      })
      .sort((a, b) => a.margen - b.margen);
  }, [personas, cfg, clientes, planes, videos, ids, gastosRef, mesRef]);
  const pierden = rentabilidad.filter((r) => r.margen < 0);
  const margenTotal = rentabilidad.reduce((a, r) => a + r.margen, 0);
  const abonoTotal = rentabilidad.reduce((a, r) => a + r.abono, 0);

  return (
    <PageShell
      title="Escalabilidad"
      subtitle={`Cuánto trabajo entra con el equipo de hoy, dónde se traba y qué clientes dejan plata. Ritmo: últimos 3 meses · plata: ${mesLabel(mesRef)}.`}
    >
      <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Clientes que entran sin contratar"
          value={entran == null ? "—" : entran}
          hint={cuello ? `El límite lo pone ${getRoleInfo(cuello.rol).label.toLowerCase()}` : "Faltan datos de ritmo del equipo"}
          tone={entran != null && entran <= 1 ? "warning" : "primary"}
          icon={TrendingUp}
        />
        <StatCard
          label="Uso del rol más cargado"
          value={cuello?.uso != null ? `${cuello.uso}%` : "—"}
          hint={cuello ? `${cuello.dem} de ${cuello.cap} por mes (su mejor mes)` : undefined}
          tone={cuello?.uso != null && cuello.uso >= 90 ? "danger" : cuello?.uso != null && cuello.uso >= 75 ? "warning" : "default"}
          icon={Gauge}
        />
        <StatCard label="Del pedido a publicado" value={tiempos.total.length ? `${uno(prom(tiempos.total))} días` : "—"} hint={`${tiempos.total.length} videos publicados`} icon={Clock} />
        <StatCard
          label={`Margen de ${mesLabel(mesRef, { corto: true })}`}
          value={formatARS(margenTotal)}
          hint={abonoTotal ? `${Math.round((margenTotal / abonoTotal) * 100)}% de los abonos · ${pierden.length} cliente${pierden.length === 1 ? "" : "s"} en rojo` : undefined}
          tone={margenTotal < 0 ? "danger" : "success"}
          icon={Users}
        />
      </div>

      <Section title="Capacidad contra demanda" description="Demanda: lo que piden los planes por mes. Capacidad: la suma del mejor mes de cada persona (lo que ya demostraron que pueden hacer).">
        <div className="grid gap-3 md:grid-cols-2">
          {porRol.map((r) => (
            <div key={r.rol} className="space-y-2 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {getRoleInfo(r.rol).label} <span className="text-xs font-normal text-muted-foreground">· {r.gente} persona{r.gente === 1 ? "" : "s"}</span>
                </p>
                <span className={cn("text-sm font-semibold tabular-nums", r.uso == null ? "text-muted-foreground" : r.uso >= 90 ? "text-destructive" : r.uso >= 75 ? "text-amber-600" : "text-emerald-600")}>
                  {r.uso == null ? "sin datos" : `${r.uso}%`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", (r.uso ?? 0) >= 90 ? "bg-destructive" : (r.uso ?? 0) >= 75 ? "bg-amber-500" : "bg-emerald-500")}
                  style={{ width: `${Math.min(100, r.uso ?? 0)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Piden {r.dem} {UNIDAD_POR_ROL[r.rol]?.plural ?? "por mes"} por mes · pueden {r.cap}
                {r.uso != null && r.uso >= 100 ? " · ya están al límite: hace falta otra persona o menos carga" : ""}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Equipo" description={`Ritmo de cada uno y cuánto cuesta cada trabajo (${mesLabel(mesRef)}).`}>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Persona</th>
                <th className="px-3 py-2 text-right font-medium">Promedio/mes</th>
                <th className="px-3 py-2 text-right font-medium">Mejor mes</th>
                <th className="px-3 py-2 text-right font-medium">Este mes</th>
                <th className="px-3 py-2 text-right font-medium">Costo {mesLabel(mesRef, { corto: true })}</th>
                <th className="px-3 py-2 text-right font-medium">Por trabajo</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {personas
                .sort((a, b) => a.p.role.localeCompare(b.p.role))
                .map((x) => (
                  <tr key={x.p.id}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <UserAvatar profile={x.p} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{x.p.nombre}</span>
                          <span className="block text-[11px] text-muted-foreground">{UNIDAD_POR_ROL[x.p.role]?.plural}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{uno(x.promedio)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.mejor}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.esteMes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.costo ? formatARS(x.costo) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.porUnidad ? formatARS(Math.round(x.porUnidad)) : "—"}</td>
                  </tr>
                ))}
              {personas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No hay personas del equipo activas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Cuánto tarda cada etapa" description="Promedio de los últimos 3 meses. Lo que más tarda es lo primero para destrabar.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Pedido → crudo subido" value={tiempos.aCrudo.length ? `${uno(prom(tiempos.aCrudo))} d` : "—"} hint={`${tiempos.aCrudo.length} videos`} />
          <StatCard label="Edición" value={tiempos.edicion.length ? `${uno(prom(tiempos.edicion))} d` : "—"} hint={`${tiempos.edicion.length} videos`} />
          <StatCard label="Aprobación del cliente" value={tiempos.aprobacion.length ? `${uno(prom(tiempos.aprobacion))} d` : "—"} hint={`${tiempos.aprobacion.length} videos`} />
          <StatCard label="Total a publicado" value={tiempos.total.length ? `${uno(prom(tiempos.total))} d` : "—"} hint={`${tiempos.total.length} videos`} />
          <StatCard
            label="Rondas de cambios"
            value={tiempos.rondas.length ? uno(prom(tiempos.rondas)) : "—"}
            hint="por video publicado"
            tone={(prom(tiempos.rondas) ?? 0) >= 1.5 ? "warning" : "default"}
          />
        </div>
      </Section>

      <Section
        title="Rentabilidad por cliente"
        description={`${mesLabel(mesRef)}: abono menos lo que costó el equipo que trabajó para ese cliente (según sus trabajos o lo que se le paga por cliente) y una parte igual de los gastos generales.`}
      >
        {pierden.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/[0.06] p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>
              <b>{pierden.length === 1 ? "1 cliente te cuesta más de lo que paga" : `${pierden.length} clientes te cuestan más de lo que pagan`}.</b> Revisá su abono o cuánto trabajo le hacen (videos, rondas de cambios).
            </span>
          </div>
        )}
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 text-right font-medium">Abono</th>
                <th className="px-3 py-2 text-right font-medium">Equipo</th>
                <th className="px-3 py-2 text-right font-medium">Gastos</th>
                <th className="px-3 py-2 text-right font-medium">Margen</th>
                <th className="px-3 py-2 text-right font-medium">Videos</th>
                <th className="px-3 py-2 text-right font-medium">Rondas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rentabilidad.map((r) => (
                <tr key={r.c.id} className={cn(r.margen < 0 && "bg-destructive/[0.04]")}>
                  <td className="px-3 py-2">
                    <ClienteTag cliente={r.c} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.abono ? formatARS(r.abono) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatARS(Math.round(r.equipo))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatARS(Math.round(r.gastos))}</td>
                  <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", r.margen < 0 ? "text-destructive" : "text-emerald-600")}>
                    {formatARS(Math.round(r.margen))}
                    {r.pct != null && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{r.pct}%</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.videos}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", (r.rondas ?? 0) >= 2 && "font-semibold text-amber-600")}>{uno(r.rondas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Sale de lo que registra el sistema: si alguien trabajó por fuera (sin marcar el video) o un pago no está cargado, el número cambia. El abono es el del plan.
        </p>
      </Section>
      </div>
    </PageShell>
  );
}
