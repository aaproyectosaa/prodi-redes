import { useEffect, useState } from "react";
import { AccionTile } from "@/components/redes/AccionesTablero";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, ClipboardList, Clock, MessageSquareWarning, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PlanMesDialog } from "@/components/redes/PlanMesDialog";
import { useRedes } from "@/contexts/redes-data-context";
import { mesActual, mesLabel, sumarMeses } from "@/lib/redes/format";
import { usoPlan } from "@/lib/redes/planes";
import { cambiosPendientes, mesParaPlanificar, usePlanesDelMes } from "@/lib/redes/planMes";
import { cn } from "@/lib/utils";

/** Botón "Armar el mes" para la cabecera del kanban (producción y admin). */
export function BotonArmarMes({ clienteId, className, tile }: { clienteId?: string | null; className?: string; tile?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {tile ? (
        <AccionTile icon={Sparkles} label="Mes con IA" color="from-violet-500 to-fuchsia-500" onClick={() => setOpen(true)} title="Armar el mes con IA" />
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)} className={cn("border-primary/40", className)}>
          <Sparkles className="mr-2 h-4 w-4 text-primary" /> Armar el mes con IA
        </Button>
      )}
      <PlanMesDialog open={open} onOpenChange={setOpen} clienteId={clienteId} />
    </>
  );
}

interface Item {
  key: string;
  tono: "cambios" | "borrador" | "falta";
  texto: string;
  /** Lo que dice el chip (el texto completo queda de tooltip). */
  corto: string;
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
  const [verLista, setVerLista] = useState(false);
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
  const mesCorto = (m: string) => mesLabel(m).split(" ")[0].slice(0, 3).toLowerCase();
  const items: Item[] = [];
  for (const p of lista) {
    const n = cambiosPendientes(p).length;
    if (p.estado === "respondido" && n)
      items.push({
        key: p.id,
        tono: "cambios",
        texto: `${nombre(p.proyecto_id)} pidió cambios en ${n === 1 ? "1 idea" : `${n} ideas`} de ${mesLabel(p.mes).split(" ")[0].toLowerCase()}`,
        corto: `${nombre(p.proyecto_id)} pidió ${n === 1 ? "1 cambio" : `${n} cambios`} · ${mesCorto(p.mes)}`,
        boton: "Ajustar",
        clienteId: p.proyecto_id,
        mes: p.mes,
      });
    else if (p.estado === "borrador")
      items.push({
        key: p.id,
        tono: "borrador",
        texto: `Borrador sin mandar: ${nombre(p.proyecto_id)} · ${mesLabel(p.mes).split(" ")[0].toLowerCase()}`,
        corto: `Borrador ${nombre(p.proyecto_id)} · ${mesCorto(p.mes)}`,
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
        corto: faltan.length === 1 ? `Falta ${faltan[0].nombre} · ${mesCorto(proximo)}` : `Faltan ${faltan.length} clientes · ${mesCorto(proximo)}`,
        boton: "Armar con IA",
        clienteId: faltan[0].id,
        mes: proximo,
      });
  }

  // Lo más urgente primero: cambios del cliente, borradores, lo que falta armar.
  const orden = { cambios: 0, borrador: 1, falta: 2 } as const;
  items.sort((a, b) => orden[a.tono] - orden[b.tono]);

  const urgentes = items.filter((it) => it.tono === "cambios").length;

  return (
    <>
      {items.length > 0 && (
        <Popover open={verLista} onOpenChange={setVerLista}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-colors animate-in fade-in",
                urgentes ? "bg-orange-500/15 text-orange-700 hover:bg-orange-500/25 dark:text-orange-300" : "bg-primary/10 text-primary hover:bg-primary/15"
              )}
            >
              <ClipboardList className="h-4 w-4" />
              {items.length === 1 ? "1 plan" : `${items.length} planes`}
              <span className="-ml-1 hidden sm:inline">para revisar</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-1.5">
            {items.map((it) => {
              const Icono = it.tono === "cambios" ? MessageSquareWarning : it.tono === "borrador" ? Clock : Sparkles;
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => {
                    setVerLista(false);
                    setAbrir({ clienteId: it.clienteId, mes: it.mes });
                  }}
                  className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <Icono
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      it.tono === "cambios" ? "text-orange-500" : it.tono === "borrador" ? "text-amber-500" : "text-primary"
                    )}
                  />
                  <span className="min-w-0 flex-1 leading-snug">{it.texto}</span>
                  <span className="inline-flex shrink-0 items-center text-xs font-semibold text-primary">
                    {it.boton} <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      )}
      <PlanMesDialog open={!!abrir} onOpenChange={(o) => !o && setAbrir(null)} clienteId={abrir?.clienteId} mes={abrir?.mes} />
    </>
  );
}
