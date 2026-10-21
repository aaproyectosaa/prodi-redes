import { PedirFotoPerfil } from "./PedirFotoPerfil";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAlertasPauta } from "@/components/redes/AlertasPauta";
import { auditoriaPauta } from "@/lib/redes/auditoriaPauta";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, ChevronDown, Sun, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { etapaInfo } from "@/lib/redes/etapas";
import { TIPOS_OBLIGACION, useFacturas, useObligaciones, vencimientos } from "@/lib/redes/facturacion";
import { hoyISO, mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { tableroDe } from "@/lib/redes/tableros";
import { useTareas } from "@/lib/redes/tareas";
import { cn } from "@/lib/utils";

export interface ItemDia {
  id: string;
  titulo: string;
  /** Cliente (si es de uno); si no, se muestra `sub`. */
  clienteId?: string | null;
  sub?: string;
  /** Texto de la etiqueta en vez de la fecha (ej. "Hoy 15:00"). */
  etiqueta?: string;
  /** Para cuándo (YYYY-MM-DD…), o null si no tiene fecha. */
  fecha: string | null | undefined;
  /** Qué hay que hacer ("Editar", "Revisar", "Publicar"…). */
  tarea: string;
  onAbrir: () => void;
}

const CUANTOS = 4;
const CLAVE = "prodi-mi-dia-visto";

/** "Ya lo vi": de hoy y con qué cosas (si después le entra algo nuevo, se vuelve a abrir). */
function leerVisto(): { fecha: string; ids: string[] } | null {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? "null");
  } catch {
    return null;
  }
}

/** "Atrasado N d", "Hoy", "Mañana" o el día. */
function cuando(fecha: string | null | undefined): { texto: string; tono: "rojo" | "naranja" | "normal" } {
  if (!fecha) return { texto: "Sin fecha", tono: "normal" };
  const f = fecha.slice(0, 10);
  const hoy = hoyISO();
  const manana = hoyISO(Date.now() + 86_400_000);
  if (f < hoy) {
    const dias = Math.max(1, Math.round((Date.parse(hoy) - Date.parse(f)) / 86_400_000));
    return { texto: `Atrasado ${dias} d`, tono: "rojo" };
  }
  if (f === hoy) return { texto: "Hoy", tono: "naranja" };
  if (f === manana) return { texto: "Mañana", tono: "normal" };
  return { texto: `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`, tono: "normal" };
}

/**
 * "Mi día": lo más urgente de cada uno, para que no tenga que buscar qué hacer. Salta como cartel al entrar al
 * tablero (una vez por día, o de nuevo si le entra algo nuevo y urgente). Al cerrarlo queda una pastillita
 * "Mi día" para volver a abrirlo. Ordenado por fecha (sin fecha, al final).
 */
function MiDiaCartel({ items }: { items: ItemDia[] }) {
  const { clienteById } = useRedes();
  const { profile } = useUserProfileContext();
  const nombre = (profile?.nombre ?? "").split(" ")[0];
  const ordenados = [...items].sort((a, b) => (a.fecha || "9999").localeCompare(b.fecha || "9999"));
  const primeros = ordenados.slice(0, CUANTOS);
  const resto = ordenados.length - primeros.length;
  // Mañana (hasta las 13), tarde (hasta las 20) o noche: cambia el saludo, el cielo y el dibujo.
  const h = new Date().getHours();
  const momento: "dia" | "tarde" | "noche" = h >= 6 && h < 13 ? "dia" : h >= 13 && h < 20 ? "tarde" : "noche";
  const saludo = { dia: "Buen día", tarde: "Buenas tardes", noche: "Buenas noches" }[momento];
  const atrasados = ordenados.filter((it) => cuando(it.fecha).tono === "rojo").length;
  const [abierto, setAbierto] = useState(false);
  const visto = leerVisto();
  // Ya lo vio hoy y no le entró nada nuevo desde entonces.
  const yaVisto = !!visto && visto.fecha === hoyISO() && primeros.every((it) => visto.ids.includes(it.id));
  const clave = primeros.map((it) => it.id).join(",");
  useEffect(() => {
    publicar({ total: items.length, atrasados });
  }, [items.length, atrasados]);
  useEffect(() => {
    const abrir = () => setAbierto(true);
    window.addEventListener(EVENTO, abrir);
    return () => window.removeEventListener(EVENTO, abrir);
  }, []);

  // Salta solo, un ratito después de entrar y sin pisar otro cartel (novedades, etc.).
  useEffect(() => {
    if (yaVisto || !primeros.length) return;
    let t = 0;
    const probar = () => {
      if (document.querySelector('[role="dialog"]')) t = window.setTimeout(probar, 1500);
      else setAbierto(true);
    };
    t = window.setTimeout(probar, 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, yaVisto]);

  const cerrar = () => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ fecha: hoyISO(), ids: primeros.map((it) => it.id) }));
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
    setAbierto(false);
  };

  if (!items.length) return null;

  return (
    <>
      <style>{SOL_CSS}</style>

      <Dialog open={abierto} onOpenChange={(v) => (v ? setAbierto(true) : cerrar())}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md gap-0 overflow-hidden rounded-[2rem] border-0 p-0 [&>button]:hidden">
          {/* Encabezado según la hora: sol de mañana, atardecer o noche con luna y estrellas */}
          <div className={cn("relative overflow-hidden px-6 pb-5 pt-6 text-white", `cielo-${momento}`)}>
            {momento === "noche" ? (
              ESTRELLAS.map((e, i) => (
                <span
                  key={i}
                  className="sol-estrella absolute rounded-full bg-white"
                  style={{ left: `${e.x}%`, top: `${e.y}%`, width: e.t, height: e.t, animationDelay: `${e.d}s` }}
                />
              ))
            ) : (
              <>
                <span className="sol-nube absolute left-[-20%] top-5 h-5 w-16 rounded-full bg-white/30 blur-[1px]" />
                <span className="sol-nube absolute left-[-30%] top-14 h-4 w-12 rounded-full bg-white/25 blur-[1px]" style={{ animationDelay: "4s" }} />
              </>
            )}
            <button
              type="button"
              onClick={cerrar}
              className="absolute right-3 top-3 z-10 rounded-full p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="relative flex items-center gap-4">
              {momento === "noche" ? (
                <div className="sol-flota relative flex h-16 w-16 shrink-0 items-center justify-center">
                  {/* medialuna: un círculo vacío con la sombra de adentro clara */}
                  <span
                    className="h-12 w-12 rounded-full"
                    style={{ boxShadow: "inset 11px -5px 0 0 #fef3c7", filter: "drop-shadow(0 0 14px rgba(253,230,138,0.7))", transform: "rotate(-20deg)" }}
                  />
                </div>
              ) : momento === "tarde" ? (
                <div className="relative h-16 w-16 shrink-0 overflow-hidden">
                  {/* sol que baja detrás del horizonte */}
                  <span className="sol-baja absolute inset-x-1 top-2 h-14 rounded-full bg-gradient-to-b from-yellow-200 via-orange-300 to-rose-400 shadow-[0_0_40px_rgba(251,146,60,0.8)]" />
                  <span className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-[#7c3aed]/70 to-transparent" />
                </div>
              ) : (
                <div className="relative h-16 w-16 shrink-0">
                  <span className="sol-rayos absolute inset-0 rounded-full" />
                  <span className="absolute inset-2 rounded-full bg-gradient-to-br from-yellow-200 to-amber-400 shadow-[0_0_40px_rgba(253,224,71,0.8)]" />
                </div>
              )}
              <div className="min-w-0">
                <DialogTitle className="text-2xl font-black leading-tight text-white">
                  {saludo}
                  {nombre ? `, ${nombre}` : ""} 👋
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-sm text-white/90">
                  {atrasados > 0
                    ? `Tenés ${atrasados} cosa${atrasados === 1 ? "" : "s"} atrasada${atrasados === 1 ? "" : "s"}. Arrancá por ahí 💪`
                    : "Esto es lo más urgente de hoy."}
                </DialogDescription>
              </div>
            </div>
          </div>

          <ol className="space-y-2 bg-background p-3">
            {primeros.map((it, i) => {
              const c = cuando(it.fecha);
              return (
                <li key={it.id} className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both" style={{ animationDelay: `${150 + i * 110}ms` }}>
                  <button
                    type="button"
                    onClick={() => {
                      cerrar();
                      it.onAbrir();
                    }}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-2xl border bg-card px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
                      c.tono === "rojo" && "animate-titilar border-destructive/60 bg-destructive/[0.07]"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums text-white",
                        c.tono === "rojo" ? "bg-destructive" : c.tono === "naranja" ? "bg-gradient-to-br from-amber-400 to-orange-500" : "bg-gradient-to-br from-primary to-fuchsia-500"
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{it.titulo}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {it.clienteId ? <ClienteTag cliente={clienteById(it.clienteId)} /> : it.sub ? <span className="truncate">{it.sub}</span> : null}
                        <span className="shrink-0">{it.clienteId || it.sub ? "· " : ""}{it.tarea}</span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        c.tono === "rojo" ? "bg-destructive text-white" : c.tono === "naranja" ? "bg-warning/25 text-foreground" : "bg-muted text-muted-foreground"
                      )}
                    >
                      <CalendarClock className="h-3 w-3" /> {c.tono === "rojo" ? c.texto : (it.etiqueta ?? c.texto)}
                    </span>
                    <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="space-y-2 bg-background px-3 pb-4">
            {resto > 0 && <p className="text-center text-xs text-muted-foreground">y {resto} más para después</p>}
            <button
              type="button"
              onClick={cerrar}
              className="h-12 w-full rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 text-base font-bold text-white shadow-lg shadow-orange-500/25 transition-transform active:scale-[0.98]"
            >
              {momento === "noche" ? "Listo, mañana sigo 🌙" : "¡Vamos! ☀️"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ESTRELLAS = Array.from({ length: 22 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: r(1) * 100, y: r(2) * 90, t: r(3) > 0.75 ? 3 : 2, d: r(4) * 3 };
});

const SOL_CSS = `
.cielo-dia { background: linear-gradient(135deg, #fbbf24 0%, #f97316 50%, #ec4899 100%); }
.cielo-tarde { background: linear-gradient(160deg, #fb923c 0%, #e11d48 45%, #7c3aed 100%); }
.cielo-noche { background: radial-gradient(120% 90% at 30% 0%, #3b2a8a 0%, #241a5c 45%, #0f0b2e 100%); }
.sol-estrella { opacity: .3; animation: sol-titila 3s ease-in-out infinite; }
@keyframes sol-titila { 0%, 100% { opacity: .2; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.2); } }
.sol-flota { animation: sol-flota 6s ease-in-out infinite; }
@keyframes sol-flota { 0%, 100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-4px) rotate(4deg); } }
.sol-baja { animation: sol-baja 6s ease-in-out infinite alternate; }
@keyframes sol-baja { from { transform: translateY(-2px); } to { transform: translateY(6px); } }
.sol-rayos { background: repeating-conic-gradient(rgba(255,255,255,.55) 0 10deg, transparent 10deg 30deg); -webkit-mask: radial-gradient(circle, transparent 45%, #000 46%, #000 70%, transparent 71%); mask: radial-gradient(circle, transparent 45%, #000 46%, #000 70%, transparent 71%); animation: sol-gira 14s linear infinite; }
@keyframes sol-gira { to { transform: rotate(360deg); } }
.sol-nube { animation: sol-nube 9s linear infinite; }
@keyframes sol-nube { 0% { transform: translateX(0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateX(560px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .sol-rayos, .sol-nube, .sol-estrella, .sol-flota, .sol-baja { animation: none; } }
`;

// ---------------------------------------------------------------------------
// La pastillita "Mi día · N" en las páginas: abre el cartel.

const EVENTO = "prodi-mi-dia";
let estado = { total: 0, atrasados: 0 };
const oyentes = new Set<() => void>();
function publicar(e: typeof estado) {
  if (e.total === estado.total && e.atrasados === estado.atrasados) return;
  estado = e;
  oyentes.forEach((f) => f());
}
const suscribir = (f: () => void) => {
  oyentes.add(f);
  return () => oyentes.delete(f);
};

export function BotonMiDia() {
  const e = useSyncExternalStore(suscribir, () => estado);
  if (!e.total) return null;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(EVENTO))}
      className="mb-4 inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-sm font-medium transition-colors hover:border-primary/50"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white">
        <Sun className="h-3 w-3" />
      </span>
      Mi día · {e.total}
      {e.atrasados > 0 && <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">{e.atrasados} atrasado{e.atrasados === 1 ? "" : "s"}</span>}
      <ChevronDown className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Qué le toca a cada uno, según sus roles. Se monta una vez en el sistema (AppLayout).

const EQUIPO = ["admin", "productor", "editor", "pauta", "diseno", "administracion", "programador"];

export function MiDia() {
  const navigate = useNavigate();
  const { user, role, roles } = useUserProfileContext();
  const { videos, piezas, reuniones, clientes } = useRedes();
  const uid = user?.uid ?? "";
  const misRoles = useMemo(() => [...new Set([role, ...(roles ?? [])].filter(Boolean).map(String))], [role, roles]);
  const delEquipo = misRoles.some((r) => EQUIPO.includes(r));
  const plata = misRoles.includes("admin") || misRoles.includes("administracion");
  const { mias } = useTareas(delEquipo ? uid : undefined);
  const { facturas } = useFacturas(sumarMeses(mesActual(), -3), plata);
  const obligaciones = useObligaciones(plata);
  const { alertas: alertasMeta } = useAlertasPauta(misRoles.includes("pauta"));

  const items = useMemo(() => {
    if (!delEquipo || !uid) return [];
    const hoy = hoyISO();
    const out: ItemDia[] = [];
    // Videos: donde le toca hacer algo a esta persona (su etapa), en cada tablero que tenga.
    const vistos = new Set<string>();
    for (const r of misRoles) {
      const tablero = tableroDe(r as never);
      if (!tablero) continue;
      for (const v of videos) {
        if (vistos.has(v.id) || v.etapa === "publicado" || etapaInfo(v.etapa).responsable !== r || !tablero.esMio(v, uid)) continue;
        vistos.add(v.id);
        out.push({
          id: v.id,
          titulo: v.titulo,
          clienteId: v.proyecto_id,
          fecha: v.entrega_edicion ?? v.fecha_deseada,
          tarea: etapaInfo(v.etapa).label,
          onAbrir: () => navigate(`/videos?video=${v.id}`),
        });
      }
    }
    // Pauta: lo pautado sin ID de Meta y las pautas con resultados viejos (metas de "Mi rendimiento").
    if (misRoles.includes("pauta")) {
      const a = auditoriaPauta(uid, videos, piezas, clientes, mesActual(), "");
      for (const v of a.sinMeta)
        out.push({ id: `meta-${v.id}`, titulo: v.titulo, clienteId: v.proyecto_id, fecha: hoy, etiqueta: "Falta", tarea: "Cargar ID de Meta", onAbrir: () => navigate(`/videos?video=${v.id}`) });
      for (const { video: v } of a.resultadosViejos)
        out.push({ id: `res-${v.id}`, titulo: v.titulo, clienteId: v.proyecto_id, fecha: hoy, etiqueta: "Falta", tarea: "Actualizar resultados", onAbrir: () => navigate(`/videos?video=${v.id}`) });
      // Alertas de Meta (presupuesto, sin gasto, costo que sube…): las que hay que mirar hoy.
      for (const al of alertasMeta.filter((x) => x.nivel >= 1))
        out.push({
          id: `al-${al.id}`,
          titulo: al.titulo,
          clienteId: al.proyectoId,
          fecha: hoy,
          etiqueta: al.nivel === 2 ? "Urgente" : "Hoy",
          tarea: al.detalle,
          onAbrir: () => navigate(`/clientes/${al.proyectoId}?tab=resultados`),
        });
    }
    // Diseño: piezas para hacer o corregir.
    if (misRoles.includes("diseno")) {
      for (const p of piezas.filter((p) => p.estado === "pagada" || p.estado === "en_proceso")) {
        out.push({
          id: p.id,
          titulo: p.pedido.slice(0, 80),
          clienteId: p.proyecto_id,
          fecha: p.fecha_deseada,
          tarea: p.estado === "pagada" ? "Para hacer" : (p.rondas ?? 0) > 0 || p.feedback_interno ? "Corregir" : "Diseñando",
          onAbrir: () => navigate(`/piezas?pieza=${p.id}`),
        });
      }
    }
    // Productor: piezas que diseño terminó y tiene que revisar.
    if (misRoles.includes("productor")) {
      for (const p of piezas.filter((p) => p.estado === "revision_interna")) {
        out.push({ id: p.id, titulo: p.pedido.slice(0, 80), clienteId: p.proyecto_id, fecha: p.fecha_deseada, tarea: "Revisar pieza", onAbrir: () => navigate(`/piezas?pieza=${p.id}`) });
      }
    }
    // Administración: boletas para revisar o cobrar, y cuotas e impuestos que vencen.
    if (plata) {
      for (const f of facturas) {
        if (f.estado === "borrador") out.push({ id: f.id, titulo: `Boleta de ${mesLabel(f.mes)}`, clienteId: f.proyecto_id, fecha: hoy, tarea: "Revisar y emitir", onAbrir: () => navigate("/cobros") });
        else if (f.estado === "pendiente" && f.vencimiento && f.vencimiento < hoy)
          out.push({ id: f.id, titulo: `Cobrar boleta de ${mesLabel(f.mes)}`, clienteId: f.proyecto_id, fecha: f.vencimiento, tarea: "Vencida sin cobrar", onAbrir: () => navigate("/cobros") });
      }
      const en7 = hoyISO(Date.now() + 7 * 86_400_000);
      for (const { o, c } of vencimientos(obligaciones, en7)) {
        out.push({
          id: `${o.id}-${c.n}`,
          titulo: o.tipo === "impuesto" ? o.nombre : `${o.nombre} · cuota ${c.n}`,
          sub: TIPOS_OBLIGACION[o.tipo].label,
          fecha: c.vence,
          tarea: `Pagar $ ${Math.round(c.monto).toLocaleString("es-AR")}`,
          onAbrir: () => navigate("/administracion"),
        });
      }
    }
    // Todos: las tareas que le dejaron en el chat…
    for (const ta of mias.filter((x) => !x.hecha)) {
      out.push({
        id: ta.id,
        titulo: ta.titulo,
        clienteId: ta.proyecto_id,
        sub: ta.creada_por_nombre ? `De ${ta.creada_por_nombre}` : undefined,
        fecha: ta.vence,
        tarea: "Tarea",
        onAbrir: () => navigate(ta.chat_id ? `/chat?c=${ta.chat_id}` : "/chat"),
      });
    }
    // …y las reuniones de hoy que todavía no pasaron.
    for (const r of reuniones) {
      if (r.estado !== "programada" || !r.participantes?.includes(uid) || hoyISO(r.fecha) !== hoy) continue;
      if (new Date(r.fin ?? r.fecha).getTime() < Date.now()) continue;
      const hh = new Date(r.fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
      out.push({ id: r.id, titulo: r.titulo, clienteId: r.proyecto_id, sub: "Reunión", fecha: hoy, etiqueta: `Hoy ${hh}`, tarea: "Reunión", onAbrir: () => navigate(`/reuniones?r=${r.id}`) });
    }
    return out;
  }, [delEquipo, uid, misRoles, videos, piezas, clientes, plata, facturas, obligaciones, mias, reuniones, navigate, alertasMeta]);

  if (!delEquipo) return null;
  return (
    <>
      <MiDiaCartel items={items} />
      {/* Sin foto de perfil: se la pide (estilo LinkedIn). */}
      <PedirFotoPerfil />
    </>
  );
}
