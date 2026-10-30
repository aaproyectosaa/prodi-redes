import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronDown, FileText, Loader2, Lock, Mic, Pause, Play, Sparkles, Square, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import { useDriveConnection } from "@/hooks/use-drive-connection";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { generarMinuta } from "@/lib/redes/reuniones";
import {
  archivosDeSesion,
  borrarSesion,
  descartarGrabacion,
  fmtDuracion,
  grabacionesPendientes,
  pausarGrabacion,
  reanudarGrabacion,
  segundosGrabados,
  terminarGrabacion,
  useGrabacion,
  type MetaGrabacion,
} from "@/lib/redes/grabacion";
import { EVENTO_ABRIR_GRABACION } from "@/lib/redes/grabarReunion";
import { plataforma } from "@/lib/instalar";
import { cn } from "@/lib/utils";

type Trabajo = { sesion: string; meta: MetaGrabacion; paso: "subiendo" | "minuta" | "lista" | "error"; error?: string };

/** Barras de volumen que se mueven con la voz. */
export function Ondas({ niveles, className, barra = "bg-current" }: { niveles: number[]; className?: string; barra?: string }) {
  return (
    <span className={cn("flex items-center gap-[3px]", className)} aria-hidden>
      {niveles.map((n, i) => (
        <span key={i} className={cn("w-[3px] rounded-full transition-[height] duration-100", barra)} style={{ height: `${Math.max(12, Math.round(n * 100))}%` }} />
      ))}
    </span>
  );
}

function useReloj(activo: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!activo) return;
    const t = window.setInterval(() => set((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [activo]);
}

/**
 * La grabación en curso, en toda la app: una píldora flotante (o la vista grande) para pausar y terminar.
 * Al terminar sube las partes a Drive y la IA arma la minuta sola. También ofrece subir lo que haya quedado
 * guardado en el teléfono si el navegador se cerró a mitad de una grabación.
 */
export function GrabacionEnCurso() {
  const g = useGrabacion();
  const { role, user } = useUserProfileContext();
  const { connection } = useDriveConnection();
  const navigate = useNavigate();
  const [grande, setGrande] = useState(false);
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null);
  const [pendientes, setPendientes] = useState<Awaited<ReturnType<typeof grabacionesPendientes>>>([]);
  const activa = g.fase !== "inactiva";
  useReloj(g.fase === "grabando");

  const { upload } = useDriveUpload({
    taskId: trabajo?.meta.reunionId ?? "",
    collectionName: "reuniones",
    slot: "crudo",
    connection,
    projectName: trabajo?.meta.clienteNombre || "Interno",
    taskTipo: "Reuniones",
    taskFecha: trabajo?.meta.fecha ?? null,
    uploaderUid: user?.uid ?? null,
    taskLabel: trabajo?.meta.titulo,
  });

  useEffect(() => {
    const abrir = () => setGrande(true);
    window.addEventListener(EVENTO_ABRIR_GRABACION, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_GRABACION, abrir);
  }, []);

  // Lo que quedó sin subir de otra vez.
  useEffect(() => {
    if (!role || role === "cliente" || activa || trabajo) return;
    void grabacionesPendientes().then(setPendientes);
  }, [role, activa, trabajo]);

  // Subir y armar la minuta (cuando ya está el trabajo, así el hook de Drive apunta a esa reunión).
  useEffect(() => {
    if (trabajo?.paso !== "subiendo" || !connection) return;
    let vivo = true;
    void (async () => {
      try {
        const archivos = await archivosDeSesion(trabajo.sesion);
        if (!archivos.length) throw new Error("No quedó audio grabado.");
        const subidos = await upload(archivos);
        if (!subidos.length) throw new Error("No se pudo subir a Drive. Quedó guardada en este teléfono: probá de nuevo en un rato.");
        if (subidos.length === archivos.length) await borrarSesion(trabajo.sesion);
        if (!vivo) return;
        setTrabajo((t) => t && { ...t, paso: "minuta" });
        await generarMinuta(trabajo.meta.reunionId, "audio");
        if (vivo) setTrabajo((t) => t && { ...t, paso: "lista" });
      } catch (err) {
        if (vivo) setTrabajo((t) => t && { ...t, paso: "error", error: err instanceof Error ? err.message : "Algo salió mal" });
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trabajo?.sesion, trabajo?.paso === "subiendo", !!connection]);

  if (!role || role === "cliente") return null;

  const terminar = async () => {
    const fin = await terminarGrabacion();
    if (!fin) return;
    if (fin.segundos < 3) {
      await borrarSesion(fin.sesion);
      setGrande(false);
      toast.message("La grabación duró muy poco: no se guardó.");
      return;
    }
    setGrande(true);
    setTrabajo({ sesion: fin.sesion, meta: fin.meta, paso: "subiendo" });
  };

  const cerrarTrabajo = () => {
    setTrabajo(null);
    setGrande(false);
  };

  const segundos = segundosGrabados(g);
  const esIphone = plataforma() === "iphone";
  const meta = g.meta ?? trabajo?.meta ?? null;

  // ---- Vista grande ----
  if (grande && (activa || trabajo) && meta) {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#0b0614] text-white">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/40 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/30 blur-[140px]" />

        <div className="relative flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
            <Mic className="h-3.5 w-3.5" /> {g.modo === "llamada" ? "Videollamada" : "Reunión presencial"}
          </span>
          {activa && (
            <button type="button" onClick={() => setGrande(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur hover:bg-white/20" aria-label="Achicar">
              <ChevronDown className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
          <div className="space-y-1.5">
            <p className="text-xl font-bold tracking-tight sm:text-2xl">{meta.titulo}</p>
            <p className="text-sm text-white/60">{meta.clienteNombre || "Interna"}</p>
          </div>

          {activa ? (
            <>
              <div className="relative flex h-44 w-44 items-center justify-center">
                {g.fase === "grabando" && <span className="absolute inset-0 animate-ping rounded-full bg-fuchsia-500/20 [animation-duration:2.4s]" />}
                <span
                  className={cn(
                    "absolute inset-3 rounded-full bg-gradient-to-br shadow-[0_0_80px_-10px] transition-colors",
                    g.fase === "grabando" ? "from-primary to-fuchsia-600 shadow-fuchsia-500/60" : "from-white/15 to-white/5 shadow-transparent"
                  )}
                />
                <Ondas niveles={g.niveles.slice(-14)} className="relative h-16" barra="bg-white" />
              </div>
              <div className="space-y-2">
                <p className="font-mono text-5xl font-bold tabular-nums tracking-tight sm:text-6xl">{fmtDuracion(segundos)}</p>
                <p className="text-sm text-white/60">
                  {g.fase === "grabando"
                    ? g.parte > 1
                      ? `Grabando · parte ${g.parte}`
                      : "Grabando"
                    : g.fase === "pausada"
                      ? "En pausa"
                      : "Se cortó el micrófono · volviendo…"}
                </p>
              </div>
              <p className="flex max-w-xs items-start gap-2 rounded-2xl bg-white/[0.06] px-4 py-3 text-left text-xs leading-relaxed text-white/70 backdrop-blur">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {esIphone
                  ? "En iPhone/iPad dejá la app abierta: la pantalla queda prendida. Si la bloqueás, al volver sigue sola y no se pierde lo grabado."
                  : g.modo === "llamada"
                    ? "Podés seguir usando la compu. Para terminar, tocá Terminar o dejá de compartir la pestaña."
                    : "Podés bloquear el celular o usar otras apps: sigue grabando. Todo se va guardando en el teléfono."}
              </p>
            </>
          ) : trabajo ? (
            <div className="flex w-full max-w-sm flex-col items-center gap-5">
              <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/10 backdrop-blur">
                {trabajo.paso === "lista" ? (
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                ) : trabajo.paso === "error" ? (
                  <FileText className="h-10 w-10 text-amber-300" />
                ) : (
                  <Loader2 className="h-10 w-10 animate-spin" />
                )}
              </span>
              <ol className="w-full space-y-2 text-left text-sm">
                {[
                  { k: "subiendo", t: "Guardando la grabación en Drive" },
                  { k: "minuta", t: "La IA escucha la reunión y arma la minuta" },
                  { k: "lista", t: "Minuta lista" },
                ].map((p, i, arr) => {
                  const actual = arr.findIndex((x) => x.k === trabajo.paso);
                  const hecho = trabajo.paso === "lista" || i < actual;
                  const ahora = i === actual && trabajo.paso !== "lista";
                  return (
                    <li key={p.k} className={cn("flex items-center gap-3 rounded-2xl px-4 py-3", ahora ? "bg-white/10" : "bg-white/[0.04]", !hecho && !ahora && "text-white/40")}>
                      {hecho ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : ahora ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="h-4 w-4 rounded-full border border-white/30" />}
                      {p.t}
                    </li>
                  );
                })}
              </ol>
              {trabajo.paso === "error" && <p className="text-sm text-amber-200">{trabajo.error}</p>}
            </div>
          ) : null}
        </div>

        <div className="relative flex items-center justify-center gap-4 px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {activa ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("¿Descartar la grabación? Se borra lo grabado.")) void descartarGrabacion().then(() => setGrande(false));
                }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white/70 backdrop-blur hover:bg-white/20"
                aria-label="Descartar"
              >
                <Trash2 className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => void terminar()}
                className="flex h-16 items-center gap-2 rounded-full bg-white px-7 text-base font-bold text-[#0b0614] shadow-2xl shadow-fuchsia-500/30 transition-transform hover:scale-[1.03]"
              >
                <Square className="h-4 w-4 fill-current" /> Terminar
              </button>
              <button
                type="button"
                onClick={() => (g.fase === "grabando" ? pausarGrabacion() : void reanudarGrabacion())}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 backdrop-blur hover:bg-white/20"
                aria-label={g.fase === "grabando" ? "Pausar" : "Seguir"}
              >
                {g.fase === "grabando" ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
              </button>
            </>
          ) : trabajo?.paso === "lista" ? (
            <Button
              className="h-14 rounded-full bg-white px-7 text-base font-bold text-[#0b0614] hover:bg-white/90"
              onClick={() => {
                navigate(`/reuniones?r=${trabajo.meta.reunionId}`);
                cerrarTrabajo();
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" /> Ver la minuta
            </Button>
          ) : trabajo?.paso === "error" ? (
            <Button variant="secondary" className="h-12 rounded-full px-6" onClick={cerrarTrabajo}>
              Cerrar
            </Button>
          ) : (
            <Button variant="ghost" className="h-12 rounded-full px-6 text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setGrande(false)}>
              Seguir en segundo plano
            </Button>
          )}
        </div>
      </div>
    );
  }

  const abajo = "bottom-[calc(5.25rem+env(safe-area-inset-bottom))] md:bottom-6";

  // ---- Píldora mientras graba ----
  if (activa && meta) {
    return (
      <div className={cn("fixed left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#140a22]/95 p-1.5 pl-2 text-white shadow-2xl shadow-fuchsia-500/25 ring-1 ring-white/10 backdrop-blur", abajo)}>
        <button type="button" onClick={() => setGrande(true)} className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 text-left">
          <span className="relative flex h-2.5 w-2.5">
            {g.fase === "grabando" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />}
            <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", g.fase === "grabando" ? "bg-red-500" : "bg-white/40")} />
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums">{fmtDuracion(segundos)}</span>
          <Ondas niveles={g.niveles.slice(-10)} className="h-5 text-fuchsia-300" />
          <span className="hidden max-w-[10rem] truncate text-xs text-white/60 sm:block">{meta.titulo}</span>
        </button>
        <button
          type="button"
          onClick={() => (g.fase === "grabando" ? pausarGrabacion() : void reanudarGrabacion())}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          aria-label={g.fase === "grabando" ? "Pausar" : "Seguir"}
        >
          {g.fase === "grabando" ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <button type="button" onClick={() => void terminar()} className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-bold text-[#140a22] hover:bg-white/90">
          <Square className="h-3 w-3 fill-current" /> Terminar
        </button>
      </div>
    );
  }

  // ---- Subiendo en segundo plano ----
  if (trabajo) {
    return (
      <button
        type="button"
        onClick={() => setGrande(true)}
        className={cn("fixed left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#140a22]/95 px-4 py-2.5 text-sm text-white shadow-2xl ring-1 ring-white/10 backdrop-blur", abajo)}
      >
        {trabajo.paso === "lista" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : trabajo.paso === "error" ? <FileText className="h-4 w-4 text-amber-300" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        {trabajo.paso === "subiendo" ? "Guardando la grabación…" : trabajo.paso === "minuta" ? "Armando la minuta…" : trabajo.paso === "lista" ? "Minuta lista · ver" : "No se pudo terminar · ver"}
      </button>
    );
  }

  // ---- Algo quedó sin subir ----
  const p = pendientes[0];
  if (p) {
    return (
      <div className={cn("fixed left-1/2 z-[60] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl border bg-card p-3 shadow-2xl", abajo)}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Mic className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">Quedó una grabación sin subir</span>
          <span className="block truncate text-xs text-muted-foreground">
            {p.meta.titulo} · {(p.bytes / 1_048_576).toFixed(1)} MB
          </span>
        </span>
        <span className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-xl"
            onClick={() => {
              if (!window.confirm("¿Borrar esta grabación del teléfono? No se puede recuperar.")) return;
              void borrarSesion(p.sesion).then(() => setPendientes((l) => l.slice(1)));
            }}
          >
            Borrar
          </Button>
          <Button
            size="sm"
            className="rounded-xl font-semibold"
            onClick={() => {
              setPendientes((l) => l.slice(1));
              setGrande(true);
              setTrabajo({ sesion: p.sesion, meta: p.meta, paso: "subiendo" });
            }}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Subir y armar minuta
          </Button>
        </span>
      </div>
    );
  }

  return null;
}
