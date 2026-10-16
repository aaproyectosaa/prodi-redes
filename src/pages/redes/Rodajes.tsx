import { useState } from "react";
import { CalendarDays, Clock, Plus, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell, EmptyState } from "@/components/redes/PageShell";
import { RodajeDialog } from "@/components/redes/RodajeDialog";
import { RodajeRow } from "@/components/redes/RodajeRow";
import { RodajesPorZona } from "@/components/redes/RodajesPorZona";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { formatearFecha } from "@/lib/fecha";
import { hoyISO } from "@/lib/redes/format";
import { cancelarRodaje, marcarRodajeRealizado, textoDuracionRodaje } from "@/lib/redes/videos";
import { canManageProduction } from "@/lib/roles";
import type { Rodaje } from "@/lib/redes/types";

function semanaLabel(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00`);
  const hoy = new Date(`${hoyISO()}T12:00:00`);
  const diff = Math.round((d.getTime() - hoy.getTime()) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff > 1 && diff < 7) return "Esta semana";
  if (diff >= 7 && diff < 14) return "La semana que viene";
  if (diff < 0 && diff > -7) return "Últimos 7 días";
  return formatearFecha(fecha, { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
}

export default function Rodajes() {
  const { rodajes, videos } = useRedes();
  const { role, user } = useUserProfileContext();
  const [tab, setTab] = useState<"proximos" | "pasados" | "zona">("proximos");
  const [dlg, setDlg] = useState<{ open: boolean; rodaje?: Rodaje | null; clienteId?: string; preseleccion?: string[] }>({ open: false });
  const hoy = hoyISO();
  const puede = canManageProduction(role);

  const lista = rodajes
    .filter((r) => r.estado !== "cancelado")
    .filter((r) => (tab === "proximos" ? r.fecha >= hoy && r.estado === "agendado" : r.fecha < hoy || r.estado === "realizado"))
    .sort((a, b) =>
      tab === "proximos"
        ? (a.fecha + (a.hora ?? "")).localeCompare(b.fecha + (b.hora ?? ""))
        : (b.fecha + (b.hora ?? "")).localeCompare(a.fecha + (a.hora ?? ""))
    );

  const grupos = new Map<string, Rodaje[]>();
  for (const r of lista) {
    const k = semanaLabel(r.fecha);
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }

  return (
    <PageShell
      title="Rodajes"
      subtitle="Jornadas de filmación: día, hora, lugar y videos de cada una."
      actions={
        puede && (
          <Button onClick={() => setDlg({ open: true })}>
            <Plus className="mr-2 h-4 w-4" /> Agendar rodaje
          </Button>
        )
      }
    >
      {puede && <TiempoDeRodaje rodajes={rodajes} />}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-5">
        <TabsList>
          <TabsTrigger value="proximos">Próximos</TabsTrigger>
          <TabsTrigger value="pasados">Realizados</TabsTrigger>
          {puede && <TabsTrigger value="zona">Por zona</TabsTrigger>}
        </TabsList>
      </Tabs>

      {tab === "zona" ? (
        <RodajesPorZona puede={puede} onAgendar={(a) => setDlg({ open: true, ...a })} />
      ) : lista.length === 0 ? (
        <EmptyState icon={CalendarDays} title={tab === "proximos" ? "No hay rodajes agendados" : "Todavía no hay rodajes realizados"} />
      ) : (
        <div className="space-y-6">
          {Array.from(grupos.entries()).map(([titulo, items]) => (
            <div key={titulo} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((r) => (
                  <div key={r.id} className="space-y-1">
                    <RodajeRow
                      rodaje={r}
                      onEdit={puede ? () => setDlg({ open: true, rodaje: r }) : undefined}
                      onDone={
                        puede
                          ? async () => {
                              await marcarRodajeRealizado(r);
                              toast.success("Rodaje realizado. Subí el crudo de cada video.");
                            }
                          : undefined
                      }
                    />
                    {puede && r.estado === "agendado" && (
                      <button
                        type="button"
                        className="px-1 text-[11px] text-muted-foreground hover:text-destructive"
                        onClick={async () => {
                          await cancelarRodaje(r, videos, user?.uid ?? "");
                          toast.success("Rodaje cancelado: los videos vuelven a planificados");
                        }}
                      >
                        Cancelar rodaje
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <RodajeDialog open={dlg.open} onOpenChange={(o) => setDlg((p) => ({ ...p, open: o }))} rodaje={dlg.rodaje}
        clienteId={dlg.clienteId}
        preseleccion={dlg.preseleccion}
      />
    </PageShell>
  );
}

/** Estadística interna: cuánto tiempo se filmó este mes (de los rodajes que se iniciaron y terminaron en la app). */
function TiempoDeRodaje({ rodajes }: { rodajes: Rodaje[] }) {
  const mes = hoyISO().slice(0, 7);
  const medidos = rodajes.filter((r) => r.duracion_min && r.fecha.startsWith(mes));
  const enCurso = rodajes.filter((r) => r.inicio_at && !r.fin_at).length;
  const total = medidos.reduce((a, r) => a + (r.duracion_min ?? 0), 0);
  const prom = medidos.length ? Math.round(total / medidos.length) : 0;
  const mayor = medidos.reduce<Rodaje | null>((m, r) => (!m || (r.duracion_min ?? 0) > (m.duracion_min ?? 0) ? r : m), null);
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        { t: "Rodajes medidos", v: String(medidos.length), s: "este mes" },
        { t: "Tiempo filmando", v: total ? textoDuracionRodaje(total) : "—", s: "en total" },
        { t: "Promedio", v: prom ? textoDuracionRodaje(prom) : "—", s: "por rodaje" },
        { t: enCurso ? "Filmando ahora" : "El más largo", v: enCurso ? String(enCurso) : mayor?.duracion_min ? textoDuracionRodaje(mayor.duracion_min) : "—", s: enCurso ? "rodaje en curso" : "este mes" },
      ].map((x) => (
        <div key={x.t} className="rounded-xl border bg-card p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            {x.t === "Filmando ahora" ? <Timer className="h-3.5 w-3.5 text-red-500" /> : <Clock className="h-3.5 w-3.5" />} {x.t}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums">{x.v}</p>
          <p className="text-[11px] text-muted-foreground">{x.s}</p>
        </div>
      ))}
    </div>
  );
}
