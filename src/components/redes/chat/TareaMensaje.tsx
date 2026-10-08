import { useEffect, useState } from "react";
import { Check, ListTodo, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import UserAvatar from "@/components/UserAvatar";
import { hoyAR, sumarDias } from "@/lib/fecha";
import { PRODI_ID, tareaDesdeMensaje } from "@/lib/redes/chat";
import type { Chat, Mensaje } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";
import { cn } from "@/lib/utils";

/**
 * "Hacer tarea con este mensaje": el texto del mensaje queda como tarea para alguien del chat, con fecha
 * opcional. Le llega el aviso, va a Calendar si tiene fecha y en el chat aparece una línea para todos.
 */
export function TareaMensajeDialog({
  chat,
  m,
  uid,
  perfilDe,
  onOpenChange,
}: {
  chat: Chat;
  m: Mensaje | null;
  uid: string;
  perfilDe: (id: string) => Profile | undefined;
  onOpenChange: (v: boolean) => void;
}) {
  const hoy = hoyAR();
  const [titulo, setTitulo] = useState("");
  const [asignados, setAsignados] = useState<string[]>([]);
  const [vence, setVence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!m) return;
    setTitulo((m.texto || m.leyenda || "").slice(0, 200));
    // Por defecto, para quien mandó el mensaje (si no fui yo ni @prodi); si no, para mí.
    setAsignados([m.by !== uid && m.by !== PRODI_ID && chat.miembros.includes(m.by) ? m.by : uid]);
    setVence(null);
  }, [m, uid, chat.miembros]);
  if (!m) return null;
  const gente = chat.miembros.filter((u) => u !== PRODI_ID);
  const nombre = (u: string) => (u === uid ? "Yo" : perfilDe(u)?.nombre || chat.nombres?.[u] || "Usuario");
  const opciones: { label: string; fecha: string | null }[] = [
    { label: "Sin fecha", fecha: null },
    { label: "Hoy", fecha: hoy },
    { label: "Mañana", fecha: sumarDias(hoy, 1) },
    { label: "En una semana", fecha: sumarDias(hoy, 7) },
  ];
  const toggle = (u: string) => setAsignados((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]));
  const crear = async () => {
    setBusy(true);
    try {
      await tareaDesdeMensaje(chat, m, { titulo: titulo.trim(), asignados, vence });
      toast.success("Tarea creada. Le llega el aviso y la ve en Tareas.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear la tarea");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!m} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md gap-4 rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-primary" /> Hacer tarea
          </DialogTitle>
          <DialogDescription>Queda en Tareas de quien elijas, con aviso. En el chat se ve que la creaste.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Qué hay que hacer</p>
          <Textarea value={titulo} onChange={(e) => setTitulo(e.target.value)} rows={3} maxLength={200} autoFocus />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Para quién</p>
          <div className="flex flex-wrap gap-1.5">
            {gente.map((u) => {
              const sel = asignados.includes(u);
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => toggle(u)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-sm transition-colors",
                    sel ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:border-primary/40"
                  )}
                >
                  <UserAvatar profile={perfilDe(u) ?? ({ id: u, nombre: nombre(u), email: "" } as Profile)} size="sm" />
                  {nombre(u).split(" ")[0]}
                  {sel && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Para cuándo</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {opciones.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setVence(o.fecha)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  vence === o.fecha ? "border-primary bg-primary/10" : "text-muted-foreground hover:border-primary/40"
                )}
              >
                {o.label}
              </button>
            ))}
            <Input type="date" min={hoy} value={vence ?? ""} onChange={(e) => setVence(e.target.value || null)} className="h-8 w-40" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void crear()} disabled={busy || titulo.trim().length < 3 || asignados.length === 0}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear tarea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
