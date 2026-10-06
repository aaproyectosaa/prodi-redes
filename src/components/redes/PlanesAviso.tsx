import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, Clock, MessageSquareWarning, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanMesDialog } from "@/components/redes/PlanMesDialog";
import { useRedes } from "@/contexts/redes-data-context";
import { mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { usoPlan } from "@/lib/redes/planes";
import { cambiosPendientes, mesParaPlanificar, usePlanesDelMes } from "@/lib/redes/planMes";
import { cn } from "@/lib/utils";

/** Botón "Armar el mes" para la cabecera del kanban (producción y admin). */
export function BotonArmarMes({ clienteId, className }: { clienteId?: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className={cn("border-primary/40", className)}>
        <Sparkles className="mr-2 h-4 w-4 text-primary" /> Armar el mes con IA
      </Button>
      <PlanMesDialog open={open} onOpenChange={setOpen} clienteId={clienteId} />
    </>
  );
}

interface Item {
  key: string;
  tono: "cambios" | "borrador" | "falta";
  texto: string;
  boton: string;
  clienteId: string;
  mes: string;
}

/**
 * Lo que producción tiene pendiente con los planes del mes: cambios que pidió el cliente,
 * borradores sin mandar y clientes a los que les falta el plan del mes que viene.
 * También abre el plan desde el aviso (?plan=<cliente>_<mes>).
 */
export function PlanesAviso() {
  const { clientes, planes, videos } = useRedes();
  const [params, setParams] = useSearchParams();
  const [abrir, setAbrir] = useState<{ clienteId: string; mes: string } | null>(null);
  const meses = [mesActual(), sumarMeses(mesActual(), 1)];
  const lista = usePlanesDelMes(meses).filter((p) => clientes.some((c) => c.id === p.proyecto_id));

  // Link de un aviso: /videos?plan=p1_2026-11
  const desdeLink = params.get("plan");
  useEffect(() => {
    if (!desdeLink) return;
    const m = /^(.+)_(\d{4}-\d{2})$/.exec(desdeLink);
    if (m) setAbrir({ clienteId: m[1], mes: m[2] });
    const next = new URLSearchParams(params);
    next.delete("plan");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desdeLink]);

  const nombre = (id: string) => clientes.find((c) => c.id === id)?.nombre ?? "Cliente";
  const items: Item[] = [];
  for (const p of lista) {
    const n = cambiosPendientes(p).length;
    if (p.estado === "respondido" && n)
      items.push({
        key: p.id,
        tono: "cambios",
        texto: `${nombre(p.proyecto_id)} pidió cambios en ${n === 1 ? "1 idea" : `${n} ideas`} de ${mesLabel(p.mes).split(" ")[0].toLowerCase()}`,
        boton: "Ajustar",
        clienteId: p.proyecto_id,
        mes: p.mes,
      });
    else if (p.estado === "borrador")
      items.push({
        key: p.id,
        tono: "borrador",
        texto: `Borrador sin mandar: ${nombre(p.proyecto_id)} · ${mesLabel(p.mes).split(" ")[0].toLowerCase()}`,
        boton: "Revisar",
        clienteId: p.proyecto_id,
        mes: p.mes,
      });
  }
  // Desde el 15: clientes sin plan para el mes que viene (y con lugar en el plan).
  const proximo = mesParaPlanificar();
  if (proximo !== mesActual()) {
    const faltan = clientes.filter(
      (c) => !lista.some((p) => p.proyecto_id === c.id && p.mes === proximo) && usoPlan(c, planes, videos, proximo).disponibles > 0
    );
    if (faltan.length)
      items.push({
        key: "faltan",
        tono: "falta",
        texto:
          faltan.length === 1
            ? `Falta armar ${mesLabel(proximo).split(" ")[0].toLowerCase()} de ${faltan[0].nombre}`
            : `Faltan armar los videos de ${mesLabel(proximo).split(" ")[0].toLowerCase()} de ${faltan.length} clientes`,
        boton: "Armar con IA",
        clienteId: faltan[0].id,
        mes: proximo,
      });
  }

  return (
    <>
      {items.length > 0 && (
        <div className="mb-4 space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none">
          {items.slice(0, 4).map((it) => {
            const Icono = it.tono === "cambios" ? MessageSquareWarning : it.tono === "borrador" ? Clock : Sparkles;
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => setAbrir({ clienteId: it.clienteId, mes: it.mes })}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-all hover:-translate-y-0.5 hover:shadow-sm",
                  it.tono === "cambios" && "border-orange-500/40 bg-orange-500/[0.07]",
                  it.tono === "borrador" && "border-amber-500/40 bg-amber-500/[0.07]",
                  it.tono === "falta" && "border-primary/30 bg-primary/[0.05]"
                )}
              >
                <Icono
                  className={cn(
                    "h-4 w-4 shrink-0",
                    it.tono === "cambios" ? "text-orange-600" : it.tono === "borrador" ? "text-amber-600" : "text-primary"
                  )}
                />
                <span className="min-w-0 flex-1">{it.texto}</span>
                <span className="inline-flex shrink-0 items-center text-xs font-semibold text-primary">
                  {it.boton} <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      )}
      <PlanMesDialog open={!!abrir} onOpenChange={(o) => !o && setAbrir(null)} clienteId={abrir?.clienteId} mes={abrir?.mes} />
    </>
  );
}
