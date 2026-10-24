import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, CalendarDays, Clapperboard, Loader2, Megaphone, RotateCcw, Send, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AdjuntosEnviados, BotonAdjuntar, ListaAdjuntos, useAdjuntosIA, type AdjuntoIA } from "@/components/redes/AdjuntosIA";
import { EstadoBorrador } from "@/components/redes/EstadoBorrador";
import { callApi } from "@/lib/redes/api";
import { useBorrador } from "@/lib/redes/borradores";
import { mesLabel } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

// Charla de campaña: el equipo le cuenta a la IA la campaña (un día de rodaje donde se filman muchos videos), la IA
// pregunta lo que le falta y, cuando sabe todo, propone los videos repartidos en los meses según los videos por mes
// del plan del cliente. Se revisa acá y con un toque queda cargado como borrador en cada mes (api/_lib/ia-charla.ts,
// tipo "campania", y /api/ia/plan-campania).

interface VideoCampania {
  id: string;
  titulo: string;
  idea: string;
  objetivo: string | null;
  porque: string | null;
  mes: string;
  sin_lugar?: boolean;
}

interface Cupo {
  mes: string;
  cupo: number;
  libres: number;
  bloqueado: boolean;
}

interface Propuesta {
  campania: string;
  rodaje: string | null;
  videos: VideoCampania[];
}

interface Mensaje {
  rol: "yo" | "ia";
  texto: string;
  recordado?: string | null;
  conPropuesta?: number;
  archivos?: string[];
}

const SUGERENCIAS = [
  "Tenemos un día de rodaje para una campaña nueva",
  "Lanzan un producto y queremos varios videos",
  "Campaña de temporada para los próximos meses",
];

const clave = (pid: string) => `prodi:campania-ia:${pid}`;

function leer(pid: string): { mensajes: Mensaje[]; propuesta: Propuesta | null } {
  try {
    const raw = localStorage.getItem(clave(pid));
    if (raw) return JSON.parse(raw);
  } catch {
    /* sin almacenamiento */
  }
  return { mensajes: [], propuesta: null };
}

type Charla = { mensajes: Mensaje[]; propuesta: Propuesta | null };
const charlaVacia = (c: Charla) => !c.mensajes.length && !c.propuesta;

export function CampaniaIA({
  proyectoId,
  nombre,
  mesDesde,
  onCargado,
}: {
  proyectoId: string;
  nombre: string;
  /** Primer mes donde se pueden cargar los videos. */
  mesDesde: string;
  /** Ya quedó cargado: abrir ese mes en "Armar el mes". */
  onCargado: (mes: string) => void;
}) {
  const inicial = useMemo(() => leer(proyectoId), [proyectoId]);
  const [mensajes, setMensajes] = useState<Mensaje[]>(inicial.mensajes);
  const [propuesta, setPropuesta] = useState<Propuesta | null>(inicial.propuesta);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [cupos, setCupos] = useState<Cupo[] | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const adj = useAdjuntosIA();

  // Cada cliente tiene su charla (sigue ahí si se cierra la ventana).
  useEffect(() => {
    const d = leer(proyectoId);
    setMensajes(d.mensajes);
    setPropuesta(d.propuesta);
  }, [proyectoId]);
  useEffect(() => {
    try {
      localStorage.setItem(clave(proyectoId), JSON.stringify({ mensajes: mensajes.slice(-40), propuesta }));
    } catch {
      /* sin almacenamiento */
    }
  }, [proyectoId, mensajes, propuesta]);

  // Y en el servidor: así no se pierde al cambiar de compu o de celular, y la ve todo el equipo.
  const charla = useMemo<Charla>(() => ({ mensajes: mensajes.slice(-40), propuesta }), [mensajes, propuesta]);
  const borrador = useBorrador<Charla>({
    tipo: "campania",
    clave: proyectoId,
    proyectoId,
    valor: charla,
    vacio: charlaVacia,
    alCargar: (d) => {
      // Si en esta compu hay una charla más larga (sin subir todavía), queda esa.
      if ((d.mensajes?.length ?? 0) < leer(proyectoId).mensajes.length) return;
      setMensajes(d.mensajes ?? []);
      setPropuesta(d.propuesta ?? null);
    },
  });

  // Lugares libres de los próximos meses.
  useEffect(() => {
    let vivo = true;
    setCupos(null);
    callApi<{ cupos: Cupo[] }>("/api/ia/plan-cupos", { proyecto_id: proyectoId, mes: mesDesde })
      .then((r) => vivo && setCupos(r.cupos))
      .catch(() => vivo && setCupos([]));
    return () => {
      vivo = false;
    };
  }, [proyectoId, mesDesde]);

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [mensajes.length, enviando]);

  const enviar = async (pedido?: string) => {
    const t = (pedido ?? texto).trim() || (adj.archivos.length ? "Te mando esto: miralo y usalo para la campaña." : "");
    if (!t || enviando) return;
    let adjuntos: AdjuntoIA[] = [];
    const elegidos = adj.archivos;
    try {
      adjuntos = await adj.preparar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron preparar los archivos");
      return;
    }
    const nuevos: Mensaje[] = [...mensajes, { rol: "yo", texto: t, ...(adjuntos.length ? { archivos: adjuntos.map((a) => a.nombre) } : {}) }];
    setMensajes(nuevos);
    setTexto("");
    setEnviando(true);
    try {
      const r = await callApi<{ respuesta: string; propuesta: (Propuesta & { cupos?: Cupo[] }) | null; recordado: string | null }>("/api/ia/charla", {
        tipo: "campania",
        proyecto_id: proyectoId,
        mes: mesDesde,
        actual: propuesta?.videos ?? [],
        mensajes: nuevos.map((m) => ({ rol: m.rol, texto: m.texto })),
        ...(adjuntos.length ? { adjuntos } : {}),
      });
      if (r.propuesta?.videos?.length) {
        setPropuesta({ campania: r.propuesta.campania, rodaje: r.propuesta.rodaje, videos: r.propuesta.videos });
        if (r.propuesta.cupos) setCupos(r.propuesta.cupos);
      }
      setMensajes((prev) => [...prev, { rol: "ia", texto: r.respuesta, recordado: r.recordado, conPropuesta: r.propuesta?.videos?.length ?? 0 }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no respondió");
      setMensajes((prev) => prev.slice(0, -1));
      setTexto(t);
      if (adjuntos.length) adj.sumar(elegidos);
    } finally {
      setEnviando(false);
    }
  };

  const empezarDeNuevo = () => {
    setMensajes([]);
    setPropuesta(null);
    setTexto("");
    void borrador.descartar();
  };

  const cambiarVideo = (id: string, cambios: Partial<VideoCampania>) =>
    setPropuesta((p) => (p ? { ...p, videos: p.videos.map((v) => (v.id === id ? { ...v, ...cambios, sin_lugar: false } : v)) } : p));
  const quitarVideo = (id: string) => setPropuesta((p) => (p ? { ...p, videos: p.videos.filter((v) => v.id !== id) } : p));

  const cargar = async () => {
    if (!propuesta?.videos.length) return;
    setCargando(true);
    try {
      const r = await callApi<{ cargados: { mes: string; ideas: number }[]; saltados: string[] }>("/api/ia/plan-campania", {
        proyecto_id: proyectoId,
        campania: propuesta.campania,
        rodaje: propuesta.rodaje,
        videos: propuesta.videos,
      });
      const detalle = r.cargados.map((c) => `${mesLabel(c.mes).split(" ")[0].toLowerCase()} (${c.ideas})`).join(", ");
      toast.success(`Listo: quedó cargado como borrador en ${detalle}. Revisalo y mandalo mes por mes.`);
      if (r.saltados.length) toast.message(`No se tocó ${r.saltados.map((m) => mesLabel(m).toLowerCase()).join(", ")}: ya se había mandado al cliente.`);
      setMensajes((prev) => [...prev, { rol: "ia", texto: `Cargué la campaña "${propuesta.campania}" en ${detalle}. Ya está en cada mes como borrador para que lo revises.` }]);
      setPropuesta(null);
      onCargado(r.cargados[0].mes);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setCargando(false);
    }
  };

  const mesesConLugar = (cupos ?? []).filter((c) => !c.bloqueado);
  const porMes = useMemo(() => {
    const m = new Map<string, VideoCampania[]>();
    for (const v of propuesta?.videos ?? []) m.set(v.mes, [...(m.get(v.mes) ?? []), v]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [propuesta]);

  return (
    <div className="space-y-4">
      {/* Lugares libres por mes: lo que la IA tiene para repartir. */}
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {cupos === null
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 w-28 shrink-0 animate-pulse rounded-2xl bg-muted" />)
          : cupos.slice(0, 6).map((c) => {
              const usados = (propuesta?.videos ?? []).filter((v) => v.mes === c.mes).length;
              return (
                <div
                  key={c.mes}
                  className={cn("w-28 shrink-0 rounded-2xl border px-3 py-2", c.bloqueado ? "opacity-50" : usados ? "border-primary/40 bg-primary/[0.06]" : "bg-card")}
                  title={c.bloqueado ? "El plan de este mes ya se mandó al cliente" : `${c.libres} lugares libres de ${c.cupo}`}
                >
                  <p className="text-[11px] font-semibold capitalize">{mesLabel(c.mes).split(" ")[0].toLowerCase()}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.bloqueado ? "ya enviado" : usados ? <b className="text-primary">{usados} de {c.libres}</b> : `${c.libres} libre${c.libres === 1 ? "" : "s"}`}
                  </p>
                  {!c.bloqueado && c.libres > 0 && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500 transition-all" style={{ width: `${Math.min(100, (usados / c.libres) * 100)}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
      </div>

      {/* La charla. */}
      <div className="overflow-hidden rounded-3xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b bg-gradient-to-r from-primary/[0.08] to-fuchsia-500/[0.06] px-4 py-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <p className="flex-1 text-sm font-semibold">Planificá la campaña con la IA</p>
          {mensajes.length > 0 && (
            <EstadoBorrador estado={borrador.estado} guardadoAt={borrador.guardadoAt} porNombre={borrador.porNombre} onGuardar={() => void borrador.guardar()} />
          )}
          {mensajes.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 rounded-full text-xs text-muted-foreground" onClick={empezarDeNuevo} disabled={enviando || cargando}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Empezar de nuevo
            </Button>
          )}
        </div>

        <div className="max-h-[40vh] min-h-[12rem] space-y-3 overflow-y-auto p-4">
          {mensajes.length === 0 && (
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Clapperboard className="h-4 w-4" />
                </span>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Contame la campaña de <b className="text-foreground">{nombre}</b>: qué se lanza, qué querés mostrar y cuándo es el rodaje (también me podés mandar fotos, capturas o PDF). Te voy a preguntar lo que me
                  falte y, cuando tenga todo, te propongo los videos repartidos en los meses según su plan.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-12">
                {SUGERENCIAS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void enviar(s)}
                    className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mensajes.map((m, i) =>
            m.rol === "yo" ? (
              <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-primary to-violet-600 px-3.5 py-2 text-sm text-white shadow-sm animate-in fade-in slide-in-from-bottom-1">
                {m.texto}
                <AdjuntosEnviados nombres={m.archivos} claro />
              </div>
            ) : (
              <div key={i} className="flex max-w-[92%] items-start gap-2 animate-in fade-in slide-in-from-bottom-1">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-white">
                  <Sparkles className="h-3 w-3" />
                </span>
                <div className="space-y-1.5">
                  <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md bg-muted px-3.5 py-2 text-sm">{m.texto}</div>
                  {!!m.conPropuesta && (
                    <p className="flex items-center gap-1 text-[11px] font-medium text-primary">
                      <Wand2 className="h-3 w-3" /> Propuesta de {m.conPropuesta} videos: está abajo para revisar
                    </p>
                  )}
                  {m.recordado && (
                    <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <Brain className="h-3 w-3" /> Anotado para {nombre}: {m.recordado}
                    </p>
                  )}
                </div>
              </div>
            )
          )}
          {enviando && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
              </span>
              Pensando…
            </div>
          )}
          <div ref={fin} />
        </div>

        <div className="space-y-2 border-t p-3" {...adj.alSoltar}>
          <ListaAdjuntos adj={adj} />
          <div className="flex items-end gap-2">
          <BotonAdjuntar adj={adj} className="h-11 w-11" disabled={enviando} />
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            onPaste={adj.alPegar}
            rows={1}
            placeholder={
              propuesta ? "Pedile cambios: “pasá el de la promo a diciembre”, “uno más de detrás de escena”…" : "Ej.: el 12/11 filmamos un día entero en la fábrica, lanzan el horno pizzero nuevo…"
            }
            className="min-h-11 resize-none rounded-2xl text-sm"
            maxLength={1500}
          />
          <Button
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-primary to-fuchsia-500 shadow-md shadow-primary/25"
            onClick={() => void enviar()}
            disabled={(!texto.trim() && !adj.archivos.length) || enviando}
            aria-label="Mandar"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
          </div>
        </div>
      </div>

      {/* Propuesta: los videos por mes, para revisar antes de cargarlos. */}
      {propuesta && (
        <div className="space-y-3 rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/[0.06] via-card to-card p-4 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold">
                <Megaphone className="h-4 w-4 text-primary" /> {propuesta.campania}
              </p>
              <p className="text-xs text-muted-foreground">
                {propuesta.videos.length} videos · se filman juntos{propuesta.rodaje ? ` · rodaje: ${propuesta.rodaje}` : " en un día de rodaje"}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {porMes.map(([mes, vids]) => (
              <div key={mes} className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" /> {mesLabel(mes)} · {vids.length} video{vids.length === 1 ? "" : "s"}
                </p>
                {vids.map((v) => (
                  <div key={v.id} className={cn("group rounded-2xl border bg-card p-3", v.sin_lugar && "border-amber-500/50")}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <input
                          value={v.titulo}
                          onChange={(e) => cambiarVideo(v.id, { titulo: e.target.value })}
                          className="w-full bg-transparent text-sm font-semibold outline-none focus:underline"
                          maxLength={120}
                          aria-label="Título del video"
                        />
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{v.idea}</p>
                        {v.sin_lugar && <p className="mt-1 text-[11px] font-medium text-amber-600">No entra en el cupo de los meses: pasalo a otro mes o sacalo.</p>}
                      </div>
                      <select
                        value={v.mes}
                        onChange={(e) => cambiarVideo(v.id, { mes: e.target.value })}
                        className="h-8 shrink-0 rounded-full border bg-background px-2 text-xs capitalize"
                        aria-label="Mes"
                      >
                        {(mesesConLugar.length ? mesesConLugar.map((c) => c.mes) : [v.mes]).map((x) => (
                          <option key={x} value={x}>
                            {mesLabel(x).split(" ")[0].toLowerCase()}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => quitarVideo(v.id)}
                        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Sacar este video"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">Quedan como borrador en cada mes: los revisás y los mandás a {nombre.split(" ")[0]} como siempre.</p>
            <Button
              onClick={() => void cargar()}
              disabled={cargando || !propuesta.videos.length}
              className="h-11 shrink-0 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-5 font-semibold shadow-lg shadow-primary/25"
            >
              {cargando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Cargar en {porMes.length} mes{porMes.length === 1 ? "" : "es"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
