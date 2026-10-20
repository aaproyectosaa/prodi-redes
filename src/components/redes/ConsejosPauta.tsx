import { useEffect, useMemo, useState } from "react";
import { BotonAplicar, ChatIA } from "@/components/redes/ChatIA";
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

const TIPO: Record<Sugerencia["tipo"], { label: string; icono: React.ElementType; chip: string; barra: string; caja: string }> = {
  cortar: { label: "Cortar", icono: Scissors, chip: "bg-red-500/15 text-red-600 dark:text-red-300", barra: "bg-red-500", caja: "bg-red-500/15 text-red-500" },
  mejorar: { label: "Mejorar", icono: TrendingUp, chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300", barra: "bg-sky-500", caja: "bg-sky-500/15 text-sky-500" },
  probar: { label: "Probar", icono: FlaskConical, chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300", barra: "bg-violet-500", caja: "bg-violet-500/15 text-violet-500" },
  mantener: { label: "Mantener", icono: CheckCircle2, chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", barra: "bg-emerald-500", caja: "bg-emerald-500/15 text-emerald-500" },
};

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

/** Lo que ya se hizo de cada análisis (en este navegador). */
function useHechos(proyectoId: string, generado?: string) {
  const clave = `prodi:consejos-hechos:${proyectoId}:${generado ?? ""}`;
  const [hechos, setHechos] = useState<number[]>([]);
  useEffect(() => {
    try {
      setHechos(JSON.parse(localStorage.getItem(clave) ?? "[]"));
    } catch {
      setHechos([]);
    }
  }, [clave]);
  const alternar = (i: number) =>
    setHechos((prev) => {
      const next = prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i];
      try {
        localStorage.setItem(clave, JSON.stringify(next));
      } catch {
        /* sin almacenamiento */
      }
      return next;
    });
  return { hechos, alternar };
}

export function ConsejosPauta({ proyectoId }: { proyectoId: string }) {
  const [datos, setDatos] = useState<Consejos | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [filtro, setFiltro] = useState<Sugerencia["tipo"] | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const { hechos, alternar } = useHechos(proyectoId, datos?.generado_at);

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
  const visibles = filtro ? lista.filter((x) => x.s.tipo === filtro) : lista;
  const cuenta = (t: Sugerencia["tipo"]) => lista.filter((x) => x.s.tipo === t).length;
  const titular = datos ? datos.titular || primeraFrase(datos.resumen) : "";
  const estado = datos?.estado ? ESTADO[datos.estado] : null;
  const hechas = lista.filter((x) => hechos.includes(x.i)).length;

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

          {/* Qué hacer ahora: lista para tildar. */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-[12rem] flex-1 space-y-1.5">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <ListChecks className="h-4 w-4" />
                  </span>
                  Qué hacer ahora
                  <span className="text-xs font-medium text-muted-foreground">
                    {hechas} de {lista.length} hechas
                  </span>
                </p>
                <div className="h-1.5 max-w-xs overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                    style={{ width: `${lista.length ? (hechas / lista.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1 rounded-2xl bg-muted/50 p-1">
                <button
                  type="button"
                  onClick={() => setFiltro(null)}
                  className={cn("rounded-xl px-3 py-1.5 text-xs font-semibold transition-all", !filtro ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  Todas
                </button>
                {(Object.keys(TIPO) as Sugerencia["tipo"][]).filter(cuenta).map((t) => {
                  const IconoT = TIPO[t].icono;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFiltro(filtro === t ? null : t)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all",
                        filtro === t ? cn("shadow-sm", TIPO[t].chip) : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <IconoT className="h-3.5 w-3.5" />
                      {TIPO[t].label}
                      <span className="rounded-full bg-background/60 px-1.5 text-[10px] tabular-nums">{cuenta(t)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <ul className="space-y-2">
              {visibles.map(({ s, i }) => {
                const t = TIPO[s.tipo] ?? TIPO.mejorar;
                const Icono = t.icono;
                const hecho = hechos.includes(i);
                const accion = s.accion || s.titulo;
                const porque = s.porque || primeraFrase(s.detalle);
                const desplegado = abierto === i;
                return (
                  <li key={i} className={cn("relative overflow-hidden rounded-2xl border bg-card transition-opacity", hecho && "opacity-55")}>
                    <span className={cn("absolute inset-y-0 left-0 w-1", t.barra)} aria-hidden />
                    <div className="flex items-start gap-3 py-3 pl-4 pr-3">
                      <button
                        type="button"
                        onClick={() => alternar(i)}
                        className={cn(
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          hecho ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-emerald-500"
                        )}
                        aria-label={hecho ? "Marcar como pendiente" : "Marcar como hecho"}
                        title={hecho ? "Hecho" : "Marcar como hecho"}
                      >
                        {hecho && <Check className="h-3.5 w-3.5" />}
                      </button>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", t.chip)}>
                            <Icono className="h-3 w-3" /> {t.label}
                          </span>
                          {s.sobre && (s.sobre.nombre || s.sobre.tipo === "general") && (() => {
                            const so = SOBRE[s.sobre.tipo] ?? SOBRE.general;
                            const IconoSobre = so.icono;
                            return (
                              <span className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground" title={s.sobre.nombre}>
                                <IconoSobre className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {so.label}
                                  {s.sobre.nombre && s.sobre.tipo !== "general" ? `: ${s.sobre.nombre}` : ""}
                                </span>
                              </span>
                            );
                          })()}
                          {s.prioridad === "alta" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-300">
                              <Flame className="h-3 w-3" /> Urgente
                            </span>
                          )}
                        </div>
                        <p className={cn("text-sm font-semibold leading-snug", hecho && "line-through")}>{accion}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{porque}</p>
                        {s.detalle && s.detalle !== porque && (
                          <>
                            <button
                              type="button"
                              onClick={() => setAbierto(desplegado ? null : i)}
                              className="inline-flex items-center gap-1 pt-0.5 text-[11px] font-medium text-primary hover:underline"
                            >
                              <ChevronDown className={cn("h-3 w-3 transition-transform", desplegado && "rotate-180")} />
                              {desplegado ? "Ocultar detalle" : "Ver detalle"}
                            </button>
                            {desplegado && (
                              <p className="rounded-xl bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground animate-in fade-in slide-in-from-top-1">{s.detalle}</p>
                            )}
                          </>
                        )}
                      </div>
                      <span className={cn("hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:flex", t.caja)}>
                        <Icono className="h-4 w-4" />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
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
