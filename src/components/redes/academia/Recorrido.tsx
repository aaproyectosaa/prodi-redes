import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Loader2,
  Lock,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarcasEdicion } from "@/components/redes/MarcasVideo";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import { db } from "@/integrations/firebase/client";
import { doc, updateDoc } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import {
  abiertos,
  avanceModulo,
  avanceRecorrido,
  cuestionarioAprobado,
  entregaDe,
  guardarCuestionario,
  ID_EXAMEN,
  idEjercicioModulo,
  idEntrega,
  leccionHecha,
  prepararEntrega,
  tildarChecklist,
  APRUEBA_CUESTIONARIO,
  type EjercicioRecorrido,
  type EntregaAcademia,
  type LeccionRecorrido,
  type ModuloRecorrido,
  type ProgresoRecorrido,
  type Recorrido,
  ESTADO_ENTREGA,
  ubicarItem,
  ultimoVideo,
} from "@/lib/redes/academiaRecorrido";
import { pickMediaFiles } from "@/utils/pickMediaFiles";
import type { DriveConnection } from "@/utils/drive/types";
import { cn } from "@/lib/utils";

// Recorrido de la Academia (ej. "Productora Prodi · Nivel 1"), del lado de quien lo hace: semanas que se abren de a una,
// lecciones con checklist, el ejercicio de cada semana (se sube y lo corrige el admin), el cuestionario, el glosario y el
// examen final. El admin lo ve todo abierto.

/** La subida la arma el servidor con la cuenta de la app (api/_lib/drive-acciones/equipo-subida.ts): no hace falta leer la conexión. */
const CONEXION_APP = { status: "connected" } as DriveConnection;

/** Video propio de una lección: YouTube y Drive embebidos; un .mp4, con el reproductor. */
function VideoPropio({ url }: { url: string }) {
  const yt = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  const drive = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url);
  const src = yt ? `https://www.youtube.com/embed/${yt[1]}` : drive ? `https://drive.google.com/file/d/${drive[1]}/preview` : null;
  return (
    <div className="mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-3xl border bg-black shadow-xl">
      {src ? <iframe src={src} title="Video de la lección" allow="autoplay; encrypted-media" allowFullScreen className="h-full w-full" /> : <video src={url} controls playsInline preload="metadata" className="h-full w-full object-contain" />}
    </div>
  );
}

/** Subir el ejercicio, mandarlo a revisar y ver la devolución. */
export function EntregaBox({
  recorrido,
  modulo,
  itemId,
  itemTitulo,
  ejercicio,
  entregas,
  uid,
  nombre,
  opcional = false,
}: {
  recorrido: Recorrido;
  modulo: ModuloRecorrido | null;
  itemId: string;
  itemTitulo: string;
  ejercicio?: EjercicioRecorrido;
  entregas: EntregaAcademia[] | null;
  uid: string;
  nombre: string;
  opcional?: boolean;
}) {
  const id = idEntrega(uid, itemId);
  const entrega = entregaDe(entregas, itemId);
  const [nota, setNota] = useState("");
  const [mandando, setMandando] = useState(false);
  useEffect(() => {
    setNota(entrega?.nota_alumno ?? "");
  }, [entrega?.nota_alumno, id]);
  const { upload, isUploading, uploads } = useDriveUpload({
    taskId: id,
    collectionName: "academia_entregas",
    slot: "crudo",
    connection: CONEXION_APP,
    projectName: "Academia",
    taskTipo: "Ejercicios",
    taskFecha: null,
    uploaderUid: uid,
    taskLabel: itemTitulo,
  });
  const archivos = entrega?.attachments_crudo ?? [];
  const estado = entrega?.estado ?? "borrador";
  const bloqueada = estado === "aprobada" || estado === "enviada";
  const video = ultimoVideo(entrega);

  const subir = () =>
    pickMediaFiles(async (files) => {
      if (!files.length) return;
      try {
        await prepararEntrega(uid, nombre, recorrido, modulo?.id ?? null, itemId, itemTitulo, entrega);
        await upload(files);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo subir");
      }
    });

  const mandar = async () => {
    if (!archivos.length) return toast.error("Subí tu ejercicio primero");
    setMandando(true);
    try {
      const at = new Date().toISOString();
      await updateDoc(doc(db, "academia_entregas", id), { estado: "enviada", nota_alumno: nota.trim(), enviada_at: at, updated_at: at });
      await callApi("/api/usuarios/academia-aviso", { entrega_id: id }).catch(() => undefined);
      toast.success("¡Listo! Lucas lo va a revisar y te avisa");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo mandar");
    } finally {
      setMandando(false);
    }
  };

  return (
    <section className={cn("space-y-3 rounded-3xl border-2 p-4 sm:p-5", estado === "aprobada" ? "border-emerald-500/40 bg-emerald-500/[0.05]" : "border-primary/30 bg-primary/[0.04]")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Upload className="h-3.5 w-3.5" /> {ejercicio ? ejercicio.titulo : opcional ? "Práctica (opcional)" : "Ejercicio"}
          </p>
          <p className="mt-1 font-semibold">{ejercicio ? ejercicio.consigna : itemTitulo}</p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", ESTADO_ENTREGA[estado].clase)}>{ESTADO_ENTREGA[estado].label}</span>
      </div>
      {!!ejercicio?.pasos.length && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {ejercicio.pasos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      )}

      {estado === "a_corregir" && (
        <div className="space-y-2 rounded-2xl border border-orange-500/40 bg-orange-500/[0.06] p-3">
          <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">Lo que hay que corregir</p>
          {entrega?.devolucion && <p className="whitespace-pre-line text-sm">{entrega.devolucion}</p>}
          {!!entrega?.marcas?.length && video && <MarcasEdicion attachment={video} marcas={entrega.marcas} />}
          <p className="text-xs text-muted-foreground">Corregilo, subí la nueva versión y mandalo de nuevo.</p>
        </div>
      )}
      {estado === "aprobada" && entrega?.devolucion && <p className="whitespace-pre-line rounded-2xl bg-emerald-500/10 p-3 text-sm">{entrega.devolucion}</p>}

      {archivos.length > 0 && (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {archivos.map((a) => (
            <li key={a.drive_file_id} className="flex min-w-0 items-center gap-2 rounded-xl border bg-background px-2.5 py-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{a.name}</span>
            </li>
          ))}
        </ul>
      )}
      {uploads.some((u) => u.status === "uploading" || u.status === "queued") && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Subiendo… no cierres la página.
        </p>
      )}

      {!bloqueada && (
        <>
          <Textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Contale a Lucas lo que quieras (opcional)" rows={2} className="rounded-xl bg-background" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={subir} disabled={isUploading} className="rounded-full">
              <Upload className="mr-1.5 h-4 w-4" /> {archivos.length ? "Subir otro archivo" : "Subir el ejercicio"}
            </Button>
            <Button onClick={() => void mandar()} disabled={mandando || isUploading || !archivos.length} className="rounded-full bg-gradient-to-r from-primary to-fuchsia-500">
              {mandando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Mandar a revisar
            </Button>
          </div>
        </>
      )}
      {estado === "enviada" && <p className="text-xs text-muted-foreground">Lucas lo está revisando. Te llega un aviso cuando lo mire.</p>}
    </section>
  );
}

/** Cuestionario de la semana: 5 preguntas; con 4 bien se aprueba. */
function Cuestionario({ modulo, uid, progreso }: { modulo: ModuloRecorrido; uid: string; progreso: ProgresoRecorrido | null }) {
  const [resp, setResp] = useState<(number | null)[]>(() => modulo.cuestionario.map(() => null));
  const [corregido, setCorregido] = useState(false);
  const aprobado = cuestionarioAprobado(modulo, progreso);
  const mejor = progreso?.cuestionarios?.[modulo.id];
  const minimo = Math.min(APRUEBA_CUESTIONARIO, modulo.cuestionario.length);
  const aciertos = resp.filter((r, i) => r === modulo.cuestionario[i].correcta).length;
  if (!modulo.cuestionario.length) return null;

  const corregir = async () => {
    if (resp.some((r) => r === null)) return toast.error("Respondé todas las preguntas");
    setCorregido(true);
    if (!mejor || aciertos > mejor.aciertos) await guardarCuestionario(uid, modulo.id, aciertos, modulo.cuestionario.length).catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"));
  };

  return (
    <section className="space-y-4 rounded-3xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <ClipboardCheck className="h-4 w-4 text-primary" /> Cuestionario de la semana
        </p>
        {mejor && (
          <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", aprobado ? ESTADO_ENTREGA.aprobada.clase : ESTADO_ENTREGA.a_corregir.clase)}>
            {aprobado ? "Aprobado" : "Sin aprobar"} · {mejor.aciertos}/{mejor.total}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {modulo.cuestionario.length} preguntas. Se aprueba con {minimo} bien. Lo podés hacer las veces que quieras.
      </p>
      {modulo.cuestionario.map((q, i) => (
        <div key={i} className="space-y-2">
          <p className="text-sm font-semibold">
            {i + 1}. {q.texto}
          </p>
          <div className="grid gap-1.5">
            {q.opciones.map((o, j) => {
              const marcada = resp[i] === j;
              const ok = corregido && j === q.correcta;
              const mal = corregido && marcada && j !== q.correcta;
              return (
                <button
                  key={j}
                  type="button"
                  disabled={corregido}
                  onClick={() => setResp((r) => r.map((x, k) => (k === i ? j : x)))}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl border bg-background px-3 py-2.5 text-left text-sm transition-colors",
                    marcada && !corregido && "border-primary bg-primary/10",
                    ok && "border-emerald-500 bg-emerald-500/10",
                    mal && "border-red-500 bg-red-500/10",
                    !corregido && !marcada && "hover:border-primary/50"
                  )}
                >
                  {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : mal ? <XCircle className="h-4 w-4 shrink-0 text-red-500" /> : marcada ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  {o}
                </button>
              );
            })}
          </div>
          {corregido && q.porque && <p className="text-xs text-muted-foreground">{q.porque}</p>}
        </div>
      ))}
      {corregido ? (
        <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-2xl p-3 text-sm", aciertos >= minimo ? "bg-emerald-500/10" : "bg-orange-500/10")}>
          <p>
            <b>
              {aciertos} de {modulo.cuestionario.length} bien.
            </b>{" "}
            {aciertos >= minimo ? "¡Aprobaste el cuestionario!" : "Repasá las lecciones y probá de nuevo."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => {
              setResp(modulo.cuestionario.map(() => null));
              setCorregido(false);
            }}
          >
            Hacerlo de nuevo
          </Button>
        </div>
      ) : (
        <Button onClick={() => void corregir()} className="rounded-full">
          Corregir
        </Button>
      )}
    </section>
  );
}

/** Una lección: objetivo, video, explicación, bien vs. mal, práctica y checklist. */
function VerLeccion({
  recorrido,
  modulo,
  leccion,
  progreso,
  entregas,
  uid,
  nombre,
  onIr,
  onVolver,
}: {
  recorrido: Recorrido;
  modulo: ModuloRecorrido;
  leccion: LeccionRecorrido;
  progreso: ProgresoRecorrido | null;
  entregas: EntregaAcademia[] | null;
  uid: string;
  nombre: string;
  onIr: (id: string) => void;
  onVolver: () => void;
}) {
  const idx = modulo.lecciones.findIndex((l) => l.id === leccion.id);
  const anterior = modulo.lecciones[idx - 1];
  const siguiente = modulo.lecciones[idx + 1];
  // Lo tildado se muestra al instante (varios toques seguidos no se pisan) y se guarda en academia/{uid}.
  const guardados = progreso?.checklist?.[leccion.id];
  const [marcados, setMarcados] = useState<number[]>(guardados ?? []);
  useEffect(() => {
    setMarcados(guardados ?? []);
  }, [leccion.id, guardados?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [leccion.id]);
  const tildar = (i: number) =>
    setMarcados((prev) => {
      const nuevo = prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort((a, b) => a - b);
      void tildarChecklist(uid, leccion.id, nuevo).catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"));
      return nuevo;
    });
  const hecha = leccionHecha(leccion, { ...progreso, checklist: { ...progreso?.checklist, [leccion.id]: marcados } });

  return (
    <div className="space-y-5">
      <button type="button" onClick={onVolver} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {modulo.titulo}
      </button>
      <div className={cn("grid gap-6", leccion.video && "lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]")}>
        {leccion.video && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <VideoPropio url={leccion.video} />
          </div>
        )}
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Lección {idx + 1} de {modulo.lecciones.length}
            </p>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">{leccion.titulo}</h2>
            <p className="mt-2 rounded-2xl bg-primary/[0.07] p-3 text-sm">
              <b>Objetivo:</b> {leccion.objetivo}
            </p>
          </div>
          <div className="space-y-2.5 text-[15px] leading-relaxed">
            {leccion.explicacion
              .split("\n")
              .filter((p) => p.trim())
              .map((p) => (
                <p key={p}>{p}</p>
              ))}
          </div>

          {(leccion.bien.length > 0 || leccion.mal.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.05] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  <ThumbsUp className="h-4 w-4" /> Bien
                </p>
                <ul className="space-y-1.5 text-sm">
                  {leccion.bien.map((b) => (
                    <li key={b} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2 rounded-2xl border border-red-500/40 bg-red-500/[0.05] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                  <ThumbsDown className="h-4 w-4" /> Mal
                </p>
                <ul className="space-y-1.5 text-sm">
                  {leccion.mal.map((m) => (
                    <li key={m} className="flex gap-2">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /> {m}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {leccion.ejercicio && <EntregaBox recorrido={recorrido} modulo={modulo} itemId={leccion.id} itemTitulo={leccion.ejercicio} entregas={entregas} uid={uid} nombre={nombre} opcional />}

          {leccion.checklist.length > 0 && (
            <section className="space-y-2 rounded-3xl border bg-card p-4 sm:p-5">
              <p className="flex items-center gap-2 font-semibold">
                <ClipboardCheck className="h-4 w-4 text-primary" /> Checklist {hecha && <span className="text-xs font-semibold text-emerald-600">· lección completa</span>}
              </p>
              {leccion.checklist.map((c, i) => {
                const ok = marcados.includes(i);
                return (
                  <button key={c} type="button" onClick={() => tildar(i)} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors", ok ? "border-emerald-500/50 bg-emerald-500/10" : "hover:border-primary/50")}>
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2", ok ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40")}>{ok && <Check className="h-3.5 w-3.5" />}</span>
                    {c}
                  </button>
                );
              })}
            </section>
          )}

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            {anterior ? (
              <Button variant="ghost" onClick={() => onIr(anterior.id)} className="rounded-full">
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Anterior
              </Button>
            ) : (
              <span />
            )}
            {siguiente ? (
              <Button onClick={() => onIr(siguiente.id)} className="rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-5">
                Siguiente: {siguiente.titulo} <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={onVolver} className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-5">
                Ir al ejercicio de la semana <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Una semana: sus lecciones, el ejercicio y el cuestionario. */
function VerModulo({
  recorrido,
  modulo,
  progreso,
  entregas,
  uid,
  nombre,
  leccionInicial,
  onVolver,
}: {
  recorrido: Recorrido;
  modulo: ModuloRecorrido;
  progreso: ProgresoRecorrido | null;
  entregas: EntregaAcademia[] | null;
  uid: string;
  nombre: string;
  leccionInicial?: string | null;
  onVolver: () => void;
}) {
  const [abierta, setAbierta] = useState<string | null>(leccionInicial ?? null);
  const leccion = modulo.lecciones.find((l) => l.id === abierta);
  if (leccion) return <VerLeccion recorrido={recorrido} modulo={modulo} leccion={leccion} progreso={progreso} entregas={entregas} uid={uid} nombre={nombre} onIr={setAbierta} onVolver={() => setAbierta(null)} />;
  const a = avanceModulo(modulo, progreso, entregas);

  return (
    <div className="space-y-5">
      <button type="button" onClick={onVolver} className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {recorrido.titulo}
      </button>
      <div>
        <h2 className="text-2xl font-bold sm:text-3xl">{modulo.titulo}</h2>
        <p className="mt-1 text-muted-foreground">{modulo.subtitulo}</p>
        <Barra hechas={a.hechas} total={a.total} className="mt-3 max-w-md" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {modulo.lecciones.map((l, i) => {
          const hecha = leccionHecha(l, progreso);
          return (
            <button key={l.id} type="button" onClick={() => setAbierta(l.id)} className="group flex items-start gap-3 rounded-2xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold", hecha ? "bg-emerald-500 text-white" : "bg-primary/10 text-primary")}>{hecha ? <Check className="h-4 w-4" /> : i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-tight">{l.titulo}</span>
                <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{l.objetivo}</span>
              </span>
              <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          );
        })}
      </div>
      <EntregaBox recorrido={recorrido} modulo={modulo} itemId={idEjercicioModulo(modulo.id)} itemTitulo={modulo.ejercicio.titulo} ejercicio={modulo.ejercicio} entregas={entregas} uid={uid} nombre={nombre} />
      <Cuestionario modulo={modulo} uid={uid} progreso={progreso} />
    </div>
  );
}

function Barra({ hechas, total, className }: { hechas: number; total: number; className?: string }) {
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  return (
    <div className={className}>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {hechas} de {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full bg-gradient-to-r transition-all", pct === 100 ? "from-emerald-500 to-teal-500" : "from-primary to-fuchsia-500")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Glosario({ recorrido }: { recorrido: Recorrido }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {recorrido.glosario.map((g) => (
        <div key={g.termino} className="rounded-2xl border bg-card p-4">
          <p className="font-semibold">{g.termino}</p>
          <p className="mt-1 text-sm text-muted-foreground">{g.definicion}</p>
        </div>
      ))}
    </div>
  );
}

/** Inicio del recorrido: avance, las semanas (se abren de a una), el examen y el glosario. */
export function VerRecorrido({
  recorrido,
  progreso,
  entregas,
  uid,
  nombre,
  libre,
  irA,
}: {
  recorrido: Recorrido;
  progreso: ProgresoRecorrido | null;
  entregas: EntregaAcademia[] | null;
  uid: string;
  nombre: string;
  libre: boolean;
  /** Ítem a abrir al entrar (ej. desde el aviso de una corrección). */
  irA?: string | null;
}) {
  const inicial = useMemo(() => (irA ? ubicarItem(recorrido, irA) : null), [irA, recorrido]);
  const [vista, setVista] = useState<string | null>(inicial?.examen ? "examen" : inicial?.modulo ?? null);
  const ab = abiertos(recorrido, progreso, entregas);
  const av = avanceRecorrido(recorrido, progreso, entregas);
  const modulo = recorrido.modulos.find((m) => m.id === vista);

  if (modulo)
    return <VerModulo key={modulo.id} recorrido={recorrido} modulo={modulo} progreso={progreso} entregas={entregas} uid={uid} nombre={nombre} leccionInicial={inicial?.modulo === modulo.id ? inicial.leccion : null} onVolver={() => setVista(null)} />;
  if (vista === "glosario")
    return (
      <div className="space-y-5">
        <button type="button" onClick={() => setVista(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {recorrido.titulo}
        </button>
        <h2 className="text-2xl font-bold">Glosario</h2>
        <Glosario recorrido={recorrido} />
      </div>
    );
  if (vista === "examen")
    return (
      <div className="space-y-5">
        <button type="button" onClick={() => setVista(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {recorrido.titulo}
        </button>
        <h2 className="text-2xl font-bold">{recorrido.examen.titulo}</h2>
        <EntregaBox recorrido={recorrido} modulo={null} itemId={ID_EXAMEN} itemTitulo={recorrido.examen.titulo} ejercicio={recorrido.examen} entregas={entregas} uid={uid} nombre={nombre} />
      </div>
    );

  const examenAbierto = libre || ab.examen;
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-fuchsia-500 p-6 text-white shadow-xl sm:p-8">
        <GraduationCap className="pointer-events-none absolute -right-6 -top-6 h-48 w-48 text-white/10" />
        <div className="relative space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">Recorrido</p>
          <h2 className="text-2xl font-bold sm:text-3xl">{recorrido.titulo}</h2>
          <p className="max-w-xl text-sm text-white/85">{recorrido.descripcion}</p>
          <p className="text-sm font-semibold">{av.completo ? "¡Terminaste el recorrido!" : `${av.aprobados} de ${av.total} semanas aprobadas${av.examen ? " · examen aprobado" : ""}`}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {recorrido.modulos.map((m, i) => {
          const abierto = libre || ab.modulos[i];
          const a = avanceModulo(m, progreso, entregas);
          const ej = entregaDe(entregas, idEjercicioModulo(m.id));
          return (
            <button
              key={m.id}
              type="button"
              disabled={!abierto}
              onClick={() => setVista(m.id)}
              className={cn("group space-y-3 rounded-3xl border bg-card p-5 text-left transition-all", abierto ? "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg" : "cursor-not-allowed opacity-55")}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold leading-tight">{m.titulo}</p>
                {a.aprobado ? <Trophy className="h-5 w-5 shrink-0 text-emerald-500" /> : !abierto && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{m.subtitulo}</p>
              <Barra hechas={a.hechas} total={a.total} />
              {!abierto ? (
                <p className="text-xs text-muted-foreground">Se abre cuando Lucas aprueba la semana anterior.</p>
              ) : (
                ej && <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", ESTADO_ENTREGA[ej.estado].clase)}>Ejercicio: {ESTADO_ENTREGA[ej.estado].label}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={!examenAbierto}
          onClick={() => setVista("examen")}
          className={cn("flex items-center gap-4 rounded-3xl border-2 border-amber-500/40 bg-amber-500/[0.06] p-5 text-left transition-all", examenAbierto ? "hover:-translate-y-0.5 hover:shadow-lg" : "cursor-not-allowed opacity-55")}
        >
          <Trophy className="h-9 w-9 shrink-0 text-amber-500" />
          <span>
            <span className="block font-bold">{recorrido.examen.titulo}</span>
            <span className="block text-xs text-muted-foreground">{examenAbierto ? (av.examen ? "Aprobado" : "Un trabajo integrador: guion, rodaje y edición.") : "Se abre con las 4 semanas aprobadas."}</span>
          </span>
        </button>
        <button type="button" onClick={() => setVista("glosario")} className="flex items-center gap-4 rounded-3xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg">
          <BookOpen className="h-9 w-9 shrink-0 text-primary" />
          <span>
            <span className="block font-bold">Glosario</span>
            <span className="block text-xs text-muted-foreground">Las palabras que vas a escuchar en Prodi, explicadas fácil.</span>
          </span>
        </button>
      </div>
    </div>
  );
}
