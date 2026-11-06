import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion, type PanInfo } from "framer-motion";
import {
  ArrowRight,
  AudioWaveform,
  BookOpen,
  Captions,
  Check,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Clapperboard,
  FolderUp,
  Frame,
  Images,
  Lock,
  Megaphone,
  Mic,
  Palette,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  Vibrate,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { callApi } from "@/lib/redes/api";
import { completarLeccion } from "@/lib/redes/academia";
import {
  abiertos,
  avanceRecorrido,
  cuestionarioAprobado,
  examenAprobado,
  guardarCuestionario,
  ID_EXAMEN,
  leccionHecha,
  minimoParaAprobar,
  moduloAprobado,
  proximoPaso,
  type LeccionRecorrido,
  type ModuloRecorrido,
  type PreguntaRecorrido,
  type ProgresoRecorrido,
  type Recorrido,
} from "@/lib/redes/academiaRecorrido";
import { cn } from "@/lib/utils";

// Recorrido de la Academia (ej. "Productora Prodi · Nivel 1"), del lado de quien lo hace. Es todo teórico y se corrige solo.
// Hablamos su idioma, el de los Reels: cada semana es una fila de tarjetas verticales y cada lección se ve a pantalla
// completa, de a una tarjeta, con la barrita de historias arriba: video, explicación, «¿bien o mal?» y ejercicios (elegir,
// completar, ordenar y unir). Cada semana cierra con un repaso, y el recorrido con el examen final. Las semanas se abren de
// a una; el admin lo ve todo abierto (`libre`).

/** El color de cada semana: tarjetas y pantallas completas (con texto blanco). */
const TONOS = ["bg-violet-700", "bg-fuchsia-700", "bg-sky-700", "bg-amber-700"];
const tonoDe = (r: Recorrido, m: ModuloRecorrido | null) => (m ? TONOS[Math.max(0, r.modulos.findIndex((x) => x.id === m.id)) % TONOS.length] : "bg-zinc-800");

const ICONOS: Record<string, LucideIcon> = {
  "s1-que-hace-prodi": Megaphone,
  "s1-preparar-celular": Smartphone,
  "s1-configuracion": SlidersHorizontal,
  "s1-estabilidad": Vibrate,
  "s2-luz": Sun,
  "s2-encuadre": Frame,
  "s2-recurso": Images,
  "s2-audio": Mic,
  "s3-antes": ClipboardList,
  "s3-durante": Video,
  "s3-despues": FolderUp,
  "s3-reglas": ShieldCheck,
  "s4-proyecto": Scissors,
  "s4-ritmo": AudioWaveform,
  "s4-subtitulos": Captions,
  "s4-color-exportar": Palette,
};

const vibrar = (ms: number | number[]) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no todos los celulares vibran */
  }
};

/** Mezcla sin dejar el orden original (si se puede): si no, el ejercicio ya viene resuelto. */
function mezclar<T>(lista: T[]): T[] {
  const una = () => lista.map((x) => ({ x, o: Math.random() })).sort((a, b) => a.o - b.o).map((y) => y.x);
  let m = una();
  for (let i = 0; i < 6 && lista.length > 1 && m.every((x, k) => x === lista[k]); i++) m = una();
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Pantalla completa (en la compu, un celular al medio)

function Pantalla({
  tono,
  titulo,
  total = 0,
  actual = 0,
  onCerrar,
  onAtras,
  pie,
  children,
}: {
  tono: string;
  titulo: string;
  total?: number;
  actual?: number;
  onCerrar: () => void;
  onAtras?: (() => void) | null;
  pie?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80" role="dialog" aria-modal="true" aria-label={titulo}>
      <div
        className={cn("relative flex h-full w-full flex-col overflow-hidden text-white transition-colors duration-300 sm:h-[min(92dvh,860px)] sm:max-w-[440px] sm:rounded-[2rem]", tono)}
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
      >
        {total > 1 && (
          <div className="flex shrink-0 gap-1 px-4 pb-2.5" aria-label={`Paso ${actual + 1} de ${total}`}>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                <span className={cn("block h-full rounded-full bg-white transition-all duration-200", i <= actual ? "w-full" : "w-0")} />
              </span>
            ))}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
          {onAtras ? (
            <button type="button" onClick={onAtras} aria-label="Volver" className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/15 active:bg-white/25">
              <ChevronLeft className="h-6 w-6" />
            </button>
          ) : (
            <span className="w-3" />
          )}
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">{titulo}</p>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/15 active:bg-white/25">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">{children}</div>
        {pie && <div className="shrink-0 px-4 pt-3">{pie}</div>}
      </div>
    </div>,
    document.body
  );
}

function BotonGrande({ children, onClick, disabled, secundario }: { children: ReactNode; onClick?: () => void; disabled?: boolean; secundario?: boolean }) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-14 w-full items-center justify-center gap-2 rounded-full text-base font-bold transition-colors",
        secundario ? "bg-white/15 text-white hover:bg-white/25" : "bg-white text-zinc-900 hover:bg-white/90",
        disabled && "cursor-not-allowed bg-white/20 text-white/60 hover:bg-white/20"
      )}
    >
      {children}
    </motion.button>
  );
}

/** Papelitos cuando sale algo bien. */
function Festejo() {
  const quieto = useReducedMotion();
  const papeles = useMemo(
    () => Array.from({ length: 34 }, (_, i) => ({ i, x: Math.random() * 100, d: 40 + Math.random() * 60, giro: Math.random() * 540 - 270, t: 1.3 + Math.random() * 1.1, r: Math.random() * 0.25, c: ["#ffffff", "#fde047", "#34d399", "#f0abfc", "#7dd3fc"][i % 5] })),
    []
  );
  if (quieto) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {papeles.map((p) => (
        <motion.span
          key={p.i}
          className="absolute top-0 block h-3 w-1.5 rounded-[1px]"
          style={{ left: `${p.x}%`, background: p.c }}
          initial={{ y: -20, rotate: 0, opacity: 1 }}
          animate={{ y: `${p.d * 8}px`, rotate: p.giro, opacity: 0 }}
          transition={{ duration: p.t, delay: p.r, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}

function VideoPropio({ url }: { url: string }) {
  const yt = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  const drive = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url);
  const src = yt ? `https://www.youtube.com/embed/${yt[1]}` : drive ? `https://drive.google.com/file/d/${drive[1]}/preview` : null;
  return (
    <div className="mx-auto aspect-[9/16] h-full max-h-full max-w-full overflow-hidden rounded-3xl bg-black">
      {src ? <iframe src={src} title="Video de la lección" allow="autoplay; encrypted-media" allowFullScreen className="h-full w-full" /> : <video src={url} controls autoPlay playsInline preload="metadata" className="h-full w-full object-contain" />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Ejercicios: elegir o completar, ordenar y unir. Avisan una sola vez si salió bien.

const sacudir = { x: [0, -8, 8, -5, 5, 0] };

function Opciones({ q, onResuelto }: { q: PreguntaRecorrido; onResuelto: (ok: boolean) => void }) {
  const [elegida, setElegida] = useState<number | null>(null);
  const [antes, despues] = q.texto.split("___");
  const completar = despues !== undefined;
  const elegir = (j: number) => {
    if (elegida !== null) return;
    setElegida(j);
    onResuelto(j === q.correcta);
  };
  return (
    <>
      <p className="text-[1.65rem] font-bold leading-[1.2] tracking-tight">
        {completar ? (
          <>
            {antes}
            <span className={cn("inline-block min-w-16 border-b-[3px] px-1 text-center", elegida === null ? "border-white/70" : elegida === q.correcta ? "border-emerald-300 text-emerald-200" : "border-red-300 text-red-200")}>
              {elegida === null ? " " : q.opciones[elegida]}
            </span>
            {despues}
          </>
        ) : (
          q.texto
        )}
      </p>
      <div className="space-y-2">
        {q.opciones.map((o, j) => {
          const ok = elegida !== null && j === q.correcta;
          const mal = elegida === j && j !== q.correcta;
          return (
            <motion.button
              key={j}
              type="button"
              disabled={elegida !== null}
              whileTap={elegida === null ? { scale: 0.98 } : undefined}
              animate={mal ? sacudir : { x: 0 }}
              transition={{ duration: 0.35 }}
              onClick={() => elegir(j)}
              className={cn(
                "flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-base font-medium transition-colors",
                elegida === null && "bg-white text-zinc-900 hover:bg-white/90",
                ok && "bg-emerald-400 text-zinc-900",
                mal && "bg-red-400 text-zinc-900",
                elegida !== null && !ok && !mal && "bg-white/15 text-white/70"
              )}
            >
              <span className="flex-1">{o}</span>
              {ok && <Check className="h-5 w-5 shrink-0" strokeWidth={3} />}
              {mal && <X className="h-5 w-5 shrink-0" strokeWidth={3} />}
            </motion.button>
          );
        })}
      </div>
    </>
  );
}

function Ordenar({ q, onResuelto }: { q: PreguntaRecorrido; onResuelto: (ok: boolean) => void }) {
  const pasos = q.ordenar ?? [];
  const [banco] = useState(() => mezclar(pasos));
  const [puestos, setPuestos] = useState<string[]>([]);
  const [corregido, setCorregido] = useState(false);
  const bien = puestos.every((p, i) => p === pasos[i]);
  const comprobar = () => {
    setCorregido(true);
    onResuelto(bien);
  };
  return (
    <>
      <p className="text-2xl font-bold leading-tight tracking-tight">{q.texto}</p>
      <ol className="space-y-2">
        {pasos.map((_, i) => {
          const p = puestos[i];
          const ok = corregido && p === pasos[i];
          return (
            <li key={i}>
              <button
                type="button"
                disabled={!p || corregido}
                onClick={() => setPuestos((l) => l.filter((x) => x !== p))}
                className={cn(
                  "flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-[15px] font-medium transition-colors",
                  !p ? "bg-black/15" : !corregido ? "bg-white text-zinc-900" : ok ? "bg-emerald-400 text-zinc-900" : "bg-red-400 text-zinc-900"
                )}
              >
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold", p ? "bg-black/10" : "bg-white/15")}>{i + 1}</span>
                {p}
              </button>
            </li>
          );
        })}
      </ol>
      {!corregido && (
        <div className="flex flex-wrap gap-2">
          {banco
            .filter((b) => !puestos.includes(b))
            .map((b) => (
              <motion.button
                key={b}
                type="button"
                layout
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  vibrar(8);
                  setPuestos((l) => [...l, b]);
                }}
                className="min-h-11 rounded-xl bg-white/20 px-3 py-2 text-left text-[15px] font-medium transition-colors hover:bg-white/30"
              >
                {b}
              </motion.button>
            ))}
        </div>
      )}
      {!corregido && puestos.length === pasos.length && <BotonGrande onClick={comprobar}>Comprobar</BotonGrande>}
      {corregido && !bien && (
        <div className="space-y-1 rounded-2xl bg-black/20 p-4 text-[15px] leading-snug">
          <p className="pb-1 font-bold">El orden es:</p>
          {pasos.map((p, i) => (
            <p key={p}>
              {i + 1}. {p}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

function Unir({ q, onResuelto }: { q: PreguntaRecorrido; onResuelto: (ok: boolean) => void }) {
  const pares = useMemo(() => q.unir ?? [], [q]);
  const [izquierda] = useState(() => mezclar(pares.map((p) => p[0])));
  const [derecha] = useState(() => mezclar(pares.map((p) => p[1])));
  const [sel, setSel] = useState<string | null>(null);
  const [hechos, setHechos] = useState<string[]>([]);
  const [mal, setMal] = useState<string | null>(null);
  const errores = useRef(0);
  const tocarDerecha = (d: string) => {
    if (!sel) {
      toast("Primero tocá una palabra de la izquierda");
      return;
    }
    const par = pares.find((p) => p[0] === sel);
    if (par?.[1] === d) {
      vibrar(12);
      const nuevos = [...hechos, sel];
      setHechos(nuevos);
      setSel(null);
      if (nuevos.length === pares.length) onResuelto(errores.current === 0);
    } else {
      errores.current += 1;
      vibrar([40, 40, 40]);
      setMal(d);
      window.setTimeout(() => setMal(null), 500);
    }
  };
  const derechaHecha = (d: string) => pares.some((p) => p[1] === d && hechos.includes(p[0]));
  return (
    <>
      <p className="text-2xl font-bold leading-tight tracking-tight">{q.texto}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          {izquierda.map((t) => (
            <button
              key={t}
              type="button"
              disabled={hechos.includes(t)}
              onClick={() => setSel(t)}
              className={cn(
                "flex min-h-[72px] w-full items-center rounded-2xl p-3 text-left text-sm font-semibold transition-colors",
                hechos.includes(t) ? "bg-emerald-400/30 text-white/60" : sel === t ? "bg-zinc-900 text-white ring-2 ring-white" : "bg-white text-zinc-900"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {derecha.map((t) => (
            <motion.button
              key={t}
              type="button"
              disabled={derechaHecha(t)}
              animate={mal === t ? sacudir : { x: 0 }}
              transition={{ duration: 0.35 }}
              onClick={() => tocarDerecha(t)}
              className={cn(
                "flex min-h-[72px] w-full items-center rounded-2xl p-3 text-left text-sm font-medium transition-colors",
                derechaHecha(t) ? "bg-emerald-400/30 text-white/60" : mal === t ? "bg-red-400 text-zinc-900" : "bg-white/20"
              )}
            >
              {t}
            </motion.button>
          ))}
        </div>
      </div>
    </>
  );
}

function Ejercicio({ q, reintenta, onResuelto }: { q: PreguntaRecorrido; reintenta?: boolean; onResuelto: (ok: boolean) => void }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const resuelto = (bien: boolean) => {
    setOk(bien);
    vibrar(bien ? 15 : [40, 40, 40]);
    onResuelto(bien);
  };
  return (
    <div className="space-y-4 px-5 pb-2 pt-3">
      {q.ordenar?.length ? <Ordenar q={q} onResuelto={resuelto} /> : q.unir?.length ? <Unir q={q} onResuelto={resuelto} /> : <Opciones q={q} onResuelto={resuelto} />}
      {ok !== null && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("rounded-2xl p-4 text-[15px] leading-snug", ok ? "bg-emerald-400 text-zinc-900" : "bg-black/25")}>
          <p className="font-bold">{ok ? "¡Muy bien!" : reintenta ? "Casi. Probá de nuevo." : "Esta no salió"}</p>
          {q.porque && <p className="mt-0.5">{q.porque}</p>}
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// ¿Bien o mal?: las dos listas de la lección, mezcladas. Se desliza la tarjeta o se tocan los botones.

function BienOMal({ leccion, onTermino }: { leccion: LeccionRecorrido; onTermino: () => void }) {
  const cartas = useMemo(() => mezclar([...leccion.bien.map((t) => ({ t, ok: true })), ...leccion.mal.map((t) => ({ t, ok: false }))]), [leccion]);
  const [i, setI] = useState(0);
  const [aciertos, setAciertos] = useState(0);
  const [respuesta, setRespuesta] = useState<boolean | null>(null);
  const carta = cartas[i];
  const fin = i >= cartas.length;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  useEffect(() => {
    if (fin) onTermino();
  }, [fin]); // eslint-disable-line react-hooks/exhaustive-deps

  const responder = (dijoBien: boolean) => {
    if (respuesta !== null || !carta) return;
    const acerto = dijoBien === carta.ok;
    setRespuesta(acerto);
    if (acerto) setAciertos((a) => a + 1);
    vibrar(acerto ? 15 : [40, 40, 40]);
    timer.current = setTimeout(
      () => {
        setRespuesta(null);
        setI((n) => n + 1);
      },
      acerto ? 750 : 1700
    );
  };
  const soltar = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 90) responder(true);
    else if (info.offset.x < -90) responder(false);
  };

  if (fin)
    return (
      <div className="space-y-4 px-5 pb-2 pt-2">
        <div>
          <p className="text-4xl font-bold tabular-nums">
            {aciertos} de {cartas.length}
          </p>
          <p className="mt-1 text-white/85">{aciertos === cartas.length ? "Todas bien. Lo tenés clarísimo." : "Repasá cómo va cada una:"}</p>
        </div>
        <div className="space-y-2 rounded-3xl bg-white/10 p-4">
          <p className="flex items-center gap-2 font-bold">
            <ThumbsUp className="h-4 w-4" /> Bien
          </p>
          {leccion.bien.map((b) => (
            <p key={b} className="text-[15px] leading-snug">
              {b}
            </p>
          ))}
        </div>
        <div className="space-y-2 rounded-3xl bg-black/20 p-4">
          <p className="flex items-center gap-2 font-bold">
            <ThumbsDown className="h-4 w-4" /> Mal
          </p>
          {leccion.mal.map((m) => (
            <p key={m} className="text-[15px] leading-snug">
              {m}
            </p>
          ))}
        </div>
      </div>
    );

  return (
    <div className="flex h-full min-h-[420px] flex-col px-5 pb-1 pt-1">
      <div className="flex items-baseline justify-between">
        <p className="text-2xl font-bold">¿Bien o mal?</p>
        <p className="text-sm tabular-nums text-white/80">
          {i + 1} de {cartas.length}
        </p>
      </div>
      <p className="mt-0.5 text-sm text-white/80">Deslizá a la derecha si está bien, a la izquierda si está mal.</p>
      <div className="relative flex min-h-0 flex-1 items-center py-4">
        <motion.div
          key={i}
          drag={respuesta === null ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.8}
          onDragEnd={soltar}
          whileDrag={{ rotate: 3 }}
          initial={{ scale: 0.92, opacity: 0, y: 14 }}
          animate={respuesta === false ? { scale: 1, opacity: 1, y: 0, ...sacudir } : { scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className={cn(
            "relative flex min-h-[220px] w-full cursor-grab touch-pan-y select-none flex-col justify-center rounded-3xl p-6 text-zinc-900 transition-colors active:cursor-grabbing",
            respuesta === null ? "bg-white" : respuesta ? "bg-emerald-300" : "bg-red-300"
          )}
        >
          <p className="text-2xl font-bold leading-tight">{carta.t}</p>
          {respuesta !== null && (
            <p className="mt-4 flex items-center gap-2 font-bold">
              {carta.ok ? <ThumbsUp className="h-5 w-5" /> : <ThumbsDown className="h-5 w-5" />}
              {respuesta ? "¡Exacto!" : carta.ok ? "Esto está bien" : "Esto está mal"}
            </p>
          )}
        </motion.div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => responder(false)} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-black/25 text-lg font-bold transition-colors hover:bg-black/35">
          <ThumbsDown className="h-5 w-5" /> Mal
        </motion.button>
        <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => responder(true)} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-white/20 text-lg font-bold transition-colors hover:bg-white/30">
          <ThumbsUp className="h-5 w-5" /> Bien
        </motion.button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Lección: tarjetas de a una

type TarjetaLeccion = { k: "portada" } | { k: "video" } | { k: "texto"; t: string } | { k: "juego" } | { k: "ejercicio"; q: PreguntaRecorrido } | { k: "fin" };

function VerLeccion({
  recorrido,
  modulo,
  leccion,
  uid,
  onSiguiente,
  textoSiguiente,
  onCerrar,
}: {
  recorrido: Recorrido;
  modulo: ModuloRecorrido;
  leccion: LeccionRecorrido;
  uid: string;
  onSiguiente: () => void;
  textoSiguiente: string;
  onCerrar: () => void;
}) {
  const tarjetas = useMemo<TarjetaLeccion[]>(() => {
    const lista: TarjetaLeccion[] = [{ k: "portada" }];
    if (leccion.video) lista.push({ k: "video" });
    leccion.explicacion
      .split("\n")
      .filter((p) => p.trim())
      .forEach((t) => lista.push({ k: "texto", t }));
    if (leccion.bien.length + leccion.mal.length > 0) lista.push({ k: "juego" });
    (leccion.ejercicios ?? []).forEach((q) => lista.push({ k: "ejercicio", q }));
    lista.push({ k: "fin" });
    return lista;
  }, [leccion]);
  const [n, setN] = useState(0);
  const [dir, setDir] = useState(1);
  const [jugo, setJugo] = useState(false);
  // Ejercicio de la tarjeta actual: sin resolver (null), bien o mal. Si sale mal se vuelve a intentar.
  const [resultado, setResultado] = useState<boolean | null>(null);
  const [intento, setIntento] = useState(0);
  const t = tarjetas[Math.min(n, tarjetas.length - 1)];
  const idx = modulo.lecciones.findIndex((l) => l.id === leccion.id);
  const Icono = ICONOS[leccion.id] ?? Clapperboard;

  const ir = useCallback((d: number) => {
    setDir(d);
    setResultado(null);
    setN((x) => Math.max(0, x + d));
  }, []);

  // Llegó al final: la lección queda hecha.
  const llego = t.k === "fin";
  useEffect(() => {
    if (llego) void completarLeccion(uid, leccion.id).catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"));
  }, [llego, uid, leccion.id]);

  const puedeSeguir = t.k === "juego" ? jugo : t.k === "ejercicio" ? resultado === true : true;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && puedeSeguir && n < tarjetas.length - 1) ir(1);
      if (e.key === "ArrowLeft" && n > 0) ir(-1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ir, n, puedeSeguir, tarjetas.length]);

  // Las tarjetas de leer se pasan deslizando, como historias.
  const deslizable = t.k === "portada" || t.k === "texto";
  const soltar = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -70 && n < tarjetas.length - 1) ir(1);
    if (info.offset.x > 70 && n > 0) ir(-1);
  };

  let pie: ReactNode;
  if (t.k === "fin") pie = <BotonGrande onClick={onSiguiente}>{textoSiguiente} <ArrowRight className="h-5 w-5" /></BotonGrande>;
  else if (t.k === "juego" && !jugo) pie = <button type="button" onClick={() => ir(1)} className="flex h-10 w-full items-center justify-center text-sm font-medium text-white/75 hover:text-white">Saltar</button>;
  else if (t.k === "ejercicio") {
    if (resultado === null) pie = null;
    else if (resultado) pie = <BotonGrande onClick={() => ir(1)}>Seguir <ArrowRight className="h-5 w-5" /></BotonGrande>;
    else
      pie = (
        <BotonGrande
          onClick={() => {
            setResultado(null);
            setIntento((x) => x + 1);
          }}
        >
          Probar de nuevo
        </BotonGrande>
      );
  } else pie = <BotonGrande onClick={() => ir(1)}>{t.k === "portada" ? "Empezar" : "Seguir"} <ArrowRight className="h-5 w-5" /></BotonGrande>;

  return (
    <Pantalla tono={tonoDe(recorrido, modulo)} titulo={leccion.titulo} total={tarjetas.length} actual={n} onCerrar={onCerrar} onAtras={n > 0 ? () => ir(-1) : null} pie={pie}>
      <motion.div
        key={n}
        initial={{ opacity: 0, x: 36 * dir }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18 }}
        drag={deslizable ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.25}
        onDragEnd={soltar}
        className={cn("min-h-full", deslizable && "touch-pan-y", t.k === "video" && "h-full")}
      >
        {t.k === "portada" && (
          <div className="flex min-h-full flex-col justify-end px-6 pb-6 pt-4">
            <motion.span initial={{ scale: 0.7, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 16 }} className="mb-auto mt-6 block">
              <Icono className="h-28 w-28" strokeWidth={1.25} />
            </motion.span>
            <p className="mt-8 font-medium text-white/85">
              Lección {idx + 1} de {modulo.lecciones.length}
            </p>
            <h2 className="mt-1 text-[2.5rem] font-bold leading-[1.05] tracking-tight">{leccion.titulo}</h2>
            <p className="mt-4 text-lg leading-snug">{leccion.objetivo}</p>
          </div>
        )}
        {t.k === "video" && leccion.video && (
          <div className="h-full px-4 pb-1">
            <VideoPropio url={leccion.video} />
          </div>
        )}
        {t.k === "texto" && (
          <div className="flex min-h-full items-center px-6 py-6">
            <p className="text-[1.65rem] font-semibold leading-[1.25] tracking-tight">{t.t}</p>
          </div>
        )}
        {t.k === "juego" && <BienOMal leccion={leccion} onTermino={() => setJugo(true)} />}
        {t.k === "ejercicio" && <Ejercicio key={intento} q={t.q} reintenta onResuelto={setResultado} />}
        {t.k === "fin" && (
          <div className="flex min-h-full flex-col items-center justify-center px-6 py-6 text-center">
            <Festejo />
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }} className="flex h-28 w-28 items-center justify-center rounded-full bg-white text-zinc-900">
              <Check className="h-14 w-14" strokeWidth={3} />
            </motion.span>
            <p className="mt-6 text-[2.25rem] font-bold leading-tight tracking-tight">¡Lección completa!</p>
            <p className="mt-2 text-lg text-white/90">{leccion.titulo}</p>
          </div>
        )}
      </motion.div>
    </Pantalla>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Prueba: el repaso de la semana y el examen final. Cuenta lo que salió bien a la primera.

function Prueba({
  tono,
  titulo,
  preguntas,
  clave,
  uid,
  progreso,
  esExamen,
  onCerrar,
}: {
  tono: string;
  titulo: string;
  preguntas: PreguntaRecorrido[];
  clave: string;
  uid: string;
  progreso: ProgresoRecorrido | null;
  esExamen?: boolean;
  onCerrar: () => void;
}) {
  const [ronda, setRonda] = useState(0);
  const [i, setI] = useState(0);
  const [resultado, setResultado] = useState<boolean | null>(null);
  const [aciertos, setAciertos] = useState(0);
  const [fin, setFin] = useState(false);
  const minimo = minimoParaAprobar(preguntas.length);
  const mejor = progreso?.cuestionarios?.[clave];

  const seguir = () => {
    if (i + 1 < preguntas.length) {
      setI(i + 1);
      setResultado(null);
      return;
    }
    setFin(true);
    if (!mejor || aciertos > mejor.aciertos) {
      void guardarCuestionario(uid, clave, aciertos, preguntas.length)
        .then(() => {
          // El examen aprobado le avisa a Lucas, que es quien le cambia el rol.
          if (esExamen && aciertos >= minimo) return callApi("/api/usuarios/academia-aviso", {}).catch(() => undefined);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"));
    }
  };
  const reiniciar = () => {
    setRonda((r) => r + 1);
    setI(0);
    setResultado(null);
    setAciertos(0);
    setFin(false);
  };

  if (fin) {
    const aprobo = aciertos >= minimo;
    return (
      <Pantalla
        tono={tono}
        titulo={titulo}
        onCerrar={onCerrar}
        pie={
          <div className="space-y-2">
            {aprobo ? <BotonGrande onClick={onCerrar}>Volver al camino <ArrowRight className="h-5 w-5" /></BotonGrande> : <BotonGrande onClick={reiniciar}>Probar de nuevo</BotonGrande>}
            {aprobo && aciertos < preguntas.length && <BotonGrande secundario onClick={reiniciar}>Hacerlo otra vez</BotonGrande>}
          </div>
        }
      >
        <div className="flex min-h-full flex-col items-center justify-center px-6 py-6 text-center">
          {aprobo && <Festejo />}
          <motion.p initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="text-[5.5rem] font-bold leading-none tabular-nums tracking-tight">
            {aciertos}/{preguntas.length}
          </motion.p>
          <p className="mt-4 text-3xl font-bold leading-tight">{aprobo ? "¡Aprobaste!" : "Casi"}</p>
          <p className="mt-2 text-lg text-white/90">
            {aprobo ? (esExamen ? "Terminaste el recorrido. Ya le avisamos a Lucas." : "Ya está guardado.") : `Se aprueba con ${minimo} bien. Podés hacerlo las veces que quieras.`}
          </p>
        </div>
      </Pantalla>
    );
  }

  return (
    <Pantalla
      tono={tono}
      titulo={`${esExamen ? "Examen" : "Repaso"} · ${i + 1} de ${preguntas.length}`}
      total={preguntas.length}
      actual={i}
      onCerrar={onCerrar}
      pie={resultado === null ? null : <BotonGrande onClick={seguir}>{i + 1 < preguntas.length ? "Seguir" : "Ver cómo me fue"} <ArrowRight className="h-5 w-5" /></BotonGrande>}
    >
      <motion.div key={`${ronda}-${i}`} initial={{ opacity: 0, x: 36 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
        <Ejercicio
          q={preguntas[i]}
          onResuelto={(ok) => {
            setResultado(ok);
            if (ok) setAciertos((a) => a + 1);
          }}
        />
      </motion.div>
    </Pantalla>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Glosario: tarjetas que se dan vuelta

function CartaGlosario({ termino, definicion }: { termino: string; definicion: string }) {
  const [vuelta, setVuelta] = useState(false);
  return (
    <button type="button" onClick={() => setVuelta((v) => !v)} className="block h-40 w-full text-left [perspective:900px]" aria-label={`${termino}: ${definicion}`}>
      <motion.span className="relative block h-full w-full [transform-style:preserve-3d]" animate={{ rotateY: vuelta ? 180 : 0 }} transition={{ duration: 0.4 }}>
        <span className="absolute inset-0 flex items-center justify-center rounded-3xl bg-white/10 p-4 text-center text-2xl font-bold [backface-visibility:hidden]">{termino}</span>
        <span className="absolute inset-0 flex items-center overflow-y-auto rounded-3xl bg-white p-5 text-[15px] font-medium leading-snug text-zinc-900 [backface-visibility:hidden] [transform:rotateY(180deg)]">{definicion}</span>
      </motion.span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// El camino: las semanas como filas de Reels

function Tarjeta({
  tono,
  bloqueada,
  hecha,
  actual,
  icono: Icono,
  arriba,
  titulo,
  onClick,
}: {
  tono: string;
  bloqueada: boolean;
  hecha: boolean;
  actual: boolean;
  icono: LucideIcon;
  arriba: string;
  titulo: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      data-actual={actual || undefined}
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      whileHover={bloqueada ? undefined : { y: -3 }}
      className={cn(
        "relative flex aspect-[9/16] w-[136px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl p-3 text-left sm:w-[160px]",
        bloqueada ? "bg-muted text-muted-foreground" : cn(tono, "text-white"),
        actual && "ring-[3px] ring-foreground ring-offset-2 ring-offset-background"
      )}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="text-xs font-medium opacity-90">{arriba}</span>
        {bloqueada ? (
          <Lock className="h-4 w-4 shrink-0" />
        ) : hecha ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900">
            <Check className="h-4 w-4" strokeWidth={3} />
          </span>
        ) : null}
      </span>
      <span className="flex flex-1 items-center justify-center">
        <Icono className={cn("h-14 w-14", hecha && "opacity-60")} strokeWidth={1.25} />
      </span>
      <span className="text-[15px] font-bold leading-tight">{titulo}</span>
      {actual && <span className="mt-2 self-start rounded-full bg-white px-2.5 py-1 text-xs font-bold text-zinc-900">Seguí acá</span>}
    </motion.button>
  );
}

type Abierto = { tipo: "leccion"; modulo: string; leccion: string } | { tipo: "cuestionario"; modulo: string } | { tipo: "examen" } | { tipo: "glosario" };

/** Inicio del recorrido: qué sigue, la tira de avance, las semanas (se abren de a una), el examen y el glosario. */
export function VerRecorrido({ recorrido, progreso, uid, libre }: { recorrido: Recorrido; progreso: ProgresoRecorrido | null; uid: string; libre: boolean }) {
  const [abierto, setAbierto] = useState<Abierto | null>(null);
  const ab = abiertos(recorrido, progreso);
  const av = avanceRecorrido(recorrido, progreso);
  const paso = proximoPaso(recorrido, progreso);

  // El botón «atrás» del celular cierra la pantalla completa, no se va de la Academia.
  const hayPantalla = !!abierto;
  const empujado = useRef(false);
  useEffect(() => {
    if (!hayPantalla) return;
    if (!empujado.current) {
      window.history.pushState({ ...window.history.state, academiaPantalla: true }, "");
      empujado.current = true;
    }
    const alVolver = () => {
      empujado.current = false;
      setAbierto(null);
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, [hayPantalla]);
  const cerrar = useCallback(() => {
    if (empujado.current) window.history.back();
    else setAbierto(null);
  }, []);

  // Cada fila arranca mostrando la tarjeta que le toca.
  const filas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const actual = filas.current?.querySelector<HTMLElement>("[data-actual]");
    const fila = actual?.parentElement;
    if (actual && fila) fila.scrollLeft += actual.getBoundingClientRect().left - fila.getBoundingClientRect().left - 16;
  }, [paso?.tipo, paso?.leccion?.id, paso?.modulo?.id]);

  const siguienteDeLeccion = (m: ModuloRecorrido, l: LeccionRecorrido) => {
    const i = m.lecciones.findIndex((x) => x.id === l.id);
    const sig = m.lecciones[i + 1];
    return sig
      ? { texto: "Siguiente lección", ir: () => setAbierto({ tipo: "leccion", modulo: m.id, leccion: sig.id }) }
      : { texto: "Ir al repaso de la semana", ir: () => setAbierto({ tipo: "cuestionario", modulo: m.id }) };
  };
  const abrirPaso = () => {
    if (!paso) return;
    if (paso.tipo === "examen") setAbierto({ tipo: "examen" });
    else if (paso.tipo === "leccion" && paso.leccion && paso.modulo) setAbierto({ tipo: "leccion", modulo: paso.modulo.id, leccion: paso.leccion.id });
    else if (paso.modulo) setAbierto({ tipo: "cuestionario", modulo: paso.modulo.id });
  };
  const avisoBloqueada = () => {
    vibrar([30, 30, 30]);
    toast("Se abre cuando apruebes la semana anterior.");
  };

  const textoPaso = !paso
    ? { arriba: "Terminaste el recorrido", titulo: "¡Felicitaciones!", boton: null }
    : paso.tipo === "leccion"
      ? { arriba: "Seguí con", titulo: paso.leccion?.titulo ?? "", boton: "Seguir" }
      : paso.tipo === "cuestionario"
        ? { arriba: "Te falta el repaso", titulo: (paso.modulo?.titulo ?? "").split("·")[0].trim(), boton: "Empezar" }
        : { arriba: "Última etapa", titulo: recorrido.examen.titulo, boton: "Empezar" };
  const tonoPaso = !paso ? "bg-emerald-700" : tonoDe(recorrido, paso.modulo);
  const IconoPaso: LucideIcon = !paso || paso.tipo === "examen" ? Trophy : paso.tipo === "leccion" ? ICONOS[paso.leccion?.id ?? ""] ?? Clapperboard : ClipboardCheck;

  // La tira de avance: un cuadro por cada cosa del recorrido, como una tira de película.
  const cuadros = [
    ...recorrido.modulos.flatMap((m) => [
      ...m.lecciones.map((l) => ({ id: l.id, tono: tonoDe(recorrido, m), hecho: leccionHecha(l, progreso) })),
      { id: `${m.id}-repaso`, tono: tonoDe(recorrido, m), hecho: !!m.cuestionario.length && cuestionarioAprobado(m, progreso) },
    ]),
    { id: "examen", tono: "bg-foreground", hecho: av.examen },
  ];
  const hechos = cuadros.filter((c) => c.hecho).length;

  const moduloAbierto = abierto && "modulo" in abierto ? recorrido.modulos.find((m) => m.id === abierto.modulo) ?? null : null;
  const leccionAbierta = abierto?.tipo === "leccion" ? moduloAbierto?.lecciones.find((l) => l.id === abierto.leccion) ?? null : null;
  const sigLeccion = moduloAbierto && leccionAbierta ? siguienteDeLeccion(moduloAbierto, leccionAbierta) : null;
  const notaExamen = progreso?.cuestionarios?.[ID_EXAMEN];
  const examenAbierto = libre || ab.examen;

  return (
    <div className="space-y-7" ref={filas}>
      {/* Qué sigue: lo primero que se ve y a un toque */}
      <motion.button
        type="button"
        whileTap={paso ? { scale: 0.985 } : undefined}
        onClick={abrirPaso}
        disabled={!paso}
        className={cn("relative flex w-full items-center gap-4 overflow-hidden rounded-3xl p-5 text-left text-white sm:p-6", tonoPaso)}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white/85">{textoPaso.arriba}</span>
          <span className="mt-1 block text-[1.75rem] font-bold leading-[1.1] tracking-tight sm:text-4xl">{textoPaso.titulo}</span>
          {textoPaso.boton && (
            <span className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-full bg-white px-5 text-[15px] font-bold text-zinc-900">
              {textoPaso.boton} <ArrowRight className="h-4 w-4" />
            </span>
          )}
        </span>
        <IconoPaso className="h-20 w-20 shrink-0 sm:h-28 sm:w-28" strokeWidth={1.25} />
      </motion.button>

      {/* Tira de avance */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-semibold">{recorrido.titulo}</p>
          <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {hechos} de {cuadros.length}
          </p>
        </div>
        <div className="mt-2 flex gap-[3px]" role="img" aria-label={`${hechos} de ${cuadros.length} pasos hechos`}>
          {cuadros.map((c) => (
            <span key={c.id} className={cn("h-7 min-w-0 flex-1 rounded-[3px] transition-colors", c.hecho ? c.tono : "bg-muted")} />
          ))}
        </div>
      </div>

      {/* Las semanas */}
      {recorrido.modulos.map((m, i) => {
        const abiertaSemana = libre || ab.modulos[i];
        const tono = tonoDe(recorrido, m);
        const [semana, ...resto] = m.titulo.split("·");
        const nota = progreso?.cuestionarios?.[m.id];
        const aprobada = moduloAprobado(m, progreso);
        const esActual = (tipo: string, id?: string) => paso?.modulo?.id === m.id && paso.tipo === tipo && (!id || paso.leccion?.id === id);
        return (
          <section key={m.id} className={cn(!abiertaSemana && "opacity-70")}>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold leading-tight">{resto.length ? resto.join("·").trim() : semana.trim()}</h2>
                <p className="text-sm text-muted-foreground">
                  {resto.length ? `${semana.trim()} · ` : ""}
                  {aprobada ? "aprobada" : abiertaSemana ? m.subtitulo : "se abre cuando apruebes la anterior"}
                </p>
              </div>
              {aprobada && <Trophy className="h-6 w-6 shrink-0 text-amber-500" />}
            </div>
            <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] sm:mx-0 sm:px-1 [&::-webkit-scrollbar]:hidden">
              {m.lecciones.map((l, k) => (
                <Tarjeta
                  key={l.id}
                  tono={tono}
                  bloqueada={!abiertaSemana}
                  hecha={leccionHecha(l, progreso)}
                  actual={esActual("leccion", l.id)}
                  icono={ICONOS[l.id] ?? Clapperboard}
                  arriba={`Lección ${k + 1}`}
                  titulo={l.titulo}
                  onClick={() => (abiertaSemana ? setAbierto({ tipo: "leccion", modulo: m.id, leccion: l.id }) : avisoBloqueada())}
                />
              ))}
              {m.cuestionario.length > 0 && (
                <Tarjeta
                  tono={tono}
                  bloqueada={!abiertaSemana}
                  hecha={cuestionarioAprobado(m, progreso)}
                  actual={esActual("cuestionario")}
                  icono={ClipboardCheck}
                  arriba={nota ? `Tu mejor: ${nota.aciertos}/${nota.total}` : `${m.cuestionario.length} preguntas`}
                  titulo="Repaso de la semana"
                  onClick={() => (abiertaSemana ? setAbierto({ tipo: "cuestionario", modulo: m.id }) : avisoBloqueada())}
                />
              )}
            </div>
          </section>
        );
      })}

      <div className="grid gap-3 sm:grid-cols-2">
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => (examenAbierto ? setAbierto({ tipo: "examen" }) : toast("Se abre con las semanas aprobadas."))}
          className={cn("flex items-center gap-4 rounded-3xl p-5 text-left", examenAbierto ? "bg-zinc-800 text-white" : "bg-muted text-muted-foreground")}
        >
          <Trophy className="h-12 w-12 shrink-0" strokeWidth={1.25} />
          <span className="min-w-0">
            <span className="block text-lg font-bold leading-tight">{recorrido.examen.titulo}</span>
            <span className="mt-0.5 block text-sm opacity-85">
              {notaExamen ? `${examenAprobado(recorrido, progreso) ? "Aprobado" : "Tu mejor"}: ${notaExamen.aciertos}/${notaExamen.total}` : examenAbierto ? recorrido.examen.consigna : "Se abre con las semanas aprobadas."}
            </span>
          </span>
        </motion.button>
        <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={() => setAbierto({ tipo: "glosario" })} className="flex items-center gap-4 rounded-3xl bg-card p-5 text-left">
          <BookOpen className="h-12 w-12 shrink-0 text-primary" strokeWidth={1.25} />
          <span className="min-w-0">
            <span className="block text-lg font-bold leading-tight">Glosario</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{recorrido.glosario.length} palabras de Prodi. Tocá y se da vuelta.</span>
          </span>
        </motion.button>
      </div>

      {/* Pantallas completas */}
      {moduloAbierto && leccionAbierta && sigLeccion && <VerLeccion key={leccionAbierta.id} recorrido={recorrido} modulo={moduloAbierto} leccion={leccionAbierta} uid={uid} textoSiguiente={sigLeccion.texto} onSiguiente={sigLeccion.ir} onCerrar={cerrar} />}
      {moduloAbierto && abierto?.tipo === "cuestionario" && <Prueba key={moduloAbierto.id} tono={tonoDe(recorrido, moduloAbierto)} titulo="Repaso de la semana" preguntas={moduloAbierto.cuestionario} clave={moduloAbierto.id} uid={uid} progreso={progreso} onCerrar={cerrar} />}
      {abierto?.tipo === "examen" && <Prueba tono="bg-zinc-800" titulo={recorrido.examen.titulo} preguntas={recorrido.examen.preguntas} clave={ID_EXAMEN} uid={uid} progreso={progreso} esExamen onCerrar={cerrar} />}
      {abierto?.tipo === "glosario" && (
        <Pantalla tono="bg-zinc-900" titulo="Glosario" onCerrar={cerrar}>
          <div className="space-y-3 px-4 pb-2 pt-1">
            {recorrido.glosario.map((g) => (
              <CartaGlosario key={g.termino} termino={g.termino} definicion={g.definicion} />
            ))}
          </div>
        </Pantalla>
      )}
    </div>
  );
}
