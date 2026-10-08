import { useEffect, useState, type ReactNode } from "react";
import { CheckCheck, Clock, ListTodo, Loader2, Pencil, Reply } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import UserAvatar from "@/components/UserAvatar";
import { editarMensaje, lecturasDe, PRODI_ID, REACCIONES } from "@/lib/redes/chat";
import { fechaAR, formatearFecha, hoyAR } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import type { Chat as ChatT, Mensaje } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";

const cuandoLargo = (iso: string) =>
  fechaAR(iso) === hoyAR()
    ? `hoy ${formatearFecha(iso, { hour: "2-digit", minute: "2-digit" })}`
    : formatearFecha(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Hasta qué mensaje leyó cada miembro (el último mensaje con fecha <= chat.leido[miembro]).
 * Devuelve mensajeId → miembros que llegaron hasta ahí. Sale de chat.leido: nada se escribe por mensaje.
 */
export function vistosHasta(chat: ChatT, mensajes: Mensaje[], uid: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const conBurbuja = mensajes.filter((m) => m.tipo !== "sistema");
  if (!conBurbuja.length) return out;
  for (const miembro of chat.miembros) {
    if (miembro === uid || miembro === PRODI_ID) continue;
    const l = chat.leido?.[miembro];
    if (!l || l < conBurbuja[0].at) continue;
    // Búsqueda binaria del último mensaje con at <= l.
    let lo = 0;
    let hi = conBurbuja.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (conBurbuja[mid].at <= l) lo = mid;
      else hi = mid - 1;
    }
    const id = conBurbuja[lo].id;
    out.set(id, [...(out.get(id) ?? []), miembro]);
  }
  return out;
}

/** Caritas apiladas (máx. 3 + "+N") de quienes leyeron hasta este mensaje, como en Messenger. */
export function Cabecitas({
  ids,
  perfilDe,
  mio,
  onClick,
}: {
  ids: string[];
  perfilDe: (id: string) => Profile | undefined;
  mio: boolean;
  onClick: () => void;
}) {
  if (!ids.length) return null;
  const vistas = ids.slice(0, 3);
  const nombres = ids.map((id) => perfilDe(id)?.nombre?.split(" ")[0] ?? "Alguien");
  const etiqueta = `Visto por ${nombres.join(", ")}`;
  return (
    <div className={cn("mt-0.5 flex", mio ? "justify-end pr-1" : "justify-start pl-9")}>
      <button type="button" onClick={onClick} className="flex items-center rounded-full p-0.5 hover:bg-muted" aria-label={etiqueta} title={etiqueta}>
        {vistas.map((id, i) => {
          const p = perfilDe(id) ?? ({ id, nombre: "", email: "" } as Profile);
          return <UserAvatar key={id} profile={p} size="sm" className={cn("!h-4 !w-4 ring-1 ring-background [&_*]:!text-[7px]", i > 0 && "-ml-1")} />;
        })}
        {ids.length > 3 && <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">+{ids.length - 3}</span>}
      </button>
    </div>
  );
}

/** "Info del mensaje": quiénes lo vieron (y cuándo fue su última lectura) y quiénes todavía no. */
export function InfoMensaje({
  chat,
  m,
  uid,
  perfilDe,
  onOpenChange,
  onEditar,
  onResponder,
  onTarea,
  onReaccionar,
}: {
  chat: ChatT;
  m: Mensaje | null;
  uid: string;
  perfilDe: (id: string) => Profile | undefined;
  onOpenChange: (v: boolean) => void;
  /** Mensaje propio de texto: abre la edición. */
  onEditar?: () => void;
  onResponder?: () => void;
  onTarea?: () => void;
  onReaccionar?: (emoji: string) => void;
}) {
  const lecturas = m ? lecturasDe(chat, m.at, m.by).filter((l) => l.uid !== PRODI_ID) : [];
  const vieron = lecturas.filter((l) => l.at).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const faltan = lecturas.filter((l) => !l.at);
  const nombre = (id: string) => (id === uid ? "Vos" : perfilDe(id)?.nombre || chat.nombres?.[id] || "Usuario");
  const fila = (id: string, extra: ReactNode) => (
    <li key={id} className="flex items-center gap-3 py-1.5">
      <UserAvatar profile={perfilDe(id) ?? ({ id, nombre: nombre(id), email: "" } as Profile)} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm">{nombre(id)}</span>
      {extra}
    </li>
  );
  return (
    <Dialog open={!!m} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm gap-3 rounded-2xl">
        <DialogHeader>
          <DialogTitle>Mensaje</DialogTitle>
          <DialogDescription className="line-clamp-3 whitespace-pre-wrap break-words">
            {m ? `${m.texto || m.leyenda || "Archivo"}` : ""}
          </DialogDescription>
        </DialogHeader>
        {m && (
          <p className="text-xs text-muted-foreground">
            Enviado {cuandoLargo(m.at)}
            {m.by !== uid && ` por ${nombre(m.by)}`}
            {m.editado_at && ` · editado ${cuandoLargo(m.editado_at)}`}
          </p>
        )}
        {m && onReaccionar && (
          <div className="flex justify-between gap-1 rounded-2xl bg-muted/60 p-1.5">
            {REACCIONES.map((e) => {
              const mia = (m.reacciones?.[e] ?? []).includes(uid);
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => onReaccionar(e)}
                  className={cn("flex h-10 w-10 items-center justify-center rounded-full text-xl transition-transform hover:scale-110 active:scale-95", mia && "bg-primary/15 ring-2 ring-primary/40")}
                  aria-label={`Reaccionar ${e}`}
                >
                  {e}
                </button>
              );
            })}
          </div>
        )}
        {(onResponder || onTarea || onEditar) && (
          <div className="grid gap-1.5">
            {onResponder && (
              <Button variant="outline" className="w-full justify-start" onClick={onResponder}>
                <Reply className="mr-2 h-4 w-4" /> Responder
              </Button>
            )}
            {onTarea && (
              <Button variant="outline" className="w-full justify-start" onClick={onTarea}>
                <ListTodo className="mr-2 h-4 w-4" /> Hacer tarea con este mensaje
              </Button>
            )}
            {onEditar && (
              <Button variant="outline" className="w-full justify-start" onClick={onEditar}>
                <Pencil className="mr-2 h-4 w-4" /> Editar mensaje
              </Button>
            )}
          </div>
        )}
        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          <section>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <CheckCheck className="h-3.5 w-3.5" /> Visto ({vieron.length})
            </p>
            {vieron.length ? (
              <ul>{vieron.map((l) => fila(l.uid, <span className="shrink-0 text-xs text-muted-foreground">{cuandoLargo(l.at!)}</span>))}</ul>
            ) : (
              <p className="py-1.5 text-sm text-muted-foreground">Nadie lo vio todavía.</p>
            )}
          </section>
          {faltan.length > 0 && (
            <section>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Sin ver ({faltan.length})
              </p>
              <ul>{faltan.map((l) => fila(l.uid, null))}</ul>
            </section>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">La hora es la última vez que cada uno abrió el chat.</p>
      </DialogContent>
    </Dialog>
  );
}

/** Corregir un mensaje propio: el texto cambia para todos y queda la marca "editado". */
export function EditarMensajeDialog({ chat, m, onOpenChange }: { chat: ChatT; m: Mensaje | null; onOpenChange: (v: boolean) => void }) {
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (m) setTexto(m.texto);
  }, [m]);
  const guardar = async () => {
    if (!m) return;
    setBusy(true);
    try {
      await editarMensaje(chat, m, texto);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo editar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!m} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md gap-3 rounded-2xl">
        <DialogHeader>
          <DialogTitle>Editar mensaje</DialogTitle>
          <DialogDescription>Todos ven el texto nuevo, con la marca «editado».</DialogDescription>
        </DialogHeader>
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void guardar();
            }
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={busy || !texto.trim() || texto.trim() === m?.texto.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
