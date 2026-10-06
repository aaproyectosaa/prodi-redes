import { useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell, EmptyState } from "@/components/redes/PageShell";
import { RodajeDialog } from "@/components/redes/RodajeDialog";
import { RodajeRow } from "@/components/redes/RodajeRow";
import { useRedes } from "@/contexts/redes-data-context";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { hoyISO } from "@/lib/redes/format";
import { cancelarRodaje, marcarRodajeRealizado } from "@/lib/redes/videos";
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
  return d.toLocaleDateString("es-AR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
}

export default function Rodajes() {
  const { rodajes, videos } = useRedes();
  const { role, user } = useUserProfileContext();
  const [tab, setTab] = useState<"proximos" | "pasados">("proximos");
  const [dlg, setDlg] = useState<{ open: boolean; rodaje?: Rodaje | null }>({ open: false });
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
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-5">
        <TabsList>
          <TabsTrigger value="proximos">Próximos</TabsTrigger>
          <TabsTrigger value="pasados">Realizados</TabsTrigger>
        </TabsList>
      </Tabs>

      {lista.length === 0 ? (
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

      <RodajeDialog open={dlg.open} onOpenChange={(o) => setDlg((p) => ({ ...p, open: o }))} rodaje={dlg.rodaje} />
    </PageShell>
  );
}
