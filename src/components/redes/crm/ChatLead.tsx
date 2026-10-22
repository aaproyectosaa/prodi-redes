import { useCallback, useEffect, useRef, useState } from "react";
import { Instagram, Loader2, MessageCircle, Paperclip, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

// La conversación de un lead que llegó por Instagram o Messenger, para leerla y contestarle desde el CRM
// (api/_lib/meta-leads.ts). Se actualiza sola cada 15 segundos mientras está abierta.

interface Mensaje {
  id: string;
  texto: string;
  adjunto: boolean;
  at: string;
  mio: boolean;
}
interface Conversacion {
  plataforma: string;
  mensajes: Mensaje[];
  puede_responder: boolean;
  vence: string | null;
}

const hora = (at: string) => {
  const d = new Date(at);
  const hoy = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("es-AR", hoy ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function ChatLead({ leadId, usuario }: { leadId: string; usuario?: string }) {
  const [conv, setConv] = useState<Conversacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [cargando, setCargando] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const cantidad = useRef(0);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await callApi<Conversacion>("/api/web/meta-conversacion", { id: leadId });
      setConv(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo traer la conversación");
    } finally {
      setCargando(false);
    }
  }, [leadId]);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => document.visibilityState === "visible" && void cargar(), 15_000);
    return () => clearInterval(t);
  }, [cargar]);

  // Al llegar un mensaje nuevo, baja hasta el final.
  useEffect(() => {
    const n = conv?.mensajes.length ?? 0;
    if (n !== cantidad.current) fin.current?.scrollIntoView({ block: "end" });
    cantidad.current = n;
  }, [conv]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      await callApi("/api/web/meta-responder", { id: leadId, texto: t });
      setTexto("");
      // Se ve al toque y después se confirma con lo que diga Meta.
      setConv((c) => (c ? { ...c, mensajes: [...c.mensajes, { id: `local-${Date.now()}`, texto: t, adjunto: false, at: new Date().toISOString(), mio: true }] } : c));
      setTimeout(() => void cargar(), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setEnviando(false);
    }
  };

  const red = conv?.plataforma === "messenger" ? "Messenger" : "Instagram";
  const IconoRed = conv?.plataforma === "messenger" ? MessageCircle : Instagram;
  const appLink = conv?.plataforma === "messenger" ? "https://business.facebook.com/latest/inbox" : usuario ? `https://ig.me/m/${usuario.replace(/^@/, "")}` : "https://www.instagram.com/direct/inbox/";

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border bg-muted/30">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-orange-400 text-white">
          <IconoRed className="h-3.5 w-3.5" />
        </span>
        <p className="flex-1 text-sm font-semibold">Chat por {red}</p>
        <button type="button" onClick={() => void cargar()} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Actualizar" aria-label="Actualizar">
          <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {!conv && !error && (
          <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Trayendo la conversación…
          </p>
        )}
        {error && <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>}
        {conv?.mensajes.map((m) => (
          <div key={m.id} className={cn("flex", m.mio ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm leading-snug",
                m.mio ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card"
              )}
            >
              {m.texto ? <span className="whitespace-pre-wrap break-words">{m.texto}</span> : null}
              {m.adjunto && (
                <span className={cn("flex items-center gap-1 text-xs", m.texto ? "mt-1 opacity-80" : "")}>
                  <Paperclip className="h-3 w-3" /> Archivo (miralo en {red})
                </span>
              )}
              <span className={cn("mt-0.5 block text-right text-[10px]", m.mio ? "text-primary-foreground/70" : "text-muted-foreground")}>{hora(m.at)}</span>
            </div>
          </div>
        ))}
        {conv && conv.mensajes.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Todavía no hay mensajes.</p>}
        <div ref={fin} />
      </div>

      <div className="border-t bg-card p-2">
        {conv && !conv.puede_responder ? (
          <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            Pasaron más de 24 h desde su último mensaje: Meta no deja responder desde acá.{" "}
            <a href={appLink} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
              Contestale desde {red}
            </a>
            .
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={1}
              placeholder={`Responder por ${red}…`}
              className="max-h-32 min-h-[40px] resize-none rounded-xl text-sm"
              disabled={!conv}
            />
            <Button size="icon" className="h-10 w-10 shrink-0 rounded-full" onClick={() => void enviar()} disabled={!texto.trim() || enviando || !conv} aria-label="Enviar">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
