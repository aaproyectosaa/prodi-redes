import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown, Loader2, MessageSquareText, Phone, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";
import { AdjuntosEnviados, BotonAdjuntar, ListaAdjuntos, useAdjuntosIA, type AdjuntoIA } from "./AdjuntosIA";
import { destrabarAudio, LlamadaIA } from "./LlamadaIA";

// Charlar con la IA donde se planifica (plan del mes, guion, texto del posteo, preparar el rodaje): pedirle cambios
// o preguntarle cosas con el contexto del cliente. Lo que propone se aplica con un toque; lo que le contás del
// cliente que sirve siempre, lo anota en su memoria (api/_lib/ia-charla.ts). También se puede llamar por voz (LlamadaIA):
// lo que se dice queda escrito acá igual.

export type TipoCharla = "plan" | "guion" | "copy" | "preparar" | "pauta";

interface Mensaje {
  rol: "yo" | "ia";
  texto: string;
  propuesta?: Record<string, unknown> | null;
  recordado?: string | null;
  aplicada?: boolean;
  /** Nombres de los archivos que iban con el mensaje. */
  archivos?: string[];
}

const SUGERENCIAS: Record<TipoCharla, string[]> = {
  plan: ["Más ideas de venta directa", "Sumá una para una fecha especial del mes", "¿Por qué elegiste estas?", "Que ninguna muestre precios"],
  guion: ["Hacelo más corto", "Más divertido", "Que el gancho sea una pregunta", "¿Qué cambiarías para que venda más?"],
  copy: ["Más corto", "Con más emojis", "Más formal", "Que invite a escribir por WhatsApp"],
  preparar: ["Más corto", "Sumá que traigan los productos nuevos", "Más amable"],
  pauta: ["¿Qué hago esta semana?", "¿Qué anuncio rinde mejor?", "¿Cómo estamos contra otros del rubro?", "Resumen para el cliente"],
};

const PLACEHOLDER: Record<TipoCharla, string> = {
  plan: "Ej.: este mes tienen promo 2x1 los martes, sumá una idea con eso",
  guion: "Ej.: que lo diga la dueña y que mencione el delivery",
  copy: "Ej.: que sea más corto y mencione el envío gratis",
  preparar: "Ej.: que tengan listos los 3 sabores nuevos",
  pauta: "Ej.: ¿subo el presupuesto de la campaña de ventas?",
};

export function ChatIA({
  tipo,
  proyectoId,
  mes,
  videoId,
  videoIds,
  actual,
  renderPropuesta,
  titulo = "Pedile a la IA",
  className,
}: {
  tipo: TipoCharla;
  proyectoId: string;
  mes?: string;
  videoId?: string;
  videoIds?: string[];
  /** Lo que está en pantalla ahora (aunque no esté guardado). */
  actual: () => unknown;
  /** Cómo se muestra lo que propone y cómo se aplica (`listo` lo marca como aplicado). */
  renderPropuesta: (p: Record<string, unknown>, listo: () => void) => React.ReactNode;
  titulo?: string;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [llamada, setLlamada] = useState(false);
  // La charla se pliega desde el título (queda solo el renglón para escribir o la llamada).
  const [plegado, setPlegado] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  // La llamada manda mensajes desde sus propios eventos: siempre con la charla al día.
  const mensajesRef = useRef<Mensaje[]>([]);
  mensajesRef.current = mensajes;
  // Fotos, capturas y PDF (la de pauta no los lee).
  const adj = useAdjuntosIA();
  const conAdjuntos = tipo !== "pauta";

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [mensajes.length, enviando]);

  /** Manda un mensaje y devuelve lo que contestó la IA (null si falló). `voz`: viene de la llamada (respuesta corta). */
  const enviar = async (pedido?: string, voz = false): Promise<string | null> => {
    const conArchivos = !voz && conAdjuntos && adj.archivos.length > 0;
    const t = (pedido ?? texto).trim() || (conArchivos ? "Te mando esto: miralo y usalo." : "");
    if (!t || (enviando && !voz)) return null;
    let adjuntos: AdjuntoIA[] = [];
    const elegidos = adj.archivos;
    if (conArchivos) {
      try {
        adjuntos = await adj.preparar();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudieron preparar los archivos");
        return null;
      }
    }
    const nuevos: Mensaje[] = [...mensajesRef.current, { rol: "yo", texto: t, ...(adjuntos.length ? { archivos: adjuntos.map((a) => a.nombre) } : {}) }];
    mensajesRef.current = nuevos;
    setMensajes(nuevos);
    if (!voz) setTexto("");
    setEnviando(true);
    try {
      const r = await callApi<{ respuesta: string; propuesta: Record<string, unknown> | null; recordado: string | null }>(tipo === "pauta" ? "/api/ia/pauta-chat" : "/api/ia/charla", {
        tipo,
        proyecto_id: proyectoId,
        ...(mes ? { mes } : {}),
        ...(videoId ? { video_id: videoId } : {}),
        ...(videoIds ? { video_ids: videoIds } : {}),
        actual: actual(),
        mensajes: nuevos.map((m) => ({ rol: m.rol, texto: m.texto })),
        ...(voz ? { voz: true } : {}),
        ...(adjuntos.length ? { adjuntos } : {}),
      });
      setMensajes((prev) => [...prev, { rol: "ia", texto: r.respuesta, propuesta: r.propuesta, recordado: r.recordado }]);
      return r.respuesta;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no respondió");
      setMensajes((prev) => prev.slice(0, -1));
      if (!voz) setTexto(t);
      if (adjuntos.length) adj.sumar(elegidos);
      return null;
    } finally {
      setEnviando(false);
    }
  };

  const llamar = () => {
    // En el mismo toque: así después el navegador deja sonar las respuestas.
    destrabarAudio();
    setAbierto(true);
    setLlamada(true);
  };

  if (!abierto) {
    return (
      <div className={cn("flex items-stretch gap-2", className)}>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/[0.03] px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/[0.07]"
        >
          <MessageSquareText className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{titulo}: pedile cambios o preguntale lo que quieras</span>
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
        </button>
        <button
          type="button"
          onClick={llamar}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-fuchsia-500 px-3 text-xs font-semibold text-white shadow-md shadow-primary/25 transition-transform hover:-translate-y-0.5"
          title={`Hablar por voz con ${titulo}`}
        >
          <Phone className="h-3.5 w-3.5" /> Llamar
        </button>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-primary/30 bg-card", className)}>
      <div className="flex items-center gap-2 border-b bg-primary/[0.05] px-3 py-2">
        <MessageSquareText className="h-4 w-4 text-primary" />
        <button
          type="button"
          onClick={() => setPlegado((v) => !v)}
          aria-expanded={!plegado}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold"
          title={plegado ? "Ver la charla" : "Plegar la charla"}
        >
          <span className="truncate">{titulo}</span>
          {plegado && mensajes.length > 0 && (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {mensajes.length} mensaje{mensajes.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground">
            {plegado ? "Ver charla" : "Ocultar"}
            <ChevronDown className={cn("h-3 w-3 transition-transform", !plegado && "rotate-180")} />
          </span>
        </button>
        {!llamada && (
          <button
            type="button"
            onClick={llamar}
            className="flex items-center gap-1 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-2.5 py-1 text-[11px] font-semibold text-white"
            title={`Hablar por voz con ${titulo}`}
          >
            <Phone className="h-3 w-3" /> Llamar
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setLlamada(false);
            setAbierto(false);
          }}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted"
          aria-label="Cerrar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!plegado && (
      <div className="max-h-[22rem] space-y-2.5 overflow-y-auto p-3 animate-in fade-in slide-in-from-top-1 duration-150">
        {mensajes.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Ya sabe todo lo del cliente (marca, productos, lo que aprendió). Contale lo que le falta o pedile cambios{conAdjuntos ? " (también le podés mandar fotos, capturas o PDF)" : ""}. Si le contás algo que sirve siempre, lo anota.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGERENCIAS[tipo].map((s) => (
                <button key={s} type="button" onClick={() => void enviar(s)} className="rounded-full border px-2.5 py-1 text-[11px] hover:border-primary hover:text-primary">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {mensajes.map((m, i) =>
          m.rol === "yo" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-xs text-primary-foreground">
              {m.texto}
              <AdjuntosEnviados nombres={m.archivos} claro />
            </div>
          ) : (
            <div key={i} className="max-w-[95%] space-y-2">
              <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-xs leading-relaxed">{m.texto}</div>
              {m.recordado && (
                <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                  <Brain className="h-3 w-3" /> Anotado para este cliente: {m.recordado}
                </p>
              )}
              {m.propuesta && (
                <div className={cn("rounded-xl border p-2", m.aplicada ? "border-emerald-500/40 bg-emerald-500/[0.05]" : "border-primary/30 bg-primary/[0.03]")}>
                  {m.aplicada ? (
                    <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">✓ Aplicado</p>
                  ) : (
                    renderPropuesta(m.propuesta, () => setMensajes((prev) => prev.map((x, j) => (j === i ? { ...x, aplicada: true } : x))))
                  )}
                </div>
              )}
            </div>
          )
        )}
        {enviando && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
          </div>
        )}
        <div ref={fin} />
      </div>
      )}

      {llamada ? (
        <div className="border-t p-2">
          <LlamadaIA titulo={titulo} onDecir={(t) => enviar(t, true)} onCortar={() => setLlamada(false)} />
        </div>
      ) : (
      <div className="space-y-2 border-t p-2" {...(conAdjuntos ? adj.alSoltar : {})}>
      {conAdjuntos && <ListaAdjuntos adj={adj} />}
      <div className="flex items-end gap-2">
        {conAdjuntos && <BotonAdjuntar adj={adj} className="h-9 w-9" disabled={enviando} />}
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          onPaste={conAdjuntos ? adj.alPegar : undefined}
          rows={1}
          placeholder={PLACEHOLDER[tipo]}
          className="min-h-9 resize-none text-xs"
          maxLength={1500}
        />
        <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => void enviar()} disabled={(!texto.trim() && !adj.archivos.length) || enviando} aria-label="Mandar">
          <Send className="h-4 w-4" />
        </Button>
      </div>
      </div>
      )}
    </div>
  );
}

/** Botón "Aplicar" de una propuesta. */
export function BotonAplicar({ onClick, children = "Aplicar" }: { onClick: () => void | Promise<void>; children?: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      className="h-7 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudo aplicar");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {children}
    </Button>
  );
}
