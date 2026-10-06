import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, PartyPopper, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { mesLabel } from "@/lib/redes/format";
import { responderPlan, usePlanMes } from "@/lib/redes/planMes";
import { cn } from "@/lib/utils";

type Resp = { ok: boolean | null; comentario: string };

/** El cliente mira las ideas del mes (ya revisadas por producción) y dice cuáles van. */
export function PlanMesCliente({
  proyectoId,
  mes,
  open,
  onOpenChange,
}: {
  proyectoId: string;
  mes: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { plan, loading } = usePlanMes(open && mes ? proyectoId : null, mes ?? "");
  const [resp, setResp] = useState<Record<string, Resp>>({});
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [listo, setListo] = useState<{ aprobadas: number; cambios: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResp({});
    setNota("");
    setIntentado(false);
    setListo(null);
  }, [open, mes]);

  const nombreMes = mes ? mesLabel(mes).split(" ")[0].toLowerCase() : "";
  const ideas = plan?.ideas ?? [];
  const respondidas = ideas.filter((i) => {
    const r = resp[i.id];
    return r?.ok === true || (r?.ok === false && r.comentario.trim().length > 0);
  }).length;
  const set = (id: string, patch: Partial<Resp>) =>
    setResp((prev) => ({ ...prev, [id]: { ok: prev[id]?.ok ?? null, comentario: prev[id]?.comentario ?? "", ...patch } }));

  const confirmar = async () => {
    setIntentado(true);
    if (!plan || respondidas < ideas.length) {
      toast.error("Decinos qué te parece cada idea (y qué cambiarías, si algo no te convence)");
      return;
    }
    setBusy(true);
    try {
      const r = await responderPlan(
        plan.proyecto_id,
        plan.mes,
        ideas.map((i) => ({ id: i.id, ok: !!resp[i.id]?.ok, comentario: resp[i.id]?.ok ? null : resp[i.id]?.comentario.trim() })),
        nota.trim() || null
      );
      setListo({ aprobadas: r.aprobadas, cambios: r.cambios });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto rounded-2xl">
        {listo ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center animate-in fade-in zoom-in-95 duration-500">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
              <PartyPopper className="h-8 w-8 animate-bounce motion-reduce:animate-none" />
            </span>
            <DialogTitle className="text-xl">¡Gracias!</DialogTitle>
            <DialogDescription className="max-w-sm">
              {listo.aprobadas > 0 && `Ya pusimos en marcha ${listo.aprobadas === 1 ? "1 video" : `${listo.aprobadas} videos`}. `}
              {listo.cambios > 0 && `Ajustamos ${listo.cambios === 1 ? "la idea que nos marcaste" : "las ideas que nos marcaste"} y te avisamos. `}
              Te vamos contando cada paso por acá y por WhatsApp.
            </DialogDescription>
            <Button className="mt-2" onClick={() => onOpenChange(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl">Tus videos de {nombreMes}</DialogTitle>
              <DialogDescription>
                {plan?.estado === "enviado"
                  ? "Marcá las ideas que van. Si algo no te convence, contanos qué cambiarías."
                  : "Esto es lo que acordamos para el mes."}
              </DialogDescription>
            </DialogHeader>

            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !plan ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay ideas para este mes.</p>
            ) : (
              <div className="space-y-4">
                {plan.nota_equipo && (
                  <div className="rounded-2xl rounded-tl-sm border bg-muted/40 p-3 text-sm">
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Equipo Prodi</p>
                    {plan.nota_equipo}
                  </div>
                )}
                <div className="space-y-3">
                  {ideas.map((i, n) => {
                    const r = resp[i.id];
                    const enviado = plan.estado === "enviado";
                    const falta = intentado && enviado && !(r?.ok === true || (r?.ok === false && r.comentario.trim()));
                    return (
                      <div
                        key={i.id}
                        style={{ animationDelay: `${n * 70}ms` }}
                        className={cn(
                          "rounded-2xl border bg-card p-4 transition-all animate-in fade-in slide-in-from-bottom-2 fill-mode-both motion-reduce:animate-none",
                          r?.ok === true && "border-emerald-500/50 bg-emerald-500/[0.05]",
                          r?.ok === false && "border-orange-500/50 bg-orange-500/[0.04]",
                          falta && "border-destructive/60"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                            {n + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold leading-snug">{i.titulo}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{i.idea}</p>
                            {i.objetivo && (
                              <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                Para: {i.objetivo}
                              </span>
                            )}
                          </div>
                        </div>
                        {enviado ? (
                          <>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                variant={r?.ok === true ? "default" : "outline"}
                                className={cn(r?.ok === true && "bg-emerald-600 hover:bg-emerald-600/90")}
                                onClick={() => set(i.id, { ok: true })}
                              >
                                <ThumbsUp className="mr-1.5 h-4 w-4" /> Va
                              </Button>
                              <Button
                                type="button"
                                variant={r?.ok === false ? "default" : "outline"}
                                className={cn(r?.ok === false && "bg-orange-600 hover:bg-orange-600/90")}
                                onClick={() => set(i.id, { ok: false })}
                              >
                                <Pencil className="mr-1.5 h-4 w-4" /> Cambiaría algo
                              </Button>
                            </div>
                            {r?.ok === false && (
                              <Textarea
                                autoFocus
                                value={r.comentario}
                                onChange={(e) => set(i.id, { comentario: e.target.value })}
                                placeholder="¿Qué cambiarías? Ej.: en vez de la promo, mostrar la pizza nueva"
                                rows={2}
                                maxLength={600}
                                className="mt-2 animate-in fade-in slide-in-from-top-1 duration-200"
                              />
                            )}
                            {falta && (
                              <p className="mt-2 text-xs text-destructive">
                                {r?.ok === false ? "Contanos qué cambiarías." : "Elegí una opción."}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="mt-3 text-xs font-medium">
                            {i.respuesta?.ok ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                                <Check className="h-3.5 w-3.5" /> Aprobada
                              </span>
                            ) : i.descartada ? (
                              <span className="text-muted-foreground">La dejamos para otro momento</span>
                            ) : i.video_id ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                                <Check className="h-3.5 w-3.5" /> Ajustada con tu pedido
                              </span>
                            ) : (
                              <span className="text-orange-700 dark:text-orange-300">La estamos ajustando con lo que nos pediste</span>
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {plan.estado === "enviado" && (
                  <>
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium">¿Algo más que quieras contarnos? (opcional)</p>
                      <Textarea
                        value={nota}
                        onChange={(e) => setNota(e.target.value)}
                        rows={2}
                        maxLength={600}
                        placeholder="Ej.: este mes tenemos 20% off con transferencia"
                      />
                    </div>
                    <div className="sticky -bottom-6 -mx-6 -mb-6 flex items-center justify-between gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur">
                      <span className="text-xs text-muted-foreground">
                        {respondidas} de {ideas.length} listas
                      </span>
                      <Button onClick={() => void confirmar()} disabled={busy}>
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                        Confirmar
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
