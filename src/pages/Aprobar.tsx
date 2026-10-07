import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, MessageSquareWarning, RotateCcw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { asset } from "@/lib/asset";
import { callPublico, urlMediaPublica } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

interface VideoPublico {
  id: string;
  titulo: string;
  cliente: { nombre: string; color: string };
  estado: "para_aprobar" | "aprobado" | "en_cambios" | "en_proceso";
  idea: string | null;
  copy: string | null;
  rondas: number;
  final: { drive_file_id: string; name: string; mime_type: string }[];
}

/**
 * Página pública: el cliente abre el link que le llega en el aviso, mira el
 * video y lo aprueba o pide cambios. No necesita usuario ni contraseña.
 */
export default function Aprobar() {
  const { token = "" } = useParams();
  const [video, setVideo] = useState<VideoPublico | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<"ver" | "cambios">("ver");
  const [nota, setNota] = useState("");
  const [rating, setRating] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<null | "aprobado" | "cambios">(null);

  useEffect(() => {
    callPublico<VideoPublico>("/api/publico/video", { t: token })
      .then(setVideo)
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos abrir el video"));
  }, [token]);

  const responder = async (decision: "aprobar" | "cambios") => {
    if (decision === "cambios" && nota.trim().length < 5) return;
    setEnviando(true);
    try {
      await callPublico("/api/publico/responder", { t: token, decision, nota: nota.trim() || null, rating: rating || null });
      setListo(decision === "aprobar" ? "aprobado" : "cambios");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="seguro-costados min-h-dvh bg-background text-foreground">
      <header className="safe-area-pt border-b">
        <div className="flex h-14 items-center justify-center">
          <img src={asset("/brand/logo-horizontal-blanco.png")} alt="Prodi" className="hidden h-5 w-auto dark:block" />
          <img src={asset("/brand/logo-horizontal-negro.png")} alt="Prodi" className="h-5 w-auto dark:hidden" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-6">
        {!video && !error && (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !video && <Aviso icon={MessageSquareWarning} titulo="No pudimos abrir el video" texto={error} />}

        {video && listo === "aprobado" && (
          <Aviso
            icon={CheckCircle2}
            tono="ok"
            titulo="¡Gracias! Video aprobado"
            texto="Ya lo tiene el equipo de pauta: lo publicamos y te avisamos cuando esté en tus redes."
          />
        )}
        {video && listo === "cambios" && (
          <Aviso
            icon={RotateCcw}
            titulo="Recibimos tus cambios"
            texto="Lo corregimos y te mandamos la nueva versión para que la veas."
          />
        )}

        {video && !listo && (
          <>
            <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: video.cliente.color }} />
              {video.cliente.nombre}
            </div>
            <h1 className="text-2xl font-bold leading-tight">{video.titulo}</h1>

            {video.estado !== "para_aprobar" && (
              <div className="mt-6">
                <Aviso
                  icon={video.estado === "aprobado" ? CheckCircle2 : RotateCcw}
                  tono={video.estado === "aprobado" ? "ok" : undefined}
                  titulo={
                    video.estado === "aprobado"
                      ? "Este video ya está aprobado"
                      : video.estado === "en_cambios"
                        ? "Estamos haciendo los cambios que pediste"
                        : "Este video todavía está en proceso"
                  }
                  texto="Te avisamos por mail cuando haya algo nuevo para ver."
                />
              </div>
            )}

            {video.final.length > 0 && (
              <div className="mt-5 space-y-3">
                {video.final.map((f) => {
                  const m = urlMediaPublica(token, f.drive_file_id, f.mime_type);
                  return m.tipo === "video" ? (
                    <video
                      key={f.drive_file_id}
                      src={m.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="max-h-[70dvh] w-full rounded-2xl bg-black"
                    />
                  ) : (
                    <img key={f.drive_file_id} src={m.url} alt={f.name} className="w-full rounded-2xl bg-black object-contain" />
                  );
                })}
              </div>
            )}

            {video.copy && (
              <section className="mt-5">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Texto de la publicación
                </p>
                <p className="whitespace-pre-wrap rounded-xl border bg-card p-3 text-sm">{video.copy}</p>
              </section>
            )}

            {video.estado === "para_aprobar" && (
              <section className="mt-6 space-y-4 rounded-2xl border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">¿Qué te pareció?</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} estrellas`}>
                        <Star
                          className={cn("h-6 w-6", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {modo === "ver" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button size="lg" variant="outline" onClick={() => setModo("cambios")} disabled={enviando}>
                      Pedir cambios
                    </Button>
                    <Button size="lg" onClick={() => responder("aprobar")} disabled={enviando}>
                      {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      Aprobar video
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">¿Qué querés cambiar?</p>
                    <Textarea
                      rows={4}
                      autoFocus
                      value={nota}
                      onChange={(e) => setNota(e.target.value)}
                      placeholder="Ej: en el segundo 5 cambiar el texto por…, usar otra música…"
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setModo("ver")} disabled={enviando}>
                        Volver
                      </Button>
                      <Button onClick={() => responder("cambios")} disabled={enviando || nota.trim().length < 5}>
                        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Enviar cambios
                      </Button>
                    </div>
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Aviso({
  icon: Icon,
  titulo,
  texto,
  tono,
}: {
  icon: React.ElementType;
  titulo: string;
  texto: string;
  tono?: "ok";
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-10 text-center">
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full",
          tono === "ok" ? "bg-success/15 text-success" : "bg-primary/12 text-primary"
        )}
      >
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-lg font-semibold">{titulo}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}
