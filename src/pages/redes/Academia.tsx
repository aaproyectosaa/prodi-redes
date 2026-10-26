import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, Circle, GraduationCap, ListChecks, Lock, PlayCircle, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/redes/PageShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useAppData } from "@/contexts/app-data-context";
import { db } from "@/integrations/firebase/client";
import { collection, doc, onSnapshot, updateDoc } from "@/lib/db";
import { avanceDe, completarLeccion, CURSOS, cursosDe, useProgresoAcademia, type Curso, type Leccion, type ProgresoAcademia } from "@/lib/redes/academia";
import { cn } from "@/lib/utils";

// Academia Prodi: los cursos de cada rol (lecciones con video, puntos clave, pasos y una pregunta) y, para el admin,
// el avance de cada persona del equipo y el modo "en capacitación".

function BarraAvance({ hechas, total, className }: { hechas: number; total: number; className?: string }) {
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}>
      <div className="h-full rounded-full bg-gradient-to-r from-primary to-fuchsia-500 transition-all duration-500" style={{ width: `${total ? (hechas / total) * 100 : 0}%` }} />
    </div>
  );
}

/** Una lección: video, puntos, pasos y la pregunta para completarla. */
function VerLeccion({ curso, leccion, hecha, onVolver, onSiguiente, uid }: { curso: Curso; leccion: Leccion; hecha: boolean; onVolver: () => void; onSiguiente?: () => void; uid: string }) {
  const [elegida, setElegida] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setElegida(null), [leccion.id]);
  const n = curso.lecciones.findIndex((l) => l.id === leccion.id) + 1;
  const bien = elegida === leccion.pregunta.correcta;

  const responder = async (i: number) => {
    setElegida(i);
    if (i !== leccion.pregunta.correcta || hecha) return;
    setGuardando(true);
    try {
      await completarLeccion(uid, leccion.id);
      toast.success("¡Lección completa!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <button type="button" onClick={onVolver} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Volver al curso
      </button>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {curso.titulo} · Lección {n} de {curso.lecciones.length}
        </p>
        <h2 className="mt-1 text-2xl font-bold">{leccion.titulo}</h2>
        <p className="mt-1 text-muted-foreground">{leccion.resumen}</p>
      </div>

      {leccion.video ? (
        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border bg-black shadow-xl">
          <video src={leccion.video} controls playsInline preload="metadata" className="aspect-[9/16] w-full" />
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          <PlayCircle className="h-4 w-4" /> El video de esta lección está en camino. Por ahora, leé los puntos clave.
        </div>
      )}

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <p className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Lo importante
        </p>
        <ul className="space-y-2.5">
          {leccion.puntos.map((p) => (
            <li key={p} className="flex gap-2.5 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-primary to-fuchsia-500" />
              {p}
            </li>
          ))}
        </ul>
      </section>

      {!!leccion.pasos?.length && (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <p className="flex items-center gap-2 font-semibold">
            <ListChecks className="h-4 w-4 text-primary" /> Paso a paso
          </p>
          <ol className="space-y-2">
            {leccion.pasos.map((p, i) => (
              <li key={p} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{i + 1}</span>
                {p}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border-2 border-primary/30 bg-primary/[0.04] p-5">
        <p className="font-semibold">{hecha ? "Ya completaste esta lección" : "Para completarla, respondé:"}</p>
        <p className="text-base font-medium">{leccion.pregunta.texto}</p>
        <div className="space-y-2">
          {leccion.pregunta.opciones.map((o, i) => {
            const marcada = elegida === i;
            return (
              <button
                key={o}
                type="button"
                onClick={() => void responder(i)}
                disabled={guardando}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border bg-background px-4 py-3 text-left text-sm transition-colors",
                  marcada && bien && "border-emerald-500 bg-emerald-500/10",
                  marcada && !bien && "border-red-500 bg-red-500/10",
                  !marcada && "hover:border-primary/50"
                )}
              >
                {marcada ? bien ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="h-5 w-5 shrink-0 text-red-500" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
                {o}
              </button>
            );
          })}
        </div>
        {elegida !== null && (
          <p className={cn("rounded-xl p-3 text-sm", bien ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-red-500/10 text-red-800 dark:text-red-200")}>
            {bien ? "¡Bien! " : "No es esa. Probá de nuevo. "}
            {bien && leccion.pregunta.porque}
          </p>
        )}
        {(bien || hecha) && onSiguiente && (
          <Button onClick={onSiguiente} className="rounded-full">
            Siguiente lección
          </Button>
        )}
      </section>
    </div>
  );
}

/** El curso: lecciones en orden, con su estado. */
function VerCurso({ curso, progreso, uid, libre }: { curso: Curso; progreso: ProgresoAcademia | null; uid: string; libre?: boolean }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const { hechas, total, completo } = avanceDe(curso, progreso);
  const idx = curso.lecciones.findIndex((l) => l.id === abierta);
  if (abierta && idx >= 0) {
    const sig = curso.lecciones[idx + 1];
    return (
      <VerLeccion
        curso={curso}
        leccion={curso.lecciones[idx]}
        hecha={!!progreso?.completadas?.[abierta]}
        uid={uid}
        onVolver={() => setAbierta(null)}
        onSiguiente={sig ? () => setAbierta(sig.id) : undefined}
      />
    );
  }
  // Se avanza en orden: la siguiente se abre al completar la anterior.
  const primeraPendiente = curso.lecciones.findIndex((l) => !progreso?.completadas?.[l.id]);
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border bg-gradient-to-br from-primary/12 via-fuchsia-500/[0.06] to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Curso</p>
            <h2 className="text-xl font-bold">{curso.titulo}</h2>
            <p className="text-sm text-muted-foreground">{curso.descripcion}</p>
          </div>
          <div className="min-w-[180px] text-right">
            <p className="text-sm font-semibold">{completo ? "¡Curso completo!" : `${hechas} de ${total} lecciones`}</p>
            <BarraAvance hechas={hechas} total={total} className="mt-1.5" />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {curso.lecciones.map((l, i) => {
          const hecha = !!progreso?.completadas?.[l.id];
          // El admin abre cualquiera (para revisarlas).
          const bloqueada = !libre && !hecha && primeraPendiente >= 0 && i > primeraPendiente;
          return (
            <button
              key={l.id}
              type="button"
              disabled={bloqueada}
              onClick={() => setAbierta(l.id)}
              className={cn(
                "flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-all",
                bloqueada ? "cursor-not-allowed opacity-50" : "hover:-translate-y-px hover:border-primary/40 hover:shadow-md",
                i === primeraPendiente && "border-primary/50 ring-2 ring-primary/20"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold",
                  hecha ? "bg-emerald-500 text-white" : bloqueada ? "bg-muted text-muted-foreground" : "bg-gradient-to-br from-primary to-fuchsia-500 text-white"
                )}
              >
                {hecha ? <Check className="h-5 w-5" /> : bloqueada ? <Lock className="h-4 w-4" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{l.titulo}</span>
                <span className="block truncate text-xs text-muted-foreground">{l.resumen}</span>
              </span>
              {l.video && <PlayCircle className="h-5 w-5 shrink-0 text-primary" />}
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

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <b>En capacitación</b>: sus videos no le llegan al cliente hasta que vos los aprobás. Prendelo cuando entra alguien nuevo y apagalo cuando termina el curso y
        ves que trabaja bien.
      </p>
      {equipo.map((p) => {
        const roles = [p.role, ...(p.roles_extra ?? [])];
        const cursos = cursosDe(roles);
        return (
          <div key={p.id} className={cn("flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-4", p.en_capacitacion && "border-amber-500/50")}>
            <div className="min-w-[160px] flex-1">
              <p className="font-semibold">{p.nombre}</p>
              {cursos.map((c) => {
                const a = avanceDe(c, progresos[p.id]);
                return (
                  <div key={c.rol} className="mt-1.5 max-w-xs">
                    <p className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{c.titulo}</span>
                      <span className={cn(a.completo && "font-semibold text-emerald-600 dark:text-emerald-400")}>{a.completo ? "Completo" : `${a.hechas}/${a.total}`}</span>
                    </p>
                    <BarraAvance hechas={a.hechas} total={a.total} className="mt-0.5 h-1.5" />
                  </div>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!p.en_capacitacion} onCheckedChange={(v) => cambiar(p.id, v)} />
              <span className={cn(p.en_capacitacion ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>En capacitación</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

export default function Academia() {
  const { user, role, roles, profile } = useUserProfileContext();
  const esAdmin = role === "admin";
  const mios = cursosDe([role ?? "", ...(roles ?? [])]);
  const [vista, setVista] = useState<string>(esAdmin ? "equipo" : mios[0]?.rol ?? "");
  const progreso = useProgresoAcademia(user?.uid);
  // El admin puede ver todos los cursos (para revisarlos).
  const cursos = esAdmin ? CURSOS : mios;
  const curso = cursos.find((c) => c.rol === vista);

  return (
    <PageShell title="Academia Prodi" subtitle="Lo que hay que saber para trabajar en Prodi, en lecciones cortas.">
      {profile?.en_capacitacion && !esAdmin && (
        <p className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.08] p-3 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          Estás en capacitación: tus videos los revisa un supervisor antes de que le lleguen al cliente. Completá tu curso.
        </p>
      )}
      {(esAdmin || cursos.length > 1) && (
        <div className="mb-4 inline-flex flex-wrap rounded-full border bg-card p-1">
          {esAdmin && (
            <button
              type="button"
              onClick={() => setVista("equipo")}
              className={cn("h-8 rounded-full px-4 text-xs font-semibold", vista === "equipo" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              El equipo
            </button>
          )}
          {cursos.map((c) => (
            <button
              key={c.rol}
              type="button"
              onClick={() => setVista(c.rol)}
              className={cn("h-8 rounded-full px-4 text-xs font-semibold", vista === c.rol ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {c.titulo}
            </button>
          ))}
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
