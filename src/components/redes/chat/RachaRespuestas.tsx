import { useEffect, useState } from "react";
import { Award, Clock, Flame, ShieldCheck, Target } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { callApi } from "@/lib/redes/api";
import { enModoVista } from "@/lib/redes/vistaComo";
import { cn } from "@/lib/utils";

// Racha de respuestas a los clientes (ver api/_lib/racha.ts). Es un indicador de atención al cliente de Prodi:
// no mide horas ni horarios de nadie, no resta y no afecta lo que cobra cada uno. Cada uno ve solo lo suyo.

export interface RachaPersona {
  uid: string;
  nombre: string;
  racha: number;
  mejor: number;
  promedio: number | null;
  aTiempo: number | null;
  casos: number;
  ultimos: { fecha: string; estado: "ok" | "falla" | "sin" }[];
  comodinUsado: boolean;
}
export interface RachaCliente {
  id: string;
  nombre: string;
  promedio: number | null;
  aTiempo: number | null;
  casos: number;
}
interface Respuesta {
  yo: RachaPersona;
  personas?: RachaPersona[];
  clientes?: RachaCliente[];
}

export const MEDALLAS = [5, 10, 20, 50];
export const AVISO_LEGAL = "Indicador de atención al cliente de Prodi. No mide horas de trabajo ni afecta lo que cobrás.";

/** "45 min", "1 h 20 min". */
export function minutosTexto(m: number | null): string {
  if (m == null) return "—";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

// Se pide una vez cada 10 minutos (lo comparten la lista de chats y Reportes).
let cache: { at: number; datos: Respuesta } | null = null;
let enCurso: Promise<Respuesta> | null = null;
export function useRacha(activo = true): Respuesta | null {
  const [datos, setDatos] = useState<Respuesta | null>(cache?.datos ?? null);
  useEffect(() => {
    if (!activo) return;
    if (cache && Date.now() - cache.at < 10 * 60_000) return setDatos(cache.datos);
    enCurso ??= callApi<Respuesta>("/api/usuarios/racha", {}).finally(() => (enCurso = null));
    let vivo = true;
    enCurso
      .then((d) => {
        cache = { at: Date.now(), datos: d };
        if (vivo) setDatos(d);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [activo]);
  return datos;
}

const CLAVE_VISTA = (uid: string) => `prodi:racha-vista:${uid}`;

/** El 🔥 de la lista de chats: la racha propia. Al tocarlo, el detalle. Si creció desde la última vez, festeja. */
export function RachaChip() {
  const datos = useRacha(!enModoVista());
  const [abierto, setAbierto] = useState(false);
  const yo = datos?.yo;

  useEffect(() => {
    if (!yo) return;
    try {
      const antes = Number(localStorage.getItem(CLAVE_VISTA(yo.uid)) ?? "0");
      if (yo.racha > antes && yo.racha >= 2) {
        const medalla = MEDALLAS.includes(yo.racha);
        toast.success(medalla ? `🏅 ¡${yo.racha} días seguidos respondiendo a tiempo!` : `🔥 ${yo.racha} días seguidos respondiendo a tiempo`, {
          description: medalla ? "Nueva medalla. Tus clientes lo notan." : "Seguí así: tus clientes lo notan.",
        });
      }
      localStorage.setItem(CLAVE_VISTA(yo.uid), String(yo.racha));
    } catch {
      /* sin almacenamiento */
    }
  }, [yo]);

  if (!yo || (!yo.casos && !yo.racha && !yo.mejor)) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          "flex h-9 items-center gap-1 rounded-full px-2.5 text-sm font-bold tabular-nums transition-colors active:scale-95",
          yo.racha ? "bg-orange-500/15 text-orange-600 hover:bg-orange-500/25 dark:text-orange-400" : "text-muted-foreground hover:bg-muted"
        )}
        aria-label={`Racha de respuestas: ${yo.racha} días`}
        title="Tu racha de respuestas a clientes"
      >
        <Flame className={cn("h-4 w-4", yo.racha && "fill-orange-500/40")} />
        {yo.racha}
      </button>
      <DetalleRacha yo={yo} open={abierto} onOpenChange={setAbierto} />
    </>
  );
}

function DetalleRacha({ yo, open, onOpenChange }: { yo: RachaPersona; open: boolean; onOpenChange: (v: boolean) => void }) {
  const proxima = MEDALLAS.find((m) => m > yo.racha);
  const dia = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-sm overflow-hidden rounded-3xl border-0 p-0">
        <div className="relative flex flex-col items-center bg-gradient-to-br from-orange-500 via-amber-500 to-rose-500 px-6 pb-5 pt-7 text-center text-white">
          <Flame className="h-12 w-12 fill-white/30" />
          <DialogTitle className="mt-1 text-4xl font-extrabold tabular-nums text-white">{yo.racha}</DialogTitle>
          <DialogDescription className="text-sm font-medium text-white/90">
            {yo.racha === 1 ? "día respondiendo a tiempo" : "días seguidos respondiendo a tiempo"}
          </DialogDescription>
          <div className="mt-4 flex gap-1.5">
            {yo.ultimos.map((u) => (
              <span key={u.fecha} className="flex flex-col items-center gap-1 text-[10px] font-semibold uppercase text-white/85">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full",
                    u.estado === "ok" ? "bg-white text-orange-500" : u.estado === "falla" ? "bg-white/25" : "bg-white/10"
                  )}
                >
                  {u.estado === "ok" ? <Flame className="h-4 w-4 fill-orange-400/50" /> : u.estado === "falla" ? "·" : ""}
                </span>
                {dia(u.fecha)}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Dato icono={Award} valor={String(yo.mejor)} label="Mejor racha" />
            <Dato icono={Clock} valor={minutosTexto(yo.promedio)} label="Tardás en promedio" />
            <Dato icono={Target} valor={yo.aTiempo != null ? `${yo.aTiempo}%` : "—"} label="A tiempo (30 días)" />
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {MEDALLAS.map((m) => (
              <span
                key={m}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  yo.mejor >= m ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground/60"
                )}
              >
                🏅 {m} días
              </span>
            ))}
          </div>
          {proxima && <p className="text-center text-xs text-muted-foreground">Te faltan {proxima - yo.racha} días para la medalla de {proxima}.</p>}
          <div className="space-y-1.5 rounded-2xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              <b className="text-foreground">Cómo suma:</b> cuando un cliente escribe, contestarle dentro de 1 hora de atención (lun a vie 9 a 20, sáb 9 a 12). Lo que
              llega fuera de ese horario cuenta desde que abre. Un día suma si todos tus clientes tuvieron respuesta a tiempo.
            </p>
            <p>Domingos y días sin mensajes no cortan la racha, y tenés 1 comodín por semana{yo.comodinUsado ? " (esta semana ya lo usaste)" : ""}.</p>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" /> {AVISO_LEGAL}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Dato({ icono: Icono, valor, label }: { icono: React.ElementType; valor: string; label: string }) {
  return (
    <div className="rounded-2xl border p-2.5">
      <Icono className="mx-auto h-4 w-4 text-orange-500" />
      <p className="mt-1 text-base font-bold tabular-nums">{valor}</p>
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}
