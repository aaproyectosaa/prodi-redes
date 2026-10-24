import { LeerEnVoz } from "@/components/LeerEnVoz";
import { useEffect, useMemo, useState } from "react";
import { BotonAplicar, ChatIA } from "@/components/redes/ChatIA";
import { HacerConsejo } from "@/components/redes/HacerConsejo";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Flame,
  FlaskConical,
  Image,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Loader2,
  MapPin,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Scissors,
  ShoppingBag,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db } from "@/integrations/firebase/client";
import { doc, onSnapshot } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { assertEditable } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";

// Consejos de la IA para quien maneja la pauta: lee los últimos 90 días de la cuenta del cliente y dice qué mantener,
// qué mejorar, qué cortar y qué probar (api/_lib/ia-pauta.ts). Queda guardado; se rehace a pedido.

interface Sugerencia {
  titulo: string;
  accion?: string;
  porque?: string;
  detalle: string;
  /** A qué apunta (campaña, anuncio, público…); sin esto, es un consejo general. */
  sobre?: { tipo: string; nombre: string } | null;
  tipo: "mantener" | "mejorar" | "cortar" | "probar";
  prioridad: "alta" | "media" | "baja";
}
interface Numero {
  etiqueta: string;
  valor: string;
  tendencia: "sube" | "baja" | "igual";
  bueno: boolean;
}
interface Consejos {
  estado?: "bien" | "regular" | "mal";
  titular?: string;
  numeros?: Numero[];
  resumen: string;
  sugerencias: Sugerencia[];
  base?: { campanias: number; conjuntos: number; anuncios: number; gasto: number; moneda: string; leido: string[] };
  generado_at: string;
  hechos?: Hechos;
}

/** Ícono y texto de "a qué apunta" cada consejo. */
const SOBRE: Record<string, { icono: React.ElementType; label: string }> = {
  campaña: { icono: Megaphone, label: "Campaña" },
  conjunto: { icono: Users, label: "Conjunto" },
  anuncio: { icono: Image, label: "Anuncio" },
  público: { icono: Users, label: "Público" },
  ubicación: { icono: LayoutGrid, label: "Ubicación" },
  zona: { icono: MapPin, label: "Zona" },
  horario: { icono: Clock, label: "Horario" },
  presupuesto: { icono: Wallet, label: "Presupuesto" },
  general: { icono: Lightbulb, label: "General" },
};

const plata = (n: number, moneda: string) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n)} ${moneda}`;

const TIPO: Record<Sugerencia["tipo"], { label: string; icono: React.ElementType; chip: string; barra: string; caja: string; texto: string }> = {
  cortar: { label: "Cortar", icono: Scissors, chip: "bg-red-500/15 text-red-600 dark:text-red-300", barra: "bg-red-500", caja: "bg-red-500/15 text-red-500", texto: "text-red-600 dark:text-red-400" },
  mejorar: { label: "Mejorar", icono: TrendingUp, chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300", barra: "bg-sky-500", caja: "bg-sky-500/15 text-sky-500", texto: "text-sky-600 dark:text-sky-400" },
  probar: { label: "Probar", icono: FlaskConical, chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300", barra: "bg-violet-500", caja: "bg-violet-500/15 text-violet-500", texto: "text-violet-600 dark:text-violet-400" },
  mantener: { label: "Mantener", icono: CheckCircle2, chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", barra: "bg-emerald-500", caja: "bg-emerald-500/15 text-emerald-500", texto: "text-emerald-600 dark:text-emerald-400" },
};

/** Cuándo hacer cada consejo (reemplaza las barras de colores y el «Urgente» en cada fila). */
const GRUPOS: { prioridad: Sugerencia["prioridad"]; titulo: string; icono: React.ElementType; clase: string }[] = [
  { prioridad: "alta", titulo: "Hacelo hoy", icono: Flame, clase: "text-red-600 dark:text-red-400" },
  { prioridad: "media", titulo: "Esta semana", icono: Clock, clase: "text-amber-600 dark:text-amber-400" },
  { prioridad: "baja", titulo: "Cuando puedas", icono: Lightbulb, clase: "text-muted-foreground" },
];

/**
 * Un consejo: cerrado se lee entero (qué hacer y sobre qué); abierto, el porqué y los botones
 * (Hacer, Ya lo hice, Escuchar), todos juntos abajo.
 */
function FilaConsejo({
  s,
  i,
  proyectoId,
  abierto,
  onAbrir,
  onHecho,
}: {
  s: Sugerencia;
  i: number;
  proyectoId: string;
  abierto: boolean;
  onAbrir: () => void;
  onHecho: () => void;
}) {
  const t = TIPO[s.tipo] ?? TIPO.mejorar;
  const accion = s.accion || s.titulo;
  const porque = s.porque || primeraFrase(s.detalle);
  const so = s.sobre && s.sobre.tipo !== "general" ? SOBRE[s.sobre.tipo] ?? null : null;
  const [masDetalle, setMasDetalle] = useState(false);
  return (
    <li className={cn("rounded-2xl border bg-card transition-all", abierto ? "border-primary/30 shadow-md" : "hover:border-foreground/20")}>
      <button type="button" onClick={onAbrir} aria-expanded={abierto} className="flex w-full items-start gap-3 p-3 text-left sm:p-3.5">
        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", t.caja)}>
          <t.icono className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            <span className={cn("font-bold uppercase tracking-wide", t.texto)}>{t.label}</span>
            {so && s.sobre?.nombre && (
              <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                <so.icono className="h-3 w-3 shrink-0" />
                <span className="truncate">{s.sobre.nombre}</span>
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-sm font-semibold leading-snug">{accion}</span>
        </span>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", abierto && "rotate-180")} />
      </button>
      {abierto && (
        <div className="space-y-3 px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-150 sm:px-3.5 sm:pb-3.5">
          <div className="rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Por qué</p>
            {porque}
            {s.detalle && s.detalle !== porque && (
              <>
                {masDetalle ? (
                  <p className="mt-2 border-t pt-2 text-[13px] text-muted-foreground">{s.detalle}</p>
                ) : (
                  <button type="button" onClick={() => setMasDetalle(true)} className="mt-1 block text-xs font-semibold text-primary hover:underline">
                    Ver más detalle
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {s.tipo !== "mantener" && <HacerConsejo proyectoId={proyectoId} indice={i} />}
            <button
              type="button"
              onClick={onHecho}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-4 text-xs font-semibold transition-colors hover:border-emerald-500 hover:text-emerald-600"
            >
              <Check className="h-3.5 w-3.5" /> Ya lo hice
            </button>
            <LeerEnVoz className="ml-auto" texto={[accion, `Por qué: ${porque}`, s.detalle && s.detalle !== porque ? s.detalle : ""].filter(Boolean).join(". ")} />
          </div>
        </div>
      )}
    </li>
  );
}

const ESTADO: Record<NonNullable<Consejos["estado"]>, { label: string; clase: string; punto: string; fondo: string }> = {
  bien: { label: "Viene bien", clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", punto: "bg-emerald-500", fondo: "from-emerald-500/[0.14]" },
  regular: { label: "Hay que ajustar", clase: "bg-amber-500/15 text-amber-700 dark:text-amber-300", punto: "bg-amber-500", fondo: "from-amber-500/[0.14]" },
  mal: { label: "Necesita cambios", clase: "bg-red-500/15 text-red-700 dark:text-red-300", punto: "bg-red-500", fondo: "from-red-500/[0.14]" },
};

/** Ícono y color de cada número clave según de qué habla. */
function iconoNumero(etiqueta: string): { icono: React.ElementType; caja: string } {
  const e = etiqueta.toLowerCase();
  if (/costo|cpr|cpc|cpm/.test(e)) return { icono: Target, caja: "from-amber-400 to-orange-500" };
  if (/venta/.test(e)) return { icono: ShoppingBag, caja: "from-emerald-400 to-teal-500" };
  if (/invers|gast/.test(e)) return { icono: Wallet, caja: "from-violet-500 to-fuchsia-500" };
  if (/impresi|alcance|visualiz/.test(e)) return { icono: Eye, caja: "from-sky-400 to-blue-500" };
  if (/clic|ctr/.test(e)) return { icono: MousePointerClick, caja: "from-sky-400 to-indigo-500" };
  return { icono: MessageCircle, caja: "from-teal-400 to-emerald-500" };
}

const PESO = { alta: 0, media: 1, baja: 2 } as const;
/** Inversión, gasto, impresiones o alcance: subir o bajar no es bueno ni malo (flecha gris). */
const NEUTRO = /invers|invert|gast|impresi|alcance|visualiz/i;

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
/** Primera oración de un texto (para los consejos guardados antes de que existieran "acción" y "por qué"). */
const primeraFrase = (t: string) => (t.match(/^[^.!?]+[.!?]/)?.[0] ?? t).trim();

/** Quién marcó cada consejo como hecho y cuándo (queda en la base: lo ve el admin y el resto del equipo). */
type Hechos = Record<string, { uid: string; nombre: string; at: string } | null>;

function useHechos(proyectoId: string, deLaBase: Hechos | undefined) {
  // Lo que se tocó recién se ve al toque (hasta que llega de la base).
  const [locales, setLocales] = useState<Record<string, boolean>>({});
  useEffect(() => setLocales({}), [deLaBase]);
  const esHecho = (i: number) => (String(i) in locales ? locales[String(i)] : !!deLaBase?.[String(i)]);
  const quien = (i: number) => deLaBase?.[String(i)] ?? null;
  const alternar = (i: number) => {
    try {
      assertEditable();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Es solo lectura");
      return;
    }
    const nuevo = !esHecho(i);
    setLocales((x) => ({ ...x, [String(i)]: nuevo }));
    void callApi("/api/ia/pauta-hecho", { proyecto_id: proyectoId, indice: i, hecho: nuevo }).catch((e) => {
      setLocales((x) => {
        const n = { ...x };
        delete n[String(i)];
        return n;
      });
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    });
  };
  return { esHecho, quien, alternar };
}

export function ConsejosPauta({ proyectoId }: { proyectoId: string }) {
  const [datos, setDatos] = useState<Consejos | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [abierto, setAbierto] = useState<number | null>(null);
  const { esHecho, quien, alternar } = useHechos(proyectoId, datos?.hechos);

  useEffect(() => {
    return onSnapshot(
      doc(db, "ia_pauta", proyectoId),
      (s) => setDatos(s.exists() ? (s.data() as Consejos) : null),
      () => setDatos(null)
    );
  }, [proyectoId]);

  const analizar = async (rehacer: boolean) => {
    setBusy(true);
    try {
      const r = await callApi<Consejos>("/api/ia/pauta-consejos", { proyecto_id: proyectoId, rehacer });
      setDatos(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no respondió");
    } finally {
      setBusy(false);
    }
  };

  // Lo más urgente arriba: prioridad y después cortar → mejorar → probar → mantener.
  const lista = useMemo(() => {
    const orden: Sugerencia["tipo"][] = ["cortar", "mejorar", "probar", "mantener"];
    return (datos?.sugerencias ?? [])
      .map((s, i) => ({ s, i }))
      .sort((a, b) => PESO[a.s.prioridad] - PESO[b.s.prioridad] || orden.indexOf(a.s.tipo) - orden.indexOf(b.s.tipo));
  }, [datos?.sugerencias]);
  const titular = datos ? datos.titular || primeraFrase(datos.resumen) : "";
  const estado = datos?.estado ? ESTADO[datos.estado] : null;
  const hechas = lista.filter((x) => esHecho(x.i)).length;

  return (
    <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center gap-3 px-5 pb-1 pt-5">
        <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white shadow-lg shadow-primary/30">
          <Sparkles className="h-5 w-5" />
          {busy && <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/30" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold tracking-tight">Consejos de la IA</p>
          <p className="text-xs text-muted-foreground">
            {datos ? `Analizó los últimos 90 días · ${fecha(datos.generado_at)}` : "Lee los últimos 90 días de pauta y te dice qué hacer."}
          </p>
        </div>
        <Button
          size="sm"
          variant={datos ? "outline" : "default"}
          className={cn("h-10 rounded-full px-4 text-xs font-semibold", datos ? "bg-muted/40 hover:bg-muted" : "bg-gradient-to-r from-primary to-fuchsia-500 shadow-md shadow-primary/25")}
          disabled={busy || datos === undefined}
          onClick={() => void analizar(!!datos)}
        >
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : datos ? <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          {busy ? "Analizando…" : datos ? "Analizar de nuevo" : "Analizar la pauta"}
        </Button>
      </div>

      {datos && (
        <div className="space-y-6 p-5">
          {/* Cómo viene, en una frase. */}
          <div className="space-y-4">
            <div className={cn("relative overflow-hidden rounded-2xl border bg-gradient-to-br via-transparent to-transparent p-4 sm:p-5", estado?.fondo ?? "from-primary/[0.10]")}>
              {estado && (
                <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold", estado.clase)}>
                  <span className="relative flex h-2 w-2">
                    <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", estado.punto)} />
                    <span className={cn("relative h-2 w-2 rounded-full", estado.punto)} />
                  </span>
                  {estado.label}
                </span>
              )}
              <p className="mt-3 text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">{titular}</p>
              <LeerEnVoz
                className="mt-3"
                etiqueta="Escuchar el análisis"
                texto={[titular, datos.resumen, lista.length ? `Qué hacer ahora: ${lista.map(({ s: x }) => x.accion || x.titulo).join(". ")}` : ""].filter(Boolean).join(". ")}
              />
            </div>
            {!!datos.numeros?.length && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {datos.numeros.map((n) => {
                  const Flecha = n.tendencia === "sube" ? ArrowUpRight : n.tendencia === "baja" ? ArrowDownRight : ArrowRight;
                  const { icono: IconoN, caja } = iconoNumero(n.etiqueta);
                  const neutro = NEUTRO.test(n.etiqueta);
                  return (
                    <div key={n.etiqueta} className="rounded-2xl border bg-card p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", caja)}>
                          <IconoN className="h-4 w-4" />
                        </span>
                        {n.tendencia !== "igual" && (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-1.5 py-0.5",
                              neutro ? "bg-muted text-muted-foreground" : n.bueno ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-600 dark:text-red-400"
                            )}
                            aria-label={neutro ? n.tendencia : n.bueno ? "mejoró" : "empeoró"}
                          >
                            <Flecha className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                      <p className="mt-3 truncate text-[11px] font-medium text-muted-foreground">{n.etiqueta}</p>
                      <p className="mt-0.5 text-xl font-extrabold tabular-nums tracking-tight">{n.valor}</p>
                    </div>
                  );
                })}
              </div>
            )}
            {datos.base && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Se basó en:</span>
                <span className="rounded-full bg-muted px-2 py-0.5">{datos.base.campanias} campañas</span>
                {datos.base.conjuntos > 0 && <span className="rounded-full bg-muted px-2 py-0.5">{datos.base.conjuntos} conjuntos</span>}
                {datos.base.anuncios > 0 && <span className="rounded-full bg-muted px-2 py-0.5">{datos.base.anuncios} anuncios</span>}
                <span className="rounded-full bg-muted px-2 py-0.5">{plata(datos.base.gasto, datos.base.moneda)} invertidos</span>
                {datos.base.leido.filter((x) => x !== "cada anuncio").map((x) => (
                  <span key={x} className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                    {x}
                  </span>
                ))}
              </div>
            )}
            {datos.resumen && (
              <details className="group">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-primary [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" /> Ver el análisis completo
                </summary>
                <p className="mt-2 rounded-2xl bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">{datos.resumen}</p>
              </details>
            )}
          </div>

          {/* Qué hacer ahora: agrupado por cuándo hacerlo; lo hecho baja a «Hechas». */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex items-center gap-2 text-base font-bold">
                  <ListChecks className="h-4 w-4 text-primary" /> Qué hacer ahora
                </p>
                <span className="text-xs font-medium text-muted-foreground">
                  {hechas} de {lista.length} hechas
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                  style={{ width: `${lista.length ? (hechas / lista.length) * 100 : 0}%` }}
                />
              </div>
            </div>

            {GRUPOS.map((g) => {
              const items = lista.filter((x) => x.s.prioridad === g.prioridad && !esHecho(x.i));
              if (!items.length) return null;
              return (
                <div key={g.prioridad} className="space-y-2">
                  <p className={cn("flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide", g.clase)}>
                    <g.icono className="h-3.5 w-3.5" /> {g.titulo}
                    <span className="font-medium normal-case tracking-normal text-muted-foreground">· {items.length}</span>
                  </p>
                  <ul className="space-y-2">
                    {items.map(({ s, i }) => (
                      <FilaConsejo key={i} s={s} i={i} proyectoId={proyectoId} abierto={abierto === i} onAbrir={() => setAbierto(abierto === i ? null : i)} onHecho={() => alternar(i)} />
                    ))}
                  </ul>
                </div>
              );
            })}

            {hechas > 0 && (
              <details className="group">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 [&::-webkit-details-marker]:hidden">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Hechas · {hechas}
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="mt-2 space-y-1">
                  {lista
                    .filter((x) => esHecho(x.i))
                    .map(({ s, i }) => {
                      const marco = quien(i);
                      return (
                        <li key={i} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm">
                          <button
                            type="button"
                            onClick={() => alternar(i)}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                            aria-label="Volver a pendiente"
                            title="Volver a pendiente"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">{s.accion || s.titulo}</span>
                          {marco && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {marco.nombre.split(" ")[0] || "alguien"} · {new Date(marco.at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </details>
            )}

            {!datos.titular && (
              <p className="text-[11px] text-muted-foreground">Tocá “Analizar de nuevo” para verlo con el semáforo y los números clave.</p>
            )}
            {datos.titular && !datos.base && (
              <p className="text-[11px] text-muted-foreground">Tocá “Analizar de nuevo”: ahora la IA también lee públicos, ubicaciones, zonas, horarios y cada anuncio.</p>
            )}
          </div>
        </div>
      )}

      <div className={cn("px-5 pb-5", !datos && "pt-4")}>
        <ChatIA
          tipo="pauta"
          titulo="Especialista Meta"
          proyectoId={proyectoId}
          actual={() => null}
          renderPropuesta={(p, listo) => {
            const texto = String(p.resumen_cliente ?? "");
            return (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-primary">Resumen para el cliente</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed">{texto}</p>
                <BotonAplicar
                  onClick={async () => {
                    await navigator.clipboard.writeText(texto);
                    toast.success("Copiado: pegalo en el chat del cliente");
                    listo();
                  }}
                >
                  Copiar
                </BotonAplicar>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
