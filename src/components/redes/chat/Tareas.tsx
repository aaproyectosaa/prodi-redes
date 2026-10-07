import { useState } from "react";
import { CalendarClock, CheckCircle2, Circle, ListTodo, MessageCircle, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { borrarTarea, marcarTarea } from "@/lib/redes/tareas";
import { hoyAR, sumarDias } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import type { Tarea } from "@/lib/redes/types";
import type { Profile } from "@/integrations/firebase/types";

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function venceTexto(f: string): { texto: string; tarde: boolean; hoy: boolean } {
  const hoy = hoyAR();
  if (f < hoy) return { texto: `venció el ${Number(f.slice(8))}/${Number(f.slice(5, 7))}`, tarde: true, hoy: false };
  if (f === hoy) return { texto: "para hoy", tarde: false, hoy: true };
  if (f === sumarDias(hoy, 1)) return { texto: "para mañana", tarde: false, hoy: false };
  const dia = new Date(`${f}T12:00:00Z`).getUTCDay();
  return { texto: `para el ${DIAS[dia]} ${Number(f.slice(8))}/${Number(f.slice(5, 7))}`, tarde: false, hoy: false };
}

/** "Mis tareas": lo que me pidieron (y lo que pedí yo) con @prodi. */
export function TareasSheet({
  open,
  onOpenChange,
  uid,
  profiles,
  mias,
  pedidas,
  onIrAlChat,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  uid: string;
  profiles: Profile[];
  mias: Tarea[];
  pedidas: Tarea[];
  onIrAlChat: (chatId: string) => void;
}) {
  const [tab, setTab] = useState<"mias" | "pedidas">("mias");
  const lista = tab === "mias" ? mias : pedidas;
  const nombre = (id: string) => profiles.find((p) => p.id === id)?.nombre?.split(" ")[0] ?? "alguien";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-primary" /> Tareas
          </SheetTitle>
          <SheetDescription>
            Las deja Prodi cuando le escribís en un chat, por ejemplo: “@prodi recordale a Lucía que mande el guion el viernes”.
          </SheetDescription>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm">
            {(["mias", "pedidas"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn("rounded-lg py-1.5 font-medium", tab === t ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {t === "mias" ? `Para mí${mias.filter((x) => !x.hecha).length ? ` (${mias.filter((x) => !x.hecha).length})` : ""}` : "Pedidas por mí"}
              </button>
            ))}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-mobile-nav md:pb-3">
          {lista.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <Sparkles className="h-8 w-8 opacity-40" />
              {tab === "mias" ? "No tenés tareas pendientes." : "No le pediste tareas a nadie."}
            </div>
          ) : (
            <ul className="space-y-2">
              {lista.slice(0, 60).map((t) => (
                <FilaTarea key={t.id} t={t} uid={uid} nombre={nombre} onIrAlChat={onIrAlChat} />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilaTarea({ t, uid, nombre, onIrAlChat }: { t: Tarea; uid: string; nombre: (id: string) => string; onIrAlChat: (chatId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const v = t.vence ? venceTexto(t.vence) : null;
  const toggle = async () => {
    setBusy(true);
    try {
      await marcarTarea(t.id, !t.hecha, uid);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };
  const para = t.asignados.filter((a) => a !== uid).map(nombre);
  return (
    <li className={cn("flex items-start gap-2.5 rounded-xl border bg-card p-3", t.hecha && "opacity-60")}>
      <button type="button" onClick={() => void toggle()} disabled={busy} className="mt-0.5 shrink-0 text-primary" aria-label={t.hecha ? "Marcar sin hacer" : "Marcar hecha"}>
        {t.hecha ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", t.hecha && "line-through")}>{t.titulo}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {v && !t.hecha && (
            <span className={cn("inline-flex items-center gap-1", v.tarde && "font-semibold text-destructive", v.hoy && "font-semibold text-orange-600")}>
              <CalendarClock className="h-3 w-3" /> {v.texto}
            </span>
          )}
          {t.creada_por !== uid ? <span>pedida por {t.creada_por_nombre?.split(" ")[0] || nombre(t.creada_por)}</span> : para.length > 0 && <span>para {para.join(", ")}</span>}
          {t.chat_id && (
            <button type="button" onClick={() => onIrAlChat(t.chat_id!)} className="inline-flex items-center gap-1 text-primary hover:underline">
              <MessageCircle className="h-3 w-3" /> ver chat
            </button>
          )}
        </p>
      </div>
      {t.creada_por === uid && (
        <button
          type="button"
          onClick={() => void borrarTarea(t.id).catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo borrar"))}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          aria-label="Borrar tarea"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
