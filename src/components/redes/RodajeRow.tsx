import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardList, Loader2, MapPin, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ClienteTag } from "@/components/redes/ClienteTag";
import { useOpenVideo } from "@/components/redes/VideoCard";
import { MaterialSlot } from "@/components/redes/MaterialSlot";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { useDriveUploadContext } from "@/contexts/drive-upload-context";
import { fechaCorta, hoyISO } from "@/lib/redes/format";
import { enviarAEdicion, marcarRodajeRealizado } from "@/lib/redes/videos";
import type { Rodaje, Video } from "@/lib/redes/types";

const SIN_EDITAR = ["planificado", "agendado"];

export function RodajeRow({
  rodaje,
  onEdit,
  onDone,
}: {
  rodaje: Rodaje;
  onEdit?: () => void;
  onDone?: () => void;
}) {
  const { clienteById, videos } = useRedes();
  const openVideo = useOpenVideo();
  const cliente = clienteById(rodaje.proyecto_id);
  const vids = videos.filter((v) => rodaje.video_ids.includes(v.id));
  const esHoy = rodaje.fecha === hoyISO();
  const [hoja, setHoja] = useState(false);
  const { user, role } = useUserProfileContext();
  const { jobs } = useDriveUploadContext();
  const puedeSubir = role === "admin" || role === "productor";

  // Cuando se sube el material del último video de la jornada, todo pasa solo a edición
  // (y edición recibe el aviso). Solo si el material se subió desde esta hoja, en esta sesión.
  const subioAca = useRef(false);
  const enviando = useRef(false);
  const ids = vids.map((v) => v.id);
  const subiendo = jobs.some((j) => ids.includes(j.taskId) && j.slot === "crudo" && (j.status === "queued" || j.status === "uploading"));
  const todosConMaterial = vids.length > 0 && vids.every((v) => (v.attachments_crudo?.length ?? 0) > 0);
  const pendientes = vids.filter((v) => SIN_EDITAR.includes(v.etapa));
  useEffect(() => {
    if (!subioAca.current || enviando.current || subiendo || !todosConMaterial || pendientes.length === 0) return;
    enviando.current = true;
    void (async () => {
      try {
        for (const v of pendientes) await enviarAEdicion(v, cliente, user?.uid ?? "");
        if (rodaje.estado === "agendado") await marcarRodajeRealizado(rodaje);
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
  return (
    <div className={`rounded-xl border bg-card p-3 ${esHoy ? "border-primary/50 bg-primary/[0.04]" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-muted py-1.5">
          <span className="text-[10px] uppercase text-muted-foreground">
            {new Date(`${rodaje.fecha}T12:00:00`).toLocaleDateString("es-AR", { month: "short" })}
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
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onDone}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Realizado
                </Button>
              )}
            </>
          )}
          </div>
        </div>
      </div>
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

/** Lo que hay que filmar en la jornada, para tener en el celular durante el rodaje. */
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
  const [hechas, setHechas] = useState<Set<string>>(new Set());
  const [mandando, setMandando] = useState<string | null>(null);
  const conMaterial = videos.filter((v) => (v.attachments_crudo?.length ?? 0) > 0).length;
  const mandar = async (v: Video) => {
    setMandando(v.id);
    try {
      await enviarAEdicion(v, clienteById(v.proyecto_id), user?.uid ?? "");
      toast.success("Enviado a edición");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo mandar");
    } finally {
      setMandando(null);
    }
  };
  const toggle = (k: string) =>
    setHechas((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hoja de rodaje · {clienteNombre}</DialogTitle>
          <DialogDescription>
            {fechaCorta(rodaje.fecha)} {rodaje.hora ? `· ${rodaje.hora}` : ""} {rodaje.lugar ? `· ${rodaje.lugar}` : ""}
          </DialogDescription>
        </DialogHeader>
        {rodaje.notas && <p className="rounded-lg bg-muted/50 p-2 text-xs">{rodaje.notas}</p>}
        {puedeSubir && videos.length > 0 && (
          <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3 text-xs">
            <p className="font-medium text-foreground">
              Material subido: {conMaterial} de {videos.length} video{videos.length === 1 ? "" : "s"}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(conMaterial / videos.length) * 100}%` }} />
            </div>
            <p className="mt-2 text-muted-foreground">
              Subí lo que filmaste desde el celular. Cuando esté el material de todos, pasan solos a edición y le avisamos a la editora.
            </p>
          </div>
        )}
        <div className="space-y-5">
          {videos.map((v) => (
            <div key={v.id} className="space-y-2 rounded-xl border p-3">
              <p className="text-sm font-semibold">{v.titulo}</p>
              {v.idea && <p className="text-xs text-muted-foreground">{v.idea}</p>}
              {(v.tomas?.length ?? 0) > 0 ? (
                <div className="space-y-1">
                  {v.tomas!.map((t, i) => {
                    const k = `${v.id}:${i}`;
                    return (
                      <label key={k} className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
                        <Checkbox checked={hechas.has(k)} onCheckedChange={() => toggle(k)} className="mt-0.5" />
                        <span className={hechas.has(k) ? "text-muted-foreground line-through" : ""}>{t}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
                  Sin lista de tomas. Abrí el video y tocá “Armar con IA”.
                </p>
              )}
              <div className="border-t pt-2">
                {SIN_EDITAR.includes(v.etapa) ? (
                  <>
                    <MaterialSlot
                      video={v}
                      slot="crudo"
                      clienteNombre={clienteNombre}
                      canUpload={puedeSubir}
                      compacto
                      onSubir={onSubir}
                    />
                    {puedeSubir && (v.attachments_crudo?.length ?? 0) > 0 && videos.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-7 px-2 text-xs"
                        disabled={mandando === v.id}
                        onClick={() => void mandar(v)}
                      >
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
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
