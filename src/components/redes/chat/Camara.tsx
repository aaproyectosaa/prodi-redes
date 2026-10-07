// Sacar una foto con la cámara y mandarla al chat.
// En el celular se usa la cámara del sistema (<input capture>); en la compu, este diálogo con getUserMedia.

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, RotateCcw, Send, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nombreCaptura } from "@/lib/imagen";

/** Celular o tablet: mejor la cámara del sistema. */
export const camaraDelSistema = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function motivo(err: unknown): string {
  const n = (err as { name?: string })?.name;
  if (n === "NotAllowedError" || n === "SecurityError")
    return "No hay permiso para usar la cámara. Habilitalo desde el candado de la barra de direcciones y probá de nuevo.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No encontramos ninguna cámara en este equipo.";
  if (n === "NotReadableError") return "La cámara la está usando otra app (Meet, Zoom…). Cerrala y probá de nuevo.";
  return "No se pudo abrir la cámara.";
}

const MAX = 2560;

export function CamaraDialog({ open, onOpenChange, onFoto }: { open: boolean; onOpenChange: (o: boolean) => void; onFoto: (f: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frente, setFrente] = useState(true);
  const [variasCamaras, setVariasCamaras] = useState(false);
  const [foto, setFoto] = useState<{ file: File; url: string } | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    let s: MediaStream | null = null;
    setError(null);
    setStream(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no deja usar la cámara (hace falta https).");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: frente ? "user" : "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((m) => {
        if (!vivo) return m.getTracks().forEach((t) => t.stop());
        s = m;
        setStream(m);
        if (video.current) video.current.srcObject = m;
        void navigator.mediaDevices
          .enumerateDevices()
          .then((d) => vivo && setVariasCamaras(d.filter((x) => x.kind === "videoinput").length > 1))
          .catch(() => undefined);
      })
      .catch((err) => vivo && setError(motivo(err)));
    return () => {
      vivo = false;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [open, frente, intento]);

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream, foto]);

  // Al cerrar, se suelta la foto.
  useEffect(() => {
    if (!open && foto) {
      URL.revokeObjectURL(foto.url);
      setFoto(null);
    }
  }, [open, foto]);

  const sacar = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const escala = Math.min(1, MAX / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * escala);
    c.height = Math.round(v.videoHeight * escala);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Con la cámara de adelante se ve como espejo; la foto sale igual que la vista previa.
    if (frente) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (b) => {
        if (!b) return;
        const file = new File([b], nombreCaptura("foto", "jpg"), { type: "image/jpeg", lastModified: Date.now() });
        setFoto({ file, url: URL.createObjectURL(b) });
      },
      "image/jpeg",
      0.85
    );
  };

  const repetir = () => {
    if (foto) URL.revokeObjectURL(foto.url);
    setFoto(null);
  };

  const mandar = () => {
    if (!foto) return;
    onFoto(foto.file);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Sacar foto</DialogTitle>
          <DialogDescription>{foto ? "¿La mandás o sacás otra?" : "Encuadrá y tocá el botón para sacar la foto."}</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/90">
              <Camera className="h-8 w-8 opacity-60" />
              <p>{error}</p>
              <Button size="sm" variant="secondary" onClick={() => setIntento((n) => n + 1)}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Probar de nuevo
              </Button>
            </div>
          ) : foto ? (
            <img src={foto.url} alt="Foto sacada" className="h-full w-full object-contain" />
          ) : (
            <>
              <video ref={video} autoPlay playsInline muted className={`h-full w-full object-contain ${frente ? "-scale-x-100" : ""}`} />
              {!stream && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-white/70" />
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          {foto ? (
            <>
              <Button variant="outline" onClick={repetir}>
                <RotateCcw className="mr-1.5 h-4 w-4" /> Sacar otra
              </Button>
              <Button onClick={mandar}>
                <Send className="mr-1.5 h-4 w-4" /> Mandar
              </Button>
            </>
          ) : (
            <>
              {variasCamaras && (
                <Button variant="ghost" size="icon" onClick={() => setFrente((f) => !f)} aria-label="Cambiar de cámara" title="Cambiar de cámara">
                  <SwitchCamera className="h-5 w-5" />
                </Button>
              )}
              <button
                type="button"
                onClick={sacar}
                disabled={!stream}
                aria-label="Sacar foto"
                className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-primary bg-primary/10 transition hover:bg-primary/20 disabled:opacity-40"
              >
                <span className="h-9 w-9 rounded-full bg-primary" />
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
