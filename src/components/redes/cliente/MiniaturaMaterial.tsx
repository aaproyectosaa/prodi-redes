import { useEffect, useState } from "react";
import { FileText, Film, Images, Loader2, Play } from "lucide-react";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import { cn } from "@/lib/utils";

/**
 * Miniatura de un archivo de material: del celular mientras sube (`file`) o ya subido a Drive (`fileId`, se ve con
 * el permiso corto de media-token, así el cliente la ve aunque no tenga acceso al Drive del equipo).
 * De los videos se muestra el primer cuadro.
 */
export function MiniaturaMaterial({
  file,
  fileId,
  mime,
  nombre,
  className,
  children,
}: {
  file?: File;
  fileId?: string;
  mime: string;
  nombre: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const esVideo = mime.startsWith("video/");
  const esFoto = mime.startsWith("image/");

  useEffect(() => {
    if (!esVideo && !esFoto) return;
    if (file) {
      const u = URL.createObjectURL(file);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    if (!fileId) return;
    let vivo = true;
    getDriveMediaPlayUrl(fileId)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [file, fileId, esVideo, esFoto]);

  const Icono = esVideo ? Film : esFoto ? Images : FileText;
  return (
    <div className={cn("relative aspect-square overflow-hidden rounded-xl border bg-muted", className)} title={nombre}>
      {url && !error && esFoto ? (
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setError(true)} />
      ) : url && !error && esVideo ? (
        <>
          {/* Sin reproducir: solo el primer cuadro como miniatura. */}
          <video src={`${url}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover" onError={() => setError(true)} />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
              <Play className="h-3.5 w-3.5 fill-current" />
            </span>
          </span>
        </>
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1.5 text-muted-foreground">
          {!error && (esVideo || esFoto) && fileId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icono className="h-5 w-5" />}
          <span className="line-clamp-2 break-all text-center text-[9px] leading-tight">{nombre}</span>
        </span>
      )}
      {children}
    </div>
  );
}
