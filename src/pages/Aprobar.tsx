import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, MessageSquareWarning, PenLine, RotateCcw, Star, Type } from "lucide-react";
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

/** Lo que se lee al lado de las estrellas. */
const ETIQUETAS_RATING = ["", "No me gustó", "Puede mejorar", "Está bien", "Muy bueno", "¡Me encantó!"];

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

  const paraAprobar = !!video && !listo && video.estado === "para_aprobar";

  return (
    <div className="seguro-costados min-h-dvh bg-background text-foreground">
      <header className="safe-area-pt sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="flex h-14 items-center justify-center">
          <img src={asset("/brand/logo-horizontal-blanco.png")} alt="Prodi" className="hidden h-5 w-auto dark:block" />
          <img src={asset("/brand/logo-horizontal-negro.png")} alt="Prodi" className="h-5 w-auto dark:hidden" />
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-xl px-4 pt-6",
          // En el celular deja lugar para la barra de botones fija.
          paraAprobar ? "pb-[calc(7rem+var(--abajo-seguro))] sm:pb-16" : "pb-[calc(4rem+env(safe-area-inset-bottom))]"
        )}
      >
        {!video && !error && (
          <div className="flex flex-col items-center gap-3 py-28 text-sm text-muted-foreground">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Loader2 className="h-6 w-6 animate-spin" />
            </span>
            Abriendo el video…
          </div>
        )}

        {error && !video && <Aviso icon={MessageSquareWarning} tono="error" titulo="No pudimos abrir el video" texto={error} />}

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
          <div className="space-y-5 animate-in fade-in duration-300 motion-reduce:animate-none">
            {/* Cliente, título y una bajada corta. */}
            <div className="space-y-2">
              <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: video.cliente.color }} />
                <span className="truncate">{video.cliente.nombre}</span>
              </span>
              <h1 className="break-words text-[26px] font-bold leading-tight tracking-tight">{video.titulo}</h1>
              {video.estado === "para_aprobar" && (
                <p className="text-sm text-muted-foreground">Miralo tranqui y contanos si va así o querés cambiar algo.</p>
              )}
            </div>

            {video.estado !== "para_aprobar" && (
              <Aviso
                compacto
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
            )}

            {video.final.length > 0 && (
              <div className="space-y-3">
                {video.final.map((f) => {
                  const m = urlMediaPublica(token, f.drive_file_id, f.mime_type);
                  return m.tipo === "video" ? (
                    <video
                      key={f.drive_file_id}
                      src={m.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="max-h-[70dvh] w-full rounded-3xl bg-black shadow-xl shadow-black/10 ring-1 ring-border"
                    />
                  ) : (
                    <img
                      key={f.drive_file_id}
                      src={m.url}
                      alt={f.name}
                      className="w-full rounded-3xl bg-black object-contain shadow-xl shadow-black/10 ring-1 ring-border"
                    />
                  );
                })}
              </div>
            )}

            {video.copy && (
              <section className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Type className="h-3.5 w-3.5" /> Texto de la publicación
                </p>
                <p className="whitespace-pre-wrap break-words rounded-2xl bg-muted/60 p-4 text-[15px] leading-relaxed">{video.copy}</p>
              </section>
            )}

            {video.estado === "para_aprobar" && (
              <>
                {/* Puntaje opcional: estrellas grandes, fáciles de tocar. */}
                <section className="rounded-2xl bg-muted/60 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold">¿Qué te pareció?</p>
                    <p className="text-xs text-muted-foreground">{rating ? ETIQUETAS_RATING[rating] : "Opcional"}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRating(n)}
                        aria-label={`${n} estrellas`}
                        aria-pressed={n <= rating}
                        className={cn(
                          "flex h-12 items-center justify-center rounded-xl transition-all active:scale-90",
                          n <= rating ? "bg-warning/15" : "bg-background shadow-sm hover:bg-background/70"
                        )}
                      >
                        <Star
                          className={cn("h-6 w-6 transition-colors", n <= rating ? "fill-warning text-warning" : "text-muted-foreground/40")}
                        />
                      </button>
                    ))}
                  </div>
                </section>

                {modo === "cambios" && (
                  <section className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
                    <label
                      htmlFor="ap-nota"
                      className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      <PenLine className="h-3.5 w-3.5" /> ¿Qué querés cambiar?
                    </label>
                    <Textarea
                      id="ap-nota"
                      rows={4}
                      autoFocus
                      value={nota}
                      onChange={(e) => setNota(e.target.value)}
                      placeholder="Ej: en el segundo 5 cambiar el texto por…, usar otra música…"
                      className="min-h-[120px] resize-none rounded-2xl border-transparent bg-muted/60 px-4 py-3.5 text-base shadow-none transition-colors focus-visible:border-primary focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0"
                    />
                    <p className="text-xs text-muted-foreground">Cuanto más claro, más rápido te mandamos la nueva versión.</p>
                  </section>
                )}

                {/* Botones: en el celular, barra fija abajo; en la compu, al final de la página. */}
                <div className="fixed inset-x-0 bottom-0 z-20 bg-background/95 px-4 pb-[max(0.75rem,var(--abajo-seguro))] pt-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] backdrop-blur sm:static sm:z-auto sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none">
                  <div className="mx-auto max-w-xl">
                    {error && <p className="mb-2 text-center text-sm font-medium text-destructive animate-in fade-in">{error}</p>}
                    {modo === "ver" ? (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setModo("cambios")}
                          disabled={enviando}
                          className="h-14 flex-1 rounded-2xl border-2 text-base font-semibold"
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Pedir cambios
                        </Button>
                        <Button
                          onClick={() => responder("aprobar")}
                          disabled={enviando}
                          className="h-14 flex-[1.3] rounded-2xl bg-gradient-to-r from-primary to-fuchsia-500 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-95"
                        >
                          {enviando ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                          Aprobar
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => setModo("ver")}
                          disabled={enviando}
                          aria-label="Volver"
                          className="h-14 w-14 shrink-0 rounded-2xl bg-muted/70 hover:bg-muted"
                        >
                          <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <Button
                          onClick={() => responder("cambios")}
                          disabled={enviando || nota.trim().length < 5}
                          className="h-14 flex-1 rounded-2xl text-base font-semibold shadow-lg shadow-primary/25"
                        >
                          {enviando && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                          Enviar cambios
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
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
  compacto,
}: {
  icon: React.ElementType;
  titulo: string;
  texto: string;
  tono?: "ok" | "error";
  /** En fila, para mostrar arriba del video. */
  compacto?: boolean;
}) {
  const chip = cn(
    "flex shrink-0 items-center justify-center",
    tono === "ok" ? "bg-success/15 text-success" : tono === "error" ? "bg-destructive/12 text-destructive" : "bg-primary/12 text-primary"
  );

  if (compacto) {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border p-4",
          tono === "ok" ? "border-success/40 bg-success/[0.08]" : "border-primary/30 bg-primary/[0.06]"
        )}
      >
        <span className={cn(chip, "h-10 w-10 rounded-xl")}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{titulo}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{texto}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-4 pt-14 text-center animate-in fade-in zoom-in-95 duration-500 motion-reduce:animate-none">
      <span className={cn(chip, "h-20 w-20 rounded-full")}>
        <Icon className="h-10 w-10" />
      </span>
      <p className="mt-2 text-[26px] font-bold leading-tight tracking-tight">{titulo}</p>
      <p className="max-w-sm text-[15px] text-muted-foreground">{texto}</p>
    </div>
  );
}
