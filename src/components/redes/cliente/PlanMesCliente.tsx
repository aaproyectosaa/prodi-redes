import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, PartyPopper, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { mesLabel } from "@/lib/redes/format";
import { useUserProfileContext } from "@/contexts/user-profile-context";
import { responderPlan, usePlanMes, votarIdea } from "@/lib/redes/planMes";
import type { IdeaPlan, PlanMes } from "@/lib/redes/types";
import { cn } from "@/lib/utils";

type Resp = { ok: boolean | null; comentario: string };

/** Escucha el plan de un mes y se lo pasa al padre (así se pueden mirar varios meses juntos). */
function PlanDe({ proyectoId, mes, onPlan }: { proyectoId: string; mes: string; onPlan: (mes: string, p: PlanMes | null, loading: boolean) => void }) {
  const { plan, loading } = usePlanMes(proyectoId, mes);
  useEffect(() => onPlan(mes, plan, loading), [mes, plan, loading, onPlan]);
  return null;
}

/**
 * El cliente mira las ideas del mes (ya revisadas por producción) y dice cuáles van. Con varios meses (una campaña que
 * se filma junta, link /cliente?plan=2026-11,2026-12) ve todas las ideas separadas por mes y confirma todo de una.
 */
export function PlanMesCliente({
  proyectoId,
  mes,
  open,
  onOpenChange,
  integrantes = [],
}: {
  proyectoId: string;
  /** Un mes ("2026-11") o varios separados por coma (campaña). */
  mes: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Los usuarios de la empresa (para avisar si alguien todavía no votó antes de confirmar). */
  integrantes?: string[];
}) {
  const meses = (mes ?? "").split(",").filter((m) => /^\d{4}-\d{2}$/.test(m));
  const [porMes, setPorMes] = useState<Record<string, { plan: PlanMes | null; loading: boolean }>>({});
  const onPlan = useCallback(
    (m: string, p: PlanMes | null, l: boolean) => setPorMes((prev) => (prev[m]?.plan === p && prev[m]?.loading === l ? prev : { ...prev, [m]: { plan: p, loading: l } })),
    []
  );
  const planes = meses.map((m) => porMes[m]?.plan).filter((p): p is PlanMes => !!p);
  const loading = meses.some((m) => porMes[m]?.loading !== false);
  // Con un solo mes, todo sigue como siempre.
  const plan = planes[0] ?? null;
  const campania = meses.length > 1;
  const [resp, setResp] = useState<Record<string, Resp>>({});
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [listo, setListo] = useState<{ aprobadas: number; cambios: number } | null>(null);
  const { user } = useUserProfileContext();
  // (los planes se escuchan con <PlanDe>, uno por mes)
  const uid = user?.uid ?? "";
  // Lo que ya votó cada uno queda guardado: al volver a abrir, aparece como lo dejó.
  const cargado = useRef(false);
  const guardarComentario = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    setResp({});
    setNota("");
    setIntentado(false);
    setListo(null);
    setPorMes({});
    cargado.current = false;
  }, [open, mes]);

  useEffect(() => {
    if (loading || !planes.length || cargado.current) return;
    cargado.current = true;
    const mios: Record<string, Resp> = {};
    for (const p of planes) for (const [id, v] of Object.entries(p.votos?.[uid] ?? {})) mios[`${p.mes}|${id}`] = { ok: v.ok, comentario: v.comentario ?? "" };
    setResp(mios);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, planes.length, uid]);

  const nombreMes = (m: string) => mesLabel(m).split(" ")[0].toLowerCase();
  const titulo = campania
    ? planes[0]?.ideas?.find((i) => i.campania)?.campania
      ? `Tu campaña “${planes[0].ideas.find((i) => i.campania)!.campania}”`
      : `Tus videos de ${nombreMes(meses[0])} a ${nombreMes(meses[meses.length - 1])}`
    : `Tus videos de ${meses[0] ? nombreMes(meses[0]) : ""}`;
  // Cada idea con su plan (clave "mes|id": los ids se repiten entre meses).
  const filas: { k: string; p: PlanMes; i: IdeaPlan }[] = planes.flatMap((p) => (p.ideas ?? []).map((i) => ({ k: `${p.mes}|${i.id}`, p, i })));
  const ideas = filas;
  const enviados = planes.filter((p) => p.estado === "enviado");
  const aResponder = filas.filter((f) => f.p.estado === "enviado");
  const respondidas = aResponder.filter(({ k }) => {
    const r = resp[k];
    return r?.ok === true || (r?.ok === false && r.comentario.trim().length > 0);
  }).length;
  const set = (k: string, p: PlanMes, id: string, patch: Partial<Resp>) => {
    const nuevo = { ok: resp[k]?.ok ?? null, comentario: resp[k]?.comentario ?? "", ...patch };
    setResp((prev) => ({ ...prev, [k]: nuevo }));
    if (p.estado !== "enviado") return;
    // Se guarda al toque (el texto, cuando deja de escribir) para que lo vean los demás.
    const guardar = () => void votarIdea(p.proyecto_id, p.mes, id, nuevo.ok, nuevo.comentario || null).catch(() => {});
    window.clearTimeout(guardarComentario.current[k]);
    if ("comentario" in patch) guardarComentario.current[k] = window.setTimeout(guardar, 700);
    else guardar();
  };
  /** Lo que votaron los demás en una idea. */
  const deOtros = (p: PlanMes, ideaId: string) =>
    Object.entries(p.votos ?? {})
      .filter(([u]) => u !== uid)
      .map(([, v]) => v[ideaId])
      .filter((v): v is NonNullable<typeof v> => !!v && v.ok !== null);

  const confirmar = async () => {
    setIntentado(true);
    if (!enviados.length || respondidas < aResponder.length) {
      toast.error("Decinos qué te parece cada idea (y qué cambiarías, si algo no te convence)");
      return;
    }
    // Al confirmar se cierra para todos: si hay compañeros que todavía no votaron, que lo sepa antes.
    const votaron = new Set(enviados.flatMap((p) => Object.keys(p.votos ?? {})));
    const faltan = integrantes.filter((u) => u !== uid && !votaron.has(u)).length;
    if (
      faltan > 0 &&
      !window.confirm(
        `${faltan === 1 ? "Una persona de tu equipo todavía no votó" : `${faltan} personas de tu equipo todavía no votaron`}. Al confirmar se cierran las ideas para todos. ¿Confirmar igual?`
      )
    )
      return;
    setBusy(true);
    try {
      // Un mes por vez (cada uno es su plan); el mensaje va con el primero.
      const total = { aprobadas: 0, cambios: 0 };
      for (const [n, p] of enviados.entries()) {
        const r = await responderPlan(
          p.proyecto_id,
          p.mes,
          (p.ideas ?? []).map((i) => {
            const x = resp[`${p.mes}|${i.id}`];
            return { id: i.id, ok: !!x?.ok, comentario: x?.ok ? null : x?.comentario.trim() };
          }),
          n === 0 ? nota.trim() || null : null
        );
        total.aprobadas += r.aprobadas;
        total.cambios += r.cambios;
      }
      setListo(total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && meses.map((m) => <PlanDe key={m} proyectoId={proyectoId} mes={m} onPlan={onPlan} />)}
      <DialogContent className="sm:max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto rounded-2xl">
        {listo ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center animate-in fade-in zoom-in-95 duration-500">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
              <PartyPopper className="h-8 w-8 animate-bounce motion-reduce:animate-none" />
            </span>
            <DialogTitle className="text-xl">¡Gracias!</DialogTitle>
            <DialogDescription className="max-w-sm">
              {listo.aprobadas > 0 && `Ya pusimos en marcha ${listo.aprobadas === 1 ? "1 video" : `${listo.aprobadas} videos`}. `}
              {listo.cambios > 0 && `Ajustamos ${listo.cambios === 1 ? "la idea que nos marcaste" : "las ideas que nos marcaste"} y te avisamos. `}
              Te vamos contando cada paso por acá y por mail.
            </DialogDescription>
            <Button className="mt-2" onClick={() => onOpenChange(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl">{titulo}</DialogTitle>
              <DialogDescription>
                {enviados.length
                  ? campania
                    ? `Son ${filas.length} videos que filmamos juntos y se publican de ${nombreMes(meses[0])} a ${nombreMes(meses[meses.length - 1])}. Marcá los que van; si algo no te convence, contanos qué cambiarías.`
                    : "Marcá las ideas que van. Si algo no te convence, contanos qué cambiarías."
                  : campania
                    ? "Esto es lo que acordamos para la campaña."
                    : "Esto es lo que acordamos para el mes."}
              </DialogDescription>
            </DialogHeader>

            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !plan ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay ideas {campania ? "para esta campaña" : "para este mes"}.</p>
            ) : (
              <div className="space-y-4">
                {plan.nota_equipo && (
                  <div className="rounded-2xl rounded-tl-sm border bg-muted/40 p-3 text-sm">
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Equipo Prodi</p>
                    {plan.nota_equipo}
                  </div>
                )}
                <div className="space-y-3">
                  {ideas.map(({ k, p, i }, n) => {
                    const r = resp[k];
                    const enviado = p.estado === "enviado";
                    const falta = intentado && enviado && !(r?.ok === true || (r?.ok === false && r.comentario.trim()));
                    const primeroDelMes = campania && (n === 0 || ideas[n - 1].p.mes !== p.mes);
                    return (
                      <div key={k} className="space-y-3">
                      {primeroDelMes && (
                        <p className="pt-2 text-xs font-bold uppercase tracking-wide text-primary">
                          Se publican en {nombreMes(p.mes)} · {(p.ideas ?? []).length} video{(p.ideas ?? []).length === 1 ? "" : "s"}
                        </p>
                      )}
                      <div
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
                                onClick={() => set(k, p, i.id, { ok: true })}
                              >
                                <ThumbsUp className="mr-1.5 h-4 w-4" /> Va
                              </Button>
                              <Button
                                type="button"
                                variant={r?.ok === false ? "default" : "outline"}
                                className={cn(r?.ok === false && "bg-orange-600 hover:bg-orange-600/90")}
                                onClick={() => set(k, p, i.id, { ok: false })}
                              >
                                <Pencil className="mr-1.5 h-4 w-4" /> Cambiaría algo
                              </Button>
                            </div>
                            {r?.ok === false && (
                              <Textarea
                                autoFocus
                                value={r.comentario}
                                onChange={(e) => set(k, p, i.id, { comentario: e.target.value })}
                                placeholder="¿Qué cambiarías? Ej.: en vez de la promo, mostrar la pizza nueva"
                                rows={2}
                                maxLength={600}
                                className="mt-2 animate-in fade-in slide-in-from-top-1 duration-200"
                              />
                            )}
                            {deOtros(p, i.id).length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {deOtros(p, i.id).map((v) => (
                                  <span
                                    key={v.nombre}
                                    title={v.comentario ?? undefined}
                                    className={cn(
                                      "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
                                      v.ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-orange-500/15 text-orange-700 dark:text-orange-300"
                                    )}
                                  >
                                    {v.ok ? <ThumbsUp className="h-3 w-3 shrink-0" /> : <Pencil className="h-3 w-3 shrink-0" />}
                                    <span className="truncate">
                                      {v.nombre.split(" ")[0]}: {v.ok ? "va" : v.comentario ? `cambiaría: ${v.comentario}` : "cambiaría algo"}
                                    </span>
                                  </span>
                                ))}
                              </div>
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
                            {i.respuesta?.comentario && (
                              <span className="mt-1.5 block whitespace-pre-wrap rounded-xl bg-muted/60 p-2 font-normal text-muted-foreground">“{i.respuesta.comentario}”</span>
                            )}
                          </p>
                        )}
                      </div>
                      </div>
                    );
                  })}
                </div>

                {enviados.length > 0 && (
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
                        {respondidas} de {aResponder.length} listas
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
