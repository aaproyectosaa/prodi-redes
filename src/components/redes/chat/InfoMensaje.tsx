import { useEffect, useState, type ReactNode } from "react";
import { CheckCheck, ChevronDown, Clock, Copy, CornerUpRight, ListTodo, Loader2, Pencil, Pin, Reply, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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

/** "Info del mensaje" (como WhatsApp): el mensaje arriba, reacciones, acciones con ícono y quiénes lo vieron. */
export function InfoMensaje({
  chat,
  m,
  uid,
  perfilDe,
  onOpenChange,
  onEditar,
  onResponder,
  onTarea,
  onFijar,
  onReenviar,
  fijado,
  onGuardar,
  guardado,
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
  onFijar?: () => void;
  onReenviar?: () => void;
  fijado?: boolean;
  /** Guardar con ⭐ (o sacarlo de guardados). */
  onGuardar?: () => void;
  guardado?: boolean;
  onReaccionar?: (emoji: string) => void;
}) {
  const [verFaltan, setVerFaltan] = useState(false);
  useEffect(() => setVerFaltan(false), [m?.id]);
  const lecturas = m ? lecturasDe(chat, m.at, m.by).filter((l) => l.uid !== PRODI_ID) : [];
  const vieron = lecturas.filter((l) => l.at).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const faltan = lecturas.filter((l) => !l.at);
  const total = vieron.length + faltan.length;
  const nombre = (id: string) => (id === uid ? "Vos" : perfilDe(id)?.nombre || chat.nombres?.[id] || "Usuario");
  const perfil = (id: string) => perfilDe(id) ?? ({ id, nombre: nombre(id), email: "" } as Profile);
  const mio = m?.by === uid;
  const texto = m ? m.texto || m.leyenda || "Archivo" : "";
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Copiado");
      onOpenChange(false);
    } catch {
      toast.error("No se pudo copiar");
    }
  };
  const acciones: { icono: ReactNode; label: string; onClick: () => void }[] = [
    ...(onResponder ? [{ icono: <Reply className="h-5 w-5" />, label: "Responder", onClick: onResponder }] : []),
    ...(m?.texto ? [{ icono: <Copy className="h-5 w-5" />, label: "Copiar", onClick: () => void copiar() }] : []),
    ...(onTarea ? [{ icono: <ListTodo className="h-5 w-5" />, label: "Tarea", onClick: onTarea }] : []),
    ...(onReenviar ? [{ icono: <CornerUpRight className="h-5 w-5" />, label: "Reenviar", onClick: onReenviar }] : []),
    ...(onFijar ? [{ icono: <Pin className="h-5 w-5" />, label: fijado ? "Desfijar" : "Fijar", onClick: onFijar }] : []),
    ...(onGuardar
      ? [{ icono: <Star className={guardado ? "h-5 w-5 fill-amber-400 text-amber-400" : "h-5 w-5"} />, label: guardado ? "Quitar ⭐" : "Guardar", onClick: onGuardar }]
      : []),
    ...(onEditar ? [{ icono: <Pencil className="h-5 w-5" />, label: "Editar", onClick: onEditar }] : []),
  ];
  const fila = (id: string, extra: ReactNode) => (
    <li key={id} className="flex items-center gap-3 py-2">
      <UserAvatar profile={perfil(id)} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{nombre(id)}</span>
      {extra}
    </li>
  );

  return (
    <Sheet open={!!m} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[88dvh] w-full max-w-lg gap-0 overflow-y-auto rounded-t-3xl border-x border-t px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 sm:bottom-4 sm:rounded-3xl sm:border"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        <SheetTitle className="sr-only">Mensaje</SheetTitle>
        {m && (
          <>
            {/* El mensaje, como se ve en el chat. */}
            <div className={cn("flex", mio ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                  mio ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card"
                )}
              >
                {!mio && <p className="mb-0.5 text-[11px] font-semibold text-primary">{nombre(m.by)}</p>}
                <p className="line-clamp-6 whitespace-pre-wrap break-words">{texto}</p>
                <p className={cn("mt-1 text-right text-[10px]", mio ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {cuandoLargo(m.at)}
                  {m.editado_at && " · editado"}
                </p>
              </div>
            </div>

            {/* Reacciones: tocá para poner o sacar la tuya. */}
            {onReaccionar && (
              <div className="mt-4 flex justify-between gap-1 rounded-full bg-muted/60 p-1.5">
                {REACCIONES.map((e) => {
                  const quienes = m.reacciones?.[e] ?? [];
                  const mia = quienes.includes(uid);
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => onReaccionar(e)}
                      className={cn(
                        "relative flex h-11 w-11 items-center justify-center rounded-full text-2xl transition-transform hover:scale-110 active:scale-90",
                        mia && "bg-primary/20 ring-2 ring-primary/50"
                      )}
                      aria-label={`Reaccionar ${e}`}
                    >
                      {e}
                      {quienes.length > 0 && (
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-background px-1 text-[10px] font-bold ring-1 ring-border">
                          {quienes.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Acciones con ícono. */}
            {acciones.length > 0 && (
              <div className={cn("mt-3 grid gap-2", acciones.length >= 5 || acciones.length === 3 ? "grid-cols-3" : acciones.length === 4 ? "grid-cols-4" : "grid-cols-2")}>
                {acciones.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.onClick}
                    className="flex flex-col items-center gap-1.5 rounded-2xl bg-muted/60 py-3 text-xs font-medium transition-colors hover:bg-muted active:scale-95"
                  >
                    <span className="text-primary">{a.icono}</span>
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            {/* Quiénes lo vieron. */}
            {total > 0 && (
              <div className="mt-4 rounded-2xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <CheckCheck className={cn("h-4 w-4", vieron.length ? "text-primary" : "text-muted-foreground")} />
                    {vieron.length === total ? "Lo vieron todos" : `Lo vieron ${vieron.length} de ${total}`}
                  </p>
                  <div className="flex">
                    {vieron.slice(0, 5).map((l, i) => (
                      <UserAvatar key={l.uid} profile={perfil(l.uid)} size="sm" className={cn("!h-6 !w-6 ring-2 ring-background", i > 0 && "-ml-2")} />
                    ))}
                  </div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((vieron.length / total) * 100)}%` }} />
                </div>
                {vieron.length > 0 && (
                  <ul className="mt-2 divide-y">{vieron.map((l) => fila(l.uid, <span className="shrink-0 text-xs text-muted-foreground">{cuandoLargo(l.at!)}</span>))}</ul>
                )}
                {faltan.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setVerFaltan((v) => !v)}
                      className="mt-1 flex w-full items-center gap-1.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Clock className="h-3.5 w-3.5" /> Sin ver ({faltan.length})
                      <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", verFaltan && "rotate-180")} />
                    </button>
                    {verFaltan && <ul className="divide-y opacity-70">{faltan.map((l) => fila(l.uid, null))}</ul>}
                  </>
                )}
              </div>
            )}
            <p className="mt-2 text-center text-[11px] text-muted-foreground">La hora es la última vez que cada uno abrió el chat.</p>
          </>
        )}
      </SheetContent>
    </Sheet>
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
