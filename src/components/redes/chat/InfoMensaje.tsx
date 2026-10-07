import type { ReactNode } from "react";
import { CheckCheck, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import UserAvatar from "@/components/UserAvatar";
import { lecturasDe, PRODI_ID } from "@/lib/redes/chat";
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
}: {
  chat: ChatT;
  m: Mensaje | null;
  uid: string;
  perfilDe: (id: string) => Profile | undefined;
  onOpenChange: (v: boolean) => void;
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
          <DialogTitle>Info del mensaje</DialogTitle>
          <DialogDescription className="line-clamp-3 whitespace-pre-wrap break-words">
            {m ? `${m.texto || m.leyenda || "Archivo"}` : ""}
          </DialogDescription>
        </DialogHeader>
        {m && (
          <p className="text-xs text-muted-foreground">
            Enviado {cuandoLargo(m.at)}
            {m.by !== uid && ` por ${nombre(m.by)}`}
          </p>
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
