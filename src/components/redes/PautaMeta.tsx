import { useMemo, useState } from "react";
import { ConsejosPauta } from "@/components/redes/ConsejosPauta";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { BarraPresupuesto } from "@/components/redes/AlertasPauta";
import { Eye, Heart, Instagram, Loader2, Megaphone, MousePointerClick, ShoppingBag, TrendingDown, TrendingUp, Users, Wallet, AlertTriangle } from "lucide-react";
import type { Project } from "@/integrations/firebase/types";
import { formatARS } from "@/lib/redes/format";
import { NOMBRE_RESULTADO, RANGOS, dinero, fechasDe, resumirIg, resumirPauta, useMetaAuto, usePautaMeta, type Rango } from "@/lib/redes/metaPauta";
import { useMetricasRedes } from "@/components/redes/CrecimientoRedes";
import { cn } from "@/lib/utils";

// Resultados de Meta de un cliente (toda la cuenta publicitaria + Instagram), por rango. Lo traen solos el cron diario
// y al abrir la pantalla (sin botones). `cliente`: en lenguaje simple y sin tablas técnicas.

const fmt = (n: number | null | undefined, dec = 0) =>
  n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: dec, minimumFractionDigits: dec }).format(n);
const ddmm = (f: string) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;
const hace = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `hace ${Math.max(m, 1)} min`;
  if (m < 60 * 24) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} días`;
};

function Cambio({ ahora, antes, alReves = false }: { ahora: number | null; antes: number | null; alReves?: boolean }) {
  if (ahora == null || !antes) return null;
  const pct = Math.round(((ahora - antes) / antes) * 100);
  if (!isFinite(pct) || pct === 0) return null;
  const bueno = alReves ? pct < 0 : pct > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold", bueno ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {pct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

function Dato({ icono: Icono, titulo, valor, sub, cambio }: { icono: React.ElementType; titulo: string; valor: string; sub?: string; cambio?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icono className="h-3.5 w-3.5" /> {titulo}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{valor}</p>
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {cambio}
        {sub}
      </p>
    </div>
  );
}

function BarrasGasto({ dias, moneda }: { dias: { fecha: string; gasto: number }[]; moneda: string }) {
  const max = Math.max(...dias.map((d) => d.gasto), 1);
  if (!dias.some((d) => d.gasto > 0)) return null;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="mb-3 text-xs font-medium text-muted-foreground">Inversión por día</p>
      <div className="flex h-28 items-end gap-[2px]">
        {dias.map((d) => (
          <div key={d.fecha} className="group relative flex h-full flex-1 items-end" title={`${ddmm(d.fecha)}: ${dinero(d.gasto, moneda)}`}>
            <div className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${Math.max((d.gasto / max) * 100, d.gasto ? 3 : 0)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{ddmm(dias[0].fecha)}</span>
        <span>{ddmm(dias[dias.length - 1].fecha)}</span>
      </div>
    </div>
  );
}

/** Cómo está lo de Meta. No hay botones: se busca solo al abrir la pantalla y todos los días. */
function EstadoSync({ cliente, buscando, admin }: { cliente: Project; buscando: boolean; admin: boolean }) {
  const s = cliente.meta_sync;
  if (buscando) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando lo nuevo en Meta…
      </span>
    );
  }
  if (!s) return null;
  const falla = !s.ok && admin;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", falla ? "text-red-600 dark:text-red-400" : "text-muted-foreground")} title={admin ? s.detalle : undefined}>
      {falla && <AlertTriangle className="h-3.5 w-3.5" />}
      {falla ? `Falló ${hace(s.at)}: ${s.detalle}` : `Actualizado ${hace(s.at)}`}
    </span>
  );
}

export function PautaMeta({ cliente, modo }: { cliente: Project; modo: "admin" | "equipo" | "cliente" }) {
  const [rango, setRango] = useState<Rango>("mes");
  const f = fechasDe(rango);
  const filas = usePautaMeta(cliente.id, f.antDesde);
  const ig = useMetricasRedes(cliente.id);
  const r = useMemo(() => (filas ? resumirPauta(filas, f.desde, f.hasta) : null), [filas, f.desde, f.hasta]);
  const ant = useMemo(() => (filas ? resumirPauta(filas, f.antDesde, f.antHasta) : null), [filas, f.antDesde, f.antHasta]);
  const igR = useMemo(() => resumirIg(ig, f.desde, f.hasta), [ig, f.desde, f.hasta]);
  const igA = useMemo(() => resumirIg(ig, f.antDesde, f.antHasta), [ig, f.antDesde, f.antHasta]);
  const conectado = !!(cliente.meta?.ad_account_id || cliente.meta?.ig_user_id);
  const esCliente = modo === "cliente";
  const { tieneRol } = useUserProfileContext();
  // Los consejos de la IA son para quien maneja la pauta (y el admin).
  const puedeConsejos = !esCliente && (tieneRol("pauta") || tieneRol("admin"));
  const buscando = useMetaAuto(cliente.id, conectado);

  if (!conectado) {
    return modo === "cliente" ? null : (
      <div className="flex items-start gap-3 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
        Para traer la pauta y el Instagram solos, cargá la cuenta publicitaria y el ID de Instagram en Configuración → Meta.
      </div>
    );
  }
  const hayPauta = !!r && (r.gasto > 0 || r.impresiones > 0);
  const hayIg = igR.alcance != null || igR.vistas != null || igR.interacciones != null || igR.seguidores != null;
  if (esCliente && filas && !hayPauta && !hayIg && !(ant && ant.gasto > 0)) return null;
  const nom = r ? NOMBRE_RESULTADO[r.principal] : NOMBRE_RESULTADO.mensajes;
  // Plata en la moneda de la cuenta publicitaria (algunas están en dólares).
  const din = (n: number | null | undefined) => dinero(n, r?.moneda ?? "ARS");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{esCliente ? "Tu publicidad en Meta" : "Pauta e Instagram (Meta)"}</h3>
          <p className="text-[11px] text-muted-foreground">Se trae solo de Meta · comparado con el período anterior</p>
        </div>
        <EstadoSync cliente={cliente} buscando={buscando} admin={modo === "admin"} />
      </div>
      <div className="flex flex-wrap gap-1">
        {RANGOS.map((x) => (
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

      {puedeConsejos && cliente.meta?.ad_account_id && <ConsejosPauta proyectoId={cliente.id} />}
      {filas && modo !== "cliente" && <BarraPresupuesto cliente={cliente} filas={filas} />}
      {r && r.moneda !== "ARS" && modo !== "cliente" && (
        <p className="text-[11px] text-muted-foreground">La cuenta publicitaria está en {r.moneda === "USD" ? "dólares" : r.moneda}: los montos se muestran en esa moneda.</p>
      )}
      {filas === null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          {hayPauta && r && ant ? (
            esCliente ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Dato icono={Wallet} titulo="Invertiste" valor={din(r.gasto)} cambio={<Cambio ahora={r.gasto} antes={ant.gasto} />} sub="en anuncios" />
                <Dato icono={Eye} titulo="Tus anuncios se vieron" valor={`${fmt(r.impresiones)} veces`} cambio={<Cambio ahora={r.impresiones} antes={ant.impresiones} />} />
                <Dato
                  icono={r.principal === "compras" ? ShoppingBag : MousePointerClick}
                  titulo={nom.titulo}
                  valor={nom.cliente(fmt(r.resultados))}
                  sub={r.principal === "compras" && r.valor_compras > 0 ? `Total vendido: ${din(r.valor_compras)}` : undefined}
                  cambio={<Cambio ahora={r.resultados} antes={ant.resultados} />}
                />
                {r.costo != null && (
                  <Dato icono={Wallet} titulo={`Cada ${nom.uno} te costó`} valor={din(r.costo)} cambio={<Cambio ahora={r.costo} antes={ant.costo} alReves />} />
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Dato icono={Wallet} titulo="Inversión" valor={din(r.gasto)} cambio={<Cambio ahora={r.gasto} antes={ant.gasto} />} sub={`antes ${din(ant.gasto)}`} />
                  <Dato
                    icono={r.principal === "compras" ? ShoppingBag : MousePointerClick}
                    titulo={nom.varios}
                    valor={fmt(r.resultados)}
                    cambio={<Cambio ahora={r.resultados} antes={ant.resultados} />}
                    sub={r.costo != null ? `${din(r.costo)} c/u` : undefined}
                  />
                  <Dato icono={Eye} titulo="Impresiones" valor={fmt(r.impresiones)} sub={`CPM ${r.cpm != null ? din(r.cpm) : "—"}`} />
                  <Dato icono={MousePointerClick} titulo="Clics" valor={fmt(r.clics)} sub={`CTR ${fmt(r.ctr, 2)}%`} />
                  <Dato icono={Users} titulo="Alcance (suma por día)" valor={fmt(r.alcance)} />
                  {r.roas != null && <Dato icono={ShoppingBag} titulo="ROAS" valor={`${fmt(r.roas, 2)}x`} sub={`${din(r.valor_compras)} en ventas`} />}
                </div>
                <BarrasGasto dias={r.porDia} moneda={r.moneda} />
                {r.campanias.length > 0 && (
                  <div className="overflow-x-auto rounded-2xl border bg-card">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="p-3 font-medium">Campaña</th>
                          <th className="p-3 text-right font-medium">Inversión</th>
                          <th className="p-3 text-right font-medium">{nom.varios}</th>
                          <th className="p-3 text-right font-medium">Costo c/u</th>
                          <th className="p-3 text-right font-medium">Clics</th>
                          <th className="p-3 text-right font-medium" title="Veces que vio el anuncio cada persona, últimos 7 días">Frecuencia 7 d</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.campanias.map((c) => (
                          <tr key={c.id} className="border-b last:border-0">
                            <td className="max-w-[260px] truncate p-3" title={c.nombre}>
                              {c.nombre}
                            </td>
                            <td className="p-3 text-right tabular-nums">{din(c.gasto)}</td>
                            <td className="p-3 text-right tabular-nums">{fmt(c.resultados)}</td>
                            <td className="p-3 text-right tabular-nums">{c.costo != null ? din(c.costo) : "—"}</td>
                            <td className="p-3 text-right tabular-nums">{fmt(c.clics)}</td>
                            {(() => {
                              const fr = cliente.meta_sync?.frecuencia?.find((x) => x.id === c.id)?.frecuencia;
                              return (
                                <td className={cn("p-3 text-right tabular-nums", fr != null && fr >= 3.5 && "font-semibold text-amber-600 dark:text-amber-400")}>
                                  {fr != null ? fmt(fr, 1) : "—"}
                                </td>
                              );
                            })()}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )
          ) : (
            <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              {esCliente ? "En este período no hubo publicidad." : cliente.meta?.ad_account_id ? "Sin pauta en este período." : "Sin cuenta publicitaria cargada."}
            </p>
          )}

          {hayIg && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Dato
                icono={Instagram}
                titulo="Seguidores en Instagram"
                valor={fmt(igR.seguidores)}
                sub={
                  igR.variacion != null
                    ? `${igR.variacion >= 0 ? "+" : ""}${fmt(igR.variacion)} en el período`
                    : igR.seguidoresFecha && igR.seguidoresFecha < f.hasta
                      ? `al ${ddmm(igR.seguidoresFecha)}`
                      : undefined
                }
              />
              {esCliente ? (
                <Dato icono={Users} titulo="Personas que te ven por día" valor={fmt(igR.alcanceDia)} sub="en promedio" cambio={<Cambio ahora={igR.alcanceDia} antes={igA.alcanceDia} />} />
              ) : (
                <Dato icono={Users} titulo="Alcance IG (suma por día)" valor={fmt(igR.alcance)} sub={igR.alcanceDia != null ? `${fmt(igR.alcanceDia)} por día` : undefined} cambio={<Cambio ahora={igR.alcance} antes={igA.alcance} />} />
              )}
              <Dato icono={Eye} titulo="Visualizaciones" valor={fmt(igR.vistas)} cambio={<Cambio ahora={igR.vistas} antes={igA.vistas} />} />
              <Dato icono={Heart} titulo="Interacciones" valor={fmt(igR.interacciones)} sub="me gusta, comentarios, guardados…" cambio={<Cambio ahora={igR.interacciones} antes={igA.interacciones} />} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Todos los clientes con Meta: inversión del mes, resultado principal, costo y cómo salió la última actualización. */
export function PautaTodos({ clientes, onAbrir }: { clientes: Project[]; onAbrir?: (id: string) => void }) {
  const f = fechasDe("mes");
  const filas = usePautaMeta(null, f.desde);
  const conMeta = clientes.filter((c) => c.enabled !== false && (c.meta?.ad_account_id || c.meta?.ig_user_id));
  const lista = useMemo(
    () =>
      conMeta
        .map((c) => ({ c, r: resumirPauta((filas ?? []).filter((x) => x.proyecto_id === c.id), f.desde, f.hasta) }))
        .sort((a, b) => Number(a.c.meta_sync?.ok ?? true) - Number(b.c.meta_sync?.ok ?? true) || b.r.gasto - a.r.gasto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filas, clientes, f.desde, f.hasta]
  );
  if (!conMeta.length) {
    return <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Ningún cliente tiene cargada su cuenta publicitaria o su Instagram (ficha → Configuración → Meta).</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="p-3 font-medium">Cliente</th>
            <th className="p-3 text-right font-medium">Inversión del mes</th>
            <th className="p-3 text-right font-medium">Resultado</th>
            <th className="p-3 text-right font-medium">Costo c/u</th>
            <th className="p-3 font-medium">Última actualización</th>
          </tr>
        </thead>
        <tbody>
          {lista.map(({ c, r }) => (
            <tr key={c.id} className={cn("border-b last:border-0", onAbrir && "cursor-pointer hover:bg-muted/50")} onClick={() => onAbrir?.(c.id)}>
              <td className="p-3 font-medium">
                {c.nombre}
                {r.moneda !== "ARS" && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{r.moneda}</span>}
              </td>
              <td className="p-3 text-right tabular-nums">{r.gasto ? dinero(r.gasto, r.moneda) : "—"}</td>
              <td className="p-3 text-right tabular-nums">{r.resultados ? `${fmt(r.resultados)} ${NOMBRE_RESULTADO[r.principal].varios.toLowerCase()}` : "—"}</td>
              <td className="p-3 text-right tabular-nums">{r.costo != null ? dinero(r.costo, r.moneda) : "—"}</td>
              <td className="p-3 text-xs">
                {!c.meta_sync ? (
                  <span className="text-muted-foreground">Todavía no</span>
                ) : c.meta_sync.ok ? (
                  <span className="text-muted-foreground">{hace(c.meta_sync.at)}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400" title={c.meta_sync.detalle}>
                    <AlertTriangle className="h-3.5 w-3.5" /> Falló {hace(c.meta_sync.at)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
