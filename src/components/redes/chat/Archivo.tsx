import { useEffect, useState } from "react";
import { AlertCircle, Download, File as FileIcon, FileText, Loader2, Play, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DriveVideoPlayer } from "@/components/DriveVideoPlayer";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import { cancelarSubida, reintentarSubida, type SubidaChat } from "@/lib/redes/chatArchivos";
import { cn } from "@/lib/utils";
import type { ArchivoChat } from "@/lib/redes/types";

export function peso(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// El permiso para ver un archivo dura 1 hora: se reusa un rato para no pedirlo en cada render.
const cacheUrls = new Map<string, { url: string; hasta: number }>();
async function urlArchivo(fileId: string): Promise<string> {
  const hit = cacheUrls.get(fileId);
  if (hit && hit.hasta > Date.now()) return hit.url;
  const url = await getDriveMediaPlayUrl(fileId);
  cacheUrls.set(fileId, { url, hasta: Date.now() + 45 * 60_000 });
  return url;
}

async function descargar(a: ArchivoChat) {
  const link = document.createElement("a");
  link.href = await urlArchivo(a.drive_file_id);
  link.download = a.name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Los formatos que el navegador muestra y el servidor deja ver en línea (sin HEIC ni SVG).
const IMG_EN_LINEA = /^image\/(png|jpeg|webp|gif|avif)$/;

/** Archivo de un mensaje: foto en línea, video con el reproductor de siempre, el resto como tarjeta para bajar. */
export function ArchivoMensaje({ archivo, mio }: { archivo: ArchivoChat; mio: boolean }) {
  const mime = archivo.mime_type || "";
  if (IMG_EN_LINEA.test(mime) && !archivo.documento) return <Imagen archivo={archivo} mio={mio} />;
  if (mime.startsWith("video/")) return <VideoChat archivo={archivo} />;
  return <Tarjeta archivo={archivo} mio={mio} />;
}

function Imagen({ archivo, mio }: { archivo: ArchivoChat; mio: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [grande, setGrande] = useState(false);
  useEffect(() => {
    let vivo = true;
    urlArchivo(archivo.drive_file_id)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [archivo.drive_file_id]);
  if (error) return <Tarjeta archivo={archivo} mio={mio} />;
  // PNG/WebP/GIF pueden ser transparentes: sobre cuadritos claros se ven tal cual (no sobre el globo oscuro).
  const transparente = /png|webp|gif/i.test(archivo.mime_type);
  return (
    <>
      <button
        type="button"
        onClick={() => url && setGrande(true)}
        className={cn("-mx-1.5 -mt-0.5 block overflow-hidden rounded-xl", transparente ? "fondo-transparencia" : "bg-black/5")}
        aria-label={`Ver ${archivo.name}`}
      >
        {url ? (
          <img src={url} alt={archivo.name} loading="lazy" onError={() => setError(true)} className={cn("max-h-72 w-full min-w-[160px]", transparente ? "object-contain" : "object-cover")} />
        ) : (
          <div className="flex h-44 w-56 max-w-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin opacity-60" />
          </div>
        )}
      </button>
      <Dialog open={grande} onOpenChange={setGrande}>
        <DialogContent className="max-w-[min(96vw,1100px)] border-0 bg-black/95 p-2">
          <DialogTitle className="sr-only">{archivo.name}</DialogTitle>
          {url && <img src={url} alt={archivo.name} className={cn("mx-auto max-h-[80vh] w-auto rounded-md object-contain", transparente && "fondo-transparencia")} />}
          <div className="flex items-center justify-between gap-2 px-1 pt-1 text-xs text-white/80">
            <span className="truncate">{archivo.name}</span>
            <button type="button" onClick={() => void descargar(archivo).catch(() => toast.error("No se pudo descargar"))} className="inline-flex items-center gap-1 hover:text-white">
              <Download className="h-3.5 w-3.5" /> Descargar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VideoChat({ archivo }: { archivo: ArchivoChat }) {
  // El video se prepara recién al tocar play (en un chat con muchos videos no se cargan todos).
  const [ver, setVer] = useState(false);
  if (ver) {
    return (
      <div className="-mx-1.5 -mt-0.5 overflow-hidden rounded-xl bg-black">
        <DriveVideoPlayer fileId={archivo.drive_file_id} mimeType={archivo.mime_type} autoPlay className="max-h-80 w-full min-h-[180px] min-w-[220px]" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setVer(true)}
      className="-mx-1.5 -mt-0.5 flex h-44 w-60 max-w-full flex-col items-center justify-center gap-2 rounded-xl bg-black/80 text-white"
      aria-label={`Reproducir ${archivo.name}`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20">
        <Play className="ml-0.5 h-6 w-6 fill-white" />
      </span>
      <span className="max-w-[90%] truncate text-[11px] opacity-80">
        {archivo.name} · {peso(archivo.size)}
      </span>
    </button>
  );
}

function Tarjeta({ archivo, mio }: { archivo: ArchivoChat; mio: boolean }) {
  const [bajando, setBajando] = useState(false);
  const pdf = archivo.mime_type === "application/pdf" || /\.pdf$/i.test(archivo.name);
  const Icono = pdf ? FileText : FileIcon;
  const bajar = async () => {
    setBajando(true);
    try {
      await descargar(archivo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar");
    } finally {
      setBajando(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void bajar()}
      disabled={bajando}
      className={cn(
        "-mx-1 flex w-60 max-w-full items-center gap-2.5 rounded-xl p-2 text-left",
        mio ? "bg-white/15 hover:bg-white/25" : "bg-muted/60 hover:bg-muted"
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", mio ? "bg-white/20" : pdf ? "bg-red-500/10 text-red-600" : "bg-primary/10 text-primary")}>
        <Icono className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{archivo.name}</span>
        <span className={cn("block text-[11px]", mio ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {archivo.size > 0 ? peso(archivo.size) : "Archivo"} · Descargar
        </span>
      </span>
      {bajando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0 opacity-70" />}
    </button>
  );
}

/** Burbuja de un archivo que se está subiendo (con progreso, cancelar y reintentar). */
export function SubidaBurbuja({ s }: { s: SubidaChat }) {
  const error = s.estado === "error";
  return (
    <div className="flex justify-end">
      <div className={cn("w-64 max-w-[82%] rounded-2xl rounded-br-md px-3 py-2 text-sm shadow-sm", error ? "border border-destructive/40 bg-destructive/5" : "bg-primary text-primary-foreground")}>
        {s.previa ? (
          <img src={s.previa} alt="" className={cn("-mx-1 mb-1.5 max-h-48 w-[calc(100%+0.5rem)] rounded-xl object-cover", !error && "opacity-70")} />
        ) : (
          <div className="mb-1 flex items-center gap-2">
            <FileIcon className="h-4 w-4 shrink-0" />
            <span className="truncate font-medium">{s.nombre}</span>
          </div>
        )}
        {error ? (
          <div className="space-y-1.5">
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {s.error ?? "No se pudo subir"}
            </p>
            <div className="flex justify-end gap-1">
              <button type="button" onClick={() => cancelarSubida(s.id)} className="rounded-full px-2.5 py-1 text-xs hover:bg-muted">
                Descartar
              </button>
              <button type="button" onClick={() => reintentarSubida(s.id)} className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                <RotateCw className="h-3 w-3" /> Reintentar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${s.estado === "listo" ? 100 : Math.max(3, s.progreso)}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right text-[10px] opacity-80">
              {s.estado === "listo" ? "Enviado" : `${s.progreso}% · ${peso(s.size)}`}
            </span>
            {s.estado === "subiendo" && (
              <button type="button" onClick={() => cancelarSubida(s.id)} className="rounded-full p-0.5 hover:bg-white/20" aria-label="Cancelar">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {s.leyenda && <p className="mt-1 whitespace-pre-wrap break-words">{s.leyenda}</p>}
      </div>
    </div>
  );
}
