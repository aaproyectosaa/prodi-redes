import { useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, ClipboardList, FileText, ListOrdered, Loader2, MapPin, Package, Play, Send, Sparkles, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { MaterialSlot } from "@/components/redes/MaterialSlot";
import { EntregaEdicionDialog } from "@/components/redes/EntregaEdicion";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useDriveUploadContext } from "@/contexts/drive-upload-context";
import { formatearFecha } from "@/lib/fecha";
import { callApi } from "@/lib/redes/api";
import { fechaCorta, hoyISO, mesLabel } from "@/lib/redes/format";
import {
  devolverNoFilmados,
  enviarAEdicion,
  iniciarRodaje,
  marcarFilmado,
  marcarLlevar,
  marcarRodajeRealizado,
  marcarTomas,
  terminarRodaje,
  textoDuracionRodaje,
} from "@/lib/redes/videos";
import { CompartirGuion } from "@/components/redes/CompartirGuion";
import { cn } from "@/lib/utils";
import type { EstadoFilmado, Rodaje, Video } from "@/lib/redes/types";

const SIN_EDITAR = ["planificado", "agendado"];
/** Videos que tienen algo para mandar al cliente (el guion, o la idea si todavía no hay guion). */
const conGuionDe = (vs: Video[]) => vs.filter((v) => v.guion?.trim() || v.idea?.trim());

export function RodajeRow({
  rodaje,
  onEdit,
  onDone,
}: {
  rodaje: Rodaje;
  onEdit?: () => void;
  onDone?: () => void | Promise<void>;
}) {
  const { clienteById, videos } = useRedes();
  const openVideo = useOpenVideo();
  const cliente = clienteById(rodaje.proyecto_id);
  const vids = videos.filter((v) => rodaje.video_ids.includes(v.id));
  const esHoy = rodaje.fecha === hoyISO();
  const [hoja, setHoja] = useState(false);
  const [mandarGuiones, setMandarGuiones] = useState(false);
  const { user, role, tieneRol } = useUserProfileContext();
  const { jobs } = useDriveUploadContext();
  const puedeSubir = role === "admin" || tieneRol("productor");

  // Cuando se sube el material del último video de la jornada, todo pasa solo a edición
  // (y edición recibe el aviso). Solo si el material se subió desde esta hoja, en esta sesión.
  const subioAca = useRef(false);
  const enviando = useRef(false);
  const ids = vids.map((v) => v.id);
  const subiendo = jobs.some((j) => ids.includes(j.taskId) && j.slot === "crudo" && (j.status === "queued" || j.status === "uploading"));
  // Los que se marcaron "No se filmó" no cuentan: no se espera su material.
  const aFilmar = vids.filter((v) => rodaje.filmados?.[v.id] !== "no");
  const todosConMaterial = aFilmar.length > 0 && aFilmar.every((v) => (v.attachments_crudo?.length ?? 0) > 0);
  const pendientes = aFilmar.filter((v) => SIN_EDITAR.includes(v.etapa));
  useEffect(() => {
    if (!subioAca.current || enviando.current || subiendo || !todosConMaterial || pendientes.length === 0) return;
    enviando.current = true;
    void (async () => {
      try {
        for (const v of pendientes) await enviarAEdicion(v, cliente, user?.uid ?? "");
        if (rodaje.estado === "agendado") await marcarRodajeRealizado(rodaje);
        await devolverNoFilmados(rodaje, vids, user?.uid ?? "");
        toast.success(
          `Material completo: ${pendientes.length === 1 ? "el video pasó" : `los ${pendientes.length} videos pasaron`} a edición y le avisamos a la editora 🎬`
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo mandar a edición");
      } finally {
        subioAca.current = false;
        enviando.current = false;
      }
    })();
  }, [subiendo, todosConMaterial, pendientes, cliente, user?.uid, rodaje]);
  // Al terminar el día: los que no se filmaron vuelven a Planificado para agendarlos en otro rodaje.
  const alTerminar = async () => {
    const n = await devolverNoFilmados(rodaje, vids, user?.uid ?? "");
    if (n) toast.message(`${n === 1 ? "El video que no se filmó volvió" : `Los ${n} videos que no se filmaron volvieron`} a Planificado, para agendarlos en otro rodaje.`);
  };
  const meses = new Set(vids.map((v) => v.mes)).size;
  const filmados = vids.filter((v) => rodaje.filmados?.[v.id] === "si" || rodaje.filmados?.[v.id] === "parcial").length;
  return (
    <div className={`rounded-xl border bg-card p-3 ${esHoy ? "border-primary/50 bg-primary/[0.04]" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-muted py-1.5">
          <span className="text-[10px] uppercase text-muted-foreground">
            {formatearFecha(rodaje.fecha, { month: "short" })}
          </span>
          <span className="text-lg font-bold leading-none">{Number(rodaje.fecha.slice(8))}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <ClienteTag cliente={cliente} size="md" className="text-foreground" />
            {esHoy && <span className="text-[10px] font-bold uppercase text-primary">Hoy</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {fechaCorta(rodaje.fecha)} {rodaje.hora ? `· ${rodaje.hora}` : ""}
            {rodaje.lugar && (
              <>
                {" "}
                · <MapPin className="inline h-3 w-3" /> {rodaje.lugar}
              </>
            )}
          </p>
          {vids.length > 2 && (
            <p className="mt-1.5 text-[11px] font-medium text-primary">
              {vids.length} videos{meses > 1 ? ` de ${meses} meses` : ""}
              {filmados ? ` · ${filmados} filmados` : ""}
              {rodaje.bloques?.length ? ` · día ordenado en ${rodaje.bloques.length} partes` : ""}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {vids.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => openVideo(v.id)}
                className="max-w-[180px] truncate rounded-md border px-2 py-0.5 text-[11px] hover:border-primary"
              >
                {v.titulo}
              </button>
            ))}
          </div>
          {rodaje.preparar && (
            <p className="mt-2 rounded-md bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Cliente tiene listo:</span> {rodaje.preparar}
            </p>
          )}
          <CronometroRodaje rodaje={rodaje} puede={puedeSubir} onTerminar={alTerminar} />
          {puedeSubir && conGuionDe(vids).length > 0 && rodaje.estado !== "cancelado" && (
            <button
              type="button"
              onClick={() => setMandarGuiones(true)}
              className="mt-2 flex w-full items-center gap-2.5 rounded-xl border border-primary/40 bg-gradient-to-r from-primary/[0.12] to-fuchsia-500/[0.08] px-3 py-2 text-left transition-colors hover:border-primary"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {conGuionDe(vids).length === 1 ? "Mandar el guion al cliente" : `Mandar los ${conGuionDe(vids).length} guiones al cliente`}
                </span>
                <span className="block text-[11px] text-muted-foreground">Lo que va a decir a cámara, por el grupo o por privado</span>
              </span>
              <Send className="h-4 w-4 shrink-0 text-primary" />
            </button>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setHoja(true)}>
              <ClipboardList className="mr-1 h-3.5 w-3.5" /> Hoja de rodaje
            </Button>
          {(onEdit || onDone) && rodaje.estado === "agendado" && (
            <>
              {onEdit && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onEdit}>
                  Editar
                </Button>
              )}
              {onDone && rodaje.fecha <= hoyISO() && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={async () => {
                    await onDone();
                    await alTerminar();
                  }}
                >
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Realizado
                </Button>
              )}
            </>
          )}
          </div>
        </div>
      </div>
      <CompartirGuion open={mandarGuiones} onOpenChange={setMandarGuiones} videos={conGuionDe(vids)} proyectoId={rodaje.proyecto_id} />
      <HojaRodaje
        rodaje={rodaje}
        videos={vids}
        clienteNombre={cliente?.nombre ?? ""}
        open={hoja}
        onOpenChange={setHoja}
        puedeSubir={puedeSubir}
        onSubir={() => (subioAca.current = true)}
      />
    </div>
  );
}

/**
 * Lo que hay que filmar en la jornada, para tener en el celular durante el rodaje. Sirve igual para un rodaje de un
 * video que para un día entero de campaña: se prepara con la IA (guiones y tomas de todos, el día ordenado por momento
 * y lugar, qué llevar) y el día se marca video por video si se filmó, quedó a medias o no se filmó. Todo queda guardado
 * en el rodaje, así lo ve igual todo el equipo desde cualquier celular.
 */
function HojaRodaje({
  rodaje,
  videos,
  clienteNombre,
  open,
  onOpenChange,
  puedeSubir,
  onSubir,
}: {
  rodaje: Rodaje;
  videos: Video[];
  clienteNombre: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  puedeSubir: boolean;
  onSubir: () => void;
}) {
  const { clienteById } = useRedes();
  const { user } = useUserProfileContext();
  const [mandando, setMandando] = useState<string | null>(null);
  const [entregaDe, setEntregaDe] = useState<Video | null>(null);
  // Guion e idea abiertos y a quién se manda (uno o todos).
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [compartir, setCompartir] = useState<Video[] | null>(null);
  const [armando, setArmando] = useState<"guiones" | "orden" | null>(null);
  // Lo que se toca se ve al instante; se guarda en el rodaje y llega a los demás celulares.
  const [filmadosLocal, setFilmadosLocal] = useState<Record<string, EstadoFilmado | null>>({});
  const [tomasLocal, setTomasLocal] = useState<Record<string, number[]>>({});
  const [llevarLocal, setLlevarLocal] = useState<number[] | null>(null);
  useEffect(() => {
    setFilmadosLocal({});
    setTomasLocal({});
    setLlevarLocal(null);
  }, [rodaje.filmados, rodaje.tomas_hechas, rodaje.llevar_hecho]);

  const conGuion = conGuionDe(videos);
  const conMaterial = videos.filter((v) => (v.attachments_crudo?.length ?? 0) > 0).length;
  const sinGuion = videos.filter((v) => !v.guion?.trim() || !(v.tomas?.length ?? 0)).length;
  const estadoDe = (id: string): EstadoFilmado | null => (id in filmadosLocal ? filmadosLocal[id] : rodaje.filmados?.[id] ?? null);
  const tomasDe = (id: string) => tomasLocal[id] ?? rodaje.tomas_hechas?.[id] ?? [];
  const llevarHecho = llevarLocal ?? rodaje.llevar_hecho ?? [];
  const cuenta = { si: 0, parcial: 0, no: 0 };
  for (const v of videos) {
    const e = estadoDe(v.id);
    if (e) cuenta[e]++;
  }
  const marcados = cuenta.si + cuenta.parcial + cuenta.no;
  const esDiaOAntes = rodaje.fecha >= hoyISO();

  // Videos por bloque (si la IA ordenó el día) o por mes de publicación.
  const porId = new Map(videos.map((v) => [v.id, v]));
  const grupos: { nombre: string; detalle?: string | null; vids: Video[] }[] = rodaje.bloques?.length
    ? [
        ...rodaje.bloques.map((b) => ({ nombre: b.nombre, detalle: b.detalle, vids: b.video_ids.map((id) => porId.get(id)).filter((v): v is Video => !!v) })),
        { nombre: "Sumados después", vids: videos.filter((v) => !rodaje.bloques!.some((b) => b.video_ids.includes(v.id))) },
      ].filter((g) => g.vids.length)
    : [...new Set(videos.map((v) => v.mes))].sort().map((m) => ({
        nombre: new Set(videos.map((v) => v.mes)).size > 1 ? `Se publican en ${mesLabel(m).split(" ")[0].toLowerCase()}` : "",
        vids: videos.filter((v) => v.mes === m),
      }));
  let numero = 0;

  const mandar = async (v: Video, fecha: string) => {
    setMandando(v.id);
    try {
      await enviarAEdicion(v, clienteById(v.proyecto_id), user?.uid ?? "", fecha);
      toast.success("Enviado a edición");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar");
    } finally {
      setMandando(null);
    }
  };
  const filmar = (v: Video, e: EstadoFilmado) => {
    const nuevo = estadoDe(v.id) === e ? null : e;
    setFilmadosLocal((p) => ({ ...p, [v.id]: nuevo }));
    marcarFilmado(rodaje, v.id, nuevo).catch((err) => {
      setFilmadosLocal((p) => {
        const n = { ...p };
        delete n[v.id];
        return n;
      });
      toast.error(err instanceof Error ? err.message : "No se pudo marcar");
    });
  };
  const toggleToma = (v: Video, i: number) => {
    const actual = tomasDe(v.id);
    const nuevas = actual.includes(i) ? actual.filter((x) => x !== i) : [...actual, i];
    setTomasLocal((p) => ({ ...p, [v.id]: nuevas }));
    marcarTomas(rodaje, v.id, nuevas).catch(() => toast.error("No se pudo guardar la toma"));
  };
  const toggleLlevar = (i: number) => {
    const nuevas = llevarHecho.includes(i) ? llevarHecho.filter((x) => x !== i) : [...llevarHecho, i];
    setLlevarLocal(nuevas);
    marcarLlevar(rodaje, nuevas).catch(() => toast.error("No se pudo guardar"));
  };
  const armar = async (que: "guiones" | "orden") => {
    setArmando(que);
    try {
      const r = await callApi<{ armados?: number; bloques?: unknown[] }>("/api/ia/rodaje-armar", { rodaje_id: rodaje.id, que });
      toast.success(
        que === "guiones"
          ? r.armados
            ? `Listo: guion y tomas de ${r.armados} video${r.armados === 1 ? "" : "s"}. Revisalos antes del rodaje.`
            : "Ya tenían todos guion y tomas"
          : "Listo: el día quedó ordenado por momento y lugar, con lo que hay que llevar"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "La IA no respondió");
    } finally {
      setArmando(null);
    }
  };
  const abrir = (k: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl gap-0 p-0 sm:max-h-[92dvh]">
          {/* Arriba, siempre a la vista: cuánto va del día. */}
          <div className="sticky top-0 z-10 space-y-2 border-b bg-background/95 px-4 pb-3 pt-4 backdrop-blur sm:px-5">
            <DialogHeader className="space-y-0.5 pr-8 text-left">
              <DialogTitle className="text-base">Hoja de rodaje · {clienteNombre}</DialogTitle>
              <DialogDescription className="text-xs">
                {fechaCorta(rodaje.fecha)} {rodaje.hora ? `· ${rodaje.hora}` : ""} {rodaje.lugar ? `· ${rodaje.lugar}` : ""} · {videos.length} video
                {videos.length === 1 ? "" : "s"}
              </DialogDescription>
            </DialogHeader>
            {videos.length > 1 && (
              <div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold">
                    Filmados {cuenta.si + cuenta.parcial} de {videos.length}
                  </span>
                  <span className="text-muted-foreground">
                    {[cuenta.parcial ? `${cuenta.parcial} a medias` : "", cuenta.no ? `${cuenta.no} no se filmó` : "", videos.length - marcados ? `${videos.length - marcados} sin marcar` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(cuenta.si / videos.length) * 100}%` }} />
                  <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${(cuenta.parcial / videos.length) * 100}%` }} />
                  <div className="h-full bg-red-500/70 transition-all duration-500" style={{ width: `${(cuenta.no / videos.length) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 px-4 py-4 sm:px-5">
            {rodaje.notas && <p className="rounded-lg bg-muted/50 p-2 text-xs">{rodaje.notas}</p>}

            {/* Antes del rodaje: la IA deja todo listo (no hace falta usarlo; es para ahorrar trabajo). */}
            {puedeSubir && esDiaOAntes && rodaje.estado === "agendado" && (videos.length > 1 || sinGuion > 0) && (
              <div className="space-y-2 rounded-2xl border border-primary/30 bg-primary/[0.04] p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Dejalo listo con la IA
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sinGuion > 0 && (
                    <Button size="sm" variant="outline" className="h-auto justify-start whitespace-normal py-2 text-left text-xs" disabled={!!armando} onClick={() => void armar("guiones")}>
                      {armando === "guiones" ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <FileText className="mr-2 h-4 w-4 shrink-0 text-primary" />}
                      <span>
                        <b>Guion y tomas</b> de los {sinGuion} que no tienen
                        <span className="block text-[11px] font-normal text-muted-foreground">Lo que ya está escrito no se toca</span>
                      </span>
                    </Button>
                  )}
                  {videos.length > 2 && (
                    <Button size="sm" variant="outline" className="h-auto justify-start whitespace-normal py-2 text-left text-xs" disabled={!!armando} onClick={() => void armar("orden")}>
                      {armando === "orden" ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <ListOrdered className="mr-2 h-4 w-4 shrink-0 text-primary" />}
                      <span>
                        <b>{rodaje.bloques?.length ? "Volver a ordenar el día" : "Ordenar el día"}</b>
                        <span className="block text-[11px] font-normal text-muted-foreground">Por momento y lugar, y qué llevar</span>
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {conGuion.length > 0 && (
              <Button className="h-11 w-full bg-gradient-to-r from-[#6F40FC] to-[#E040A0] font-semibold text-white shadow-md hover:opacity-95" onClick={() => setCompartir(conGuion)}>
                <Send className="mr-2 h-4 w-4" /> {conGuion.length === 1 ? "Mandar el guion" : `Mandar los ${conGuion.length} guiones`} al cliente
              </Button>
            )}

            {/* Qué llevar: se tilda al cargar el auto. */}
            {(rodaje.llevar?.length ?? 0) > 0 && (
              <div className="rounded-2xl border p-3">
                <button type="button" onClick={() => abrir("llevar")} className="flex w-full items-center gap-2 text-left text-sm font-semibold">
                  <Package className="h-4 w-4 text-primary" /> Qué llevar
                  <span className="text-xs font-normal text-muted-foreground">
                    {llevarHecho.length} de {rodaje.llevar!.length}
                  </span>
                  <ChevronDown className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", !abiertos.has("llevar") && "-rotate-90")} />
                </button>
                {abiertos.has("llevar") && (
                  <div className="mt-2 grid gap-0.5 sm:grid-cols-2">
                    {rodaje.llevar!.map((x, i) => (
                      <label key={i} className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
                        <Checkbox checked={llevarHecho.includes(i)} onCheckedChange={() => toggleLlevar(i)} className="mt-0.5" disabled={!puedeSubir} />
                        <span className={llevarHecho.includes(i) ? "text-muted-foreground line-through" : ""}>{x}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {puedeSubir && videos.length > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3 text-xs">
                <p className="font-medium text-foreground">
                  Material subido: {conMaterial} de {videos.length - cuenta.no} video{videos.length - cuenta.no === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Subí lo que filmaste desde el celular. Cuando esté el material de todos, pasan solos a edición y le avisamos a la editora. Cada uno con su fecha de entrega según el
                  mes en que se publica, así no le cae todo junto. Los que marcás “No se filmó” vuelven a Planificado al terminar.
                </p>
              </div>
            )}

            {grupos.map((g, gi) => (
              <div key={gi} className="space-y-2.5">
                {g.nombre && (
                  <div className="pt-1">
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
                      {rodaje.bloques?.length ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">{gi + 1}</span> : <CalendarDays className="h-3.5 w-3.5" />}
                      {g.nombre}
                      <span className="font-medium normal-case tracking-normal text-muted-foreground">
                        · {g.vids.filter((v) => estadoDe(v.id) === "si" || estadoDe(v.id) === "parcial").length} de {g.vids.length}
                      </span>
                    </p>
                    {g.detalle && <p className="mt-0.5 text-xs text-muted-foreground">{g.detalle}</p>}
                  </div>
                )}
                {g.vids.map((v) => {
                  numero++;
                  const e = estadoDe(v.id);
                  const hechas = tomasDe(v.id);
                  return (
                    <div
                      key={v.id}
                      className={cn(
                        "space-y-2 rounded-xl border p-3 transition-colors",
                        e === "si" && "border-emerald-500/40 bg-emerald-500/[0.04]",
                        e === "parcial" && "border-amber-500/40 bg-amber-500/[0.04]",
                        e === "no" && "border-red-500/30 bg-red-500/[0.03] opacity-80"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold">{numero}</span>
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm font-semibold leading-snug", e === "no" && "line-through")}>{v.titulo}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Se publica en {mesLabel(v.mes).split(" ")[0].toLowerCase()}
                            {v.campania ? ` · ${v.campania}` : ""}
                          </p>
                        </div>
                        {(v.guion?.trim() || v.idea?.trim()) && (
                          <button
                            type="button"
                            onClick={() => setCompartir([v])}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
                            title="Mandar el guion al cliente"
                          >
                            <Send className="h-3 w-3" />
                          </button>
                        )}
                      </div>

                      {/* El día: ¿se filmó? Un toque. */}
                      {puedeSubir && SIN_EDITAR.includes(v.etapa) && (
                        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/50 p-1">
                          {(
                            [
                              ["si", "Filmado", "bg-emerald-600 text-white"],
                              ["parcial", "A medias", "bg-amber-500 text-white"],
                              ["no", "No se filmó", "bg-red-500 text-white"],
                            ] as const
                          ).map(([k, label, activo]) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => filmar(v, k)}
                              className={cn(
                                "h-9 rounded-lg text-xs font-semibold transition-colors",
                                e === k ? cn(activo, "shadow-sm") : "text-muted-foreground hover:bg-background hover:text-foreground"
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                      {puedeSubir && (e === "parcial" || e === "no") && (
                        <NotaFilmado
                          key={`${v.id}:${rodaje.notas_filmado?.[v.id] ?? ""}`}
                          inicial={rodaje.notas_filmado?.[v.id] ?? ""}
                          placeholder={e === "parcial" ? "¿Qué faltó? Ej.: la toma del moño" : "¿Por qué? Ej.: no llegó el parrillero"}
                          onGuardar={(nota) => marcarFilmado(rodaje, v.id, e, nota).catch(() => toast.error("No se pudo guardar la nota"))}
                        />
                      )}

                      {(v.tomas?.length ?? 0) > 0 ? (
                        <div className="space-y-0.5">
                          {v.tomas!.map((t, i) => (
                            <label key={i} className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
                              <Checkbox checked={hechas.includes(i)} onCheckedChange={() => toggleToma(v, i)} className="mt-0.5" disabled={!puedeSubir} />
                              <span className={hechas.includes(i) ? "text-muted-foreground line-through" : ""}>{t}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">Sin lista de tomas todavía.</p>
                      )}

                      <div className="flex flex-wrap gap-1.5">
                        {v.guion?.trim() && (
                          <button type="button" onClick={() => abrir(`g:${v.id}`)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
                            <FileText className="h-3 w-3 text-primary" /> Guion
                            <ChevronDown className={cn("h-3 w-3 transition-transform", abiertos.has(`g:${v.id}`) && "rotate-180")} />
                          </button>
                        )}
                        {v.idea?.trim() && (
                          <button type="button" onClick={() => abrir(`i:${v.id}`)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
                            Idea
                            <ChevronDown className={cn("h-3 w-3 transition-transform", abiertos.has(`i:${v.id}`) && "rotate-180")} />
                          </button>
                        )}
                      </div>
                      {abiertos.has(`g:${v.id}`) && <p className="whitespace-pre-line rounded-lg border bg-muted/30 px-2.5 py-2 text-xs leading-relaxed">{v.guion}</p>}
                      {abiertos.has(`i:${v.id}`) && <p className="rounded-lg border bg-muted/30 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">{v.idea}</p>}

                      {e !== "no" && (
                        <div className="border-t pt-2">
                          {SIN_EDITAR.includes(v.etapa) ? (
                            <>
                              <MaterialSlot video={v} slot="crudo" clienteNombre={clienteNombre} canUpload={puedeSubir} compacto onSubir={onSubir} />
                              {puedeSubir && (v.attachments_crudo?.length ?? 0) > 0 && videos.length > 1 && (
                                <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" disabled={mandando === v.id} onClick={() => setEntregaDe(v)}>
                                  {mandando === v.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                                  Mandar este ya a edición
                                </Button>
                              )}
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Ya pasó a edición
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <CompartirGuion open={!!compartir} onOpenChange={(v) => !v && setCompartir(null)} videos={compartir ?? []} proyectoId={rodaje.proyecto_id} />
      <EntregaEdicionDialog
        video={entregaDe}
        open={!!entregaDe}
        onOpenChange={(v) => !v && setEntregaDe(null)}
        onConfirmar={async (fecha) => {
          if (entregaDe) await mandar(entregaDe, fecha);
        }}
      />
    </>
  );
}

/** Qué faltó de un video (se guarda al salir del cuadro). */
function NotaFilmado({ inicial, placeholder, onGuardar }: { inicial: string; placeholder: string; onGuardar: (nota: string) => void }) {
  const [texto, setTexto] = useState(inicial);
  return (
    <input
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => texto.trim() !== inicial.trim() && onGuardar(texto)}
      placeholder={placeholder}
      maxLength={200}
      className="h-9 w-full rounded-lg border bg-background px-2.5 text-xs outline-none focus:border-primary"
    />
  );
}

/** Tiempo de rodaje (estadística interna): Iniciar al llegar, Terminar al irse. Mientras tanto corre el reloj. */
function CronometroRodaje({ rodaje, puede, onTerminar }: { rodaje: Rodaje; puede: boolean; onTerminar: () => Promise<void> }) {
  const [ahora, setAhora] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const { user } = useUserProfileContext();
  const enCurso = !!rodaje.inicio_at && !rodaje.fin_at;
  useEffect(() => {
    if (!enCurso) return;
    const t = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enCurso]);

  if (rodaje.duracion_min) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        <Timer className="h-3.5 w-3.5" /> Rodaje de {textoDuracionRodaje(rodaje.duracion_min)}
      </p>
    );
  }
  if (!puede || rodaje.estado === "cancelado") return null;
  // Se puede iniciar el día del rodaje (o si quedó atrasado).
  if (!enCurso && rodaje.fecha > hoyISO()) return null;

  const accion = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo");
    } finally {
      setBusy(false);
    }
  };

  if (!enCurso) {
    return (
      <Button
        size="sm"
        className="mt-2 h-9 w-full bg-emerald-600 font-semibold text-white hover:bg-emerald-600/90"
        disabled={busy}
        onClick={() => void accion(() => iniciarRodaje(rodaje, user?.uid ?? ""), "¡A filmar! El tiempo del rodaje empezó a correr")}
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4 fill-current" />}
        Iniciar rodaje
      </Button>
    );
  }
  const seg = Math.max(0, Math.floor((ahora - Date.parse(rodaje.inicio_at!)) / 1000));
  const reloj = [Math.floor(seg / 3600), Math.floor((seg % 3600) / 60), seg % 60].map((n) => String(n).padStart(2, "0")).join(":");
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/[0.07] p-2">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-red-500">Filmando</span>
        <span className="block font-mono text-lg font-bold tabular-nums leading-tight">{reloj}</span>
      </span>
      <Button
        size="sm"
        variant="destructive"
        className="h-9 shrink-0 font-semibold"
        disabled={busy}
        onClick={() => void accion(async () => {
          const min = await terminarRodaje(rodaje);
          toast.message(`Rodaje de ${textoDuracionRodaje(min)}. Subí el crudo de cada video.`);
          await onTerminar();
        }, "Rodaje terminado")}
      >
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />}
        Terminar
      </Button>
    </div>
  );
}
