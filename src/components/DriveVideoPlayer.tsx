import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Video as VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDriveMediaPlayUrl } from "@/utils/drive/driveMediaUrl";
import {
  logVideo,
  mediaErrorLabel,
  probeDriveMediaUrl,
} from "@/utils/drive/videoDebug";
import { cn } from "@/lib/utils";

interface DriveVideoPlayerProps {
  fileId: string;
  mimeType?: string;
  className?: string;
  poster?: string;
  autoPlay?: boolean;
  /** @deprecated Ya no es el fallback principal; el video se reproduce en la app. */
  webViewLink?: string;
  /** Si true, muestra link externo al fallar. Por defecto false. */
  showExternalFallback?: boolean;
  /** Acceso al <video> (para leer el segundo actual o saltar a un segundo). */
  onVideoEl?: (el: HTMLVideoElement | null) => void;
}

export function DriveVideoPlayer({
  fileId,
  mimeType,
  className,
  poster,
  autoPlay = false,
  webViewLink,
  showExternalFallback = false,
  onVideoEl,
}: DriveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState(false);
  const [debugDetail, setDebugDetail] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPlaybackError(false);
    setDebugDetail(null);
    setSrc(null);

    void (async () => {
      try {
        logVideo("resolve-url:start", { fileId, mimeType, attempt });
        const url = await getDriveMediaPlayUrl(fileId);
        const withBust =
          attempt > 0
            ? `${url}${url.includes("?") ? "&" : "?"}r=${attempt}`
            : url;

        logVideo("resolve-url:built", {
          fileId,
          urlPreview: withBust.replace(/token=[^&]+/, "token=***"),
        });

        const probe = await probeDriveMediaUrl(withBust);
        logVideo("probe:result", { fileId, ...probe });

        if (!active) return;

        if (!probe.ok) {
          const hint =
            probe.status === 404 && import.meta.env.DEV
              ? " En local, el proxy /api debe apuntar a Vercel (VITE_APP_URL) o corré vercel dev."
              : "";
          setDebugDetail(
            `API ${probe.status || "sin respuesta"}: ${probe.error ?? "falló"}${hint}`
          );
          setPlaybackError(true);
          return;
        }

        setSrc(withBust);
      } catch (err) {
        logVideo("resolve-url:error", {
          fileId,
          error: err instanceof Error ? err.message : String(err),
        });
        if (active) {
          setDebugDetail(
            err instanceof Error ? err.message : "No se pudo obtener la URL"
          );
          setPlaybackError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [fileId, mimeType, attempt]);

  useEffect(() => {
    if (!autoPlay || !src) return;
    const el = videoRef.current;
    if (!el) return;
    void el.play().catch((err) => {
      logVideo("autoplay:blocked", {
        fileId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, [autoPlay, src, fileId]);

  const retry = () => setAttempt((n) => n + 1);

  const handleVideoError = () => {
    const el = videoRef.current;
    const code = el?.error?.code;
    const message = el?.error?.message;
    const detail = `video ${mediaErrorLabel(code)}${message ? `: ${message}` : ""}`;
    logVideo("element:error", { fileId, mimeType, code, message, src: src?.slice(0, 80) });
    setDebugDetail(detail);
    setPlaybackError(true);
  };

  if (loading) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 bg-black/5 dark:bg-black/20 rounded-md px-4 text-center",
          className
        )}
      >
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <div className="space-y-1 max-w-xs">
          <p className="text-sm font-medium text-foreground/90">
            Preparando el video…
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            La visualización puede tardar unos segundos. Se reproduce acá, sin
            salir de la app.
          </p>
        </div>
      </div>
    );
  }

  if (playbackError || !src) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 p-4 text-center bg-secondary/40 rounded-md",
          className
        )}
      >
        <VideoIcon className="w-10 h-10 text-muted-foreground" />
        <div className="space-y-1 max-w-xs">
          <p className="text-sm font-medium text-foreground/90">
            Todavía no se pudo cargar el video
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            A veces tarda un poco. Tocá reintentar para verlo acá mismo.
          </p>
          {debugDetail && (
            <p className="text-[10px] text-left font-mono text-muted-foreground/90 break-all pt-1">
              {debugDetail}
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1.5"
          onClick={retry}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reintentar
        </Button>
        {showExternalFallback && webViewLink && (
          <a
            href={webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:underline"
          >
            Abrir archivo
          </a>
        )}
      </div>
    );
  }

  return (
    <video
      ref={(el) => {
        videoRef.current = el;
        onVideoEl?.(el);
      }}
      key={`${fileId}-${attempt}`}
      src={src}
      controls
      playsInline
      preload="metadata"
      poster={poster}
      className={cn(
        "relative z-0 block max-w-full rounded-md object-contain transform-gpu",
        className
      )}
      onError={handleVideoError}
      onLoadedMetadata={() => {
        logVideo("element:metadata", {
          fileId,
          duration: videoRef.current?.duration,
          videoWidth: videoRef.current?.videoWidth,
          videoHeight: videoRef.current?.videoHeight,
        });
      }}
      onLoadedData={(e) => {
        logVideo("element:loaded", { fileId });
        if (!autoPlay) return;
        void e.currentTarget.play().catch((err) => {
          logVideo("autoplay:blocked", {
            fileId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }}
    />
  );
}
