import { useState } from "react";
import { Check, CheckSquare, FileText, Film, Images, Loader2, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { TaskMediaGallery } from "@/components/media/TaskMediaGallery";
import { asset } from "@/lib/asset";
import { cn } from "@/lib/utils";
import type { DriveAttachmentRef } from "@/integrations/firebase/types";

const miniatura = (id: string) => (id.startsWith("demo/") || id.startsWith("blob:") ? asset(id) : `https://drive.google.com/thumbnail?id=${id}&sz=w480`);
const esVideo = (a: DriveAttachmentRef) => a.mime_type.startsWith("video/");
const esFoto = (a: DriveAttachmentRef) => a.mime_type.startsWith("image/");

function Miniatura({ a }: { a: DriveAttachmentRef }) {
  const [error, setError] = useState(false);
  if (error || (!esVideo(a) && !esFoto(a))) {
    const Icono = esVideo(a) ? Film : esFoto(a) ? Images : FileText;
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-muted-foreground">
        <Icono className="h-6 w-6" />
        <span className="line-clamp-2 break-all text-center text-[10px] leading-tight">{a.name}</span>
      </span>
    );
  }
  return (
    <img
      src={miniatura(a.drive_file_id)}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setError(true)}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
    />
  );
}

/**
 * Material (crudo) como galería: miniaturas en grilla; al tocar una se ve en grande (con el visor de siempre).
 * Con `onQuitar`, "Elegir" permite marcar varios y sacarlos del video (siguen guardados en Drive).
 */
export function GaleriaMaterial({
  attachments,
  driveAvailable,
  onQuitar,
}: {
  attachments: DriveAttachmentRef[];
  driveAvailable: boolean;
  onQuitar?: (atts: DriveAttachmentRef[]) => Promise<void> | void;
}) {
  const [abierto, setAbierto] = useState<number | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState(false);
  const [sacando, setSacando] = useState(false);
  const videos = attachments.filter(esVideo).length;
  const fotos = attachments.filter(esFoto).length;
  const otros = attachments.length - videos - fotos;
  const resumen = [
    videos ? `${videos} ${videos === 1 ? "video" : "videos"}` : null,
    fotos ? `${fotos} ${fotos === 1 ? "foto" : "fotos"}` : null,
    otros ? `${otros} ${otros === 1 ? "archivo" : "archivos"}` : null,
  ].filter(Boolean);

  const salirDeElegir = () => {
    setEligiendo(false);
    setMarcados(new Set());
    setConfirmar(false);
  };
  const tocar = (a: DriveAttachmentRef, i: number) => {
    if (!eligiendo) return setAbierto(i);
    setConfirmar(false);
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(a.drive_file_id)) n.delete(a.drive_file_id);
      else n.add(a.drive_file_id);
      return n;
    });
  };
  const sacar = async () => {
    if (!onQuitar || !marcados.size) return;
    setSacando(true);
    try {
      await onQuitar(attachments.filter((a) => marcados.has(a.drive_file_id)));
      salirDeElegir();
    } finally {
      setSacando(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{attachments.length}</span> · {resumen.join(" · ")}
        </p>
        {onQuitar &&
          (eligiendo ? (
            <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={salirDeElegir}>
              <X className="mr-1 h-4 w-4" /> Listo
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-8 rounded-full text-muted-foreground" onClick={() => setEligiendo(true)}>
              <CheckSquare className="mr-1.5 h-4 w-4" /> Elegir
            </Button>
          ))}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {attachments.map((a, i) => {
          const marcado = marcados.has(a.drive_file_id);
          return (
            <button
              key={a.drive_file_id}
              type="button"
              onClick={() => tocar(a, i)}
              title={a.name}
              aria-label={eligiendo ? `Marcar ${a.name}` : `Ver ${a.name}`}
              aria-pressed={eligiendo ? marcado : undefined}
              className={cn(
                "group relative aspect-square overflow-hidden rounded-2xl bg-muted ring-offset-2 ring-offset-background transition-all active:scale-95",
                marcado && "ring-[3px] ring-destructive"
              )}
            >
              <Miniatura a={a} />
              {/* Degradé abajo con el nombre al pasar el mouse */}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-left text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                <span className="line-clamp-1">{a.name}</span>
              </span>
              {esVideo(a) && (
                <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur">
                  <Play className="h-3 w-3 fill-current" />
                </span>
              )}
              {a.origen === "cliente" && (
                <span className="absolute bottom-1.5 right-1.5 rounded-full bg-violet-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white group-hover:hidden">Cliente</span>
              )}
              {eligiendo && (
                <span
                  className={cn(
                    "absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2",
                    marcado ? "border-destructive bg-destructive text-white" : "border-white/90 bg-black/30"
                  )}
                >
                  {marcado && <Check className="h-3.5 w-3.5" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {eligiendo && marcados.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-destructive/10 p-2 pl-3 text-sm animate-in fade-in">
          <span>
            {confirmar ? "Se sacan del video (quedan guardados en Drive)." : `${marcados.size} ${marcados.size === 1 ? "elegido" : "elegidos"}`}
          </span>
          <Button size="sm" variant="destructive" className="rounded-full" disabled={sacando} onClick={() => (confirmar ? void sacar() : setConfirmar(true))}>
            {sacando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
            {confirmar ? "Sí, sacar" : `Sacar ${marcados.size}`}
          </Button>
        </div>
      )}

      {/* En grande: el visor de siempre, arrancando en el que se tocó. */}
      <Dialog open={abierto !== null} onOpenChange={(o) => !o && setAbierto(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl overflow-hidden rounded-3xl border-0 bg-black p-0">
          <VisuallyHidden>
            <DialogTitle>Material</DialogTitle>
          </VisuallyHidden>
          {abierto !== null && (
            <TaskMediaGallery key={abierto} attachments={attachments} driveAvailable={driveAvailable} inicial={abierto} onQuitar={onQuitar} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
