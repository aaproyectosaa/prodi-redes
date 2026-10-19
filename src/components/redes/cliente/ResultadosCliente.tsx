import { useMemo } from "react";
import {
  BarChart3,
  ExternalLink,
  Eye,
  Heart,
  HelpCircle,
  Instagram,
  Mail,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  Play,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { Project } from "@/integrations/firebase/types";
import type { Video } from "@/lib/redes/types";
import { cn, hrefSeguro } from "@/lib/utils";
import { fechaCorta, formatARS, formatNum, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { NOMBRE_RESULTADO, fechasDeMes, resumirIg, resumirPauta, useMetaAuto, usePautaMeta } from "@/lib/redes/metaPauta";
import { CrecimientoRedes, useMetricasRedes } from "@/components/redes/CrecimientoRedes";
import { EvolucionMensajes } from "@/components/redes/EvolucionMensajes";
import { resumirMes } from "@/components/redes/ResultadosMes";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { EmptyState } from "@/components/redes/PageShell";

// Resultados para el cliente: un solo selector de mes arriba, lo más importante en grande y después el detalle.
// Las tarjetas sin dato no se muestran (nunca un "—" ni un "0" que confunda).

const fmt = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n);
const nombreMes = (m: string) => mesLabel(m).split(" ")[0];
const anio = (m: string) => m.slice(0, 4);

function Cambio({ ahora, antes, alReves = false }: { ahora: number | null | undefined; antes: number | null | undefined; alReves?: boolean }) {
  if (ahora == null || !antes) return null;
  const pct = Math.round(((ahora - antes) / antes) * 100);
  if (!isFinite(pct) || pct === 0) return null;
  const bueno = alReves ? pct < 0 : pct > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
        bueno ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
      )}
    >
      {pct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

type Tono = "violeta" | "rosa" | "azul" | "verde" | "ambar";
const TONOS: Record<Tono, string> = {
  violeta: "bg-primary/10 text-primary",
  rosa: "bg-pink-500/10 text-pink-500",
  azul: "bg-sky-500/10 text-sky-500",
  verde: "bg-emerald-500/10 text-emerald-500",
  ambar: "bg-amber-500/10 text-amber-500",
};

interface TileProps {
  icono: React.ElementType;
  titulo: string;
  valor: string;
  sub?: string;
  cambio?: React.ReactNode;
  tono?: Tono;
}

function Tile({ icono: Icono, titulo, valor, sub, cambio, tono = "violeta" }: TileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-foreground/15">
      <div className="flex items-center justify-between gap-2">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", TONOS[tono])}>
          <Icono className="h-[18px] w-[18px]" />
        </span>
        {cambio}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className="mt-0.5 truncate text-2xl font-bold tabular-nums tracking-tight">{valor}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function Grupo({ icono: Icono, titulo, nota, tiles }: { icono: React.ElementType; titulo: string; nota?: string; tiles: (TileProps | null)[] }) {
  const lista = tiles.filter((t): t is TileProps => !!t);
  if (!lista.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Icono className="h-4 w-4 text-muted-foreground" /> {titulo}
        </h3>
        {nota && <p className="text-[11px] text-muted-foreground">{nota}</p>}
      </div>
      <div className={cn("grid grid-cols-2 gap-3", lista.length >= 4 ? "lg:grid-cols-4" : lista.length === 3 ? "lg:grid-cols-3" : "")}>
        {lista.map((t) => (
          <Tile key={t.titulo} {...t} />
        ))}
      </div>
    </section>
  );
}

/** Lo más importante del mes, en una frase y un número grande. */
function Destacado({ etiqueta, numero, unidad, detalle, cambio }: { etiqueta: string; numero: string; unidad: string; detalle?: string; cambio?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-5 sm:p-7">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-fuchsia-500/15 blur-3xl" aria-hidden />
      <p className="relative text-sm font-medium text-muted-foreground">{etiqueta}</p>
      <p className="relative mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="bg-gradient-to-r from-primary to-fuchsia-500 bg-clip-text text-5xl font-extrabold tabular-nums tracking-tight text-transparent sm:text-6xl">
          {numero}
        </span>
        <span className="text-xl font-semibold sm:text-2xl">{unidad}</span>
        {cambio}
      </p>
      {detalle && <p className="relative mt-2 text-sm text-muted-foreground">{detalle}</p>}
    </section>
  );
}

function SelectorMes({ mes, onMes }: { mes: string; onMes: (m: string) => void }) {
  const hoy = mesActual();
  const meses = [0, -1, -2, -3, -4, -5].map((d) => sumarMeses(hoy, d));
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {meses.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onMes(m)}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all",
            m === mes
              ? "border-transparent bg-gradient-to-r from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25"
              : "border-border/60 bg-card/60 text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {nombreMes(m)}
          {anio(m) !== anio(hoy) && <span className="ml-1 opacity-70">{anio(m)}</span>}
          {m === hoy && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle opacity-80" aria-label="en curso" />}
        </button>
      ))}
    </div>
  );
}

/** Publicado hace menos de 2 días: la pauta todavía no tiene números. */
const esReciente = (v: Video) => {
  const p = v.publicacion?.publicado_at;
  return !!p && Date.now() - new Date(p).getTime() < 2 * 86_400_000;
};

function VideosDelMes({ publicados, conMeta }: { publicados: Video[]; conMeta: boolean }) {
  const open = useOpenVideo();
  if (!publicados.length) return null;
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Play className="h-4 w-4 text-muted-foreground" /> Tus videos del mes
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{publicados.length}</span>
      </h3>
      <div className="grid gap-2">
        {publicados.map((v) => {
          const r = v.resultados;
          const chips = r
            ? [
                r.mensajes ? { i: MessageCircle, t: `${formatNum(r.mensajes)} mensajes` } : null,
                r.alcance ? { i: Users, t: `${formatNum(r.alcance)} personas` } : null,
                r.reproducciones ? { i: Play, t: `${formatNum(r.reproducciones)} reproducciones` } : null,
                r.gasto ? { i: Wallet, t: formatARS(r.gasto) } : null,
              ].filter(Boolean)
            : [];
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => open(v.id)}
              onKeyDown={(e) => e.key === "Enter" && open(v.id)}
              className="group flex cursor-pointer flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-fuchsia-500/20 text-primary">
                  <Play className="h-4 w-4 fill-current" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{v.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    Publicado el {fechaCorta(v.publicacion?.publicado_at)}
                    {v.pauta?.objetivo ? ` · para ${v.pauta.objetivo.toLowerCase()}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:pl-[52px]">
                {chips.length ? (
                  chips.map((c) => {
                    const I = c!.i;
                    return (
                      <span key={c!.t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums">
                        <I className="h-3 w-3 text-muted-foreground" /> {c!.t}
                      </span>
                    );
                  })
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {esReciente(v) ? "Los números aparecen a las 48 h" : conMeta ? "Sus números están sumados arriba" : "Todavía sin números"}
                  </span>
                )}
                {v.publicacion?.link_instagram && (
                  <a
                    href={hrefSeguro(v.publicacion.link_instagram)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ml-1 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    Ver <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const GLOSARIO: [string, string][] = [
  ["Invertiste", "Lo que se puso en publicidad en Meta (Instagram y Facebook) en el mes."],
  ["Tus anuncios se vieron", "Cuántas veces aparecieron tus anuncios en pantalla. Una misma persona puede verlos más de una vez."],
  ["Ventas / mensajes / contactos", "Lo que logró la publicidad según su objetivo, y cuánto costó cada uno."],
  ["Personas que te ven por día", "En promedio, cuánta gente distinta vio tu Instagram cada día."],
  ["Visualizaciones", "Cuántas veces se vieron tus publicaciones, reels e historias."],
  ["Interacciones", "Me gusta, comentarios, guardados y compartidos."],
];

export function ResultadosCliente({
  cliente,
  videos,
  mes,
  onMes,
}: {
  cliente: Project;
  videos: Video[];
  mes: string;
  onMes: (m: string) => void;
}) {
  const f = fechasDeMes(mes);
  const filas = usePautaMeta(cliente.id, f.antDesde);
  const ig = useMetricasRedes(cliente.id);
  const r = useMemo(() => (filas ? resumirPauta(filas, f.desde, f.hasta) : null), [filas, f.desde, f.hasta]);
  const ant = useMemo(() => (filas ? resumirPauta(filas, f.antDesde, f.antHasta) : null), [filas, f.antDesde, f.antHasta]);
  const igR = useMemo(() => resumirIg(ig, f.desde, f.hasta), [ig, f.desde, f.hasta]);
  const igA = useMemo(() => resumirIg(ig, f.antDesde, f.antHasta), [ig, f.antDesde, f.antHasta]);
  const vid = resumirMes(videos, cliente.id, mes);

  const conMeta = !!(cliente.meta?.ad_account_id || cliente.meta?.ig_user_id);
  // Al abrir: si lo de Meta tiene más de 3 horas, el servidor lo vuelve a buscar solo.
  useMetaAuto(cliente.id, conMeta);
  const hayPauta = !!r && (r.gasto > 0 || r.impresiones > 0);
  const hayIg = igR.vistas != null || igR.alcanceDia != null || igR.interacciones != null || igR.seguidores != null;
  const enCurso = mes === mesActual();
  const cuando = enCurso ? `En lo que va de ${nombreMes(mes).toLowerCase()}` : `En ${nombreMes(mes).toLowerCase()}`;
  const nom = r ? NOMBRE_RESULTADO[r.principal] : NOMBRE_RESULTADO.mensajes;
  const plural = (n: number, uno: string) => (n === 1 ? uno : uno === "compra" ? "ventas" : `${uno}s`);
  const unoVisible = (u: string) => (u === "compra" ? "venta" : u);

  // Lo más importante del mes: el resultado de la pauta; si no hubo, los mensajes de los videos; si no, el Instagram.
  let destacado: React.ReactNode = null;
  if (hayPauta && r && r.resultados > 0) {
    destacado = (
      <Destacado
        etiqueta={`${cuando}, gracias a tu publicidad`}
        numero={fmt(r.resultados)}
        unidad={plural(r.resultados, unoVisible(nom.uno))}
        cambio={!enCurso ? <Cambio ahora={r.resultados} antes={ant?.resultados} /> : undefined}
        detalle={`Invertiste ${formatARS(r.gasto)}${r.costo != null ? ` · cada ${unoVisible(nom.uno)} costó ${formatARS(r.costo)}` : ""}${
          r.principal === "compras" && r.valor_compras > 0 ? ` · vendiste por ${formatARS(r.valor_compras)}` : ""
        }`}
      />
    );
  } else if (vid.mensajes > 0) {
    destacado = (
      <Destacado
        etiqueta={`${cuando} te escribieron`}
        numero={fmt(vid.mensajes)}
        unidad={vid.mensajes === 1 ? "mensaje" : "mensajes"}
        detalle={vid.costoMensaje ? `Cada mensaje costó ${formatARS(vid.costoMensaje)}` : undefined}
      />
    );
  } else if (igR.vistas) {
    destacado = (
      <Destacado
        etiqueta={`${cuando}, tu Instagram tuvo`}
        numero={fmt(igR.vistas)}
        unidad="visualizaciones"
        cambio={!enCurso ? <Cambio ahora={igR.vistas} antes={igA.vistas} /> : undefined}
      />
    );
  }

  const sinNada = !hayPauta && !hayIg && vid.publicados.length === 0;
  // Sin Meta conectado, los números salen de los videos (cargados por el equipo).
  const deVideos = !hayPauta && vid.publicados.some((v) => v.resultados);

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SelectorMes mes={mes} onMes={onMes} />
        {(cliente.contacto_emails?.length ?? 0) > 0 && (
          <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" /> Cada día 1 te llega este informe por correo
          </p>
        )}
      </div>

      {filas === null && conMeta ? (
        <div className="h-40 animate-pulse rounded-3xl border bg-card" />
      ) : sinNada ? (
        <EmptyState
          icon={BarChart3}
          title={`Todavía no hay resultados de ${nombreMes(mes).toLowerCase()}`}
          description="Cuando publiquemos y pautemos tus videos, acá vas a ver qué lograron."
        />
      ) : (
        <>
          {destacado}

          {hayPauta && r && (
            <Grupo
              icono={Megaphone}
              titulo="Tu publicidad"
              nota={enCurso ? "Se actualiza sola todos los días · comparado con los mismos días del mes pasado" : "Comparado con el mes anterior"}
              tiles={[
                { icono: Wallet, titulo: "Invertiste", valor: formatARS(r.gasto), cambio: <Cambio ahora={r.gasto} antes={ant?.gasto} />, tono: "violeta" },
                { icono: Eye, titulo: "Tus anuncios se vieron", valor: `${fmt(r.impresiones)} veces`, cambio: <Cambio ahora={r.impresiones} antes={ant?.impresiones} />, tono: "azul" },
                r.resultados > 0
                  ? {
                      icono: r.principal === "compras" ? ShoppingBag : r.principal === "mensajes" ? MessageCircle : MousePointerClick,
                      titulo: `Cada ${unoVisible(nom.uno)} costó`,
                      valor: r.costo != null ? formatARS(r.costo) : "",
                      sub: `${fmt(r.resultados)} ${plural(r.resultados, unoVisible(nom.uno))} en total`,
                      cambio: <Cambio ahora={r.costo} antes={ant?.costo} alReves />,
                      tono: "verde",
                    }
                  : null,
                r.clics > 0 && r.principal !== "clics"
                  ? { icono: MousePointerClick, titulo: "Clics en tus anuncios", valor: fmt(r.clics), cambio: <Cambio ahora={r.clics} antes={ant?.clics} />, tono: "ambar" }
                  : null,
              ]}
            />
          )}

          {deVideos && (
            <Grupo
              icono={Megaphone}
              titulo="Tus videos con pauta"
              tiles={[
                vid.mensajes ? { icono: MessageCircle, titulo: "Mensajes recibidos", valor: fmt(vid.mensajes), tono: "verde" } : null,
                vid.alcance ? { icono: Users, titulo: "Personas alcanzadas", valor: fmt(vid.alcance), tono: "azul" } : null,
                vid.reproducciones ? { icono: Play, titulo: "Reproducciones", valor: fmt(vid.reproducciones), tono: "rosa" } : null,
                vid.gasto
                  ? { icono: Wallet, titulo: "Inversión", valor: formatARS(vid.gasto), sub: vid.costoMensaje ? `${formatARS(vid.costoMensaje)} por mensaje` : undefined, tono: "violeta" }
                  : null,
              ]}
            />
          )}

          {hayIg && (
            <Grupo
              icono={Instagram}
              titulo="Tu Instagram"
              tiles={[
                igR.seguidores != null
                  ? {
                      icono: Users,
                      titulo: "Seguidores",
                      valor: fmt(igR.seguidores),
                      sub: igR.variacion ? `${igR.variacion > 0 ? "+" : ""}${fmt(igR.variacion)} en el mes` : undefined,
                      tono: "rosa",
                    }
                  : null,
                igR.alcanceDia != null
                  ? { icono: Users, titulo: "Personas que te ven por día", valor: fmt(igR.alcanceDia), sub: "en promedio", cambio: <Cambio ahora={igR.alcanceDia} antes={igA.alcanceDia} />, tono: "azul" }
                  : null,
                igR.vistas != null ? { icono: Eye, titulo: "Visualizaciones", valor: fmt(igR.vistas), cambio: <Cambio ahora={igR.vistas} antes={igA.vistas} />, tono: "violeta" } : null,
                igR.interacciones != null
                  ? { icono: Heart, titulo: "Interacciones", valor: fmt(igR.interacciones), sub: "me gusta, comentarios, guardados", cambio: <Cambio ahora={igR.interacciones} antes={igA.interacciones} />, tono: "rosa" }
                  : null,
              ]}
            />
          )}

          <CrecimientoRedes proyectoId={cliente.id} />
          <EvolucionMensajes videos={videos} proyectoId={cliente.id} mes={mes} onMes={onMes} />
          <VideosDelMes publicados={vid.publicados} conMeta={hayPauta} />
        </>
      )}

      <details className="group rounded-2xl border bg-card/60 p-4">
        <summary className="flex cursor-pointer select-none list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <HelpCircle className="h-4 w-4 text-primary" /> ¿Qué significa cada número?
          <span className="ml-auto text-xs font-normal text-muted-foreground transition-transform group-open:rotate-180">▾</span>
        </summary>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          {GLOSARIO.map(([t, d]) => (
            <div key={t}>
              <dt className="font-medium">{t}</dt>
              <dd className="mt-0.5 text-xs text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
