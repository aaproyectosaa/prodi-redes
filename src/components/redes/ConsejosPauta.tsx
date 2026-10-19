import { useEffect, useState } from "react";
import { BotonAplicar, ChatIA } from "@/components/redes/ChatIA";
import { CheckCircle2, FlaskConical, Loader2, RefreshCw, Scissors, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db } from "@/integrations/firebase/client";
import { doc, onSnapshot } from "@/lib/db";
import { callApi } from "@/lib/redes/api";
import { cn } from "@/lib/utils";

// Consejos de la IA para quien maneja la pauta: lee los últimos 90 días de la cuenta del cliente y dice qué mantener,
// qué mejorar, qué cortar y qué probar (api/_lib/ia-pauta.ts). Queda guardado; se rehace a pedido.

interface Sugerencia {
  titulo: string;
  detalle: string;
  tipo: "mantener" | "mejorar" | "cortar" | "probar";
  prioridad: "alta" | "media" | "baja";
}
interface Consejos {
  resumen: string;
  sugerencias: Sugerencia[];
  generado_at: string;
}

const TIPO: Record<Sugerencia["tipo"], { label: string; icono: React.ElementType; clase: string }> = {
  mantener: { label: "Mantener", icono: CheckCircle2, clase: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  mejorar: { label: "Mejorar", icono: TrendingUp, clase: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  cortar: { label: "Cortar", icono: Scissors, clase: "bg-red-500/15 text-red-700 dark:text-red-300" },
  probar: { label: "Probar", icono: FlaskConical, clase: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
};

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

export function ConsejosPauta({ proyectoId }: { proyectoId: string }) {
  const [datos, setDatos] = useState<Consejos | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return onSnapshot(
      doc(db, "ia_pauta", proyectoId),
      (s) => setDatos(s.exists() ? (s.data() as Consejos) : null),
      () => setDatos(null)
    );
  }, [proyectoId]);

  const analizar = async (rehacer: boolean) => {
    setBusy(true);
    try {
      const r = await callApi<Consejos>("/api/ia/pauta-consejos", { proyecto_id: proyectoId, rehacer });
      setDatos(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "La IA no respondió");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.06] to-fuchsia-500/[0.04] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#6F40FC] to-[#E040A0] text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Consejos de la IA</p>
          <p className="text-[11px] text-muted-foreground">
            {datos ? `Analizó los últimos 90 días · ${fecha(datos.generado_at)}` : "Lee los últimos 90 días de pauta y te dice qué mantener y qué mejorar."}
          </p>
        </div>
        <Button size="sm" variant={datos ? "ghost" : "default"} className="h-8 text-xs" disabled={busy || datos === undefined} onClick={() => void analizar(!!datos)}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : datos ? <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          {busy ? "Analizando…" : datos ? "Actualizar" : "Analizar la pauta"}
        </Button>
      </div>

      {datos && (
        <div className="mt-3 space-y-2.5">
          {datos.resumen && <p className="text-sm leading-relaxed">{datos.resumen}</p>}
          <ul className="space-y-2">
            {datos.sugerencias.map((s, i) => {
              const t = TIPO[s.tipo] ?? TIPO.mejorar;
              const Icono = t.icono;
              return (
                <li key={i} className="rounded-xl border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", t.clase)}>
                      <Icono className="h-3 w-3" /> {t.label}
                    </span>
                    <span className="text-sm font-semibold">{s.titulo}</span>
                    {s.prioridad === "alta" && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-300">Prioridad alta</span>}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.detalle}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ChatIA
        className="mt-3"
        tipo="pauta"
        titulo="Especialista Meta"
        proyectoId={proyectoId}
        actual={() => null}
        renderPropuesta={(p, listo) => {
          const texto = String(p.resumen_cliente ?? "");
          return (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-primary">Resumen para el cliente</p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed">{texto}</p>
              <BotonAplicar
                onClick={async () => {
                  await navigator.clipboard.writeText(texto);
                  toast.success("Copiado: pegalo en el chat del cliente");
                  listo();
                }}
              >
                Copiar
              </BotonAplicar>
            </div>
          );
        }}
      />
    </div>
  );
}
