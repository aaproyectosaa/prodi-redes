import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Clapperboard,
  GraduationCap,
  ListChecks,
  Lock,
  Megaphone,
  Palette,
  Play,
  ShieldCheck,
  Sparkles,
  Trophy,
  Video as VideoIcon,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/redes/PageShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useAppData } from "@/contexts/app-data-context";
import { db } from "@/integrations/firebase/client";
import { collection, doc, onSnapshot, updateDoc } from "@/lib/db";
import { avanceDe, completarLeccion, CURSOS, cursosDe, useProgresoAcademia, type Curso, type Leccion, type ProgresoAcademia, type RolCurso } from "@/lib/redes/academia";
import { cn } from "@/lib/utils";

// Academia Prodi: cursos por rol con lecciones cortas (video animado, lo importante, paso a paso y una pregunta).
// Inicio del curso con "Seguí donde quedaste" y las lecciones como tarjetas; la lección con el video al lado de lo
// importante; y, para el admin, el avance de cada persona y el modo "en capacitación".

const ICONO: Record<RolCurso, React.ElementType> = { productor: Clapperboard, editor: VideoIcon, pauta: Megaphone, diseno: Palette };
const COLOR: Record<RolCurso, string> = {
  productor: "from-primary to-fuchsia-500",
  editor: "from-sky-500 to-indigo-500",
  pauta: "from-amber-500 to-orange-500",
  diseno: "from-emerald-500 to-teal-500",
};

/** Anillo de avance (porcentaje en el medio). */
function Anillo({ hechas, total, tam = 88, grosor = 9, className }: { hechas: number; total: number; tam?: number; grosor?: number; className?: string }) {
  const r = (tam - grosor) / 2;
  const c = 2 * Math.PI * r;
  const pct = total ? hechas / total : 0;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: tam, height: tam }}>
      <svg width={tam} height={tam} className="-rotate-90">
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke="currentColor" strokeWidth={grosor} className="text-white/15" />
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke="url(#grad-academia)" strokeWidth={grosor} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} className="transition-all duration-700" />
        <defs>
          <linearGradient id="grad-academia" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#f472b6" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">{Math.round(pct * 100)}%</span>
    </div>
  );
}

/** Video de la lección: entra entero en la pantalla y arranca con un botón grande de play. */
function VideoLeccion({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [arranco, setArranco] = useState(false);
  return (
    <div className="relative mx-auto aspect-[9/16] h-[clamp(360px,calc(100vh-15rem),676px)] max-w-full overflow-hidden rounded-3xl border bg-black shadow-2xl shadow-primary/10">
      <video
        ref={ref}
        src={src}
        poster={poster}
        controls={arranco}
        playsInline
        preload="metadata"
        onPlay={() => setArranco(true)}
        className="h-full w-full object-contain"
      />
      {!arranco && (
        <button
          type="button"
          onClick={() => ref.current?.play()}
          aria-label="Ver el video"
          className="group absolute inset-0 flex items-center justify-center bg-black/10"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-primary shadow-xl transition group-hover:scale-110">
            <Play className="ml-1 h-9 w-9 fill-current" />
          </span>
        </button>
      )}
    </div>
  );
}

/** Miniatura de una lección: el cuadro del video o un fondo con el número. */
function Miniatura({ leccion, n, curso, className }: { leccion: Leccion; n: number; curso: Curso; className?: string }) {
  const Icono = ICONO[curso.rol];
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br", COLOR[curso.rol], className)}>
      {leccion.poster ? (
        <img src={leccion.poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <>
          <Icono className="absolute -bottom-4 -right-4 h-24 w-24 text-white/15" />
          <span className="absolute left-3 top-2 text-4xl font-black text-white/90">{n}</span>
        </>
      )}
      {leccion.video ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/10">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-primary shadow-lg">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </span>
      ) : null}
      {leccion.duracion && <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{leccion.duracion}</span>}
    </div>
  );
}

/** La lección: video al lado de lo importante, paso a paso, la pregunta y para seguir. */
function VerLeccion({
  curso,
  leccion,
  progreso,
  uid,
  libre,
  onIr,
  onVolver,
}: {
  curso: Curso;
  leccion: Leccion;
  progreso: ProgresoAcademia | null;
  uid: string;
  libre: boolean;
  onIr: (id: string) => void;
  onVolver: () => void;
}) {
  const [elegida, setElegida] = useState<number | null>(null);
  const [festejo, setFestejo] = useState(false);
  useEffect(() => {
    setElegida(null);
    setFestejo(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [leccion.id]);
  const idx = curso.lecciones.findIndex((l) => l.id === leccion.id);
  const hecha = !!progreso?.completadas?.[leccion.id];
  const bien = elegida === leccion.pregunta.correcta;
  const anterior = curso.lecciones[idx - 1];
  const siguiente = curso.lecciones[idx + 1];
  const puedeAbrir = (i: number) => libre || i === 0 || !!progreso?.completadas?.[curso.lecciones[i - 1].id] || !!progreso?.completadas?.[curso.lecciones[i].id];

  const responder = async (i: number) => {
    setElegida(i);
    if (i !== leccion.pregunta.correcta || hecha) return;
    try {
      await completarLeccion(uid, leccion.id);
      setFestejo(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  return (
    <div className="space-y-5">
      {/* Arriba: volver y los pasos del curso */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onVolver} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {curso.titulo}
        </button>
        <div className="flex items-center gap-1.5">
          {curso.lecciones.map((l, i) => {
            const ok = !!progreso?.completadas?.[l.id];
            return (
              <button
                key={l.id}
                type="button"
                disabled={!puedeAbrir(i)}
                onClick={() => onIr(l.id)}
                title={l.titulo}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all",
                  l.id === leccion.id ? "scale-110 bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/30" : ok ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
                  !puedeAbrir(i) && "opacity-40"
                )}
              >
                {ok && l.id !== leccion.id ? <Check className="h-4 w-4" /> : i + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* Video */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          {leccion.video ? (
            <VideoLeccion key={leccion.video} src={leccion.video} poster={leccion.poster} />
          ) : (
            <div className={cn("mx-auto flex aspect-[9/16] w-full max-w-[380px] flex-col items-center justify-center gap-3 rounded-3xl bg-gradient-to-br p-8 text-center text-white", COLOR[curso.rol])}>
              <Sparkles className="h-10 w-10" />
              <p className="text-lg font-bold">El video de esta lección está en camino</p>
              <p className="text-sm text-white/80">Mientras tanto, leé lo importante: está todo acá al lado.</p>
            </div>
          )}
        </div>

        {/* Contenido */}
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Lección {idx + 1} de {curso.lecciones.length}
            </p>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{leccion.titulo}</h2>
            <p className="mt-1.5 text-muted-foreground">{leccion.resumen}</p>
          </div>

          <section className="space-y-2.5">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Lo importante
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {leccion.puntos.map((p, i) => (
                <div key={p} className="flex gap-3 rounded-2xl border bg-card p-3.5">
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-xs font-bold text-white", COLOR[curso.rol])}>{i + 1}</span>
                  <p className="text-sm leading-snug">{p}</p>
                </div>
              ))}
            </div>
          </section>

          {!!leccion.pasos?.length && (
            <section className="space-y-2.5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <ListChecks className="h-4 w-4 text-primary" /> Paso a paso
              </p>
              <ol className="relative space-y-3 rounded-2xl border bg-card p-4">
                {leccion.pasos.map((p, i) => (
                  <li key={p} className="relative flex gap-3 text-sm">
                    {i < leccion.pasos!.length - 1 && <span className="absolute left-[11px] top-7 h-[calc(100%-4px)] w-px bg-border" />}
                    <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background text-[10px] font-bold text-primary">{i + 1}</span>
                    <span className="pt-0.5">{p}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* La pregunta */}
          <section className="relative space-y-3 overflow-hidden rounded-3xl border-2 border-primary/30 bg-gradient-to-br from-primary/[0.08] to-fuchsia-500/[0.05] p-5">
            {festejo && (
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                {Array.from({ length: 18 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute h-2 w-2 rounded-sm animate-in fade-in zoom-in duration-700"
                    style={{ left: `${(i * 53) % 100}%`, top: `${(i * 37) % 90}%`, background: ["#a78bfa", "#f472b6", "#34d399", "#fbbf24"][i % 4], transform: `rotate(${i * 25}deg)` }}
                  />
                ))}
              </div>
            )}
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">{hecha ? "Lección completa" : "Para completar la lección"}</p>
            <p className="text-lg font-semibold">{leccion.pregunta.texto}</p>
            <div className="grid gap-2">
              {leccion.pregunta.opciones.map((o, i) => {
                const marcada = elegida === i;
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => void responder(i)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border bg-background px-4 py-3.5 text-left text-sm font-medium transition-all active:scale-[0.99]",
                      marcada && bien && "border-emerald-500 bg-emerald-500/10",
                      marcada && !bien && "border-red-500 bg-red-500/10",
                      !marcada && "hover:border-primary/50 hover:bg-primary/5"
                    )}
                  >
                    {marcada ? bien ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="h-5 w-5 shrink-0 text-red-500" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
                    {o}
                  </button>
                );
              })}
            </div>
            {elegida !== null && (
              <p className={cn("rounded-2xl p-3.5 text-sm animate-in fade-in slide-in-from-bottom-1", bien ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-red-500/10 text-red-800 dark:text-red-200")}>
                {bien ? <b>¡Bien! </b> : <b>Casi. Probá de nuevo. </b>}
                {bien && leccion.pregunta.porque}
              </p>
            )}
          </section>

          {/* Para seguir */}
          <div className="flex items-center justify-between gap-3 border-t pt-4">
            {anterior ? (
              <Button variant="ghost" onClick={() => onIr(anterior.id)} className="rounded-full">
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Anterior
              </Button>
            ) : (
              <span />
            )}
            {siguiente ? (
              <Button
                onClick={() => onIr(siguiente.id)}
                disabled={!libre && !hecha && !bien}
                className="rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-5 shadow-md shadow-primary/25"
                title={!libre && !hecha && !bien ? "Respondé la pregunta para seguir" : undefined}
              >
                Siguiente: {siguiente.titulo} <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              (hecha || bien) && (
                <Button onClick={onVolver} className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-5">
                  <Trophy className="mr-1.5 h-4 w-4" /> Terminar el curso
                </Button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inicio del curso: avance, "Seguí donde quedaste" y las lecciones como tarjetas. */
function VerCurso({ curso, progreso, uid, libre }: { curso: Curso; progreso: ProgresoAcademia | null; uid: string; libre: boolean }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const { hechas, total, completo } = avanceDe(curso, progreso);
  const leccion = curso.lecciones.find((l) => l.id === abierta);
  if (leccion) return <VerLeccion curso={curso} leccion={leccion} progreso={progreso} uid={uid} libre={libre} onIr={setAbierta} onVolver={() => setAbierta(null)} />;

  const pendiente = curso.lecciones.findIndex((l) => !progreso?.completadas?.[l.id]);
  const seguir = curso.lecciones[pendiente >= 0 ? pendiente : 0];
  const Icono = ICONO[curso.rol];

  return (
    <div className="space-y-6">
      {/* Portada del curso */}
      <div className={cn("relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-xl sm:p-8", COLOR[curso.rol])}>
        <Icono className="pointer-events-none absolute -right-6 -top-6 h-48 w-48 text-white/10" />
        <div className="relative flex flex-wrap items-center gap-6">
          <Anillo hechas={hechas} total={total} tam={104} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">Curso</p>
            <h2 className="text-2xl font-bold sm:text-3xl">{curso.titulo}</h2>
            <p className="mt-1 max-w-xl text-sm text-white/85">{curso.descripcion}</p>
            <p className="mt-2 text-sm font-semibold">{completo ? "¡Terminaste el curso!" : `${hechas} de ${total} lecciones`}</p>
          </div>
          {!completo && (
            <Button onClick={() => setAbierta(seguir.id)} className="rounded-full bg-white px-5 font-semibold text-zinc-900 shadow-lg hover:bg-white/90">
              <Play className="mr-1.5 h-4 w-4 fill-current" /> {hechas ? "Seguir" : "Empezar"}
            </Button>
          )}
        </div>
      </div>

      {/* Seguí donde quedaste */}
      {!completo && (
        <button
          type="button"
          onClick={() => setAbierta(seguir.id)}
          className="group flex w-full items-center gap-4 rounded-3xl border-2 border-primary/40 bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
        >
          <Miniatura leccion={seguir} n={pendiente + 1} curso={curso} className="h-28 w-20 shrink-0 rounded-2xl sm:h-32 sm:w-24" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">{hechas ? "Seguí donde quedaste" : "Arrancá por acá"}</p>
            <p className="mt-0.5 text-lg font-bold">
              {pendiente + 1}. {seguir.titulo}
            </p>
            <p className="line-clamp-2 text-sm text-muted-foreground">{seguir.resumen}</p>
          </div>
          <ArrowRight className="mr-2 h-6 w-6 shrink-0 text-primary transition-transform group-hover:translate-x-1" />
        </button>
      )}

      {/* Todas las lecciones */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {curso.lecciones.map((l, i) => {
          const hecha = !!progreso?.completadas?.[l.id];
          const bloqueada = !libre && !hecha && pendiente >= 0 && i > pendiente;
          return (
            <button
              key={l.id}
              type="button"
              disabled={bloqueada}
              onClick={() => setAbierta(l.id)}
              className={cn(
                "group flex gap-3 rounded-2xl border bg-card p-2.5 text-left transition-all",
                bloqueada ? "cursor-not-allowed opacity-50" : "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              )}
            >
              <Miniatura leccion={l} n={i + 1} curso={curso} className="h-24 w-16 shrink-0 rounded-xl" />
              <span className="flex min-w-0 flex-1 flex-col py-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lección {i + 1}</span>
                <span className="font-semibold leading-tight">{l.titulo}</span>
                <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{l.resumen}</span>
                <span className="mt-auto pt-1.5">
                  {hecha ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <Check className="h-3 w-3" /> Completa
                    </span>
                  ) : bloqueada ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="h-3 w-3" /> Se abre al terminar la anterior
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      <Play className="h-3 w-3" /> Disponible
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Admin: el avance de cada persona del equipo y el modo "en capacitación". */
function EquipoAcademia() {
  const { profiles } = useAppData();
  const [progresos, setProgresos] = useState<Record<string, ProgresoAcademia>>({});
  useEffect(
    () =>
      onSnapshot(
        collection(db, "academia"),
        (s) => setProgresos(Object.fromEntries(s.docs.map((d) => [d.id, d.data() as ProgresoAcademia]))),
        () => setProgresos({})
      ),
    []
  );
  const equipo = useMemo(
    () =>
      profiles
        .filter((p) => p.activo !== false && ["productor", "editor", "pauta", "diseno"].some((r) => p.role === r || (p.roles_extra ?? []).includes(r as never)))
        .sort((a, b) => Number(!!b.en_capacitacion) - Number(!!a.en_capacitacion) || a.nombre.localeCompare(b.nombre)),
    [profiles]
  );
  const cambiar = (id: string, v: boolean) =>
    void updateDoc(doc(db, "profiles", id), { en_capacitacion: v })
      .then(() => toast.success(v ? "En capacitación: sus videos pasan por vos antes del cliente" : "Listo: ya manda sus videos al cliente"))
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo"));
  const ini = (n: string) =>
    n
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase() ?? "")
      .join("");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-4 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <p>
          <b>En capacitación:</b> sus videos no le llegan al cliente hasta que vos los aprobás. Prendelo cuando entra alguien nuevo y apagalo cuando termina el curso y
          ves que trabaja bien.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {equipo.map((p) => {
          const cursos = cursosDe([p.role, ...(p.roles_extra ?? [])]);
          return (
            <div key={p.id} className={cn("space-y-3 rounded-2xl border bg-card p-4 transition-colors", p.en_capacitacion && "border-amber-500/60 bg-amber-500/[0.04]")}>
              <div className="flex items-center gap-3">
                {p.profileImage ? (
                  <img src={p.profileImage} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 text-sm font-bold text-white">{ini(p.nombre)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.nombre}</p>
                  {p.en_capacitacion && <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">En capacitación</p>}
                </div>
                <Switch checked={!!p.en_capacitacion} onCheckedChange={(v) => cambiar(p.id, v)} title="En capacitación" />
              </div>
              <div className="space-y-2">
                {cursos.map((c) => {
                  const a = avanceDe(c, progresos[p.id]);
                  const Icono = ICONO[c.rol];
                  return (
                    <div key={c.rol} className="flex items-center gap-3">
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white", COLOR[c.rol])}>
                        <Icono className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center justify-between text-xs">
                          <span className="font-medium">{c.titulo}</span>
                          <span className={cn("text-muted-foreground", a.completo && "font-semibold text-emerald-600 dark:text-emerald-400")}>{a.completo ? "Completo" : `${a.hechas}/${a.total}`}</span>
                        </p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full bg-gradient-to-r", a.completo ? "from-emerald-500 to-teal-500" : "from-primary to-fuchsia-500")} style={{ width: `${(a.hechas / a.total) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Academia() {
  const { user, role, roles, profile } = useUserProfileContext();
  const esAdmin = role === "admin";
  const mios = cursosDe([role ?? "", ...(roles ?? [])]);
  const [vista, setVista] = useState<string>(esAdmin ? "equipo" : mios[0]?.rol ?? "");
  const progreso = useProgresoAcademia(user?.uid);
  // El admin ve todos los cursos (para revisarlos) y puede abrir cualquier lección.
  const cursos = esAdmin ? CURSOS : mios;
  const curso = cursos.find((c) => c.rol === vista);

  return (
    <PageShell title="Academia Prodi" subtitle="Lo que hay que saber para trabajar en Prodi, en lecciones cortas con video.">
      {profile?.en_capacitacion && !esAdmin && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/[0.08] p-4 text-sm">
          <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p>
            <b>Estás en capacitación.</b> Tus videos los revisa un supervisor antes de que le lleguen al cliente. Completá tu curso: cada lección dura un par de minutos.
          </p>
        </div>
      )}
      {(esAdmin || cursos.length > 1) && (
        <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
          {esAdmin && (
            <button
              type="button"
              onClick={() => setVista("equipo")}
              className={cn("flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors", vista === "equipo" ? "border-transparent bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground")}
            >
              <GraduationCap className="h-4 w-4" /> El equipo
            </button>
          )}
          {cursos.map((c) => {
            const Icono = ICONO[c.rol];
            return (
              <button
                key={c.rol}
                type="button"
                onClick={() => setVista(c.rol)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                  vista === c.rol ? cn("border-transparent bg-gradient-to-r text-white shadow-md", COLOR[c.rol]) : "bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <Icono className="h-4 w-4" /> {c.titulo}
              </button>
            );
          })}
        </div>
      )}
      {vista === "equipo" && esAdmin ? (
        <EquipoAcademia />
      ) : curso && user ? (
        <VerCurso key={curso.rol} curso={curso} progreso={progreso} uid={user.uid} libre={esAdmin} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <GraduationCap className="h-4 w-4" /> Todavía no hay un curso para tu rol.
        </p>
      )}
    </PageShell>
  );
}
