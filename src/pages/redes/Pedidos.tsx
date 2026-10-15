import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, ChevronDown, Clapperboard, ImageIcon, Inbox, Loader2, MapPin, Package, Sparkles, Square, Volume2 } from "lucide-react";
import { callApi } from "@/lib/redes/api";
import { PageShell } from "@/components/redes/PageShell";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { etapaInfo } from "@/lib/redes/etapas";
import { hoyISO } from "@/lib/redes/format";
import { formatoInfo } from "@/lib/redes/piezas";
import { DIAS_PEDIDOS, marcarVistoPedidos, usePedidosClientes, type PedidoCliente } from "@/lib/redes/pedidosClientes";
import { cn } from "@/lib/utils";

/** "hace 5 min", "hace 3 h", "ayer", "hace 4 días". */
function haceCuanto(at: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

/** "sáb 18 oct". */
const fechaLinda = (f: string) =>
  new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).replace(/[.,]/g, "");

/** En qué grupo cae (por el día en que entró). */
function grupoDe(at: string): string {
  const d = hoyISO(at);
  if (d === hoyISO()) return "Hoy";
  if (d === hoyISO(Date.now() - 86_400_000)) return "Ayer";
  if (d >= hoyISO(Date.now() - 7 * 86_400_000)) return "Esta semana";
  return "Antes";
}
const GRUPOS = ["Hoy", "Ayer", "Esta semana", "Antes"];

type Filtro = "todos" | "video" | "pieza";

/**
 * Bandeja de pedidos de los clientes (videos y piezas): lo que pidieron en los últimos días, agrupado por día y
 * con lo nuevo resaltado. Al abrirla se marca como visto (el número rojo del menú se apaga).
 */
export default function Pedidos() {
  const { user } = useUserProfileContext();
  const uid = user?.uid ?? "";
  const { lista, corte } = usePedidosClientes();
  const { loading } = useRedes();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  // Un ratito de gracia al entrar: los datos llegan en tandas y no queremos mostrar "no hay pedidos" de más.
  const [espera, setEspera] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setEspera(false), 2500);
    return () => window.clearTimeout(t);
  }, []);
  // Lo que era nuevo al entrar sigue resaltado mientras esté en la pantalla.
  const corteAlEntrar = useRef(corte);
  const esNuevo = (p: PedidoCliente) => p.at > corteAlEntrar.current;

  useEffect(() => {
    if (!uid) return;
    const t = window.setTimeout(() => marcarVistoPedidos(uid), 1500);
    return () => window.clearTimeout(t);
  }, [uid, lista.length]);

  const visibles = lista.filter((p) => filtro === "todos" || p.tipo === filtro);
  const grupos = useMemo(() => GRUPOS.map((g) => ({ g, items: visibles.filter((p) => grupoDe(p.at) === g) })).filter((x) => x.items.length), [visibles]);
  const nuevos = lista.filter(esNuevo).length;
  const semana = lista.filter((p) => hoyISO(p.at) >= hoyISO(Date.now() - 7 * 86_400_000)).length;
  const cuantos = { todos: lista.length, video: lista.filter((p) => p.tipo === "video").length, pieza: lista.filter((p) => p.tipo === "pieza").length };

  return (
    <PageShell title="Pedidos de clientes" subtitle={`Lo que pidieron los clientes desde su panel en los últimos ${DIAS_PEDIDOS} días.`}>
      {(loading || espera) && lista.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-3xl bg-muted/60" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed px-6 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white shadow-lg">
            <Inbox className="h-8 w-8" />
          </span>
          <p className="text-lg font-semibold">Todavía no hay pedidos</p>
          <p className="max-w-sm text-sm text-muted-foreground">Cuando un cliente pida un video o una pieza desde su panel, aparece acá y se prende el número rojo del menú.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Dato icono={Sparkles} valor={nuevos} texto="Nuevos" tono={nuevos ? "from-red-500 to-rose-600" : "from-slate-400 to-slate-500"} late={nuevos > 0} />
            <Dato icono={CalendarClock} valor={semana} texto="Esta semana" tono="from-amber-400 to-orange-500" />
            <Dato icono={Clapperboard} valor={cuantos.video} texto="Videos" tono="from-[#6F40FC] to-[#E040A0]" />
            <Dato icono={ImageIcon} valor={cuantos.pieza} texto="Piezas" tono="from-pink-500 to-rose-600" />
          </div>

          {/* Filtro */}
          <div className="inline-flex rounded-full border bg-card p-1">
            {(
              [
                ["todos", "Todos"],
                ["video", "Videos"],
                ["pieza", "Piezas"],
              ] as [Filtro, string][]
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFiltro(k)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  filtro === k ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t} <span className="opacity-70">{cuantos[k]}</span>
              </button>
            ))}
          </div>

          {grupos.map(({ g, items }) => (
            <section key={g} className="space-y-3">
              <h2 className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {g}
                <span className="h-px flex-1 bg-border" />
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {items.map((p) => (
                  <Tarjeta key={p.tipo + p.id} p={p} nuevo={esNuevo(p)} />
                ))}
              </div>
            </section>
          ))}
          {grupos.length === 0 && <p className="text-sm text-muted-foreground">No hay {filtro === "video" ? "videos" : "piezas"} pedidos en estos días.</p>}
        </div>
      )}
    </PageShell>
  );
}

function Dato({ icono: Icono, valor, texto, tono, late }: { icono: React.ElementType; valor: number; texto: string; tono: string; late?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border bg-card p-3", late && "border-red-500/50")}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", tono, late && "motion-safe:animate-pulse")}>
        <Icono className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-none tabular-nums">{valor}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{texto}</p>
      </div>
    </div>
  );
}

function Tarjeta({ p, nuevo }: { p: PedidoCliente; nuevo?: boolean }) {
  const navigate = useNavigate();
  const { clienteById } = useRedes();
  const [abierta, setAbierta] = useState(false);
  const cliente = clienteById(p.clienteId);
  const esVideo = p.tipo === "video";
  const titulo = esVideo ? p.video.titulo : p.pieza.producto || p.pieza.pedido;
  const tipo = esVideo ? (p.video.extra ? "Video extra" : "Video") : formatoInfo(p.pieza.formato).label;
  const detalle = esVideo ? p.video.idea : p.pieza.producto ? p.pieza.pedido : null;
  const fecha = esVideo ? p.video.fecha_deseada : p.pieza.fecha_deseada;
  const largo = (detalle?.length ?? 0) > 160;
  // Con resumen de Prodi, lo que escribió el cliente queda plegado (se abre con un toque).
  const conResumen = !!(esVideo ? p.video.resumen_ia : p.pieza.resumen_ia)?.texto;
  const plegable = largo || conResumen;

  // Plan: del plan, extra/aparte y si está pago.
  const plan = esVideo
    ? p.video.extra
      ? { texto: "Extra", clase: "text-amber-600 dark:text-amber-300" }
      : { texto: "Del plan", clase: "text-emerald-600 dark:text-emerald-300" }
    : p.pieza.incluida
      ? { texto: "Del plan", clase: "text-emerald-600 dark:text-emerald-300" }
      : p.pieza.estado === "pendiente_pago"
        ? { texto: "Sin pagar", clase: "text-destructive" }
        : { texto: "Aparte, pagada", clase: "text-amber-600 dark:text-amber-300" };

  // Dónde / cómo: localidad (con viático), lo filma el cliente o con material.
  const v = esVideo ? p.video : null;
  const donde = v
    ? v.filma_cliente
      ? "Lo filma el cliente"
      : v.material_base?.tipo === "existente"
        ? "Con su material"
        : v.viatico && v.viatico.estado !== "sin_cargo"
          ? `${v.viatico.localidad}${v.viatico.km != null ? ` · ${v.viatico.km} km` : ""}`
          : "Reconquista"
    : null;

  const abrir = () => navigate(esVideo ? `/videos?video=${p.id}` : `/piezas?pieza=${p.id}`);
  const inicial = (cliente?.nombre ?? "?").trim().charAt(0).toUpperCase();

  return (
    <article
      onClick={abrir}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-3xl border bg-card transition-all hover:-translate-y-0.5 hover:shadow-lg",
        nuevo && "border-red-500/60 shadow-md shadow-red-500/10"
      )}
    >
      {/* Franja de color arriba: violeta video, rosa pieza */}
      <span className={cn("h-1.5 w-full bg-gradient-to-r", esVideo ? "from-[#6F40FC] to-[#E040A0]" : "from-pink-500 to-rose-500")} />

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Cliente, tipo y cuándo entró */}
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: cliente?.color || "#6F40FC" }}
          >
            {inicial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{cliente?.nombre ?? "Cliente"}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {esVideo ? <Clapperboard className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
              {tipo} · {haceCuanto(p.at)}
            </p>
          </div>
          {nuevo && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-white" /> Nuevo
            </span>
          )}
        </div>

        {/* Qué pidió */}
        <div>
          <h3 className="text-lg font-bold leading-snug">{titulo}</h3>
          {detalle && (
            <>
              <ResumenIA p={p} largo={largo} />
              <p className={cn("mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground", !abierta && "line-clamp-2", plegable && !abierta && "hidden")}>{detalle}</p>
              {plegable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAbierta((x) => !x);
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  {abierta ? "Ocultar lo que escribió" : "Ver lo que escribió el cliente"}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", abierta && "rotate-180")} />
                </button>
              )}
            </>
          )}
        </div>

        {/* Datos clave */}
        <div className={cn("mt-auto grid gap-2", donde ? "grid-cols-3" : "grid-cols-2")}>
          <Celda icono={CalendarClock} label="Para cuándo" valor={fecha ? fechaLinda(fecha) : "Sin fecha"} clase={fecha ? "text-orange-600 dark:text-orange-300" : "text-muted-foreground"} />
          <Celda icono={Package} label="Plan" valor={plan.texto} clase={plan.clase} />
          {donde && <Celda icono={MapPin} label="Dónde" valor={donde} />}
        </div>
      </div>

      {/* Pie: etapa y abrir */}
      <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-4 py-2.5">
        <span className="truncate text-xs text-muted-foreground">
          {esVideo ? `Etapa: ${etapaInfo(p.video.etapa).label}` : p.pieza.estado === "pendiente_pago" ? "Esperando el pago" : "En diseño"}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">
          Abrir <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </article>
  );
}

function Celda({ icono: Icono, label, valor, clase }: { icono: React.ElementType; label: string; valor: string; clase?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/50 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icono className="h-3 w-3" /> {label}
      </p>
      <p className={cn("mt-0.5 truncate text-sm font-semibold", clase)}>{valor}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resumen de Prodi: la IA cuenta el pedido en 1 o 2 frases (y lo lee en voz alta).

/** De a uno: si se abren muchos pedidos sin resumen, no se piden todos juntos. */
let cola: Promise<unknown> = Promise.resolve();
const pedidos = new Map<string, Promise<string | null>>();
function pedirResumen(tipo: string, id: string): Promise<string | null> {
  const k = `${tipo}:${id}`;
  if (!pedidos.has(k)) {
    const p = cola.then(() => callApi<{ texto: string | null }>("/api/ia/resumen-pedido", { tipo, id }).then((r) => r.texto));
    cola = p.catch(() => undefined);
    pedidos.set(k, p);
  }
  return pedidos.get(k)!;
}

function ResumenIA({ p, largo }: { p: PedidoCliente; largo: boolean }) {
  const { viewingAs } = useUserProfileContext();
  const guardado = (p.tipo === "video" ? p.video.resumen_ia : p.pieza.resumen_ia)?.texto ?? null;
  const [texto, setTexto] = useState<string | null>(guardado);
  const [estado, setEstado] = useState<"listo" | "cargando" | "error">(guardado ? "listo" : "cargando");
  const [hablando, setHablando] = useState(false);

  useEffect(() => {
    if (guardado) {
      setTexto(guardado);
      setEstado("listo");
      return;
    }
    // Solo hace falta si lo que escribió el cliente es largo. Mirando "como" otro no se genera (sería escribir).
    if (!largo || viewingAs) return;
    let vivo = true;
    setEstado("cargando");
    pedirResumen(p.tipo, p.id)
      .then((r) => vivo && (setTexto(r), setEstado("listo")))
      .catch(() => vivo && setEstado("error"));
    return () => {
      vivo = false;
    };
  }, [guardado, largo, viewingAs, p.tipo, p.id]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  if (!largo && !guardado) return null;
  if (estado === "error" || (estado === "listo" && !texto) || (viewingAs && !guardado)) return null;

  const escuchar = (e: React.MouseEvent) => {
    e.stopPropagation();
    const s = window.speechSynthesis;
    if (!s || !texto) return;
    if (hablando) {
      s.cancel();
      setHablando(false);
      return;
    }
    s.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "es-AR";
    const voz = s.getVoices().find((v) => v.lang === "es-AR") ?? s.getVoices().find((v) => v.lang.startsWith("es"));
    if (voz) u.voice = voz;
    u.rate = 1.05;
    u.onend = () => setHablando(false);
    u.onerror = () => setHablando(false);
    setHablando(true);
    s.speak(u);
  };

  return (
    <div className="mt-2 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.10] to-fuchsia-500/[0.06] p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          <Sparkles className="h-3.5 w-3.5" /> Prodi te lo resume
        </span>
        {estado === "listo" && texto && "speechSynthesis" in window && (
          <button
            type="button"
            onClick={escuchar}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
              hablando ? "bg-primary text-primary-foreground" : "bg-background/70 text-primary hover:bg-background"
            )}
          >
            {hablando ? <Square className="h-3 w-3 fill-current" /> : <Volume2 className="h-3.5 w-3.5" />}
            {hablando ? "Parar" : "Escuchar"}
          </button>
        )}
      </div>
      {estado === "cargando" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo el pedido…
        </p>
      ) : (
        <p className="text-[15px] font-medium leading-snug">{texto}</p>
      )}
    </div>
  );
}
