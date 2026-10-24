import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, HelpCircle, Lightbulb, Loader2, MessageCircleQuestion, RefreshCw, ShieldAlert, ShoppingBag, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRedes } from "@/contexts/redes-data-context";
import type { Project } from "@/integrations/firebase/types";
import { callApi } from "@/lib/redes/api";
import { useContactos } from "@/lib/redes/crm";
import { dinero, useAnunciosInfo, useAnunciosMeta } from "@/lib/redes/metaPauta";
import { hace } from "@/lib/redes/format";
import { cn } from "@/lib/utils";

// "Qué te vende" (CRM beta): las dos cosas que solo puede mostrar Prodi porque hace los videos y maneja la pauta.
//   1. Qué video trajo cada venta: contactos, ventas y plata por video (y cuánto costó cada venta con su anuncio).
//   2. Lo que más preguntan sus contactos, convertido en ideas de video (api/_lib/crm-ideas.ts). Eso también entra
//      solo en el plan del mes que arma Prodi.

const plata = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;
const PERIODOS = [
  { dias: 30, label: "30 días" },
  { dias: 90, label: "90 días" },
  { dias: 365, label: "Todo el año" },
];
const desdeISO = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

interface Tema {
  tema: string;
  tipo: "pregunta" | "objecion" | "pedido";
  veces: number;
  ejemplos: string[];
  idea: { titulo: string; idea: string };
}
interface Ideas {
  at: string;
  temas: Tema[];
  poco?: boolean;
}
const TIPO: Record<Tema["tipo"], { label: string; icono: React.ElementType; clase: string }> = {
  pregunta: { label: "Preguntan", icono: HelpCircle, clase: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  objecion: { label: "Les frena", icono: ShieldAlert, clase: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  pedido: { label: "Piden", icono: ShoppingBag, clase: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
};

/** 1. Los videos ordenados por lo que vendieron. */
function VideosQueVenden({ cliente }: { cliente: Project }) {
  const [dias, setDias] = useState(90);
  const contactos = useContactos(cliente.id);
  const { videos } = useRedes();
  const desde = desdeISO(dias);
  const anuncios = useAnunciosMeta(cliente.meta?.ad_account_id ? cliente.id : undefined, desde.slice(0, 10));
  const infos = useAnunciosInfo(cliente.meta?.ad_account_id ? cliente.id : undefined);

  const filas = useMemo(() => {
    const lista = (contactos ?? []).filter((c) => c.creado_at >= desde);
    const porVideo = new Map<string, { contactos: number; ventas: number; total: number }>();
    for (const c of lista) {
      if (!c.video_id) continue;
      const f = porVideo.get(c.video_id) ?? { contactos: 0, ventas: 0, total: 0 };
      f.contactos++;
      if (c.etapa === "vendido") {
        f.ventas++;
        f.total += Number(c.monto_venta) || 0;
      }
      porVideo.set(c.video_id, f);
    }
    const gastoPorAnuncio = new Map<string, { gasto: number; moneda?: string }>();
    for (const a of anuncios ?? []) gastoPorAnuncio.set(a.ad_id, { gasto: (gastoPorAnuncio.get(a.ad_id)?.gasto ?? 0) + (Number(a.gasto) || 0) });
    return [...porVideo.entries()]
      .map(([id, f]) => {
        const v = videos.find((x) => x.id === id);
        const adId = v?.meta?.ad_id ?? null;
        const gasto = adId ? gastoPorAnuncio.get(adId)?.gasto ?? 0 : 0;
        const mini = adId ? infos.find((i) => i.ad_id === adId)?.miniatura ?? null : null;
        return { id, titulo: v?.titulo ?? "Video", mes: v?.mes ?? "", mini, gasto, ...f };
      })
      .sort((a, b) => b.total - a.total || b.ventas - a.ventas || b.contactos - a.contactos);
  }, [contactos, videos, anuncios, infos, desde]);

  const sinVideo = (contactos ?? []).filter((c) => c.creado_at >= desde && c.origen === "anuncio" && !c.video_id).length;
  const totalVideos = filas.reduce((a, f) => a + f.total, 0);
  const ganador = filas[0];

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <Clapperboard className="h-4 w-4 text-primary" /> Los videos que te vendieron
          </p>
          <p className="text-xs text-muted-foreground">Cada contacto que llegó por un video, hasta la venta.</p>
        </div>
        <div className="inline-flex rounded-full border bg-background p-0.5">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              onClick={() => setDias(p.dias)}
              className={cn("h-7 rounded-full px-3 text-[11px] font-semibold transition-colors", dias === p.dias ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {ganador && ganador.total > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-primary/15 via-fuchsia-500/10 to-transparent p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-md shadow-primary/25">
            <Trophy className="h-5 w-5" />
          </span>
          <p className="text-sm">
            <b>«{ganador.titulo}»</b> te vendió <b className="text-emerald-600 dark:text-emerald-400">{plata(ganador.total)}</b>
            {totalVideos > ganador.total ? ` (el ${Math.round((ganador.total / totalVideos) * 100)}% de lo que vendieron tus videos)` : ""}.
          </p>
        </div>
      )}

      {contactos === null ? (
        <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : !filas.length ? (
        <p className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">
          Todavía no hay contactos atados a un video. Al cargar un contacto que vino por un anuncio, elegí qué video lo trajo.
        </p>
      ) : (
        <div className="space-y-1.5">
          {filas.map((f, i) => (
            <div key={f.id} className="flex items-center gap-3 rounded-xl border bg-background p-2">
              <span className="w-5 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
              {f.mini ? (
                <img src={f.mini} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Clapperboard className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{f.titulo}</p>
                <p className="text-[11px] text-muted-foreground">
                  {f.contactos} contacto{f.contactos === 1 ? "" : "s"} · {f.ventas} venta{f.ventas === 1 ? "" : "s"}
                  {f.gasto > 0 && f.ventas > 0 ? ` · cada venta costó ${dinero(f.gasto / f.ventas)} de publicidad` : ""}
                </p>
              </div>
              <span className={cn("shrink-0 text-sm font-bold tabular-nums", f.total ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{plata(f.total)}</span>
            </div>
          ))}
        </div>
      )}
      {sinVideo > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          {sinVideo} contacto{sinVideo === 1 ? "" : "s"} de anuncios sin video elegido: abrilos en «Mis contactos» y elegí qué video los trajo.
        </p>
      )}
    </section>
  );
}

/** 2. Lo que más preguntan sus contactos, con el video que lo responde. */
function LoQueTePreguntan({ cliente }: { cliente: Project }) {
  const [ideas, setIdeas] = useState<Ideas | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leer = useCallback(
    async (rehacer: boolean) => {
      setLeyendo(true);
      try {
        setIdeas(await callApi<Ideas>("/api/ia/crm-ideas", { proyecto_id: cliente.id, rehacer }));
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "No se pudo leer";
        setError(msg);
        if (rehacer) toast.error(msg);
      } finally {
        setLeyendo(false);
      }
    },
    [cliente.id]
  );
  useEffect(() => {
    void leer(false);
  }, [leer]);

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <MessageCircleQuestion className="h-4 w-4 text-primary" /> Lo que más te preguntan
          </p>
          <p className="text-xs text-muted-foreground">La IA lee tus charlas de los últimos 60 días y propone un video para cada cosa que se repite.</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => void leer(true)} disabled={leyendo}>
          {leyendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />} Volver a leer
        </Button>
      </div>

      {!ideas && error ? (
        <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">No se pudieron leer las charlas: {error}</p>
      ) : !ideas ? (
        <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Leyendo tus charlas…
        </p>
      ) : !ideas.temas.length ? (
        <p className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">
          {ideas.poco ? "Todavía hay pocas charlas para encontrar lo que se repite. Seguí anotando lo que te escriben." : "Por ahora nada se repite en tus charlas."}
        </p>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {ideas.temas.map((t, i) => {
            const tipo = TIPO[t.tipo] ?? TIPO.pregunta;
            return (
              <div key={i} className="space-y-2 rounded-xl border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug">{t.tema}</p>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", tipo.clase)}>
                    <tipo.icono className="h-3 w-3" /> {tipo.label} · {t.veces}
                  </span>
                </div>
                {t.ejemplos[0] && <p className="text-xs italic text-muted-foreground">“{t.ejemplos[0]}”</p>}
                <div className="rounded-lg bg-gradient-to-br from-primary/[0.08] to-fuchsia-500/[0.06] p-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                    <Lightbulb className="h-3.5 w-3.5" /> Video que lo responde
                  </p>
                  <p className="mt-1 text-sm font-semibold">{t.idea.titulo}</p>
                  <p className="text-xs text-foreground/80">{t.idea.idea}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" /> Prodi usa esto para armar tus próximos videos.{ideas?.at ? ` Leído ${hace(ideas.at)}.` : ""}
      </p>
    </section>
  );
}

export function QueTeVende({ cliente }: { cliente: Project }) {
  return (
    <div className="space-y-4">
      <VideosQueVenden cliente={cliente} />
      <LoQueTePreguntan cliente={cliente} />
    </div>
  );
}
